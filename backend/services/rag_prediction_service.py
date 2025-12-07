"""
RAG 预测服务 - 独立实现的 RAG+LLM 多目标预测服务
使用向量检索 + LLM 生成的方式进行预测
"""

import os
import pandas as pd
import numpy as np
from pathlib import Path
from typing import List, Dict, Any, Optional
import logging
import json
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
import threading

from models.schemas import PredictionConfig, TaskStatus
from services.task_manager import TaskManager
from services.simple_rag_engine import SimpleRAGEngine
from services.prompt_builder import PromptBuilder
from services.prompt_template_manager import PromptTemplateManager
from services.sample_text_builder import SampleTextBuilder
from config import RESULTS_DIR

logger = logging.getLogger(__name__)


def safe_write_file(file_path: Path, content: str, max_retries: int = 3, retry_delay: float = 0.3) -> bool:
    """
    安全写入文件（带重试机制）

    Args:
        file_path: 文件路径
        content: 文件内容
        max_retries: 最大重试次数
        retry_delay: 重试延迟（秒）

    Returns:
        是否成功写入
    """
    for attempt in range(max_retries):
        try:
            with open(file_path, 'w', encoding='utf-8') as f:
                f.write(content)
            return True
        except PermissionError as e:
            if attempt < max_retries - 1:
                logger.warning(f"文件写入失败，重试 (尝试 {attempt + 1}/{max_retries}): {file_path}")
                time.sleep(retry_delay)
            else:
                logger.error(f"❌ 文件权限错误: {e} - {file_path}")
                return False
        except Exception as e:
            logger.error(f"文件写入失败: {e} - {file_path}")
            return False
    return False


class RAGPredictionService:
    """
    RAG 预测服务 - 独立实现
    使用向量检索 + LLM 生成进行多目标预测
    """

    def __init__(self, task_manager: TaskManager):
        """
        初始化 RAG 预测服务

        Args:
            task_manager: 任务管理器实例
        """
        self.task_manager = task_manager
        self.rag_engine = None
        self.results_dir = RESULTS_DIR  # 添加 results_dir 属性

    def _apply_column_name_mapping(self, text: str, column_name_mapping: Optional[Dict[str, str]] = None) -> str:
        """
        应用列名映射到文本中

        Args:
            text: 原始文本，例如 "Composition: ...\nProcessing_Description: ..."
            column_name_mapping: 列名映射字典，例如 {"Processing_Description": "Heat treatment method"}

        Returns:
            映射后的文本，例如 "Composition: ...\nHeat treatment method: ..."
        """
        if not column_name_mapping:
            # 使用默认映射
            column_name_mapping = PromptTemplateManager.get_default_column_mapping()

        result = text
        for old_name, new_name in column_name_mapping.items():
            # 替换 "old_name:" 为 "new_name:"
            if f"{old_name}:" in result:
                result = result.replace(f"{old_name}:", f"{new_name}:")

        return result

    def _format_composition(self, row: pd.Series, composition_columns: list) -> tuple:
        """
        格式化组分信息

        Args:
            row: 数据行
            composition_columns: 组分列名列表

        Returns:
            (unit_type, composition_str) - 例如 ("at%", "Fe 26.3, Ni 26.3, Cr 21.1, Co 21, Al 5.3")
        """
        # 判断单位类型
        unit_type = ""
        if any('wt%' in col.lower() for col in composition_columns):
            unit_type = "wt%"
        elif any('at%' in col.lower() for col in composition_columns):
            unit_type = "at%"

        # 格式化组分
        comp_parts = []
        for col in composition_columns:
            value = row[col]
            # 提取元素名称（去掉单位部分，如 "(at%)" 或 "(wt%)"）
            element = col.split('(')[0].strip()
            # 只包含非零值的元素
            if value > 0:
                comp_parts.append(f"{element} {value}")

        composition_str = ", ".join(comp_parts)
        return unit_type, composition_str

    def run_prediction(
        self,
        task_id: str,
        file_path: str,
        config: PredictionConfig
    ):
        """
        执行 RAG 预测任务（在后台线程中运行）

        Args:
            task_id: 任务ID
            file_path: 上传的CSV文件路径
            config: 预测配置
        """
        try:
            # 更新任务状态为运行中
            self.task_manager.update_task_status(
                task_id=task_id,
                status=TaskStatus.RUNNING,
                progress=0.0,
                message="正在初始化预测任务..."
            )

            # 创建任务专属结果目录
            task_results_dir = RESULTS_DIR / task_id
            task_results_dir.mkdir(parents=True, exist_ok=True)

            logger.info(f"Task {task_id}: Starting RAG prediction")
            logger.info(f"File: {file_path}")
            logger.info(f"Config: {config.model_dump()}")

            # 检查是否为增量预测（只有在非强制重启模式下才进行增量预测）
            existing_predictions = None
            if config.continue_from_task_id and not getattr(config, 'force_restart', False):
                logger.info(f"Task {task_id}: 增量预测模式，继续任务 {config.continue_from_task_id}")
                existing_predictions = self._load_existing_predictions(config.continue_from_task_id)
            elif getattr(config, 'force_restart', False):
                logger.info(f"Task {task_id}: 强制重启模式，忽略之前的预测结果")

            # 1. 数据预处理和划分
            self.task_manager.update_task_status(
                task_id=task_id,
                status=TaskStatus.RUNNING,
                progress=0.1,
                message="正在加载和预处理数据..."
            )

            train_df, test_df, composition_columns = self._prepare_data(file_path, config)

            # 保存测试集到结果目录，便于后续通过 sample_index 定位样本
            test_set_file = task_results_dir / "test_set.csv"
            test_df.to_csv(test_set_file, index=False)
            logger.info(f"Task {task_id}: 测试集已保存到 {test_set_file}")

            # 如果是增量预测，不过滤测试集，而是在采样时排除已预测的样本
            # 这样可以保持test_df的完整性，便于后续基于索引进行增量预测
            predicted_indices = set()
            if config.continue_from_task_id:
                # 从process_details.json中提取已预测的样本索引
                logger.info(f"Task {task_id}: 增量预测模式 - 继续任务 {config.continue_from_task_id}")
                try:
                    import json
                    from pathlib import Path
                    prev_task_dir = Path(self.results_dir) / config.continue_from_task_id
                    details_file = prev_task_dir / "process_details.json"
                    logger.info(f"Task {task_id}: 尝试从 {details_file} 加载已预测样本索引")
                    if details_file.exists():
                        with open(details_file, 'r', encoding='utf-8') as f:
                            details = json.load(f)
                            predicted_indices = set(d['sample_index'] for d in details if 'sample_index' in d)
                        logger.info(
                            f"Task {task_id}: ✓ 从 process_details.json 加载已预测样本索引: "
                            f"{sorted(predicted_indices)} (共 {len(predicted_indices)} 个)"
                        )
                    else:
                        logger.warning(f"Task {task_id}: process_details.json 不存在，尝试从 predictions.csv 推断")
                        # 如果 process_details.json 不存在，尝试从 predictions.csv 推断
                        if existing_predictions is not None and 'sample_index' in existing_predictions.columns:
                            predicted_indices = set(existing_predictions['sample_index'].dropna().astype(int).tolist())
                            logger.info(
                                f"Task {task_id}: ✓ 从 predictions.csv 推断已预测样本索引: "
                                f"{sorted(predicted_indices)} (共 {len(predicted_indices)} 个)"
                            )
                except Exception as e:
                    logger.warning(f"Task {task_id}: 无法加载已预测的样本索引: {e}")
                    # 最后的备选方案：如果 existing_predictions 存在，假设已预测的样本数量等于 existing_predictions 的行数
                    if existing_predictions is not None:
                        # 假设已预测的样本是从 0 开始的连续索引
                        predicted_count = len(existing_predictions)
                        predicted_indices = set(range(predicted_count))
                        logger.warning(f"Task {task_id}: 使用备选方案，假设已预测样本索引为 0-{predicted_count-1}")

                # 【关键修复】检查已预测样本中是否存在零值，如果存在则需要重新预测
                if existing_predictions is not None and not existing_predictions.empty and predicted_indices:
                    zero_value_indices = self._identify_zero_value_samples(
                        existing_predictions,
                        config.target_columns
                    )
                    if zero_value_indices:
                        logger.warning(
                            f"Task {task_id}: 发现 {len(zero_value_indices)} 个零值样本需要重新预测: "
                            f"{sorted(zero_value_indices)}"
                        )
                        # 从已预测索引中移除零值样本，使其被重新预测
                        predicted_indices -= zero_value_indices
                        logger.info(
                            f"Task {task_id}: 移除零值样本后，有效已预测样本索引: "
                            f"{sorted(predicted_indices)} (共 {len(predicted_indices)} 个)"
                        )

                # 检查是否所有样本都已预测
                if len(predicted_indices) >= config.sample_size:
                    logger.info(
                        f"Task {task_id}: 已预测 {len(predicted_indices)} 个样本，"
                        f"达到或超过目标 {config.sample_size}，无需继续"
                    )
                    self.task_manager.update_task_status(
                        task_id=task_id,
                        status=TaskStatus.COMPLETED,
                        progress=1.0,
                        message=f"已完成 {len(predicted_indices)} 个样本的预测",
                        result_id=config.continue_from_task_id
                    )
                    return
                else:
                    logger.info(
                        f"Task {task_id}: 需要新增 {config.sample_size - len(predicted_indices)} 个样本 "
                        f"(目标: {config.sample_size}, 已完成: {len(predicted_indices)})"
                    )

            logger.info(f"Task {task_id}: Data prepared - Train: {len(train_df)}, Test: {len(test_df)}")

            # 2. 初始化 RAG 引擎
            self.task_manager.update_task_status(
                task_id=task_id,
                status=TaskStatus.RUNNING,
                progress=0.2,
                message="正在初始化 RAG 引擎..."
            )

            self.rag_engine = SimpleRAGEngine(
                max_retrieved_samples=config.max_retrieved_samples,
                similarity_threshold=config.similarity_threshold
            )

            logger.info(f"Task {task_id}: RAG engine initialized")

            # 3. 执行多目标预测
            self.task_manager.update_task_status(
                task_id=task_id,
                status=TaskStatus.RUNNING,
                progress=0.3,
                message=f"正在预测 {len(config.target_columns)} 个目标..."
            )

            results, prediction_details, sampled_test_df = self._run_multi_target_prediction(
                train_df=train_df,
                test_df=test_df,
                config=config,
                task_id=task_id,
                task_results_dir=task_results_dir,
                composition_columns=composition_columns,
                predicted_indices=predicted_indices
            )

            logger.info(f"Task {task_id}: Prediction completed")

            # 检查是否有预测结果（任务取消前可能没有完成任何预测）
            has_predictions = len(prediction_details) > 0

            if not has_predictions:
                # 没有任何预测结果，检查是否被取消
                current_task = self.task_manager.get_task(task_id)
                if current_task and current_task.get('status') == 'cancelled':
                    logger.info(f"Task {task_id}: Task cancelled before any predictions completed")
                    self.task_manager.update_task_status(
                        task_id=task_id,
                        status=TaskStatus.CANCELLED,
                        progress=0.0,
                        message="任务已取消（未完成任何预测）"
                    )
                    return
                else:
                    # 非取消情况下没有结果，这是异常
                    raise ValueError("预测完成但没有生成任何结果")

            # 5. 保存结果
            self.task_manager.update_task_status(
                task_id=task_id,
                status=TaskStatus.RUNNING,
                progress=0.9,
                message="正在保存结果..."
            )

            # 如果是增量预测，合并将在保存阶段完成

            result_id = self._save_results(
                results=results,
                test_df=sampled_test_df,  # 使用采样后的测试集
                config=config,
                task_results_dir=task_results_dir,
                existing_predictions=existing_predictions,
                composition_columns=composition_columns,
                processing_column=config.processing_column,
            )

            # 6. 保存预测详细信息到 process_details（增量预测时进行合并）
            import json
            process_details_file = task_results_dir / "process_details.json"

            final_prediction_details = prediction_details
            try:
                if config.continue_from_task_id:
                    # 先读取已有的 process_details
                    prev_details = []
                    if process_details_file.exists():
                        with open(process_details_file, 'r', encoding='utf-8') as f:
                            prev_details = json.load(f)
                        prev_indices = [d.get('sample_index') for d in prev_details if isinstance(d, dict)]
                        logger.info(
                            f"Task {task_id}: 增量预测 - 加载已有样本详细信息: "
                            f"索引 {sorted(prev_indices)} (共 {len(prev_details)} 个)"
                        )

                    # 以 sample_index 为键合并，新值覆盖旧值
                    # 先将已有数据放入字典（使用sample_index作为键）
                    merged_map = {d.get('sample_index'): d for d in prev_details if isinstance(d, dict)}
                    # 新数据覆盖旧数据
                    new_indices = []
                    for d in prediction_details:
                        idx = d.get('sample_index')
                        merged_map[idx] = d
                        new_indices.append(idx)
                    # 按 sample_index 升序排序
                    final_prediction_details = sorted(
                        merged_map.values(),
                        key=lambda x: x.get('sample_index', 0)
                    )
                    final_indices = [d.get('sample_index') for d in final_prediction_details]
                    logger.info(
                        f"Task {task_id}: ✓ 合并 process_details 完成 - "
                        f"新增样本索引: {sorted(new_indices)}, "
                        f"合并后总索引: {sorted(final_indices)} (共 {len(final_prediction_details)} 个)"
                    )
            except Exception as e:
                logger.warning(f"合并 process_details 失败，使用本次结果: {e}")

            # 使用安全写入保存 process_details
            process_details_json = json.dumps(final_prediction_details, ensure_ascii=False, indent=2)
            safe_write_file(process_details_file, process_details_json)

            # 6.1 为每个样本创建独立的 prompt 和 response 文件
            # 使用唯一标识符（组分+工艺的哈希值）来命名文件，避免增量预测时的冲突
            inputs_dir = task_results_dir / "inputs"
            outputs_dir = task_results_dir / "outputs"
            inputs_dir.mkdir(exist_ok=True)
            outputs_dir.mkdir(exist_ok=True)

            import hashlib
            saved_count = 0
            failed_count = 0
            for detail in prediction_details:
                # 使用组分+工艺生成唯一标识符
                sample_key = f"{detail.get('composition', '')}|{detail.get('processing', '')}"
                sample_hash = hashlib.md5(sample_key.encode('utf-8')).hexdigest()[:8]
                sample_idx = detail['sample_index']

                # 文件名格式：sample_{index}_{hash}.txt
                file_suffix = f"{sample_idx}_{sample_hash}"

                # 始终保存 prompt（输入）- 使用安全写入
                prompt_file = inputs_dir / f"sample_{file_suffix}.txt"
                if not safe_write_file(prompt_file, detail.get('prompt', '')):
                    failed_count += 1

                # 只有预测成功时才保存 LLM response（输出）
                llm_response = detail.get('llm_response', '')
                if llm_response and not llm_response.startswith('Error:'):
                    response_file = outputs_dir / f"sample_{file_suffix}.txt"
                    if safe_write_file(response_file, llm_response):
                        saved_count += 1
                    else:
                        failed_count += 1
                else:
                    logger.debug(f"跳过保存失败样本的输出文件: sample_{file_suffix}.txt")

            if failed_count > 0:
                logger.warning(f"Task {task_id}: {failed_count} 个文件写入失败")
            logger.info(f"Task {task_id}: Saved {len(prediction_details)} prompts to inputs/ and {saved_count} successful responses to outputs/")

            # 更新任务的 process_details 字段（使用合并后的结果）
            self.task_manager.update_task_process_details(
                task_id=task_id,
                process_details=final_prediction_details
            )

            # 6.2 保存任务配置信息到 task_config.json
            task_info = self.task_manager.get_task_status(task_id)
            if task_info:
                task_config = {
                    "task_id": task_id,
                    "status": task_info.get("status"),
                    "progress": task_info.get("progress", 1.0),
                    "message": task_info.get("message", "预测完成"),
                    "created_at": task_info.get("created_at"),
                    "updated_at": task_info.get("updated_at"),
                    "request_data": task_info.get("request_data", {})
                }

                task_config_file = task_results_dir / "task_config.json"
                with open(task_config_file, 'w', encoding='utf-8') as f:
                    json.dump(task_config, f, ensure_ascii=False, indent=2)

                logger.info(f"Task {task_id}: Saved task config to task_config.json")

            logger.info(f"Task {task_id}: Results saved with ID {result_id}")

            # 6. 任务完成（检查是否被取消）
            current_task = self.task_manager.get_task(task_id)
            if current_task and current_task.get('status') == 'cancelled':
                # 任务已被取消，保持取消状态但保存部分结果
                self.task_manager.update_task_status(
                    task_id=task_id,
                    status=TaskStatus.CANCELLED,
                    progress=1.0,
                    message=f"任务已取消（已保存 {len(prediction_details)} 个样本的部分结果）",
                    result_id=result_id
                )
                logger.info(f"Task {task_id}: Task was cancelled, partial results saved")
            else:
                # 正常完成
                self.task_manager.update_task_status(
                    task_id=task_id,
                    status=TaskStatus.COMPLETED,
                    progress=1.0,
                    message="预测完成",
                    result_id=result_id
                )
                logger.info(f"Task {task_id}: Task completed successfully")
            
        except Exception as e:
            logger.error(f"Task {task_id}: Prediction failed - {str(e)}", exc_info=True)
            self.task_manager.update_task_status(
                task_id=task_id,
                status=TaskStatus.FAILED,
                message=f"预测失败: {str(e)}",
                error=str(e)
            )

    def _prepare_data(
        self,
        file_path: str,
        config: PredictionConfig
    ) -> tuple:
        """
        准备训练和测试数据

        Returns:
            (train_df, test_df, composition_columns)
        """
        # 读取CSV文件（保留原始DataFrame索引）
        df = pd.read_csv(file_path)

        # 处理 composition_column：可能是单个列名或列名列表
        if isinstance(config.composition_column, str):
            composition_columns = [config.composition_column]
        else:
            composition_columns = config.composition_column

        # 验证必需的列存在
        required_cols = composition_columns + config.target_columns
        # 工艺列是可选的，只有在提供时才验证
        if config.processing_column:
            required_cols.extend(config.processing_column)
        missing_cols = [col for col in required_cols if col not in df.columns]
        if missing_cols:
            raise ValueError(f"缺少必需的列: {missing_cols}")

        # 数据清洗：移除目标列中的空值
        df_clean = df.dropna(subset=config.target_columns)
        logger.info(f"Data cleaning: {len(df)} -> {len(df_clean)} rows")

        # 训练/测试集划分
        from sklearn.model_selection import train_test_split
        train_df, test_df = train_test_split(
            df_clean,
            train_size=config.train_ratio,
            random_state=config.random_seed,
            shuffle=True
        )

        # 重置测试集索引为从 0 开始的连续序列
        # 这样 sample_index 就表示"测试集中的第几个样本"，而不是"原始 CSV 的第几行"
        # 注意：如果原始数据集包含 'ID' 列，该列会被保留，用于追溯原始数据集中的位置
        test_df = test_df.reset_index(drop=True)
        logger.info(f"测试集样本数: {len(test_df)}, 索引范围: 0 - {len(test_df)-1}")

        return train_df, test_df, composition_columns



    def _predict_single_sample(
        self,
        test_idx: int,
        test_row: pd.Series,
        train_df: pd.DataFrame,
        train_texts: List[str],
        train_embeddings: np.ndarray,
        config: PredictionConfig,
        composition_columns: list
    ) -> Dict[str, Any]:
        """
        预测单个样本（线程安全）

        Returns:
            包含预测结果和详细信息的字典
        """
        # 导入 PromptBuilder 用于统一构建样本文本
        from services.prompt_builder import PromptBuilder

        # 格式化组分信息（如果有）
        test_composition_str = None
        if composition_columns:
            unit_type, comp_str = self._format_composition(test_row, composition_columns)
            if unit_type:
                test_composition_str = f"({unit_type}) {comp_str}"
            else:
                test_composition_str = comp_str

        # 使用统一的样本文本构建工具
        from services.sample_text_builder import SampleTextBuilder

        # 提取工艺列数据
        processing_dict = {}
        if config.processing_column:
            for proc_col in config.processing_column:
                if proc_col in test_row.index:
                    processing_value = test_row[proc_col]
                    if pd.notna(processing_value) and str(processing_value).strip():
                        processing_dict[proc_col] = processing_value

        # 提取特征列数据
        feature_dict = {}
        if config.feature_columns:
            for feat_col in config.feature_columns:
                if feat_col in test_row.index:
                    feat_value = test_row[feat_col]
                    if pd.notna(feat_value):
                        feature_dict[feat_col] = feat_value

        # 构建查询文本
        query_text = SampleTextBuilder.build_sample_text(
            composition=test_composition_str,
            processing_columns=processing_dict if processing_dict else None,
            feature_columns=feature_dict if feature_dict else None
        )

        # 检索相似样本
        similar_indices = self.rag_engine.retrieve_similar_samples(
            query_text=query_text,
            train_texts=train_texts,
            train_embeddings=train_embeddings
        )

        # 准备相似样本数据（包含所有目标列的值）
        similar_samples = []
        for sim_idx in similar_indices:
            sample_data = {}

            # 格式化相似样本的组分（如果有）
            sim_composition_str = None
            if composition_columns:
                _, sim_composition_str = self._format_composition(train_df.iloc[sim_idx], composition_columns)

            # 收集工艺信息（如果有，支持多列）
            processing_dict = {}
            if config.processing_column:
                for proc_col in config.processing_column:
                    if proc_col in train_df.columns:
                        proc_value = train_df.iloc[sim_idx][proc_col]
                        if pd.notna(proc_value):
                            processing_dict[proc_col] = proc_value

            # 收集特征列信息（如果有，支持多列）
            feature_dict = {}
            if config.feature_columns:
                for feat_col in config.feature_columns:
                    if feat_col in train_df.columns:
                        feat_value = train_df.iloc[sim_idx][feat_col]
                        if pd.notna(feat_value):
                            feature_dict[feat_col] = feat_value

            # 使用 SampleTextBuilder 构建统一的样本文本
            # 这确保了与提示词格式完全一致
            sample_text = SampleTextBuilder.build_sample_text(
                composition=sim_composition_str,
                processing_columns=processing_dict if processing_dict else None,
                feature_columns=feature_dict if feature_dict else None
            )

            # 应用列名映射（从自定义模板中获取，如果没有则使用默认值）
            column_name_mapping = None
            if config.prompt_template and "column_name_mapping" in config.prompt_template:
                column_name_mapping = config.prompt_template["column_name_mapping"]
            sample_text = self._apply_column_name_mapping(sample_text, column_name_mapping)

            sample_data['sample_text'] = sample_text

            # 添加所有目标列的值
            for col in config.target_columns:
                sample_data[col] = train_df.iloc[sim_idx][col]

            similar_samples.append(sample_data)

        # 准备查询样本的组分（去除单位前缀，仅保留组分字符串）
        query_composition = None
        if composition_columns:
            _, comp_str_only = self._format_composition(test_row, composition_columns)
            query_composition = comp_str_only

        # 准备工艺列字典（支持多列，使用原始列名）
        query_processing = {}
        if config.processing_column:
            for proc_col in config.processing_column:
                if proc_col in test_row.index:
                    processing_value = test_row[proc_col]
                    if pd.notna(processing_value) and str(processing_value).strip():
                        query_processing[proc_col] = processing_value

        # 准备特征列字典
        query_features = {}
        if config.feature_columns:
            for feat_col in config.feature_columns:
                if feat_col in test_row.index:
                    feat_value = test_row[feat_col]
                    if pd.notna(feat_value):
                        query_features[feat_col] = feat_value

        # 使用 LLM 一次性生成所有目标的预测（获取详细信息）
        result = self.rag_engine.generate_multi_target_prediction(
            query_composition=query_composition,
            query_processing=query_processing,
            similar_samples=similar_samples,
            target_columns=config.target_columns,
            model_provider=config.model_provider,
            model_name=config.model_name,
            temperature=config.temperature,
            return_details=True,  # 获取详细信息
            custom_template=config.prompt_template,  # 传递自定义模板
            query_features=query_features  # 传递特征列
        )

        # 返回结果（使用不带单位前缀的组分字符串）
        # 处理工艺列（支持多列）
        processing_dict = {}
        if config.processing_column:
            for proc_col in config.processing_column:
                if proc_col in test_row.index:
                    processing_dict[proc_col] = test_row[proc_col]

        # 提取特征列数据
        feature_dict = {}
        if config.feature_columns:
            for feat_col in config.feature_columns:
                if feat_col in test_row.index:
                    feat_value = test_row[feat_col]
                    if pd.notna(feat_value):
                        feature_dict[feat_col] = feat_value

        # 构建统一的样本文本（与提示词格式完全一致）
        # 这个文本将直接用于前端展示，避免重复的格式化逻辑
        sample_text = SampleTextBuilder.build_sample_text(
            composition=query_composition,
            processing_columns=processing_dict if processing_dict else None,
            feature_columns=feature_dict if feature_dict else None
        )

        # 应用列名映射（从自定义模板中获取，如果没有则使用默认值）
        column_name_mapping = None
        if config.prompt_template and "column_name_mapping" in config.prompt_template:
            column_name_mapping = config.prompt_template["column_name_mapping"]
        sample_text = self._apply_column_name_mapping(sample_text, column_name_mapping)

        # 记录预测完成时间
        from datetime import datetime
        predicted_at = datetime.now().isoformat()

        result_dict = {
            'sample_index': int(test_idx),
            'sample_text': sample_text,  # 统一的样本文本（已应用列名映射）
            'predictions': result['predictions'],
            'prompt': result.get('prompt', ''),
            'llm_response': result.get('llm_response', ''),
            'similar_samples': similar_samples,
            'predicted_at': predicted_at  # 预测生成时间戳
        }

        # 添加 ID 字段（原始数据集中的行号）
        # 优先使用 'ID' 列，如果不存在则尝试 '_original_row_id' 列
        if 'ID' in test_row.index:
            result_dict['ID'] = int(test_row['ID']) if pd.notna(test_row['ID']) else None
        elif '_original_row_id' in test_row.index:
            result_dict['ID'] = int(test_row['_original_row_id']) if pd.notna(test_row['_original_row_id']) else None

        return result_dict

    def _run_multi_target_prediction(
        self,
        train_df: pd.DataFrame,
        test_df: pd.DataFrame,
        config: PredictionConfig,
        task_id: str,
        task_results_dir: Path,
        composition_columns: list,
        predicted_indices: set = None
    ) -> tuple[Dict[str, pd.DataFrame], List[Dict]]:
        """
        执行多目标预测（支持并行处理）

        Returns:
            (预测结果字典 {target_column: predictions_array}, 预测详细信息列表)
        """
        # 1. 创建训练样本的文本表示和嵌入
        logger.info(f"Task {task_id}: Creating embeddings for {len(train_df)} training samples")

        # 导入 PromptBuilder 用于统一构建样本文本
        from services.prompt_builder import PromptBuilder

        train_texts = []
        for _, row in train_df.iterrows():
            # 格式化组分信息（如果有）
            composition_str = None
            if composition_columns:
                unit_type, comp_str = self._format_composition(row, composition_columns)
                if unit_type:
                    composition_str = f"({unit_type}) {comp_str}"
                else:
                    composition_str = comp_str

            # 使用统一的样本文本构建工具
            from services.sample_text_builder import SampleTextBuilder

            # 提取工艺列数据
            processing_dict = {}
            if config.processing_column:
                for proc_col in config.processing_column:
                    if proc_col in row.index:
                        processing_value = row[proc_col]
                        if pd.notna(processing_value) and str(processing_value).strip():
                            processing_dict[proc_col] = processing_value

            # 提取特征列数据
            feature_dict = {}
            if config.feature_columns:
                for feat_col in config.feature_columns:
                    if feat_col in row.index:
                        feat_value = row[feat_col]
                        if pd.notna(feat_value):
                            feature_dict[feat_col] = feat_value

            # 构建样本文本
            text = SampleTextBuilder.build_sample_text(
                composition=composition_str,
                processing_columns=processing_dict if processing_dict else None,
                feature_columns=feature_dict if feature_dict else None
            )
            train_texts.append(text)

        # 创建嵌入
        train_embeddings = self.rag_engine.create_embeddings(train_texts)
        logger.info(f"Task {task_id}: Embeddings created with shape {train_embeddings.shape}")

        # 2. 从测试集中**顺序**选择样本进行预测（基于测试集索引）
        #    增量预测时，从已预测的最大 sample_index 之后继续顺序选择
        if predicted_indices is None:
            predicted_indices = set()

        # 计算需要新增的样本数量（sample_size 表示“总共需要预测的样本数”）
        already_predicted_count = len(predicted_indices)
        target_total_count = config.sample_size
        new_samples_needed = target_total_count - already_predicted_count

        if new_samples_needed <= 0:
            logger.info(
                f"Task {task_id}: 已预测 {already_predicted_count} 个样本，"
                f"达到或超过目标 {target_total_count}，无需新增样本"
            )
            # 返回空结果
            return {}, [], pd.DataFrame()

        # 按索引排序，保证采样顺序稳定且与测试集索引一致
        sorted_indices = sorted(test_df.index.tolist())
        logger.info(
            f"Task {task_id}: 测试集索引范围: {sorted_indices[0]}-{sorted_indices[-1]} "
            f"(共 {len(sorted_indices)} 个样本)"
        )

        if predicted_indices:
            # 排除已预测的样本索引，从剩余样本中按顺序选择
            # 这样可以确保：
            # 1. 不会重复预测已完成的样本
            # 2. 会重新预测失败的样本（如果它们不在 predicted_indices 中）
            # 3. 按照测试集索引顺序选择新样本
            candidate_indices = [idx for idx in sorted_indices if idx not in predicted_indices]
            logger.info(
                f"Task {task_id}: 增量预测 - 排除已预测的样本索引 {sorted(predicted_indices)}, "
                f"剩余候选样本索引: {candidate_indices[:20]}{'...' if len(candidate_indices) > 20 else ''} "
                f"(共 {len(candidate_indices)} 个)"
            )
        else:
            # 首次预测：从第一个索引开始
            candidate_indices = sorted_indices
            logger.info(
                f"Task {task_id}: 首次预测 - 候选样本索引: {candidate_indices[:20]}{'...' if len(candidate_indices) > 20 else ''} "
                f"(共 {len(candidate_indices)} 个)"
            )

        if not candidate_indices:
            logger.info(
                f"Task {task_id}: 测试集中没有更多可用样本 "
                f"(总测试集: {len(test_df)}, 已预测: {already_predicted_count})"
            )
            return {}, [], pd.DataFrame()

        # 实际采样数量不能超过候选样本数量
        actual_sample_size = min(new_samples_needed, len(candidate_indices))

        # 按顺序选取前 actual_sample_size 个样本
        selected_indices = candidate_indices[:actual_sample_size]
        sampled_test_df = test_df.loc[selected_indices]
        logger.info(
            f"Task {task_id}: ✓ 顺序选择 {actual_sample_size} 个新样本进行预测 "
            f"(目标总数: {target_total_count}, 已预测: {already_predicted_count}, 新增: {actual_sample_size}), "
            f"选中索引: {selected_indices}"
        )

        # 初始化预测结果字典和详细信息列表
        total_samples = len(sampled_test_df)
        logger.info(f"Task {task_id}: Starting multi-target prediction for {total_samples} samples with {config.workers} workers")

        # 使用线程池并行处理
        workers = min(config.workers, total_samples)  # 不超过样本数
        completed_count = 0
        completed_lock = threading.Lock()

        # 存储结果（按索引）
        results_dict = {}

        def update_progress():
            """线程安全的进度更新"""
            nonlocal completed_count
            with completed_lock:
                completed_count += 1
                progress = 0.3 + (completed_count / total_samples) * 0.6
                self.task_manager.update_task_status(
                    task_id=task_id,
                    status=TaskStatus.RUNNING,
                    progress=progress,
                    message=f"正在预测样本 {completed_count}/{total_samples}"
                )

        with ThreadPoolExecutor(max_workers=workers) as executor:
            # 提交所有任务
            future_to_idx = {}
            for test_idx, test_row in sampled_test_df.iterrows():
                future = executor.submit(
                    self._predict_single_sample,
                    test_idx,
                    test_row,
                    train_df,
                    train_texts,
                    train_embeddings,
                    config,
                    composition_columns
                )
                future_to_idx[future] = test_idx

            # 收集结果
            for future in as_completed(future_to_idx):
                # 检查任务是否被取消
                current_task = self.task_manager.get_task(task_id)
                if current_task and current_task.get('status') == 'cancelled':
                    logger.info(f"Task {task_id}: Cancelled by user, stopping prediction")
                    # 取消所有未完成的 future
                    for f in future_to_idx.keys():
                        f.cancel()
                    break

                test_idx = future_to_idx[future]
                try:
                    result = future.result()
                    results_dict[test_idx] = result
                    update_progress()

                    # 每10个样本记录一次
                    if completed_count % 10 == 0:
                        logger.info(f"Task {task_id}: Predicted {completed_count}/{total_samples} samples")

                except Exception as e:
                    logger.error(f"Task {task_id}: Error predicting sample {test_idx}: {e}")
                    # 创建失败结果
                    from datetime import datetime
                    test_row = sampled_test_df.loc[test_idx]
                    error_result = {
                        'sample_index': int(test_idx),
                        'composition': '',
                        'processing': '',
                        'predictions': {col: None for col in config.target_columns},
                        'prompt': '',
                        'llm_response': f'Error: {str(e)}',
                        'similar_samples': [],
                        'predicted_at': datetime.now().isoformat()  # 错误发生时间
                    }

                    # 添加 ID 字段（如果存在）
                    if 'ID' in test_row.index:
                        error_result['ID'] = int(test_row['ID']) if pd.notna(test_row['ID']) else None
                    elif '_original_row_id' in test_row.index:
                        error_result['ID'] = int(test_row['_original_row_id']) if pd.notna(test_row['_original_row_id']) else None

                    results_dict[test_idx] = error_result
                    update_progress()

        # 检查任务是否被取消
        current_task = self.task_manager.get_task(task_id)
        was_cancelled = current_task and current_task.get('status') == 'cancelled'

        if was_cancelled:
            logger.info(f"Task {task_id}: Task was cancelled, saving partial results ({len(results_dict)} samples)")

        # 按索引排序并提取结果
        predictions = {col: [] for col in config.target_columns}
        prediction_details = []

        for test_idx in sorted(results_dict.keys()):
            result = results_dict[test_idx]
            test_row = sampled_test_df.loc[test_idx]

            # 提取预测值（确保使用默认值 0.0 而不是 None）
            used_default_values = []
            for target_col in config.target_columns:
                pred_value = result['predictions'].get(target_col)
                # 如果预测值为 None，使用默认值 0.0
                if pred_value is None:
                    logger.warning(
                        f"Task {task_id}: Sample {result['sample_index']} - "
                        f"目标属性 {target_col} 的预测值为 None，使用默认值 0.0"
                    )
                    pred_value = 0.0
                    used_default_values.append(target_col)
                # 检查是否为解析失败的默认值（LLM 响应中包含错误信息或响应被截断）
                elif pred_value == 0.0 and (
                    'Error:' in result.get('llm_response', '') or
                    len(result.get('llm_response', '')) < 100
                ):
                    used_default_values.append(target_col)
                predictions[target_col].append(pred_value)

            # 保存详细信息
            # 使用统一的 sample_text 字段（与提示词格式完全一致）
            sample_detail = {
                'sample_index': result['sample_index'],
                'sample_text': result['sample_text'],  # 统一的样本文本
                'true_values': {col: float(test_row[col]) for col in config.target_columns},
                'predicted_values': result['predictions'],
                'prompt': result['prompt'],
                'llm_response': result['llm_response'],
                'similar_samples': result['similar_samples'],
                'used_default_values': used_default_values,  # 记录使用默认值的目标属性
                'predicted_at': result.get('predicted_at')  # 预测生成时间戳
            }

            # 添加 ID 字段（如果存在）
            if 'ID' in result:
                sample_detail['ID'] = result['ID']

            prediction_details.append(sample_detail)

        # 转换为 DataFrame（包含预测列）
        result_dfs = {}
        for target_col in config.target_columns:
            pred_array = np.array(predictions[target_col])
            # 创建 DataFrame，包含预测列
            pred_col_name = f"{target_col}_predicted"
            result_dfs[target_col] = pd.DataFrame({
                pred_col_name: pred_array
            })
            logger.info(f"Task {task_id}: Target {target_col} prediction completed")

        # 如果任务被取消，只返回已完成的样本
        if was_cancelled:
            # 过滤 sampled_test_df，只保留已预测的样本
            completed_indices = sorted(results_dict.keys())
            sampled_test_df = sampled_test_df.loc[completed_indices]

        return result_dfs, prediction_details, sampled_test_df

    def _save_results(
        self,
        results: Dict[str, pd.DataFrame],
        test_df: pd.DataFrame,
        config: PredictionConfig,
        task_results_dir: Path,
        existing_predictions: Optional[pd.DataFrame] = None,
        composition_columns: Optional[list] = None,
        processing_column: Optional[list] = None,
    ) -> str:
        """
        保存预测结果（支持与已有结果合并）

        Args:
            results: 各目标列的预测结果字典，值为仅包含“{target}_predicted”列的 DataFrame
            test_df: 本次测试集（采样后）
            config: 预测配置
            task_results_dir: 结果目录
            existing_predictions: 需要合并的历史预测结果（predictions.csv）
            composition_columns: 组分列名列表（用于合并去重）
            processing_column: 工艺列名（用于合并去重）
            """
        # 1) 生成本次运行的最终结果 DataFrame
        #    保留测试集的原始索引，并显式写入 sample_index 列，便于与 process_details.json 对齐
        final_df = test_df.copy()
        if "sample_index" not in final_df.columns:
            # 使用 DataFrame 的索引作为 sample_index（对应原始 CSV 的行号）
            final_df["sample_index"] = final_df.index.astype(int)

        # 重置行索引，仅作为 DataFrame 内部索引使用，不影响 sample_index 含义
        final_df = final_df.reset_index(drop=True)

        # 可选：将 sample_index 列移动到首列，方便查看
        cols = final_df.columns.tolist()
        if "sample_index" in cols:
            cols = ["sample_index"] + [c for c in cols if c != "sample_index"]
            final_df = final_df[cols]

        for target_col, result_df in results.items():
            pred_col = f"{target_col}_predicted"
            if pred_col in result_df.columns:
                # 检查长度匹配
                if len(result_df) != len(final_df):
                    raise ValueError(
                        f"预测结果长度不匹配：{pred_col} 有 {len(result_df)} 行，"
                        f"但测试集有 {len(final_df)} 行。可能是任务在预测过程中被取消导致。"
                    )
                final_df[pred_col] = result_df[pred_col].values

        # 2) 如为增量模式，与历史结果合并
        #    增量预测时，按 sample_index 合并（新样本追加，已有样本保留）
        if existing_predictions is not None and not existing_predictions.empty:
            try:
                # 确保历史结果也有 sample_index 列
                if "sample_index" not in existing_predictions.columns:
                    logger.warning("历史预测结果缺少 sample_index 列，无法按索引合并，将直接追加")
                    # 保持原始列顺序
                    original_cols = existing_predictions.columns.tolist()
                    new_cols = [c for c in final_df.columns if c not in original_cols]
                    all_cols = original_cols + new_cols

                    # 对齐列集合
                    for col in all_cols:
                        if col not in existing_predictions.columns:
                            existing_predictions[col] = np.nan
                        if col not in final_df.columns:
                            final_df[col] = np.nan

                    existing_predictions = existing_predictions[all_cols]
                    final_df = final_df[all_cols]

                    # 直接追加
                    merged_df = pd.concat([existing_predictions, final_df], ignore_index=True)
                else:
                    # 按 sample_index 合并：使用字典去重，新值覆盖旧值
                    # 保持原始列顺序
                    original_cols = existing_predictions.columns.tolist()
                    new_cols = [c for c in final_df.columns if c not in original_cols]
                    all_cols = original_cols + new_cols

                    # 对齐列集合
                    for col in all_cols:
                        if col not in existing_predictions.columns:
                            existing_predictions[col] = np.nan
                        if col not in final_df.columns:
                            final_df[col] = np.nan

                    existing_predictions = existing_predictions[all_cols]
                    final_df = final_df[all_cols]

                    # 使用 sample_index 作为键进行合并
                    merged_map = {}
                    for _, row in existing_predictions.iterrows():
                        idx = row.get("sample_index")
                        if pd.notna(idx):
                            merged_map[int(idx)] = row.to_dict()

                    for _, row in final_df.iterrows():
                        idx = row.get("sample_index")
                        if pd.notna(idx):
                            merged_map[int(idx)] = row.to_dict()

                    # 按 sample_index 升序排序后转为 DataFrame
                    sorted_indices = sorted(merged_map.keys())
                    merged_df = pd.DataFrame([merged_map[idx] for idx in sorted_indices])
                    merged_df = merged_df.reset_index(drop=True)

                    logger.info(
                        f"按 sample_index 合并预测结果: 原有 {len(existing_predictions)} 行 + "
                        f"新增 {len(final_df)} 行 -> 合并后 {len(merged_df)} 行"
                    )

                save_df = merged_df
            except Exception as e:
                logger.warning(f"合并历史预测结果失败，回退为仅保存本次结果: {e}")
                save_df = final_df
        else:
            save_df = final_df

        # 3) 保存最终结果
        result_file = task_results_dir / "predictions.csv"
        save_df.to_csv(result_file, index=False)

        # 4) 计算与保存指标（基于合并后的所有结果）
        # 使用 save_df 而不是 final_df，以便包含所有样本的指标
        metrics = self._calculate_metrics(save_df, config.target_columns)
        import json
        metrics_file = task_results_dir / "metrics.json"
        metrics_json = json.dumps(metrics, ensure_ascii=False, indent=2)
        safe_write_file(metrics_file, metrics_json)

        return task_results_dir.name

    def _calculate_metrics(
        self,
        df: pd.DataFrame,
        target_columns: List[str]
    ) -> Dict[str, Dict[str, float]]:
        """计算预测指标"""
        from sklearn.metrics import r2_score, mean_squared_error, mean_absolute_error
        import numpy as np
        import math

        metrics = {}

        for target_col in target_columns:
            pred_col = f"{target_col}_predicted"

            if pred_col not in df.columns:
                continue

            # 移除空值
            valid_mask = df[target_col].notna() & df[pred_col].notna()
            y_true = df.loc[valid_mask, target_col]
            y_pred = df.loc[valid_mask, pred_col]

            if len(y_true) == 0:
                continue

            # 计算指标
            # 注意：当样本数量 < 2 时，r2_score 会返回 NaN
            if len(y_true) >= 2:
                r2 = r2_score(y_true, y_pred)
            else:
                r2 = None  # 样本数量不足，无法计算 R²

            rmse = np.sqrt(mean_squared_error(y_true, y_pred))
            mae = mean_absolute_error(y_true, y_pred)

            # 计算 MAPE，避免除以零
            with np.errstate(divide='ignore', invalid='ignore'):
                mape = np.mean(np.abs((y_true - y_pred) / y_true)) * 100

            # 将 NaN 和 Inf 值转换为 None，确保 JSON 序列化兼容
            def safe_float(value):
                """将浮点数转换为 JSON 兼容的值"""
                if value is None:
                    return None
                if isinstance(value, (int, float)):
                    if math.isnan(value) or math.isinf(value):
                        return None
                    return float(value)
                return value

            metrics[target_col] = {
                "r2": safe_float(r2),
                "rmse": safe_float(rmse),
                "mae": safe_float(mae),
                "mape": safe_float(mape)
            }

        return metrics

    def _load_existing_predictions(self, task_id: str) -> Optional[pd.DataFrame]:
        """
        加载已有任务的预测结果

        Args:
            task_id: 原任务ID

        Returns:
            已完成的预测结果 DataFrame，如果加载失败返回 None
        """
        try:
            predictions_file = RESULTS_DIR / task_id / "predictions.csv"
            if predictions_file.exists():
                df = pd.read_csv(predictions_file)
                logger.info(f"成功加载已有预测结果: {len(df)} 个样本")
                return df
            else:
                logger.warning(f"未找到预测结果文件: {predictions_file}")
                return None
        except Exception as e:
            logger.error(f"加载已有预测结果失败: {e}")
            return None

    def _identify_zero_value_samples(
        self,
        predictions_df: pd.DataFrame,
        target_columns: List[str]
    ) -> set:
        """
        识别预测结果中值为零或 NaN 的样本索引

        Args:
            predictions_df: 预测结果 DataFrame（必须包含 sample_index 列）
            target_columns: 目标属性列名列表

        Returns:
            包含零值或 NaN 值的样本索引集合
        """
        zero_value_indices = set()

        # 确保 predictions_df 包含 sample_index 列
        if 'sample_index' not in predictions_df.columns:
            logger.warning("predictions_df 缺少 sample_index 列，无法识别零值样本")
            return zero_value_indices

        # 遍历每一行，检查目标列的预测值
        for _, row in predictions_df.iterrows():
            sample_index = row.get('sample_index')
            if pd.isna(sample_index):
                continue

            sample_index = int(sample_index)
            has_invalid_value = False

            # 检查所有目标列的预测值
            for target_col in target_columns:
                pred_col = f"{target_col}_predicted"

                # 如果预测列不存在，跳过（不视为零值）
                if pred_col not in row.index:
                    continue

                pred_value = row[pred_col]

                # 检查是否为无效值（包括 0, 0.0, NaN, None）
                # NaN 值和零值都视为无效预测，需要重新预测
                if pd.isna(pred_value) or pred_value == 0:
                    has_invalid_value = True
                    logger.debug(
                        f"样本 {sample_index} 的 {target_col} 预测值无效: {pred_value} (NaN={pd.isna(pred_value)}, Zero={pred_value == 0 if pd.notna(pred_value) else False})"
                    )
                    break

            if has_invalid_value:
                zero_value_indices.add(sample_index)

        return zero_value_indices

    def _filter_completed_samples(
        self,
        test_df: pd.DataFrame,
        existing_predictions: pd.DataFrame,
        composition_columns: list,
        processing_column: list,
        target_columns: list = None,
        prev_task_id: str = None
    ) -> pd.DataFrame:
        """
        过滤掉已完成预测的样本（仅保留空值或0值的样本需要重新预测）

        Args:
            test_df: 测试集 DataFrame
            existing_predictions: 已有预测结果 DataFrame
            composition_columns: 组分列名列表
            processing_column: 工艺列名列表（支持多选）
            target_columns: 目标列名列表（用于检查预测值是否有效）
            prev_task_id: 上一个任务的 ID（用于加载 process_details.json）

        Returns:
            过滤后的测试集（仅包含未完成或预测值无效的样本）
        """
        # 创建唯一标识符（组分 + 工艺）
        def create_sample_key(row):
            comp_parts = []
            for col in composition_columns:
                if col in row.index and pd.notna(row[col]):
                    comp_parts.append(f"{col}:{row[col]}")
            # 处理工艺列（支持多列）
            processing_parts = []
            if processing_column:
                for proc_col in processing_column:
                    if proc_col in row.index and pd.notna(row[proc_col]):
                        processing_parts.append(f"{proc_col}:{row[proc_col]}")
            processing_str = "|".join(processing_parts) if processing_parts else ""
            return "|".join(comp_parts) + "|" + processing_str

        # 为测试集和已有预测创建键
        test_df = test_df.copy()
        test_df['_sample_key'] = test_df.apply(create_sample_key, axis=1)

        existing_predictions = existing_predictions.copy()
        existing_predictions['_sample_key'] = existing_predictions.apply(create_sample_key, axis=1)

        # 找出需要重新预测的样本键（预测值为空、NaN 或使用了默认值的样本）
        incomplete_keys = set()

        # 尝试从 process_details.json 中加载使用默认值的样本信息
        samples_with_defaults = set()
        if prev_task_id:
            try:
                prev_task_dir = Path(self.results_dir) / prev_task_id
                process_details_file = prev_task_dir / "process_details.json"
                if process_details_file.exists():
                    import json
                    with open(process_details_file, 'r', encoding='utf-8') as f:
                        process_details = json.load(f)
                        for detail in process_details:
                            if detail.get('used_default_values'):
                                # 记录使用了默认值的样本索引
                                samples_with_defaults.add(detail['sample_index'])
                    logger.info(f"从 {prev_task_id} 加载了 {len(samples_with_defaults)} 个使用默认值的样本")
            except Exception as e:
                logger.warning(f"无法加载 process_details.json: {e}")

        if target_columns:
            # 检查每个样本的预测值
            for _, row in existing_predictions.iterrows():
                sample_key = row['_sample_key']
                sample_idx = row.get('sample_index')
                needs_reprediction = False

                # 如果样本使用了默认值，需要重新预测
                if sample_idx in samples_with_defaults:
                    needs_reprediction = True
                    logger.info(f"样本 {sample_idx} 在上次预测中使用了默认值，将重新预测")
                else:
                    # 检查所有目标列的预测值
                    for target_col in target_columns:
                        pred_col = f"{target_col}_predicted"
                        if pred_col in row.index:
                            pred_value = row[pred_col]
                            # 如果预测值为空或 NaN，则需要重新预测
                            # 注意：不再将 0 视为无效值，因为 0 可能是真实的预测结果
                            if pd.isna(pred_value) or pred_value is None:
                                needs_reprediction = True
                                break
                        else:
                            # 如果预测列不存在，也需要重新预测
                            needs_reprediction = True
                            break

                if needs_reprediction:
                    incomplete_keys.add(sample_key)

        # 找出已有预测的样本键
        existing_keys = set(existing_predictions['_sample_key'].unique())

        # 需要预测的样本 = 从未预测的样本 + 预测值无效的样本
        keys_to_predict = (set(test_df['_sample_key'].unique()) - existing_keys) | incomplete_keys

        # 过滤出需要预测的样本
        remaining_df = test_df[test_df['_sample_key'].isin(keys_to_predict)].copy()
        remaining_df = remaining_df.drop(columns=['_sample_key'])

        logger.info(f"增量预测分析: 总样本={len(test_df)}, 已有预测={len(existing_keys)}, "
                   f"预测值无效={len(incomplete_keys)}, 需要预测={len(remaining_df)}")

        return remaining_df

    def _merge_predictions(
        self,
        new_results: Dict[str, pd.DataFrame],
        existing_predictions: pd.DataFrame,
        target_columns: List[str]
    ) -> Dict[str, pd.DataFrame]:
        """
        合并新预测结果和已有预测结果

        Args:
            new_results: 新预测结果字典
            existing_predictions: 已有预测结果 DataFrame
            target_columns: 目标列名列表

        Returns:
            合并后的预测结果字典
        """
        # 从新结果中提取预测 DataFrame
        new_predictions_df = new_results.get('predictions', pd.DataFrame())

        if new_predictions_df.empty:
            # 如果没有新预测，直接返回已有预测
            return {'predictions': existing_predictions}

        # 合并新旧预测结果
        merged_df = pd.concat([existing_predictions, new_predictions_df], ignore_index=True)

        # 去重（如果有重复样本，保留新预测）
        # 这里简单地按所有列去重，保留最后出现的（即新预测）
        merged_df = merged_df.drop_duplicates(subset=merged_df.columns.difference([f"{col}_predicted" for col in target_columns]), keep='last')

        logger.info(f"合并预测结果: 已有 {len(existing_predictions)} 个，新增 {len(new_predictions_df)} 个，合并后 {len(merged_df)} 个")

        return {'predictions': merged_df}

