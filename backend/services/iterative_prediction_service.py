"""
迭代预测服务 - 使用LangGraph实现迭代预测工作流
"""

import logging
import json
import time
from typing import TypedDict, List, Dict, Any, Optional, Set
from datetime import datetime
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
import shutil

import pandas as pd
from langgraph.graph import StateGraph, END
from langgraph.graph.state import CompiledStateGraph

from models.schemas import PredictionConfig, TaskStatus
from services.task_manager import TaskManager
from database.task_db import TaskDatabase
from services.simple_rag_engine import SimpleRAGEngine
from services.prompt_builder import PromptBuilder
from services.convergence_checker import ConvergenceChecker
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


class IterationState(TypedDict):
    """迭代预测状态定义"""
    
    # 任务基本信息
    task_id: str
    config: Dict[str, Any]
    
    # 数据集信息
    train_data: List[Dict[str, Any]]
    test_data: List[Dict[str, Any]]
    train_embeddings: Any  # numpy array
    
    # 迭代控制
    current_iteration: int
    max_iterations: int
    convergence_threshold: float
    early_stop: bool
    
    # 预测结果
    iteration_results: Dict[int, Dict[int, Dict[str, float]]]  # {iteration: {sample_idx: {target: value}}}
    iteration_history: Dict[int, Dict[str, List[float]]]  # {sample_idx: {target: [iter1_val, iter2_val, ...]}}
    
    # 收敛状态
    converged_samples: Set[int]
    failed_samples: Dict[int, str]
    
    # LLM配置
    llm_provider: str
    llm_model: str
    temperature: float
    
    # 时间戳
    start_time: datetime
    iteration_start_times: Dict[int, datetime]
    
    # 其他配置
    max_workers: int
    target_properties: List[str]
    sample_size: Optional[int]  # 每轮迭代预测的样本数量

    # Prompt和响应记录
    prompts: Dict[int, Dict[int, str]]  # {sample_idx: {iteration: prompt}}
    responses: Dict[int, Dict[int, Dict[str, Any]]]  # {sample_idx: {iteration: response}}


class IterativePredictionService:
    """
    迭代预测服务
    
    使用LangGraph实现迭代预测工作流，包括：
    1. 初始化
    2. 迭代预测
    3. 收敛检查
    4. 失败处理
    5. 结果保存
    """
    
    def __init__(
        self,
        task_manager: TaskManager,
        task_db: TaskDatabase,
        rag_engine: SimpleRAGEngine
    ):
        """
        初始化迭代预测服务
        
        Args:
            task_manager: 任务管理器
            task_db: 任务数据库
            rag_engine: RAG引擎
        """
        self.task_manager = task_manager
        self.task_db = task_db
        self.rag_engine = rag_engine
        self.convergence_checker = ConvergenceChecker()
        
        # 构建工作流
        self.workflow: Optional[CompiledStateGraph] = None
        self._build_graph()

    def run_task(self, task_id: str, file_path: Path, config: PredictionConfig):
        """
        执行迭代预测任务（包含数据加载和预处理）
        
        支持增量预测：如果 config.continue_from_task_id 设置为 task_id，
        则会加载已有的预测结果并继续未完成的样本

        Args:
            task_id: 任务ID
            file_path: 数据文件路径
            config: 预测配置
        """
        try:
            logger.info(f"Task {task_id}: Starting iterative prediction task")
            
            # 🔥 检查是否为增量预测模式
            is_incremental = (config.continue_from_task_id == task_id)
            
            if is_incremental:
                logger.info(f"Task {task_id}: Incremental prediction mode detected - will continue from existing results")
            
            # 更新任务状态
            self.task_manager.update_task(
                task_id,
                {
                    "status": "running",
                    "progress": 0.0,
                    "message": "正在加载数据..." if not is_incremental else "正在加载现有预测结果..."
                }
            )

            # 1. 加载数据
            df = pd.read_csv(file_path)
            logger.info(f"Task {task_id}: Loaded {len(df)} samples")

            # 2. 识别组分列
            composition_columns = []
            for col in df.columns:
                if any(unit in col.lower() for unit in ['wt%', 'at%']):
                    composition_columns.append(col)

            if not composition_columns:
                # 尝试使用配置中的组分列
                if config.composition_column:
                    if isinstance(config.composition_column, list):
                        composition_columns = config.composition_column
                    else:
                        composition_columns = [config.composition_column]
                
                if not composition_columns:
                    raise ValueError("未找到组分列（应包含 wt% 或 at%，或在配置中指定）")

            logger.info(f"Task {task_id}: Found {len(composition_columns)} composition columns")

            # 3. 数据集划分（必须使用相同的随机种子以确保一致性）
            from sklearn.model_selection import train_test_split

            train_df, test_df = train_test_split(
                df,
                train_size=config.train_ratio,
                random_state=config.random_seed or 42
            )

            logger.info(
                f"Task {task_id}: Split data into {len(train_df)} train and {len(test_df)} test samples"
            )

            # 4. 构建样本文本和嵌入
            from services.sample_text_builder import SampleTextBuilder

            def format_composition(row, comp_cols):
                """格式化组分"""
                comp_parts = []
                for col in comp_cols:
                    value = row[col]
                    element = col.split('(')[0].strip()
                    if value > 0:
                        comp_parts.append(f"{element} {value}")
                return ", ".join(comp_parts)

            # 构建训练样本文本
            train_texts = []
            train_data = []

            for idx, row in train_df.iterrows():
                composition_str = format_composition(row, composition_columns)

                # 提取工艺列
                processing_dict = {}
                if config.processing_column:
                    for proc_col in config.processing_column:
                        if proc_col in row.index and pd.notna(row[proc_col]):
                            processing_dict[proc_col] = row[proc_col]

                # 提取特征列
                feature_dict = {}
                if config.feature_columns:
                    for feat_col in config.feature_columns:
                        if feat_col in row.index and pd.notna(row[feat_col]):
                            feature_dict[feat_col] = row[feat_col]

                # 构建样本文本
                sample_text = SampleTextBuilder.build_sample_text(
                    composition=composition_str,
                    processing_columns=processing_dict if processing_dict else None,
                    feature_columns=feature_dict if feature_dict else None
                )

                train_texts.append(sample_text)

                # 保存样本数据
                sample_data = {
                    "composition": composition_str,
                    "sample_text": sample_text
                }

                # 添加工艺列
                if processing_dict:
                    sample_data.update(processing_dict)

                # 添加特征列
                if feature_dict:
                    sample_data.update(feature_dict)

                # 添加目标属性
                for target_col in config.target_columns:
                    if target_col in row.index and pd.notna(row[target_col]):
                        sample_data[target_col] = float(row[target_col])

                train_data.append(sample_data)

            # 构建测试样本数据（保留所有原始列，确保 CSV 格式完整）
            test_data = []
            for idx, row in test_df.iterrows():
                composition_str = format_composition(row, composition_columns)

                # 提取工艺列
                processing_dict = {}
                if config.processing_column:
                    for proc_col in config.processing_column:
                        if proc_col in row.index and pd.notna(row[proc_col]):
                            processing_dict[proc_col] = row[proc_col]

                # 提取特征列
                feature_dict = {}
                if config.feature_columns:
                    for feat_col in config.feature_columns:
                        if feat_col in row.index and pd.notna(row[feat_col]):
                            feature_dict[feat_col] = row[feat_col]

                # 构建样本文本
                sample_text = SampleTextBuilder.build_sample_text(
                    composition=composition_str,
                    processing_columns=processing_dict if processing_dict else None,
                    feature_columns=feature_dict if feature_dict else None
                )

                # 保存样本数据（保留所有原始列）
                sample_data = row.to_dict()  # 保留所有原始列
                sample_data["composition"] = composition_str  # 添加格式化的 composition 字符串
                sample_data["sample_text"] = sample_text  # 添加样本文本

                test_data.append(sample_data)

            # 5. 生成嵌入
            if self.rag_engine:
                self.rag_engine.max_retrieved_samples = config.max_retrieved_samples
                self.rag_engine.similarity_threshold = config.similarity_threshold
            
            train_embeddings = self.rag_engine.create_embeddings(train_texts)

            logger.info(f"Task {task_id}: Generated embeddings for {len(train_texts)} training samples")

            # 6. 运行迭代预测（传递 continue_from_task_id 以便加载现有结果）
            result = self.run_iterative_prediction(
                task_id=task_id,
                config=config,
                train_data=train_data,
                test_data=test_data,
                train_embeddings=train_embeddings
            )

            if result["success"]:
                # 更新任务状态为完成
                self.task_manager.update_task(
                    task_id,
                    {
                        "status": "completed",
                        "progress": 1.0,
                        "message": f"迭代预测完成，共{result['total_iterations']}轮，"
                                   f"收敛{result['converged_samples']}个样本，"
                                   f"失败{result['failed_samples']}个样本"
                    }
                )

                logger.info(f"Task {task_id}: Iterative prediction completed successfully")
            else:
                # 更新任务状态为失败
                self.task_manager.update_task(
                    task_id,
                    {
                        "status": "failed",
                        "error": result.get("error", "未知错误")
                    }
                )

                logger.error(f"Task {task_id}: Iterative prediction failed: {result.get('error')}")

        except Exception as e:
            logger.error(f"Task {task_id}: Iterative prediction task failed: {e}", exc_info=True)

            # 更新任务状态为失败
            self.task_manager.update_task(
                task_id,
                {
                    "status": "failed",
                    "error": str(e)
                }
            )
    
    def _build_graph(self) -> None:
        """构建LangGraph工作流"""
        
        # 创建状态图
        workflow = StateGraph(IterationState)
        
        # 添加节点
        workflow.add_node("initialize", self._node_initialize)
        workflow.add_node("predict_iteration", self._node_predict_iteration)
        workflow.add_node("check_convergence", self._node_check_convergence)
        workflow.add_node("save_results", self._node_save_results)
        workflow.add_node("handle_failure", self._node_handle_failure)
        
        # 设置入口点
        workflow.set_entry_point("initialize")
        
        # 添加边
        workflow.add_edge("initialize", "predict_iteration")
        
        # 条件路由：预测后检查是否有失败
        workflow.add_conditional_edges(
            "predict_iteration",
            self._should_handle_failure,
            {
                "handle_failure": "handle_failure",
                "continue": "check_convergence"
            }
        )
        
        # 失败处理后继续收敛检查
        workflow.add_edge("handle_failure", "check_convergence")
        
        # 条件路由：检查是否继续迭代
        workflow.add_conditional_edges(
            "check_convergence",
            self._should_continue_iteration,
            {
                "continue": "predict_iteration",
                "finish": "save_results"
            }
        )
        
        # 保存结果后结束
        workflow.add_edge("save_results", END)
        
        # 编译工作流
        self.workflow = workflow.compile()
        logger.info("LangGraph工作流构建完成")

    def _node_initialize(self, state: IterationState) -> IterationState:
        """
        初始化节点 - 初始化迭代预测的状态
        """
        task_id = state['task_id']
        logger.info(f"Task {task_id}: 初始化迭代预测")

        # 初始化迭代结果存储
        state["iteration_results"] = {}
        state["iteration_history"] = {}
        state["converged_samples"] = set()
        state["failed_samples"] = {}
        state["iteration_start_times"] = {}
        state["current_iteration"] = 1
        state["start_time"] = datetime.now()

        # 更新任务状态（设置初始进度为 0.0，并设置 result_id）
        self.task_manager.update_task(
            task_id,
            {
                "status": TaskStatus.RUNNING,
                "progress": 0.0,
                "message": f"开始迭代预测（最大{state['max_iterations']}轮）",
                "result_id": task_id  # 设置 result_id，使前端可以立即访问结果
            }
        )

        # 同时更新数据库中的 result_id
        self.task_db.update_task(task_id, {"result_id": task_id})
        logger.info(f"Task {task_id}: 已设置 result_id")

        logger.info(
            f"Task {task_id}: 初始化完成，"
            f"测试样本数={len(state['test_data'])}, "
            f"最大迭代次数={state['max_iterations']}"
        )

        # 检查是否是增量预测
        config = state['config']
        # 🔥 修复：config 是字典（来自 model_dump()），使用字典方式访问
        continue_from_task_id = config.get("continue_from_task_id")
        
        if continue_from_task_id:
            logger.info(f"Task {task_id}: 增量预测模式，尝试从任务 {continue_from_task_id} 恢复状态")
            src_dir = RESULTS_DIR / continue_from_task_id
            dst_dir = RESULTS_DIR / task_id
            
            # 如果是跨任务（新任务ID != 旧任务ID），则需要复制文件
            if continue_from_task_id != task_id:
                if src_dir.exists():
                    try:
                        # 确保目标目录存在
                        dst_dir.mkdir(parents=True, exist_ok=True)
                        
                        # 1. 复制 iteration_history.json
                        history_file = src_dir / "iteration_history.json"
                        if history_file.exists():
                            shutil.copy2(history_file, dst_dir / "iteration_history.json")
                            
                        # 2. 复制 inputs 和 outputs 目录（保留 Prompt 和 Response 历史）
                        if (src_dir / "inputs").exists():
                            if (dst_dir / "inputs").exists():
                                shutil.rmtree(dst_dir / "inputs")
                            shutil.copytree(src_dir / "inputs", dst_dir / "inputs")
                            
                        if (src_dir / "outputs").exists():
                            if (dst_dir / "outputs").exists():
                                shutil.rmtree(dst_dir / "outputs")
                            shutil.copytree(src_dir / "outputs", dst_dir / "outputs")
                    except Exception as e:
                        logger.error(f"Task {task_id}: 复制历史文件失败: {e}", exc_info=True)
                else:
                    logger.warning(f"Task {task_id}: 指定的旧任务 {continue_from_task_id} 目录不存在")
            
            # 3. 加载历史数据并恢复状态 (无论是原地还是跨任务，只要文件在 dst_dir 就加载)
            try:
                if (dst_dir / "iteration_history.json").exists():
                    with open(dst_dir / "iteration_history.json", 'r', encoding='utf-8') as f:
                        history_json = json.load(f)
                    
                    self._restore_state_from_history(state, history_json)
                    
                    # 关键：重置失败样本，以便在本次增量预测中重试
                    state["failed_samples"] = {}
                    
                    # 关键：重置当前轮次为1，以便从头扫描并补全缺失的预测
                    state["current_iteration"] = 1
                    
                    logger.info(f"Task {task_id}: 已恢复历史状态，准备进行增量预测（失败样本已重置）")
            except Exception as e:
                logger.error(f"Task {task_id}: 恢复历史数据失败: {e}", exc_info=True)

        return state

    def _restore_state_from_history(self, state: IterationState, history_json: Dict[str, Any]):
        """从历史JSON恢复状态"""
        samples_data = history_json.get("samples", {})
        
        # 恢复 iteration_history
        for sample_key, sample_info in samples_data.items():
            # sample_key 格式为 "sample_0", "sample_1" 等
            try:
                sample_idx = int(sample_key.split("_")[1])
            except:
                continue
                
            targets_info = sample_info.get("targets", {})
            
            # 重建该样本的历史记录
            sample_history = {}
            is_converged = False
            
            for target, info in targets_info.items():
                iterations = info.get("iterations", [])
                sample_history[target] = iterations
                
                if info.get("convergence_status") == "converged":
                    is_converged = True
            
            if sample_history:
                state["iteration_history"][sample_idx] = sample_history
            
            if is_converged:
                state["converged_samples"].add(sample_idx)
        
        # 尝试恢复 prompts 和 responses (从文件系统读取可能太慢，这里只恢复内存中的结构以便后续追加)
        # 注意：如果不恢复 prompts/responses 到内存，_build_sample_detail 时可能会缺失旧轮次的信息
        # 但由于我们已经复制了 inputs/outputs 文件夹，且 _save_prompts_and_responses 是追加写入（或覆盖），
        # 只要我们不覆盖旧文件，或者重新读取它们。
        # 
        # 实际上，_build_sample_detail 依赖 state["prompts"] 和 state["responses"]。
        # 为了生成完整的 process_details.json，我们需要把旧的 prompt/response 加载到内存。
        # 这里做一个简单的加载：读取 inputs/outputs 目录下的文件
        
        task_id = state["task_id"]
        result_dir = RESULTS_DIR / task_id
        
        inputs_dir = result_dir / "inputs"
        outputs_dir = result_dir / "outputs"
        
        if inputs_dir.exists():
            for sample_dir in inputs_dir.iterdir():
                if sample_dir.is_dir() and sample_dir.name.startswith("sample_"):
                    try:
                        idx = int(sample_dir.name.split("_")[1])
                        if idx not in state["prompts"]:
                            state["prompts"][idx] = {}
                            
                        for file in sample_dir.glob("iteration_*.txt"):
                            iter_num = int(file.stem.split("_")[1])
                            with open(file, 'r', encoding='utf-8') as f:
                                state["prompts"][idx][iter_num] = f.read()
                    except:
                        pass

        if outputs_dir.exists():
            for sample_dir in outputs_dir.iterdir():
                if sample_dir.is_dir() and sample_dir.name.startswith("sample_"):
                    try:
                        idx = int(sample_dir.name.split("_")[1])
                        if idx not in state["responses"]:
                            state["responses"][idx] = {}
                            
                        for file in sample_dir.glob("iteration_*.txt"):
                            iter_num = int(file.stem.split("_")[1])
                            with open(file, 'r', encoding='utf-8') as f:
                                content = f.read()
                                # 构造一个简单的 response 对象
                                state["responses"][idx][iter_num] = {
                                    "llm_response": content,
                                    "predictions": {}, # 无法从文本恢复预测值，但这通常不影响显示
                                    "confidence": None
                                }
                    except:
                        pass

    def _get_candidate_samples(self, state: IterationState) -> List[tuple]:
        """
        获取候选样本（排除完全完成的样本）
        
        增量预测场景：
        - 已收敛但迭代历史不完整的样本应该被包含（以便补全缺失的迭代）
        - early_stop=false 时，即使已收敛也要继续到 max_iterations
        - 只有迭代历史完整（iterations数组长度 == max_iterations）且已收敛的样本才被排除

        Returns:
            候选样本列表 [(idx, test_sample), ...]
        """
        candidate_samples = []
        sample_size = state.get("sample_size")
        max_iterations = state.get("max_iterations", 1)
        early_stop = state.get("early_stop", True)
        
        task_id = state.get("task_id", "unknown")
        logger.info(f"Task {task_id}: 筛选候选样本 (sample_size={sample_size}, max_iterations={max_iterations}, early_stop={early_stop})")
        
        for idx, test_sample in enumerate(state["test_data"]):
            # 如果 sample_size 存在，只处理前 sample_size 个样本
            # 这是一个硬性限制：只有前 sample_size 个样本会被纳入预测范围
            if sample_size is not None and sample_size > 0 and idx >= sample_size:
                logger.debug(f"Task {task_id}: 样本{idx} - 超出 sample_size 范围，跳过")
                continue
            
            # 🔥 修改：检查样本是否完全完成
            # 完全完成 = 已收敛 + 迭代历史完整 (仅在 early_stop=true 时)
            should_exclude = False
            exclude_reason = ""
            
            if idx in state["failed_samples"]:
                # 失败样本应该被包含，以便重试
                should_exclude = False
                logger.info(f"Task {task_id}: 样本{idx} - 失败样本，包含以便重试")
            elif idx in state["converged_samples"]:
                # 🔥 关键：如果 early_stop=false，已收敛的样本也要继续
                if not early_stop:
                    # early_stop=false：检查迭代历史是否完整
                    if idx in state["iteration_history"]:
                        history = state["iteration_history"][idx]
                        # 检查所有目标属性的迭代历史长度
                        all_complete = True
                        for target in state["target_properties"]:
                            vals = history.get(target, [])
                            current_len = len(vals)
                            # 如果任何目标属性的迭代数 < max_iterations，则不完整
                            if current_len < max_iterations:
                                all_complete = False
                                logger.info(f"Task {task_id}: 样本{idx} - 已收敛但历史不完整 ({target}: {current_len}/{max_iterations})，包含")
                                break
                            # 检查是否有任何一轮的值是 None
                            if any(v is None for v in vals):
                                all_complete = False
                                logger.info(f"Task {task_id}: 样本{idx} - 已收敛但有 None 值 ({target})，包含")
                                break
                        
                        if all_complete:
                            should_exclude = True
                            exclude_reason = f"已收敛且历史完整 ({len(vals)}/{max_iterations})"
                    else:
                        # 没有历史记录，不应该排除
                        should_exclude = False
                        logger.info(f"Task {task_id}: 样本{idx} - 已收敛但无历史记录，包含")
                else:
                    # early_stop=true：已收敛的样本可以排除（但还要检查历史完整性）
                    if idx in state["iteration_history"]:
                        history = state["iteration_history"][idx]
                        # 检查所有目标属性的迭代历史长度
                        all_complete = True
                        for target in state["target_properties"]:
                            vals = history.get(target, [])
                            current_len = len(vals)
                            # 如果任何目标属性的迭代数 < max_iterations，则不完整
                            if current_len < max_iterations:
                                all_complete = False
                                logger.info(f"Task {task_id}: 样本{idx} - 已收敛但历史不完整 ({target}: {current_len}/{max_iterations})，包含")
                                break
                            # 检查是否有任何一轮的值是 None
                            if any(v is None for v in vals):
                                all_complete = False
                                logger.info(f"Task {task_id}: 样本{idx} - 已收敛但有 None 值 ({target})，包含")
                                break
                        
                        if all_complete:
                            should_exclude = True
                            exclude_reason = f"已收敛且历史完整 ({len(vals)}/{max_iterations})"
                    else:
                        # 没有历史记录，不应该排除
                        should_exclude = False
                        logger.info(f"Task {task_id}: 样本{idx} - 已收敛但无历史记录，包含")
            else:
                # 既未收敛也未失败的样本
                logger.info(f"Task {task_id}: 样本{idx} - 未收敛，包含")
            
            if should_exclude:
                logger.info(f"Task {task_id}: 样本{idx} - 排除（{exclude_reason}）")
            else:
                candidate_samples.append((idx, test_sample))
        
        logger.info(f"Task {task_id}: 筛选结果 - {len(candidate_samples)} 个候选样本: {[idx for idx, _ in candidate_samples]}")
        return candidate_samples

    def _select_samples_to_predict(
        self,
        state: IterationState,
        candidate_samples: List[tuple],
        current_iter: int
    ) -> List[tuple]:
        """
        根据 sample_size 参数选择本轮要预测的样本（顺序选择，不随机）
        
        增量预测逻辑：
        - 如果某个样本的当前轮次已有有效预测值，则跳过
        - 如果当前轮次的值是 None 或不存在，则需要重新预测

        Args:
            state: 迭代状态
            candidate_samples: 候选样本列表 [(idx, test_sample), ...]
            current_iter: 当前迭代轮次

        Returns:
            本轮要预测的样本列表
        """
        if state["sample_size"] is not None and state["sample_size"] > 0:
            # 顺序选择前 sample_size 个样本（按索引从小到大）
            sorted_candidates = sorted(candidate_samples, key=lambda x: x[0])
            
            # 过滤掉在当前轮次已有有效结果的样本（增量预测逻辑）
            real_candidates = []
            skipped_count = 0
            
            for idx, sample in sorted_candidates:
                # 检查是否已有当前轮次的有效结果
                has_valid_result = False
                if idx in state["iteration_history"]:
                    history = state["iteration_history"][idx]
                    # 检查所有目标属性是否都有当前轮次的有效值（不是 None）
                    all_targets_have_valid_value = True
                    for target in state["target_properties"]:
                        vals = history.get(target, [])
                        # 🔥 关键修改：不仅检查长度，还要检查值的有效性
                        if len(vals) < current_iter:
                            # 缺少当前轮次的值
                            all_targets_have_valid_value = False
                            break
                        # 检查当前轮次的值是否为 None
                        current_iter_value = vals[current_iter - 1]  # current_iter 是 1-indexed
                        if current_iter_value is None:
                            # 当前轮次的值是 None（失败），需要重新预测
                            all_targets_have_valid_value = False
                            break
                    if all_targets_have_valid_value:
                        has_valid_result = True
                
                if not has_valid_result:
                    real_candidates.append((idx, sample))
                else:
                    skipped_count += 1
            
            # 从剩下的候选者中选择
            num_to_predict = min(state["sample_size"], len(real_candidates))
            samples_to_predict = real_candidates[:num_to_predict]

            selected_indices = [idx for idx, _ in samples_to_predict]
            logger.info(
                f"Task {state['task_id']}: 第{current_iter}轮 - "
                f"候选{len(candidate_samples)}个，跳过已完成{skipped_count}个，"
                f"计划预测{num_to_predict}个 (sample_size={state['sample_size']}), "
                f"选中索引: {selected_indices}"
            )
        else:
            # 处理所有样本
            real_candidates = []
            skipped_count = 0
            
            for idx, sample in candidate_samples:
                # 检查是否已有当前轮次的有效结果
                has_valid_result = False
                if idx in state["iteration_history"]:
                    history = state["iteration_history"][idx]
                    all_targets_have_valid_value = True
                    for target in state["target_properties"]:
                        vals = history.get(target, [])
                        # 🔥 关键修改：不仅检查长度，还要检查值的有效性
                        if len(vals) < current_iter:
                            all_targets_have_valid_value = False
                            break
                        # 检查当前轮次的值是否为 None
                        current_iter_value = vals[current_iter - 1]
                        if current_iter_value is None:
                            all_targets_have_valid_value = False
                            break
                    if all_targets_have_valid_value:
                        has_valid_result = True
                
                if not has_valid_result:
                    real_candidates.append((idx, sample))
                else:
                    skipped_count += 1
            
            samples_to_predict = real_candidates
            logger.info(
                f"Task {state['task_id']}: 第{current_iter}轮 - "
                f"跳过已完成{skipped_count}个，预测剩余{len(samples_to_predict)}个未收敛样本"
            )

        return samples_to_predict

    def _node_predict_iteration(self, state: IterationState) -> IterationState:
        """
        预测迭代节点 - 根据 sample_size 参数选择样本进行预测
        """
        task_id = state['task_id']
        current_iter = state["current_iteration"]
        logger.info(f"Task {task_id}: 开始第{current_iter}轮迭代预测")

        state["iteration_start_times"][current_iter] = datetime.now()

        # 获取候选样本并选择本轮要预测的样本
        candidate_samples = self._get_candidate_samples(state)
        samples_to_predict = self._select_samples_to_predict(state, candidate_samples, current_iter)

        # 并行预测
        iteration_predictions = self._run_parallel_predictions(state, samples_to_predict, current_iter)

        # 保存本轮迭代结果
        state["iteration_results"][current_iter] = iteration_predictions
        self._save_iteration_results(state, current_iter)

        # 更新任务进度
        self._update_iteration_progress(state, current_iter, len(iteration_predictions))

        return state

    def _run_parallel_predictions(
        self,
        state: IterationState,
        samples_to_predict: List[tuple],
        current_iter: int
    ) -> Dict[int, Dict[str, float]]:
        """
        并行执行样本预测

        Returns:
            预测结果字典 {sample_idx: {target: value}}
        """
        task_id = state['task_id']
        iteration_predictions = {}
        total_samples = len(state["test_data"])
        completed_count = 0

        with ThreadPoolExecutor(max_workers=state["max_workers"]) as executor:
            # 提交所有任务
            futures = {
                executor.submit(
                    self._predict_single_sample,
                    state,
                    sample_idx,
                    test_sample,
                    current_iter
                ): sample_idx
                for sample_idx, test_sample in samples_to_predict
            }

            # 收集结果
            for future in as_completed(futures):
                sample_idx = futures[future]
                try:
                    # 获取完整结果（包含预测值、Prompt、响应等）
                    result_data = future.result()
                    predictions = result_data["predictions"]
                    
                    # 更新迭代结果
                    iteration_predictions[sample_idx] = predictions

                    # 更新状态中的 Prompts 和 Responses
                    if sample_idx not in state["prompts"]:
                        state["prompts"][sample_idx] = {}
                    state["prompts"][sample_idx][current_iter] = result_data["prompt"]

                    if sample_idx not in state["responses"]:
                        state["responses"][sample_idx] = {}
                    state["responses"][sample_idx][current_iter] = result_data["response_data"]

                    # 检查预测值是否有效（非零）
                    all_zeros = True
                    for target in state["target_properties"]:
                        val = predictions.get(target)
                        if val is not None and abs(val) > 1e-6:
                            all_zeros = False
                            break
                    
                    if all_zeros:
                        # 预测失败（全0），记录失败但保留Prompt和Response
                        error_msg = f"Prediction failed: All target properties predicted as zero or None. Response: {result_data['response_data'].get('llm_response', '')[:100]}..."
                        logger.warning(f"Task {task_id}: 样本{sample_idx}预测全为0: {error_msg}")
                        state["failed_samples"][sample_idx] = error_msg
                        # 不更新 iteration_history，这样它会被视为失败
                    else:
                        # 预测成功，更新迭代结果和历史
                        iteration_predictions[sample_idx] = predictions
                        self._update_iteration_history(state, sample_idx, predictions)

                    # 更新进度
                    completed_count += 1
                    self._update_sample_progress(
                        state, current_iter, completed_count,
                        len(samples_to_predict), total_samples
                    )

                except Exception as e:
                    logger.error(
                        f"Task {task_id}: 样本{sample_idx}预测失败: {e}",
                        exc_info=True
                    )
                    state["failed_samples"][sample_idx] = str(e)
                    completed_count += 1
                    self._update_sample_progress(
                        state, current_iter, completed_count,
                        len(samples_to_predict), total_samples
                    )

        return iteration_predictions

    def _update_iteration_history(
        self,
        state: IterationState,
        sample_idx: int,
        predictions: Dict[str, float]
    ):
        """更新样本的迭代历史"""
        if sample_idx not in state["iteration_history"]:
            state["iteration_history"][sample_idx] = {
                prop: [] for prop in state["target_properties"]
            }

        for prop in state["target_properties"]:
            state["iteration_history"][sample_idx][prop].append(
                predictions.get(prop, 0.0)
            )

    def _update_sample_progress(
        self,
        state: IterationState,
        current_iter: int,
        completed_count: int,
        total_to_predict: int,
        total_samples: int
    ):
        """更新单个样本完成后的进度"""
        progress = len(state["converged_samples"]) / total_samples if total_samples > 0 else 0.0
        self.task_manager.update_task(
            state["task_id"],
            {
                "progress": progress,
                "message": f"第{current_iter}轮: 已完成{completed_count}/{total_to_predict}个样本，已收敛{len(state['converged_samples'])}个"
            }
        )

    def _update_iteration_progress(
        self,
        state: IterationState,
        current_iter: int,
        predictions_count: int
    ):
        """更新迭代完成后的进度"""
        total_samples = len(state["test_data"])
        completed_samples = len(state["converged_samples"]) + len(state["failed_samples"])
        progress = completed_samples / total_samples if total_samples > 0 else 0.0

        self.task_manager.update_task(
            state["task_id"],
            {
                "progress": progress,
                "message": f"第{current_iter}轮迭代完成，已收敛{len(state['converged_samples'])}个样本"
            }
        )

        logger.info(
            f"Task {state['task_id']}: 第{current_iter}轮迭代完成，"
            f"成功预测{predictions_count}个样本，结果已保存"
        )

    def _check_sample_convergence_and_update(
        self,
        state: IterationState,
        sample_idx: int,
        current_iter: int
    ) -> bool:
        """
        检查单个样本的收敛情况并更新状态

        Returns:
            是否新收敛
        """
        converged, rel_changes = self.convergence_checker.check_sample_convergence(
            sample_idx,
            state["target_properties"],
            state["iteration_history"][sample_idx]
        )

        if converged:
            state["converged_samples"].add(sample_idx)
            logger.info(
                f"Task {state['task_id']}: 样本{sample_idx}在第{current_iter}轮收敛，"
                f"相对变化率={rel_changes}"
            )
            return True
        return False

    def _node_check_convergence(self, state: IterationState) -> IterationState:
        """
        收敛检查节点 - 检查每个样本是否收敛
        """
        task_id = state['task_id']
        current_iter = state["current_iteration"]
        logger.info(f"Task {task_id}: 检查第{current_iter}轮收敛情况")

        # 只在第2轮及以后检查收敛
        if current_iter < 2:
            logger.info(f"Task {task_id}: 第1轮不检查收敛")
            # 增加迭代计数器（即使不检查收敛也要增加）
            state["current_iteration"] += 1
            return state

        # 更新收敛检查器的阈值
        self.convergence_checker.threshold = state["convergence_threshold"]

        # 检查所有样本的收敛情况
        newly_converged_count = 0
        for sample_idx in state["iteration_history"].keys():
            # 跳过已收敛或失败的样本
            if sample_idx in state["converged_samples"] or sample_idx in state["failed_samples"]:
                continue

            if self._check_sample_convergence_and_update(state, sample_idx, current_iter):
                newly_converged_count += 1

        logger.info(
            f"Task {task_id}: 第{current_iter}轮新增收敛{newly_converged_count}个样本，"
            f"累计收敛{len(state['converged_samples'])}个样本"
        )

        # 增加迭代计数器
        state["current_iteration"] += 1

        return state

    def _node_handle_failure(self, state: IterationState) -> IterationState:
        """
        失败处理节点 - 记录失败样本，不中断整体流程
        """
        task_id = state['task_id']
        logger.info(
            f"Task {task_id}: 处理失败样本，"
            f"失败数量={len(state['failed_samples'])}"
        )

        # 失败样本已在predict_iteration节点中记录，这里只记录日志
        for sample_idx, error_msg in state["failed_samples"].items():
            logger.warning(f"Task {task_id}: 样本{sample_idx}失败: {error_msg}")

        return state

    def _build_global_info(self, state: IterationState) -> Dict[str, Any]:
        """构建全局信息"""
        return {
            "task_id": state["task_id"],
            "total_iterations": state["current_iteration"],
            "max_iterations": state["max_iterations"],
            "convergence_threshold": state["convergence_threshold"],
            "early_stopped": state["early_stop"] and state["current_iteration"] < state["max_iterations"],
            "total_samples": len(state["test_data"]),
            "converged_samples": len(state["converged_samples"]),
            "failed_samples": len(state["failed_samples"])
        }

    def _calculate_relative_changes(self, iterations: List[float]) -> List[Optional[float]]:
        """计算相对变化率"""
        relative_changes = [None]  # 第1轮没有变化率
        for i in range(1, len(iterations)):
            if abs(iterations[i-1]) > 1e-6:
                rel_change = abs(iterations[i] - iterations[i-1]) / abs(iterations[i-1])
            else:
                rel_change = abs(iterations[i] - iterations[i-1])
            relative_changes.append(rel_change)
        return relative_changes

    def _get_convergence_status(
        self,
        sample_idx: int,
        state: IterationState,
        iterations: List[float]
    ) -> tuple:
        """
        获取收敛状态

        Returns:
            (convergence_status, converged_at)
        """
        if sample_idx in state["converged_samples"]:
            return "converged", len(iterations)
        elif sample_idx in state["failed_samples"]:
            return "failed", None
        else:
            return "not_converged", None

    def _build_sample_info(
        self,
        sample_idx: int,
        history: Dict[str, List[float]],
        state: IterationState
    ) -> Dict[str, Any]:
        """构建单个样本的信息"""
        sample_info = {
            "sample_index": sample_idx,
            "targets": {}
        }

        for target_prop in state["target_properties"]:
            iterations = history.get(target_prop, [])
            relative_changes = self._calculate_relative_changes(iterations)
            convergence_status, converged_at = self._get_convergence_status(
                sample_idx, state, iterations
            )

            sample_info["targets"][target_prop] = {
                "iterations": iterations,
                "converged_at_iteration": converged_at,
                "convergence_status": convergence_status,
                "relative_changes": relative_changes
            }

        return sample_info

    def _build_iteration_history_json(self, state: IterationState) -> Dict[str, Any]:
        """构建迭代历史JSON"""
        iteration_history_json = {
            "global_info": self._build_global_info(state),
            "samples": {}
        }

        # 添加每个样本的迭代历史
        for sample_idx, history in state["iteration_history"].items():
            sample_info = self._build_sample_info(sample_idx, history, state)
            iteration_history_json["samples"][f"sample_{sample_idx}"] = sample_info

        return iteration_history_json

    def _node_save_results(self, state: IterationState) -> IterationState:
        """
        保存结果节点 - 保存迭代历史和最终结果到数据库和文件系统
        """
        task_id = state['task_id']
        logger.info(f"Task {task_id}: 保存迭代预测结果")

        # 构建迭代历史JSON
        iteration_history_json = self._build_iteration_history_json(state)

        # 保存结果到文件系统
        self._save_results_to_filesystem(state, iteration_history_json)

        # 更新任务数据库
        self.task_db.update_task(
            task_id,
            {
                "current_iteration": state["current_iteration"],
                "iteration_history": iteration_history_json,
                "failed_samples": state["failed_samples"],
                "result_id": task_id
            }
        )

        logger.info(
            f"Task {task_id}: 迭代预测完成，"
            f"总迭代次数={state['current_iteration']}, "
            f"收敛样本={len(state['converged_samples'])}, "
            f"失败样本={len(state['failed_samples'])}"
        )

        return state

    def _save_results_to_filesystem(self, state: IterationState, iteration_history_json: Dict[str, Any]):
        """
        保存迭代预测结果到文件系统

        Args:
            state: 迭代状态
            iteration_history_json: 迭代历史JSON
        """
        task_id = state["task_id"]

        try:
            # 创建结果目录
            result_dir = RESULTS_DIR / task_id
            result_dir.mkdir(parents=True, exist_ok=True)

            # 1. 保存迭代历史JSON
            iteration_history_file = result_dir / "iteration_history.json"
            iteration_history_content = json.dumps(iteration_history_json, ensure_ascii=False, indent=2)
            if safe_write_file(iteration_history_file, iteration_history_content):
                logger.info(f"Task {task_id}: 已保存迭代历史到 iteration_history.json")
            else:
                logger.error(f"Task {task_id}: 保存迭代历史失败")

            # 2. 构建预测结果CSV（为每个目标属性创建多个预测列）
            # 注意：保留所有原始数据列，确保格式与 RAG 预测服务一致
            predictions_data = []
            
            # 确定要输出的样本索引范围
            sample_size = state.get("sample_size")
            total_samples = len(state["test_data"])
            
            if sample_size is not None and sample_size > 0:
                indices_to_export = range(min(sample_size, total_samples))
            else:
                indices_to_export = range(total_samples)

            for sample_idx in indices_to_export:
                test_sample = state["test_data"][sample_idx]
                
                # 复制所有原始列（包括元素列、工艺列等）
                row = test_sample.copy()

                # 确保 sample_index 列存在
                row["sample_index"] = sample_idx

                # 为每个目标属性添加每轮迭代的预测值
                if sample_idx in state["iteration_history"]:
                    history = state["iteration_history"][sample_idx]
                    for target_prop in state["target_properties"]:
                        iterations = history.get(target_prop, [])

                        # 为每轮迭代创建一个预测列
                        for iter_num in range(1, state["max_iterations"] + 1):
                            col_name = f"{target_prop}_predicted_Iteration_{iter_num}"
                            if iter_num <= len(iterations):
                                row[col_name] = iterations[iter_num - 1]
                            else:
                                row[col_name] = None  # 该样本在这轮没有预测

                    # 添加收敛信息
                    if sample_idx in state["converged_samples"]:
                        row["convergence_status"] = "converged"
                        # 找到收敛的轮次（最后一次预测的轮次）
                        row["converged_at_iteration"] = len(iterations)
                    elif sample_idx in state["failed_samples"]:
                        row["convergence_status"] = "failed"
                        row["converged_at_iteration"] = None
                    else:
                        row["convergence_status"] = "not_converged"
                        row["converged_at_iteration"] = None
                else:
                    # 样本没有预测历史（可能失败了或者被跳过）
                    for target_prop in state["target_properties"]:
                        for iter_num in range(1, state["max_iterations"] + 1):
                            col_name = f"{target_prop}_predicted_Iteration_{iter_num}"
                            row[col_name] = None
                    row["convergence_status"] = "failed"
                    row["converged_at_iteration"] = None

                predictions_data.append(row)

            # 保存predictions.csv（保留所有原始列，并调整列顺序）
            predictions_df = pd.DataFrame(predictions_data)

            # 调整列顺序：sample_index, ID（如果有）, 原始数据列, 预测列, 收敛状态列
            # 1. 确定列顺序
            ordered_columns = []

            # 首先添加 sample_index
            if "sample_index" in predictions_df.columns:
                ordered_columns.append("sample_index")

            # 然后添加 ID（如果存在）
            if "ID" in predictions_df.columns:
                ordered_columns.append("ID")

            # 添加所有原始数据列（排除 sample_index, ID, composition, sample_text, 预测列, 收敛状态列）
            exclude_cols = {"sample_index", "ID", "composition", "sample_text", "convergence_status", "converged_at_iteration"}
            for col in predictions_df.columns:
                if col not in exclude_cols and not col.endswith("_predicted_Iteration_1") and \
                   not col.endswith("_predicted_Iteration_2") and not col.endswith("_predicted_Iteration_3") and \
                   col not in ordered_columns:
                    ordered_columns.append(col)

            # 添加 composition（如果存在）
            if "composition" in predictions_df.columns:
                ordered_columns.append("composition")

            # 添加预测列（按迭代轮次排序）
            prediction_cols = [col for col in predictions_df.columns if "_predicted_Iteration_" in col]
            ordered_columns.extend(sorted(prediction_cols))

            # 最后添加收敛状态列
            if "convergence_status" in predictions_df.columns:
                ordered_columns.append("convergence_status")
            if "converged_at_iteration" in predictions_df.columns:
                ordered_columns.append("converged_at_iteration")

            # 2. 重新排列列顺序
            predictions_df = predictions_df[ordered_columns]

            predictions_file = result_dir / "predictions.csv"
            predictions_df.to_csv(predictions_file, index=False, encoding='utf-8')
            logger.info(f"Task {task_id}: 已保存预测结果到 predictions.csv ({len(predictions_df)} 个样本)")

            # 3. 计算并保存评估指标
            metrics = self._calculate_iterative_metrics(predictions_df, state["target_properties"])
            metrics_file = result_dir / "metrics.json"
            metrics_content = json.dumps(metrics, ensure_ascii=False, indent=2)
            if safe_write_file(metrics_file, metrics_content):
                logger.info(f"Task {task_id}: 已保存评估指标到 metrics.json")
            else:
                logger.error(f"Task {task_id}: 保存评估指标失败")

            # 4. 保存任务配置
            # 获取任务状态信息（使用 get_task_status 获取原始数据，包含 request_data）
            task_info = self.task_manager.get_task_status(task_id) or {}
            
            # 从 TaskManager 获取原始 request_data，避免从 config 重构导致丢失字段
            request_data = task_info.get("request_data", {})
            if not request_data:
                request_data = {
                    "filename": Path(state["config"].get("data_path", "")).name if state["config"].get("data_path") else "",
                    "file_path": state["config"].get("data_path", ""),
                    "config": state["config"],
                    "dataset_id": state["config"].get("dataset_id", ""),
                    "file_id": state["config"].get("file_id", ""),
                    "note": state["config"].get("note", "")
                }

            task_config = {
                "task_id": task_id,
                "status": task_info.get("status", "completed"),
                "progress": task_info.get("progress", 1.0),
                "message": task_info.get("message", "预测完成"),
                "created_at": state["start_time"].isoformat(),
                "updated_at": datetime.now().isoformat(),
                "request_data": request_data,
                "total_rows": len(predictions_data),
                "valid_rows": len(predictions_data),
                "note": state["config"].get("note", ""),
                "total_iterations": state["current_iteration"],
                "max_iterations": state["max_iterations"],
                "convergence_threshold": state["convergence_threshold"],
                "enable_iteration": True,
                "early_stop": state["early_stop"],
                "max_workers": state["max_workers"]
            }
            task_config_file = result_dir / "task_config.json"
            task_config_content = json.dumps(task_config, ensure_ascii=False, indent=2)
            if safe_write_file(task_config_file, task_config_content):
                logger.info(f"Task {task_id}: 已保存任务配置到 task_config.json")
            else:
                logger.error(f"Task {task_id}: 保存任务配置失败")

            # 5. 保存测试集
            test_df = pd.DataFrame(state["test_data"])
            test_set_file = result_dir / "test_set.csv"
            test_df.to_csv(test_set_file, index=False, encoding='utf-8')
            logger.info(f"Task {task_id}: 已保存测试集到 test_set.csv")

            logger.info(f"Task {task_id}: 所有结果文件已保存到 {result_dir}")

        except Exception as e:
            logger.error(f"Task {task_id}: 保存结果到文件系统失败: {e}", exc_info=True)

    def _calculate_iterative_metrics(self, df: pd.DataFrame, target_properties: List[str]) -> Dict[str, Any]:
        """
        计算迭代预测的评估指标（为每轮迭代计算指标）

        Args:
            df: 预测结果DataFrame
            target_properties: 目标属性列表

        Returns:
            评估指标字典
        """
        from sklearn.metrics import r2_score, mean_squared_error, mean_absolute_error
        import numpy as np

        metrics = {}

        # 检查真实值列是否存在
        for target_prop in target_properties:
            if target_prop not in df.columns:
                logger.debug(f"跳过指标计算：真实值列 '{target_prop}' 不存在")
                continue

            # 为每个目标属性计算每轮迭代的指标
            target_metrics = {}

            # 找出所有迭代列
            iteration_cols = [col for col in df.columns if col.startswith(f"{target_prop}_predicted_Iteration_")]

            for pred_col in iteration_cols:
                # 提取迭代轮次
                iter_num = pred_col.split("_")[-1]

                # 计算该轮迭代的指标
                iter_metrics = self._calculate_single_target_metrics(
                    df, target_prop, pred_col,
                    mean_absolute_error, mean_squared_error, r2_score, np
                )

                target_metrics[f"Iteration_{iter_num}"] = iter_metrics

            if target_metrics:
                metrics[target_prop] = target_metrics

        return metrics

    def _calculate_single_target_metrics(
        self,
        df: pd.DataFrame,
        target_prop: str,
        pred_col: str,
        mae_func,
        mse_func,
        r2_func,
        np_module
    ) -> Dict[str, Any]:
        """
        计算单个目标属性的评估指标

        Returns:
            指标字典
        """
        # 过滤掉缺失值
        valid_mask = df[target_prop].notna() & df[pred_col].notna()
        y_true = df.loc[valid_mask, target_prop].values
        y_pred = df.loc[valid_mask, pred_col].values

        if len(y_true) > 0:
            mae = mae_func(y_true, y_pred)
            rmse = np_module.sqrt(mse_func(y_true, y_pred))
            r2 = r2_func(y_true, y_pred) if len(y_true) > 1 else 0.0

            return {
                "MAE": float(mae),
                "RMSE": float(rmse),
                "R2": float(r2),
                "sample_count": int(len(y_true))
            }
        else:
            return {
                "MAE": None,
                "RMSE": None,
                "R2": None,
                "sample_count": 0
            }

    def _build_iteration_global_info(self, state: IterationState, current_iter: int) -> Dict[str, Any]:
        """构建迭代全局信息"""
        return {
            "task_id": state["task_id"],
            "current_iteration": current_iter,
            "max_iterations": state["max_iterations"],
            "convergence_threshold": state["convergence_threshold"],
            "total_samples": len(state["test_data"]),
            "converged_samples": len(state["converged_samples"]),
            "failed_samples": len(state["failed_samples"])
        }

    def _get_iteration_convergence_status(
        self,
        sample_idx: int,
        state: IterationState,
        iterations: List[float]
    ) -> tuple:
        """
        获取迭代中的收敛状态

        Returns:
            (convergence_status, converged_at)
        """
        if sample_idx in state["converged_samples"]:
            return "converged", len(iterations)
        elif sample_idx in state["failed_samples"]:
            return "failed", None
        else:
            return "in_progress", None

    def _build_iteration_sample_info(
        self,
        sample_idx: int,
        history: Dict[str, List[float]],
        state: IterationState
    ) -> Dict[str, Any]:
        """构建迭代中单个样本的信息"""
        sample_info = {
            "sample_index": sample_idx,
            "targets": {}
        }

        for target_prop in state["target_properties"]:
            iterations = history.get(target_prop, [])
            relative_changes = self._calculate_relative_changes(iterations)
            convergence_status, converged_at = self._get_iteration_convergence_status(
                sample_idx, state, iterations
            )

            sample_info["targets"][target_prop] = {
                "iterations": iterations,
                "converged_at_iteration": converged_at,
                "convergence_status": convergence_status,
                "relative_changes": relative_changes
            }

        return sample_info

    def _build_iteration_history_for_current(
        self,
        state: IterationState,
        current_iter: int
    ) -> Dict[str, Any]:
        """构建当前迭代的历史JSON"""
        iteration_history_json = {
            "global_info": self._build_iteration_global_info(state, current_iter),
            "samples": {}
        }

        # 添加每个样本的迭代历史
        for sample_idx, history in state["iteration_history"].items():
            sample_info = self._build_iteration_sample_info(sample_idx, history, state)
            iteration_history_json["samples"][f"sample_{sample_idx}"] = sample_info

        return iteration_history_json

    def _save_iteration_results(self, state: IterationState, current_iter: int):
        """
        保存当前迭代的结果到数据库和文件系统

        Args:
            state: 当前状态
            current_iter: 当前迭代轮次
        """
        try:
            # 构建迭代历史JSON
            iteration_history_json = self._build_iteration_history_for_current(state, current_iter)

            # 更新任务数据库
            self.task_db.update_task(
                state["task_id"],
                {
                    "current_iteration": current_iter,
                    "iteration_history": iteration_history_json,
                    "failed_samples": state["failed_samples"]
                }
            )

            logger.info(f"Task {state['task_id']}: 第{current_iter}轮结果已保存到数据库")

            # 增量保存到文件系统
            self._save_incremental_results_to_filesystem(state, iteration_history_json, current_iter)

        except Exception as e:
            logger.error(
                f"Task {state['task_id']}: 保存第{current_iter}轮结果失败: {e}",
                exc_info=True
            )

    def _save_incremental_results_to_filesystem(
        self,
        state: IterationState,
        iteration_history_json: Dict[str, Any],
        current_iter: int
    ):
        """
        增量保存迭代结果到文件系统（每轮迭代后调用）

        Args:
            state: 迭代状态
            iteration_history_json: 迭代历史JSON（截至当前轮次）
            current_iter: 当前迭代轮次
        """
        task_id = state["task_id"]

        try:
            # 创建结果目录
            result_dir = RESULTS_DIR / task_id
            result_dir.mkdir(parents=True, exist_ok=True)

            # 1. 保存迭代历史JSON（增量更新）
            iteration_history_file = result_dir / "iteration_history.json"
            iteration_history_content = json.dumps(iteration_history_json, ensure_ascii=False, indent=2)
            if safe_write_file(iteration_history_file, iteration_history_content):
                logger.info(f"Task {task_id}: 第{current_iter}轮 - 已更新 iteration_history.json")
            else:
                logger.error(f"Task {task_id}: 第{current_iter}轮 - 更新 iteration_history.json 失败")

            # 2. 构建并保存当前预测结果CSV（增量更新，为每个目标属性创建多个预测列）
            predictions_data = []
            valid_rows_count = 0
            
            # 确定要输出的样本索引范围
            sample_size = state.get("sample_size")
            total_samples = len(state["test_data"])
            
            if sample_size is not None and sample_size > 0:
                indices_to_export = range(min(sample_size, total_samples))
            else:
                indices_to_export = range(total_samples)
                
            for sample_idx in indices_to_export:
                test_sample = state["test_data"][sample_idx]
                
                # 不再跳过未处理的样本，以确保输出行数与 sample_size 一致
                # if sample_idx not in state["iteration_history"] and sample_idx not in state["failed_samples"]:
                #     continue

                row = test_sample.copy()
                row["sample_index"] = sample_idx
                
                is_sample_valid = False

                # 为每个目标属性添加每轮迭代的预测值
                if sample_idx in state["iteration_history"]:
                    history = state["iteration_history"][sample_idx]
                    
                    # 检查该样本是否有效（所有目标属性的最新预测值都不为0且不为空）
                    # 只要有一个目标属性有有效预测，我们暂且认为有效，或者严格一点要求所有？
                    # 根据用户要求 "预测值不为零或空的行数"，通常指有效输出。
                    # 这里检查所有目标属性的最后一个值
                    all_targets_valid = True
                    for target_prop in state["target_properties"]:
                        vals = history.get(target_prop, [])
                        if not vals or vals[-1] is None or abs(vals[-1]) < 1e-6:
                            all_targets_valid = False
                            break
                    if all_targets_valid:
                        is_sample_valid = True

                    for target_prop in state["target_properties"]:
                        iterations = history.get(target_prop, [])

                        # 为每轮迭代创建一个预测列（截至当前轮次）
                        for iter_num in range(1, state["max_iterations"] + 1):
                            col_name = f"{target_prop}_predicted_Iteration_{iter_num}"
                            if iter_num <= len(iterations):
                                row[col_name] = iterations[iter_num - 1]
                            else:
                                row[col_name] = None  # 该样本在这轮还没有预测

                    # 添加收敛信息
                    if sample_idx in state["converged_samples"]:
                        row["convergence_status"] = "converged"
                        row["converged_at_iteration"] = len(iterations)
                    elif sample_idx in state["failed_samples"]:
                        row["convergence_status"] = "failed"
                        row["converged_at_iteration"] = None
                    else:
                        row["convergence_status"] = "in_progress"
                        row["converged_at_iteration"] = None
                else:
                    # 样本失败了（在failed_samples中但不在iteration_history中）
                    for target_prop in state["target_properties"]:
                        for iter_num in range(1, state["max_iterations"] + 1):
                            col_name = f"{target_prop}_predicted_Iteration_{iter_num}"
                            row[col_name] = None
                    row["convergence_status"] = "failed"
                    row["converged_at_iteration"] = None
                
                if is_sample_valid:
                    valid_rows_count += 1

                predictions_data.append(row)

            # 保存predictions.csv（调整列顺序）
            predictions_df = pd.DataFrame(predictions_data)

            # 调整列顺序：sample_index, ID（如果有）, 原始数据列, 预测列, 收敛状态列
            ordered_columns = []

            # 首先添加 sample_index
            if "sample_index" in predictions_df.columns:
                ordered_columns.append("sample_index")

            # 然后添加 ID（如果存在）
            if "ID" in predictions_df.columns:
                ordered_columns.append("ID")

            # 添加所有原始数据列（排除 sample_index, ID, composition, sample_text, 预测列, 收敛状态列）
            exclude_cols = {"sample_index", "ID", "composition", "sample_text", "convergence_status", "converged_at_iteration"}
            for col in predictions_df.columns:
                if col not in exclude_cols and not col.endswith("_predicted_Iteration_1") and \
                   not col.endswith("_predicted_Iteration_2") and not col.endswith("_predicted_Iteration_3") and \
                   col not in ordered_columns:
                    ordered_columns.append(col)

            # 添加 composition（如果存在）
            if "composition" in predictions_df.columns:
                ordered_columns.append("composition")

            # 添加预测列（按迭代轮次排序）
            prediction_cols = [col for col in predictions_df.columns if "_predicted_Iteration_" in col]
            ordered_columns.extend(sorted(prediction_cols))

            # 最后添加收敛状态列
            if "convergence_status" in predictions_df.columns:
                ordered_columns.append("convergence_status")
            if "converged_at_iteration" in predictions_df.columns:
                ordered_columns.append("converged_at_iteration")

            # 重新排列列顺序
            predictions_df = predictions_df[ordered_columns]

            predictions_file = result_dir / "predictions.csv"
            predictions_df.to_csv(predictions_file, index=False, encoding='utf-8')
            logger.info(f"Task {task_id}: 第{current_iter}轮 - 已更新 predictions.csv ({len(predictions_df)} 个样本)")

            # 3. 计算并保存评估指标（增量更新）
            metrics = self._calculate_iterative_metrics(predictions_df, state["target_properties"])
            metrics["current_iteration"] = current_iter
            metrics["max_iterations"] = state["max_iterations"]
            metrics["converged_samples"] = len(state["converged_samples"])
            metrics["failed_samples"] = len(state["failed_samples"])
            metrics["in_progress_samples"] = len(state["test_data"]) - len(state["converged_samples"]) - len(state["failed_samples"])

            metrics_file = result_dir / "metrics.json"
            metrics_content = json.dumps(metrics, ensure_ascii=False, indent=2)
            if safe_write_file(metrics_file, metrics_content):
                logger.info(f"Task {task_id}: 第{current_iter}轮 - 已更新 metrics.json")
            else:
                logger.error(f"Task {task_id}: 第{current_iter}轮 - 更新 metrics.json 失败")

            # 4. 保存任务配置（每轮更新，因为total_rows和valid_rows会变化）
            task_config_file = result_dir / "task_config.json"
            # 总是更新 task_config.json
            # 获取任务状态信息（使用 get_task_status 获取原始数据，包含 request_data）
            task_info = self.task_manager.get_task_status(task_id) or {}

            # 从 TaskManager 获取原始 request_data
            request_data = task_info.get("request_data", {})
            if not request_data:
                request_data = {
                    "filename": Path(state["config"].get("data_path", "")).name if state["config"].get("data_path") else "",
                    "file_path": state["config"].get("data_path", ""),
                    "config": state["config"],
                    "dataset_id": state["config"].get("dataset_id", ""),
                    "file_id": state["config"].get("file_id", ""),
                    "note": state["config"].get("note", "")
                }

            task_config = {
                "task_id": task_id,
                "status": task_info.get("status", "running"),
                "progress": task_info.get("progress", 0.0),
                "message": task_info.get("message", ""),
                "created_at": state["start_time"].isoformat(),
                "updated_at": datetime.now().isoformat(),
                "request_data": request_data,
                "total_rows": len(predictions_data),
                "valid_rows": valid_rows_count,
                "note": state["config"].get("note", ""),
                "total_iterations": state["current_iteration"],
                "max_iterations": state["max_iterations"],
                "convergence_threshold": state["convergence_threshold"],
                "enable_iteration": True,
                "early_stop": state["early_stop"],
                "max_workers": state["max_workers"]
            }
            task_config_content = json.dumps(task_config, ensure_ascii=False, indent=2)
            if safe_write_file(task_config_file, task_config_content):
                logger.info(f"Task {task_id}: 已更新 task_config.json (rows={len(predictions_data)}, valid={valid_rows_count})")
            else:
                logger.error(f"Task {task_id}: 保存 task_config.json 失败")

            # 5. 保存测试集（只在第一轮保存）
            test_set_file = result_dir / "test_set.csv"
            if current_iter == 1 or not test_set_file.exists():
                test_df = pd.DataFrame(state["test_data"])
                test_df.to_csv(test_set_file, index=False, encoding='utf-8')
                logger.info(f"Task {task_id}: 已保存 test_set.csv")

            # 6. 保存 inputs 和 outputs 文件夹（每轮增量保存）
            self._save_prompts_and_responses(result_dir, state, current_iter)

            # 7. 生成并保存 process_details.json（每轮增量更新）
            self._save_process_details(result_dir, state, current_iter)

            logger.info(
                f"Task {task_id}: 第{current_iter}轮结果已增量保存到文件系统 "
                f"(收敛:{len(state['converged_samples'])}, "
                f"失败:{len(state['failed_samples'])}, "
                f"进行中:{len(state['test_data']) - len(state['converged_samples']) - len(state['failed_samples'])})"
            )

        except Exception as e:
            logger.error(f"Task {task_id}: 第{current_iter}轮增量保存到文件系统失败: {e}", exc_info=True)

    def _build_sample_detail(
        self,
        sample_idx: int,
        test_sample: Dict[str, Any],
        state: IterationState
    ) -> Dict[str, Any]:
        """
        构建单个样本的详细信息（完全继承 RAG 预测服务的格式）

        Returns:
            样本详细信息字典
        """
        # 获取样本文本并应用列名映射
        sample_text = test_sample.get("sample_text", "")
        
        # 获取列名映射配置
        config = state["config"]
        column_name_mapping = None
        if config.get("prompt_template") and "column_name_mapping" in config["prompt_template"]:
            column_name_mapping = config["prompt_template"]["column_name_mapping"]
        else:
            # 使用默认列名映射
            from services.prompt_template_manager import PromptTemplateManager
            column_name_mapping = PromptTemplateManager.get_default_column_mapping()
            
        # 应用映射
        if sample_text:
            prompt_builder = PromptBuilder(column_name_mapping=column_name_mapping)
            sample_text = prompt_builder._apply_column_name_mapping(sample_text)

        # 获取真实值
        true_values = {
            target_prop: test_sample[target_prop]
            for target_prop in state["target_properties"]
            if target_prop in test_sample
        }

        # 获取迭代历史和最终预测值
        iteration_history = {}
        predicted_values = {}  # 使用 predicted_values 而不是 final_predictions

        if sample_idx in state["iteration_history"]:
            history = state["iteration_history"][sample_idx]
            for target_prop in state["target_properties"]:
                iterations = history.get(target_prop, [])
                if iterations:
                    iteration_history[target_prop] = iterations
                    predicted_values[target_prop] = iterations[-1]  # 最后一轮的预测值

        # 获取相似样本信息（从第一轮的响应中获取）
        similar_samples = []
        if sample_idx in state["responses"] and 1 in state["responses"][sample_idx]:
            first_iter_response = state["responses"][sample_idx][1]
            similar_samples = first_iter_response.get("similar_samples", [])

        # 获取最后一轮的 prompt 和 llm_response
        # prompt 使用最后一轮（与 predicted_values 保持一致）
        # llm_response 使用最后一轮
        prompt = ""
        llm_response = ""

        if sample_idx in state["prompts"]:
            last_iteration = max(state["prompts"][sample_idx].keys()) if state["prompts"][sample_idx] else None
            if last_iteration:
                prompt = state["prompts"][sample_idx][last_iteration]

        # 获取最后一轮的 llm_response
        if sample_idx in state["responses"]:
            # 找到最后一轮的迭代
            last_iteration = max(state["responses"][sample_idx].keys()) if state["responses"][sample_idx] else None
            if last_iteration:
                llm_response = state["responses"][sample_idx][last_iteration].get("llm_response", "")

        # 构建基本信息（与 RAG 预测服务格式完全一致）
        detail = {
            "sample_index": sample_idx,
            "sample_text": sample_text,
            "true_values": true_values,
            "predicted_values": predicted_values,  # 使用 predicted_values 而不是 final_predictions
            "prompt": prompt,  # 第一轮的 prompt
            "llm_response": llm_response,  # 第一轮的 llm_response
            "confidence": None,  # 默认置信度
            "similar_samples": similar_samples,  # 相似样本列表
            "iteration_history": iteration_history,  # 迭代历史（迭代预测特有）
            "predicted_at": datetime.now().isoformat(),  # 预测时间
            "used_default_values": False  # 是否使用默认值
        }

        # 获取最后一轮的 confidence
        if sample_idx in state["responses"]:
            last_iteration = max(state["responses"][sample_idx].keys()) if state["responses"][sample_idx] else None
            if last_iteration:
                detail["confidence"] = state["responses"][sample_idx][last_iteration].get("confidence")

        # 添加 ID 字段（如果存在）
        if "ID" in test_sample:
            detail["ID"] = test_sample["ID"]

        # 添加每轮迭代的详细信息（prompt 和 response）
        if sample_idx in state["prompts"]:
            iterations_details = []
            for iteration in sorted(state["prompts"][sample_idx].keys()):
                iteration_detail = {
                    "iteration": iteration,
                    "prompt": state["prompts"][sample_idx].get(iteration, ""),
                }

                # 添加该轮的响应信息
                if sample_idx in state["responses"] and iteration in state["responses"][sample_idx]:
                    response_data = state["responses"][sample_idx][iteration]
                    iteration_detail["llm_response"] = response_data.get("llm_response", "")
                    iteration_detail["predictions"] = response_data.get("predictions", {})
                    iteration_detail["confidence"] = response_data.get("confidence")  # 添加每轮的置信度

                iterations_details.append(iteration_detail)

            detail["iterations_details"] = iterations_details

        return detail

    def _save_process_details(
        self,
        result_dir: Path,
        state: IterationState,
        current_iter: int
    ):
        """
        生成并保存 process_details.json 文件

        Args:
            result_dir: 结果目录
            state: 迭代状态
            current_iter: 当前迭代轮次
        """
        task_id = state["task_id"]

        try:
            process_details = []

            # 遍历所有测试样本，只包含至少被预测过一次的样本
            for sample_idx, test_sample in enumerate(state["test_data"]):
                if sample_idx not in state["iteration_history"]:
                    continue

                detail = self._build_sample_detail(sample_idx, test_sample, state)
                process_details.append(detail)

            # 保存到文件
            process_details_file = result_dir / "process_details.json"
            process_details_content = json.dumps(process_details, ensure_ascii=False, indent=2)
            if safe_write_file(process_details_file, process_details_content):
                logger.info(
                    f"Task {task_id}: 第{current_iter}轮 - 已保存 process_details.json "
                    f"({len(process_details)} 个样本记录)"
                )
            else:
                logger.error(f"Task {task_id}: 第{current_iter}轮 - 保存 process_details.json 失败")

        except Exception as e:
            logger.error(f"Task {task_id}: 保存 process_details.json 失败: {e}", exc_info=True)

    def _save_prompts_and_responses(
        self,
        result_dir: Path,
        state: IterationState,
        current_iter: int
    ):
        """
        保存 prompts 和 responses 到 inputs/ 和 outputs/ 文件夹

        Args:
            result_dir: 结果目录
            state: 迭代状态
            current_iter: 当前迭代轮次
        """
        task_id = state["task_id"]

        try:
            # 创建 inputs 和 outputs 目录
            inputs_dir = result_dir / "inputs"
            outputs_dir = result_dir / "outputs"
            inputs_dir.mkdir(exist_ok=True)
            outputs_dir.mkdir(exist_ok=True)

            # 遍历所有样本（不仅仅是有prompt的样本，以确保文件完整性）
            for sample_idx in range(len(state["test_data"])):
                # 如果样本未被处理（不在 iteration_history 且不在 failed_samples 中），则跳过
                if sample_idx not in state["iteration_history"] and sample_idx not in state["failed_samples"]:
                    continue

                # 创建样本目录
                sample_inputs_dir = inputs_dir / f"sample_{sample_idx}"
                sample_outputs_dir = outputs_dir / f"sample_{sample_idx}"
                sample_inputs_dir.mkdir(exist_ok=True)
                sample_outputs_dir.mkdir(exist_ok=True)

                # 遍历所有迭代轮次（直到当前轮次）
                for iteration in range(1, current_iter + 1):
                    # 保存 prompt 到 inputs
                    prompt_file = sample_inputs_dir / f"iteration_{iteration}.txt"
                    
                    if sample_idx in state["prompts"] and iteration in state["prompts"][sample_idx]:
                        prompt = state["prompts"][sample_idx][iteration]
                        if not safe_write_file(prompt_file, prompt):
                            logger.error(f"Task {task_id}: 写入Prompt失败 {prompt_file}")
                    else:
                        # 如果缺失，写入占位符（例如样本失败或跳过）
                        if not prompt_file.exists():
                            safe_write_file(prompt_file, f"No prompt data for iteration {iteration}")

                    # 保存 response 到 outputs
                    response_file = sample_outputs_dir / f"iteration_{iteration}.txt"
                    
                    if sample_idx in state["responses"] and iteration in state["responses"][sample_idx]:
                        response_data = state["responses"][sample_idx][iteration]
                        output_content = self._build_response_content(response_data)
                        if not safe_write_file(response_file, output_content):
                             logger.error(f"Task {task_id}: 写入响应失败 {response_file}")
                    else:
                        # 如果缺失，写入占位符
                        if not response_file.exists():
                            safe_write_file(response_file, f"No response data for iteration {iteration}")

            logger.info(
                f"Task {task_id}: 第{current_iter}轮 - 已保存 {len(state['prompts'])} 个样本的 prompts 和 responses"
            )

        except Exception as e:
            logger.error(f"Task {task_id}: 保存 prompts 和 responses 失败: {e}", exc_info=True)

    def _build_response_content(self, response_data: Dict[str, Any]) -> str:
        """
        构建响应文件内容（只返回 LLM 原始响应）

        Args:
            response_data: 响应数据

        Returns:
            LLM 响应字符串
        """
        # 直接从 response_data 中提取 llm_response
        llm_response = response_data.get('llm_response', '')

        # 返回纯净的 LLM 响应字符串
        return llm_response if llm_response else "No response available"

    def _should_handle_failure(self, state: IterationState) -> str:
        """
        判断是否需要处理失败

        Returns:
            "handle_failure" 或 "continue"
        """
        if state["failed_samples"]:
            return "handle_failure"
        return "continue"

    def _should_continue_iteration(self, state: IterationState) -> str:
        """
        判断是否继续迭代（不修改状态，只做判断）

        Returns:
            "continue" 或 "finish"
        """
        # 检查是否达到最大迭代次数
        # 注意：current_iteration 在每轮结束后会 +1，所以这里用 > 而不是 >=
        # 例如：max_iterations=3 时，应该执行第1、2、3轮，第3轮结束后 current_iteration=4，此时停止
        if state["current_iteration"] > state["max_iterations"]:
            logger.info(
                f"Task {state['task_id']}: 达到最大迭代次数{state['max_iterations']}，停止迭代"
            )
            return "finish"

        # 检查是否所有样本都已收敛或失败
        total_samples = len(state["test_data"])
        completed_samples = len(state["converged_samples"]) + len(state["failed_samples"])

        if completed_samples >= total_samples:
            logger.info(
                f"Task {state['task_id']}: 所有样本已完成（收敛或失败），停止迭代"
            )
            return "finish"

        # 检查是否启用提前停止
        if state["early_stop"]:
            # 如果超过80%的样本已收敛，可以提前停止
            convergence_rate = len(state["converged_samples"]) / total_samples
            if convergence_rate >= 0.8:
                logger.info(
                    f"Task {state['task_id']}: 收敛率{convergence_rate:.2%}>=80%，提前停止"
                )
                return "finish"

        # 继续下一轮迭代
        logger.info(
            f"Task {state['task_id']}: 准备进入第{state['current_iteration'] + 1}轮迭代"
        )
        return "continue"

    def _predict_single_sample(
        self,
        state: IterationState,
        sample_idx: int,
        test_sample: Dict[str, Any],
        current_iteration: int
    ) -> Dict[str, Any]:
        """
        预测单个样本

        Args:
            state: 迭代状态
            sample_idx: 样本索引
            test_sample: 测试样本数据
            current_iteration: 当前迭代轮数

        Returns:
            包含预测结果、Prompt、响应等信息的字典
        """
        config = state["config"]
        composition = test_sample.get("composition", "")

        # 提取工艺列
        processing_dict = {}
        if config.get("processing_column"):
            for proc_col in config["processing_column"]:
                if proc_col in test_sample:
                    processing_dict[proc_col] = test_sample[proc_col]

        # 提取特征列
        feature_dict = {}
        if config.get("feature_columns"):
            for feat_col in config["feature_columns"]:
                if feat_col in test_sample:
                    feature_dict[feat_col] = test_sample[feat_col]

        # 构建查询文本
        query_text = SampleTextBuilder.build_sample_text(
            composition=composition,
            processing_columns=processing_dict if processing_dict else None,
            feature_columns=feature_dict if feature_dict else None
        )

        # 检索相似样本
        similar_indices = self.rag_engine.retrieve_similar_samples(
            query_text=query_text,
            train_texts=[s.get("sample_text", "") for s in state["train_data"]],
            train_embeddings=state["train_embeddings"]
        )

        similar_samples = [state["train_data"][i] for i in similar_indices]

        # 获取列名映射配置
        column_name_mapping = None
        if config.get("prompt_template") and "column_name_mapping" in config["prompt_template"]:
            column_name_mapping = config["prompt_template"]["column_name_mapping"]
        else:
            # 使用默认列名映射
            from services.prompt_template_manager import PromptTemplateManager
            column_name_mapping = PromptTemplateManager.get_default_column_mapping()

        # 构建Prompt（传入列名映射）
        prompt_builder = PromptBuilder(column_name_mapping=column_name_mapping)

        # 格式化迭代历史（如果是第2轮及以后）
        iteration_history_str = None
        if current_iteration > 1 and sample_idx in state["iteration_history"]:
            iteration_history_str = prompt_builder.format_multi_target_iteration_history(
                sample_idx,
                state["target_properties"],
                state["iteration_history"][sample_idx]
            )

        # 转换为PromptBuilder需要的格式
        retrieved_samples = []
        for sample in similar_samples:
            sample_text = sample.get("sample_text", "")
            retrieved_samples.append((sample_text, 1.0, sample))

        # 构建Prompt
        prompt = prompt_builder.build_prompt(
            retrieved_samples=retrieved_samples,
            test_sample=query_text,
            target_properties=state["target_properties"],
            iteration=current_iteration,
            iteration_history=iteration_history_str
        )

        # 调用LLM（返回详细信息以保存响应）
        result = self.rag_engine.generate_multi_target_prediction(
            query_composition=composition,
            query_processing=processing_dict if processing_dict else "",
            similar_samples=similar_samples,
            target_columns=state["target_properties"],
            model_provider=state["llm_provider"],
            model_name=state["llm_model"],
            temperature=state["temperature"],
            prompt_template=state["config"].get("prompt_template"),
            return_details=True  # 返回详细信息
        )

        # 从 result 中提取预测值（result 是详细信息字典）
        predictions = result.get('predictions', {})

        # 注意：这里不再抛出异常，而是返回结果，由调用方(_run_parallel_predictions)检查是否全为0
        # 这样可以确保即使预测失败，Prompt和Response也能被保存

        # 对相似样本进行处理：
        # 1. 应用列名映射到 sample_text
        # 2. 只保留 sample_text 和目标属性，移除其他字段（如 Processing_Description）
        mapped_similar_samples = []
        for sample in similar_samples:
            clean_sample = {}
            
            # 处理 sample_text
            original_text = sample.get("sample_text", "")
            if original_text:
                clean_sample["sample_text"] = prompt_builder._apply_column_name_mapping(original_text)
            
            # 保留目标属性
            for target in state["target_properties"]:
                if target in sample:
                    clean_sample[target] = sample[target]
            
            mapped_similar_samples.append(clean_sample)

        # 构建响应数据
        response_data = {
            "predictions": predictions,
            "confidence": result.get('confidence'),
            "llm_response": result.get('llm_response', ''),
            "prompt": prompt,
            "similar_samples": mapped_similar_samples,
            "similar_samples_count": len(similar_samples)
        }

        return {
            "predictions": predictions,
            "prompt": prompt,
            "response_data": response_data,
            "mapped_similar_samples": mapped_similar_samples
        }

    def run_iterative_prediction(
        self,
        task_id: str,
        config: PredictionConfig,
        train_data: List[Dict[str, Any]],
        test_data: List[Dict[str, Any]],
        train_embeddings: Any
    ) -> Dict[str, Any]:
        """
        运行迭代预测

        Args:
            task_id: 任务ID
            config: 预测配置
            train_data: 训练数据
            test_data: 测试数据
            train_embeddings: 训练数据嵌入

        Returns:
            迭代预测结果
        """
        logger.info(f"Task {task_id}: 开始运行迭代预测工作流")

        # 初始化状态
        initial_state: IterationState = {
            "task_id": task_id,
            "config": config.model_dump(),
            "train_data": train_data,
            "test_data": test_data,
            "train_embeddings": train_embeddings,
            "current_iteration": 1,
            "max_iterations": config.max_iterations,
            "convergence_threshold": config.convergence_threshold,
            "early_stop": config.early_stop,
            "iteration_results": {},
            "iteration_history": {},
            "converged_samples": set(),
            "failed_samples": {},
            "llm_provider": config.model_provider or "gemini",
            "llm_model": config.model_name or "gemini-2.5-flash",
            "temperature": config.temperature or 1.0,
            "start_time": datetime.now(),
            "iteration_start_times": {},
            "max_workers": config.max_workers,
            "target_properties": config.target_columns,
            "sample_size": config.sample_size,
            "prompts": {},
            "responses": {}
        }

        try:
            # 设置递归限制（最大迭代次数 * 10，因为每轮迭代会经过多个节点）
            recursion_limit = max(config.max_iterations * 10, 100)
            logger.info(f"Task {task_id}: 工作流递归限制设置为 {recursion_limit}")

            final_state = self.workflow.invoke(
                initial_state,
                config={"recursion_limit": recursion_limit}
            )

            logger.info(f"Task {task_id}: 迭代预测工作流完成")

            return {
                "success": True,
                "total_iterations": final_state["current_iteration"],
                "converged_samples": len(final_state["converged_samples"]),
                "failed_samples": len(final_state["failed_samples"]),
                "iteration_history": final_state["iteration_history"]
            }

        except Exception as e:
            logger.error(f"Task {task_id}: 迭代预测工作流失败: {e}", exc_info=True)

            # 更新任务状态为失败
            self.task_manager.update_task(
                task_id,
                {
                    "status": TaskStatus.FAILED,
                    "error": str(e)
                }
            )

            return {
                "success": False,
                "error": str(e)
            }

