"""
简单的 RAG 引擎 - 独立实现
使用向量检索 + LLM 生成进行预测
"""

import numpy as np
import pandas as pd
from typing import List, Dict, Any, Optional
import logging
import re
import os
import time
import json
from pathlib import Path

logger = logging.getLogger(__name__)

# 尝试导入可选依赖
try:
    from sentence_transformers import SentenceTransformer
    SENTENCE_TRANSFORMERS_AVAILABLE = True
except ImportError:
    SENTENCE_TRANSFORMERS_AVAILABLE = False

try:
    import litellm
    LITELLM_AVAILABLE = True
except ImportError:
    LITELLM_AVAILABLE = False


# ============================================================================
# 模块化解析器和验证器类
# ============================================================================

class JSONExtractor:
    """JSON 提取器 - 从文本中提取 JSON 对象"""

    @staticmethod
    def extract_from_code_blocks(text: str) -> List[str]:
        """从 markdown 代码块中提取 JSON

        Args:
            text: 输入文本

        Returns:
            提取到的 JSON 字符串列表
        """
        pattern = r'```(?:json)?\s*(\{.*?\})\s*```'
        matches = re.findall(pattern, text, re.DOTALL)
        return matches

    @staticmethod
    def extract_json_objects(text: str) -> List[str]:
        """从文本中提取所有 JSON 对象（支持深度嵌套）

        Args:
            text: 输入文本

        Returns:
            提取到的 JSON 字符串列表
        """
        # 使用栈来匹配嵌套的花括号，支持任意深度的嵌套
        matches = []
        i = 0
        while i < len(text):
            if text[i] == '{':
                # 找到一个 JSON 对象的开始
                start = i
                stack = ['{']
                i += 1
                in_string = False
                escape_next = False

                while i < len(text) and stack:
                    char = text[i]

                    # 处理转义字符
                    if escape_next:
                        escape_next = False
                        i += 1
                        continue

                    if char == '\\':
                        escape_next = True
                        i += 1
                        continue

                    # 处理字符串
                    if char == '"':
                        in_string = not in_string
                    elif not in_string:
                        if char == '{':
                            stack.append('{')
                        elif char == '}':
                            stack.pop()

                    i += 1

                # 如果栈为空，说明找到了一个完整的 JSON 对象
                if not stack:
                    json_str = text[start:i]
                    matches.append(json_str)
            else:
                i += 1

        return matches

    @staticmethod
    def extract_all_candidates(text: str) -> List[str]:
        """提取所有候选 JSON 字符串（优先代码块）

        Args:
            text: 输入文本

        Returns:
            所有候选 JSON 字符串列表
        """
        code_block_matches = JSONExtractor.extract_from_code_blocks(text)
        json_matches = JSONExtractor.extract_json_objects(text)
        # 优先使用代码块中的 JSON
        return code_block_matches + json_matches


class PredictionExtractor:
    """预测值提取器 - 从解析后的 JSON 中提取预测值"""

    @staticmethod
    def extract_from_predictions_field(
        data: dict,
        target_columns: List[str]
    ) -> Dict[str, Optional[float]]:
        """从 predictions 字段中提取预测值

        支持格式:
        1. {"predictions": {"UTS(MPa)": {"value": 1000, "unit": "MPa"}, ...}}
        2. {"predictions": {"UTS(MPa)": 1000, ...}}
        3. {"predictions": {"target_1": 1000, "target_2": 2000, ...}}

        Args:
            data: 解析后的 JSON 数据
            target_columns: 目标属性列名列表

        Returns:
            提取到的预测值字典
        """
        predictions = {}

        if 'predictions' not in data or not isinstance(data['predictions'], dict):
            return predictions

        pred_dict = data['predictions']

        # 策略1: 直接匹配目标列名
        for target_col in target_columns:
            if target_col in pred_dict:
                pred_data = pred_dict[target_col]
                # 支持 {"value": 1000, "unit": "MPa"} 格式
                if isinstance(pred_data, dict) and 'value' in pred_data:
                    predictions[target_col] = float(pred_data['value'])
                # 支持直接数值格式
                elif isinstance(pred_data, (int, float)):
                    predictions[target_col] = float(pred_data)

        # 策略2: 如果直接匹配失败，尝试匹配 target_1, target_2 等通用键名
        if not predictions and len(target_columns) > 0:
            # 提取所有 target_N 格式的键
            target_keys = sorted([k for k in pred_dict.keys() if k.startswith('target_')])

            # 按顺序映射到目标列
            for i, target_col in enumerate(target_columns):
                if i < len(target_keys):
                    key = target_keys[i]
                    pred_data = pred_dict[key]
                    if isinstance(pred_data, dict) and 'value' in pred_data:
                        predictions[target_col] = float(pred_data['value'])
                    elif isinstance(pred_data, (int, float)):
                        predictions[target_col] = float(pred_data)

        return predictions

    @staticmethod
    def extract_from_single_value_field(
        data: dict,
        target_columns: List[str]
    ) -> Dict[str, Optional[float]]:
        """从单值字段中提取预测值（仅适用于单目标）

        支持格式: {"prediction_value": 1000, ...}

        Args:
            data: 解析后的 JSON 数据
            target_columns: 目标属性列名列表

        Returns:
            提取到的预测值字典
        """
        predictions = {}

        if 'prediction_value' in data and len(target_columns) == 1:
            predictions[target_columns[0]] = float(data['prediction_value'])

        return predictions


class TextPatternExtractor:
    """文本模式提取器 - 从文本中直接提取数字"""

    @staticmethod
    def extract_by_patterns(
        text: str,
        target_columns: List[str]
    ) -> Dict[str, Optional[float]]:
        """使用正则表达式从文本中提取预测值

        Args:
            text: 输入文本
            target_columns: 目标属性列名列表

        Returns:
            提取到的预测值字典
        """
        predictions = {}

        for target_col in target_columns:
            # 定义多种匹配模式
            patterns = [
                # 匹配 "UTS(MPa)": {"value": 1000.0
                rf'"{re.escape(target_col)}":\s*\{{\s*"value":\s*(\d+\.?\d*)',
                # 匹配 "UTS(MPa)": 1000.0
                rf'"{re.escape(target_col)}":\s*(\d+\.?\d*)',
                # 匹配 UTS(MPa): 1000.0
                rf'{re.escape(target_col)}[:\s]+(\d+\.?\d*)',
            ]

            for pattern in patterns:
                match = re.search(pattern, text)
                if match:
                    try:
                        predictions[target_col] = float(match.group(1))
                        logger.debug(f"从文本模式提取 {target_col}: {predictions[target_col]}")
                        break
                    except ValueError:
                        continue

        return predictions


class LLMResponseParser:
    """LLM 响应解析器 - 统一的解析入口"""

    def __init__(self):
        self.json_extractor = JSONExtractor()
        self.pred_extractor = PredictionExtractor()
        self.text_extractor = TextPatternExtractor()

    def parse(
        self,
        text: str,
        target_columns: List[str]
    ) -> Dict[str, Optional[float]]:
        """解析 LLM 响应，提取预测值

        Args:
            text: LLM 响应文本
            target_columns: 目标属性列名列表

        Returns:
            提取到的预测值字典
        """
        predictions = {}

        # 步骤1: 提取所有候选 JSON 字符串
        json_candidates = self.json_extractor.extract_all_candidates(text)

        # 步骤2: 尝试解析每个候选 JSON
        for json_str in json_candidates:
            try:
                data = json.loads(json_str)

                # 尝试从 predictions 字段提取
                preds = self.pred_extractor.extract_from_predictions_field(data, target_columns)
                if preds and all(col in preds for col in target_columns):
                    logger.debug(f"成功从 predictions 字段提取所有目标: {preds}")
                    return preds

                # 尝试从单值字段提取（仅适用于单目标）
                preds = self.pred_extractor.extract_from_single_value_field(data, target_columns)
                if preds:
                    logger.debug(f"成功从单值字段提取: {preds}")
                    return preds

            except (json.JSONDecodeError, ValueError, KeyError):
                # 当前 JSON 解析失败，继续尝试下一个
                continue

        # 步骤3: 如果 JSON 解析失败，尝试从文本中直接提取数字
        if not predictions:
            logger.debug("JSON 解析失败，尝试从文本中提取数字")
            predictions = self.text_extractor.extract_by_patterns(text, target_columns)

        return predictions

    def extract_confidence(self, text: str) -> Optional[str]:
        """从 LLM 响应中提取 confidence 字段

        Args:
            text: LLM 响应文本

        Returns:
            置信度值 ("high", "medium", "low") 或 None
        """
        # 步骤1: 提取所有候选 JSON 字符串
        json_candidates = self.json_extractor.extract_all_candidates(text)

        # 步骤2: 尝试解析每个候选 JSON，查找 confidence 字段
        for json_str in json_candidates:
            try:
                data = json.loads(json_str)

                # 查找 confidence 字段
                if 'confidence' in data:
                    confidence = data['confidence']
                    # 验证值是否有效
                    if isinstance(confidence, str):
                        confidence_lower = confidence.lower()

                        # 标准值: high, medium, low
                        if confidence_lower in ['high', 'medium', 'low']:
                            return confidence_lower

                        # 处理变体: medium-high, medium-low 等
                        if 'high' in confidence_lower:
                            return 'high'
                        elif 'medium' in confidence_lower:
                            return 'medium'
                        elif 'low' in confidence_lower:
                            return 'low'

            except (json.JSONDecodeError, ValueError, KeyError):
                continue

        # 如果没有找到有效的 confidence 字段，返回 None
        return None


class PredictionValidator:
    """预测值验证器 - 验证和填充默认值"""

    @staticmethod
    def validate_and_fill(
        predictions: Dict[str, Optional[float]],
        target_columns: List[str],
        default_value: float = 0.0
    ) -> tuple[Dict[str, float], List[str]]:
        """验证预测值并填充缺失值

        Args:
            predictions: 预测值字典
            target_columns: 目标属性列名列表
            default_value: 缺失值的默认填充值

        Returns:
            (填充后的预测值字典, 缺失的目标列名列表)
        """
        missing_targets = []

        for target_col in target_columns:
            if target_col not in predictions or predictions[target_col] is None:
                predictions[target_col] = default_value
                missing_targets.append(target_col)

        return predictions, missing_targets


class SimpleRAGEngine:
    """
    简单的 RAG 引擎
    使用向量嵌入进行相似样本检索，然后用 LLM 生成预测
    """

    def __init__(
        self,
        embedding_model: str = "all-MiniLM-L6-v2",
        max_retrieved_samples: int = 10,
        similarity_threshold: float = 0.3
    ):
        """
        初始化 RAG 引擎

        Args:
            embedding_model: 嵌入模型名称或本地路径
            max_retrieved_samples: 最大检索样本数
            similarity_threshold: 相似度阈值
        """
        self.max_retrieved_samples = max_retrieved_samples
        self.similarity_threshold = similarity_threshold

        # 初始化嵌入模型
        if SENTENCE_TRANSFORMERS_AVAILABLE:
            try:
                # 优先使用本地模型路径
                model_path = self._get_local_model_path(embedding_model)

                if model_path and os.path.exists(model_path):
                    logger.info(f"Loading embedding model from local path: {model_path}")
                    self.embedder = SentenceTransformer(model_path, device='cpu')
                    logger.info(f"✓ Successfully loaded local embedding model: {embedding_model}")
                else:
                    # 如果本地路径不存在，尝试从 HuggingFace 加载（但会警告）
                    logger.warning(f"Local model path not found: {model_path}")
                    logger.info(f"Attempting to load from HuggingFace: {embedding_model}")
                    self.embedder = SentenceTransformer(embedding_model, device='cpu')
                    logger.info(f"Loaded embedding model from HuggingFace: {embedding_model}")

            except Exception as e:
                logger.error(f"Failed to load embedding model: {e}", exc_info=True)
                logger.warning("Using fallback embedding (random)")
                self.embedder = None
        else:
            self.embedder = None
            logger.warning("sentence-transformers not available, using fallback embedding (random)")

    def _get_local_model_path(self, model_name: str) -> Optional[str]:
        """
        获取本地模型路径

        Args:
            model_name: 模型名称

        Returns:
            本地模型路径，如果不存在则返回 None
        """
        # 获取项目根目录（backend 的父目录）
        backend_dir = Path(__file__).parent.parent
        project_root = backend_dir.parent

        # 检查项目根目录下的模型目录
        local_model_path = project_root / model_name

        if local_model_path.exists() and local_model_path.is_dir():
            # 验证模型文件是否完整
            required_files = ['config.json', 'modules.json']
            if all((local_model_path / f).exists() for f in required_files):
                return str(local_model_path)

        # 检查环境变量指定的路径
        env_path = os.environ.get('SENTENCE_TRANSFORMERS_HOME')
        if env_path:
            env_model_path = Path(env_path) / model_name
            if env_model_path.exists() and env_model_path.is_dir():
                return str(env_model_path)

        return None
    
    def create_embeddings(self, texts: List[str]) -> np.ndarray:
        """
        创建文本嵌入
        
        Args:
            texts: 文本列表
            
        Returns:
            嵌入向量矩阵
        """
        if self.embedder is not None:
            return self.embedder.encode(texts, show_progress_bar=False)
        else:
            # Fallback: 使用简单的哈希嵌入
            embeddings = []
            for text in texts:
                # 简单的字符级嵌入
                vec = np.zeros(384)  # 匹配 all-MiniLM-L6-v2 的维度
                for i, char in enumerate(text[:384]):
                    vec[i] = ord(char) / 255.0
                embeddings.append(vec)
            return np.array(embeddings)
    
    def retrieve_similar_samples(
        self,
        query_text: str,
        train_texts: List[str],
        train_embeddings: np.ndarray
    ) -> List[int]:
        """
        检索相似样本
        
        Args:
            query_text: 查询文本
            train_texts: 训练样本文本列表
            train_embeddings: 训练样本嵌入矩阵
            
        Returns:
            相似样本的索引列表
        """
        # 创建查询嵌入
        query_embedding = self.create_embeddings([query_text])[0]
        
        # 计算余弦相似度
        similarities = np.dot(train_embeddings, query_embedding) / (
            np.linalg.norm(train_embeddings, axis=1) * np.linalg.norm(query_embedding)
        )
        
        # 过滤低于阈值的样本
        valid_indices = np.where(similarities >= self.similarity_threshold)[0]
        
        if len(valid_indices) == 0:
            # 如果没有满足阈值的样本，返回最相似的几个
            top_indices = np.argsort(similarities)[-self.max_retrieved_samples:][::-1]
            return top_indices.tolist()
        
        # 按相似度排序并返回 top-k
        sorted_indices = valid_indices[np.argsort(similarities[valid_indices])[::-1]]
        return sorted_indices[:self.max_retrieved_samples].tolist()
    
    def generate_multi_target_prediction(
        self,
        query_composition: str,
        query_processing: str,
        similar_samples: List[Dict[str, Any]],
        target_columns: List[str],
        model_provider: str = "gemini",
        model_name: str = "gemini-2.5-flash",
        temperature: float = 1.0,
        return_details: bool = False,
        custom_template: Optional[Dict] = None,
        query_features: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        使用 LLM 生成多目标预测

        Args:
            query_composition: 查询样本的组成
            query_processing: 查询样本的热处理
            similar_samples: 相似样本列表（每个样本可包含特征列）
            target_columns: 目标列名列表
            model_provider: 模型提供商
            model_name: 模型名称
            temperature: 温度参数
            return_details: 是否返回详细信息（prompt 和 LLM 响应）
            custom_template: 自定义模板
            query_features: 查询样本的特征列字典（可选），例如 {"Temperature": 298, "Pressure": 1}

        Returns:
            如果 return_details=False: {target_column: prediction_value}
            如果 return_details=True: {
                'predictions': {target_column: prediction_value},
                'prompt': str,
                'llm_response': str,
                'similar_samples': List[Dict]
            }
        """
        # 调用 LLM
        if LITELLM_AVAILABLE:
            # 构建提示词（在 try 外部，确保即使失败也能保存）
            prompt = None
            try:
                from services.prompt_builder import PromptBuilder
                from services.prompt_template_manager import PromptTemplateManager

                # 从自定义模板中获取列名映射，如果没有则使用默认值
                column_name_mapping = None
                if custom_template and "column_name_mapping" in custom_template:
                    column_name_mapping = custom_template["column_name_mapping"]
                else:
                    column_name_mapping = PromptTemplateManager.get_default_column_mapping()

                # 从自定义模板中获取 apply_mapping_to_target 选项，默认为 True
                apply_mapping_to_target = True
                if custom_template and "apply_mapping_to_target" in custom_template:
                    apply_mapping_to_target = custom_template["apply_mapping_to_target"]

                logger.info(f"使用列名映射: {column_name_mapping}")

                prompt_builder = PromptBuilder(
                    custom_template=custom_template,
                    column_name_mapping=column_name_mapping,
                    apply_mapping_to_target=apply_mapping_to_target
                )

                # 使用统一的样本文本构建工具
                from services.sample_text_builder import SampleTextBuilder

                # 格式化测试样本（使用原始列名，后续由 PromptBuilder 应用列名映射）
                # 处理 query_processing：支持字典（多工艺列）或字符串（单工艺列）
                processing_dict = None
                if query_processing:
                    if isinstance(query_processing, dict):
                        processing_dict = query_processing
                    elif str(query_processing).strip():
                        # 单工艺列（向后兼容）：使用 "Processing" 作为键
                        processing_dict = {"Processing": query_processing}

                # 构建测试样本文本
                test_sample = SampleTextBuilder.build_sample_text(
                    composition=query_composition,
                    processing_columns=processing_dict,
                    feature_columns=query_features
                )
                if not test_sample:
                    test_sample = "No data available"

                # 格式化相似样本
                # 优先使用已经构建好的 sample_text（已应用列名映射）
                # 如果不存在，则重新构建（向后兼容）
                retrieved_samples = []
                for sample in similar_samples:
                    # 优先使用已经存在的 sample_text
                    if 'sample_text' in sample and sample['sample_text']:
                        sample_text = sample['sample_text']
                    else:
                        # 向后兼容：如果没有 sample_text，则重新构建
                        # 确定工艺列列表
                        processing_columns = None
                        if isinstance(query_processing, dict):
                            processing_columns = list(query_processing.keys())
                        elif sample.get('processing'):
                            # 向后兼容：单工艺列
                            processing_columns = ["processing"]

                        # 确定特征列列表
                        feature_columns = list(query_features.keys()) if query_features else None

                        # 使用 SampleTextBuilder 构建样本文本
                        sample_text = SampleTextBuilder.build_from_dict(
                            sample_dict=sample,
                            composition_key="composition",
                            processing_columns=processing_columns,
                            feature_columns=feature_columns
                        )

                    # metadata 包含所有目标列的值
                    retrieved_samples.append((sample_text, 1.0, sample))

                # 构建提示词（多目标）
                prompt = prompt_builder.build_prompt(
                    retrieved_samples=retrieved_samples,
                    test_sample=test_sample,
                    target_properties=target_columns
                )

                # 加载 LLM 配置
                from services.llm_config_loader import get_model_config_by_name

                # 处理模型名称：如果 model_name 已经包含 provider 前缀，直接使用
                if '/' in model_name:
                    full_model_name = model_name
                else:
                    full_model_name = f"{model_provider}/{model_name}"

                # 从配置文件获取 API Key 和 Base URL
                model_config = get_model_config_by_name(full_model_name)

                # 重试配置
                max_retries = 3
                retry_delay = 2  # 初始延迟（秒）
                last_error = None

                for attempt in range(max_retries):
                    try:
                        if model_config:
                            api_key = model_config.get('api_key')
                            base_url = model_config.get('base_url')
                            actual_model = model_config.get('model', full_model_name)

                            if attempt > 0:
                                logger.info(f"Retry attempt {attempt + 1}/{max_retries} for model: {actual_model}")
                            else:
                                logger.info(f"Calling LLM with model: {actual_model}")
                                logger.info(f"Using base_url: {base_url}")

                            # 调用 LLM（传递 API Key 和 Base URL）
                            response = litellm.completion(
                                model=actual_model,
                                messages=[{"role": "user", "content": prompt}],
                                temperature=temperature,
                                api_key=api_key,
                                base_url=base_url
                            )
                        else:
                            # 如果没有找到配置，使用默认方式调用（依赖环境变量）
                            if attempt == 0:
                                logger.warning(f"No config found for model: {full_model_name}, using environment variables")
                            response = litellm.completion(
                                model=full_model_name,
                                messages=[{"role": "user", "content": prompt}],
                                temperature=temperature
                            )

                        prediction_text = response.choices[0].message.content

                        # 从响应中提取多目标预测值
                        predictions = self._extract_multi_target_predictions(prediction_text, target_columns)

                        # 如果需要返回详细信息
                        if return_details:
                            return {
                                'predictions': predictions,
                                'prompt': prompt,
                                'llm_response': prediction_text,
                                'similar_samples': similar_samples
                            }
                        else:
                            return predictions

                    except Exception as retry_error:
                        last_error = retry_error
                        error_str = str(retry_error)

                        # 检查是否是可重试的错误（500 内部服务器错误）
                        is_retryable = (
                            'InternalServerError' in error_str or
                            'Internal server error' in error_str or
                            '500' in error_str or
                            'http_error' in error_str
                        )

                        if is_retryable and attempt < max_retries - 1:
                            wait_time = retry_delay * (2 ** attempt)  # 指数退避
                            logger.warning(
                                f"LLM API 调用失败 (尝试 {attempt + 1}/{max_retries}): {error_str}. "
                                f"等待 {wait_time} 秒后重试..."
                            )
                            time.sleep(wait_time)
                        else:
                            # 不可重试的错误或已达到最大重试次数
                            if attempt < max_retries - 1:
                                logger.error(f"遇到不可重试的错误: {error_str}")
                            break

                # 所有重试都失败
                logger.error(f"LLM prediction failed after {max_retries} attempts: {last_error}", exc_info=True)
                # 预测失败时，填充 0 而不是使用平均值
                predictions = {col: 0.0 for col in target_columns}
                error_msg = f"Error: {str(last_error)}"
                logger.warning(f"使用默认值 0.0 填充所有目标属性: {list(target_columns)}")
                if return_details:
                    return {
                        'predictions': predictions,
                        'prompt': prompt if 'prompt' in locals() else None,  # 保存已构建的 prompt（如果有）
                        'llm_response': error_msg,
                        'similar_samples': similar_samples
                    }
                else:
                    return predictions

            except Exception as e:
                logger.error(f"LLM prediction failed: {e}", exc_info=True)
                # 预测失败时，填充 0 而不是使用平均值
                predictions = {col: 0.0 for col in target_columns}
                error_msg = f"Error: {str(e)}"
                logger.warning(f"使用默认值 0.0 填充所有目标属性: {list(target_columns)}")
                if return_details:
                    return {
                        'predictions': predictions,
                        'prompt': prompt if 'prompt' in locals() else None,  # 保存已构建的 prompt（如果有）
                        'llm_response': error_msg,
                        'similar_samples': similar_samples
                    }
                else:
                    return predictions
        else:
            # Fallback: 使用平均值
            predictions = self._fallback_multi_target_prediction(similar_samples, target_columns)
            if return_details:
                return {
                    'predictions': predictions,
                    'prompt': None,
                    'llm_response': "LiteLLM not available, using fallback",
                    'similar_samples': similar_samples
                }
            else:
                return predictions

    def _extract_multi_target_predictions(
        self,
        text: str,
        target_columns: List[str]
    ) -> Dict[str, Optional[float]]:
        """从 LLM 响应中提取多目标预测值（模块化设计）

        改进的提取策略:
        1. 优先查找包含 "predictions" 字段的JSON块
        2. 使用非贪婪匹配和多种模式
        3. 支持JSON在文本任意位置(开头、中间、末尾)
        4. 支持markdown代码块包裹的JSON
        5. 支持动态数量的目标属性（1个、2个、3个或更多）
        6. 支持动态目标属性键名（如 "target_1", "UTS(MPa)" 等）
        """
        # 使用模块化解析器
        parser = LLMResponseParser()
        predictions = parser.parse(text, target_columns)

        # 验证和填充默认值
        validator = PredictionValidator()
        predictions, missing_targets = validator.validate_and_fill(predictions, target_columns)

        # 记录解析失败的详细信息
        if missing_targets:
            logger.warning(
                f"LLM 响应解析失败，以下目标属性使用默认值 0.0: {missing_targets}\n"
                f"响应内容（前500字符）: {text[:500]}\n"
                f"响应内容（后500字符）: {text[-500:]}"
            )

        return predictions

    def _fallback_multi_target_prediction(
        self,
        similar_samples: List[Dict[str, Any]],
        target_columns: List[str]
    ) -> Dict[str, Optional[float]]:
        """Fallback 多目标预测：预测失败时填充 0"""
        # 预测失败时，所有目标属性填充 0
        predictions = {col: 0.0 for col in target_columns}
        return predictions

