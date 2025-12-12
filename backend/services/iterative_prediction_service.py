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

        return state

    def _get_candidate_samples(self, state: IterationState) -> List[tuple]:
        """
        获取候选样本（排除已收敛和失败的样本）

        Returns:
            候选样本列表 [(idx, test_sample), ...]
        """
        candidate_samples = []
        for idx, test_sample in enumerate(state["test_data"]):
            if idx not in state["converged_samples"] and idx not in state["failed_samples"]:
                candidate_samples.append((idx, test_sample))
        return candidate_samples

    def _select_samples_to_predict(
        self,
        state: IterationState,
        candidate_samples: List[tuple],
        current_iter: int
    ) -> List[tuple]:
        """
        根据 sample_size 参数选择本轮要预测的样本（顺序选择，不随机）

        Args:
            state: 迭代状态
            candidate_samples: 候选样本列表 [(idx, test_sample), ...]
            current_iter: 当前迭代轮次

        Returns:
            本轮要预测的样本列表
        """
        if state["sample_size"] is not None and state["sample_size"] > 0:
            # 顺序选择前 sample_size 个样本（按索引从小到大）
            # 先按索引排序，确保从小到大顺序选择
            sorted_candidates = sorted(candidate_samples, key=lambda x: x[0])
            num_to_predict = min(state["sample_size"], len(sorted_candidates))
            samples_to_predict = sorted_candidates[:num_to_predict]

            selected_indices = [idx for idx, _ in samples_to_predict]
            logger.info(
                f"Task {state['task_id']}: 第{current_iter}轮从{len(candidate_samples)}个候选样本中"
                f"顺序选择{num_to_predict}个样本进行预测 (sample_size={state['sample_size']}), "
                f"选中索引: {selected_indices}"
            )
        else:
            samples_to_predict = candidate_samples
            logger.info(
                f"Task {state['task_id']}: 第{current_iter}轮预测所有{len(samples_to_predict)}个未收敛样本"
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
                    predictions = future.result()
                    iteration_predictions[sample_idx] = predictions

                    # 更新迭代历史
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
            for sample_idx, test_sample in enumerate(state["test_data"]):
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
                    # 样本没有预测历史（可能失败了）
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
            task_config = {
                "task_id": task_id,
                "config": state["config"],
                "total_iterations": state["current_iteration"],
                "max_iterations": state["max_iterations"],
                "convergence_threshold": state["convergence_threshold"],
                "total_samples": len(state["test_data"]),
                "converged_samples": len(state["converged_samples"]),
                "failed_samples": len(state["failed_samples"]),
                "target_properties": state["target_properties"]
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
            for sample_idx, test_sample in enumerate(state["test_data"]):
                row = test_sample.copy()
                row["sample_index"] = sample_idx

                # 为每个目标属性添加每轮迭代的预测值
                if sample_idx in state["iteration_history"]:
                    history = state["iteration_history"][sample_idx]
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
                    # 样本还没有预测历史
                    for target_prop in state["target_properties"]:
                        for iter_num in range(1, state["max_iterations"] + 1):
                            col_name = f"{target_prop}_predicted_Iteration_{iter_num}"
                            row[col_name] = None
                    row["convergence_status"] = "pending"
                    row["converged_at_iteration"] = None

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

            # 4. 保存任务配置（只在第一轮保存）
            task_config_file = result_dir / "task_config.json"
            if current_iter == 1 or not task_config_file.exists():
                task_config = {
                    "task_id": task_id,
                    "config": state["config"],
                    "max_iterations": state["max_iterations"],
                    "convergence_threshold": state["convergence_threshold"],
                    "total_samples": len(state["test_data"]),
                    "target_properties": state["target_properties"]
                }
                task_config_content = json.dumps(task_config, ensure_ascii=False, indent=2)
                if safe_write_file(task_config_file, task_config_content):
                    logger.info(f"Task {task_id}: 已保存 task_config.json")
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
        # 获取样本文本
        sample_text = test_sample.get("sample_text", "")

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

        # 获取第一轮的 prompt 和最后一轮的 llm_response
        # prompt 使用第一轮（展示初始提示词）
        # llm_response 使用最后一轮（与 predicted_values 保持一致）
        prompt = ""
        llm_response = ""

        if sample_idx in state["prompts"] and 1 in state["prompts"][sample_idx]:
            prompt = state["prompts"][sample_idx][1]

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
            "similar_samples": similar_samples,  # 相似样本列表
            "iteration_history": iteration_history  # 迭代历史（迭代预测特有）
        }

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

            # 遍历所有有 prompt 记录的样本
            for sample_idx in state["prompts"].keys():
                # 创建样本目录
                sample_inputs_dir = inputs_dir / f"sample_{sample_idx}"
                sample_outputs_dir = outputs_dir / f"sample_{sample_idx}"
                sample_inputs_dir.mkdir(exist_ok=True)
                sample_outputs_dir.mkdir(exist_ok=True)

                # 保存该样本的所有迭代轮次的 prompt 和 response
                for iteration in sorted(state["prompts"][sample_idx].keys()):
                    # 只保存到当前轮次为止的数据
                    if iteration > current_iter:
                        continue

                    # 保存 prompt 到 inputs
                    prompt = state["prompts"][sample_idx][iteration]
                    prompt_file = sample_inputs_dir / f"iteration_{iteration}.txt"
                    safe_write_file(prompt_file, prompt)

                    # 保存 response 到 outputs
                    if sample_idx in state["responses"] and iteration in state["responses"][sample_idx]:
                        response_data = state["responses"][sample_idx][iteration]
                        response_file = sample_outputs_dir / f"iteration_{iteration}.txt"

                        # 构建输出内容
                        output_content = self._build_response_content(response_data)

                        # 写入文件
                        safe_write_file(response_file, output_content)

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
    ) -> Dict[str, float]:
        """
        预测单个样本

        Args:
            state: 迭代状态
            sample_idx: 样本索引
            test_sample: 测试样本数据
            current_iteration: 当前迭代轮数

        Returns:
            预测结果字典 {target: value}
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

        # 保存 prompt
        if sample_idx not in state["prompts"]:
            state["prompts"][sample_idx] = {}
        state["prompts"][sample_idx][current_iteration] = prompt

        # 调用LLM（返回详细信息以保存响应）
        result = self.rag_engine.generate_multi_target_prediction(
            query_composition=composition,
            query_processing=processing_dict if processing_dict else "",
            similar_samples=similar_samples,
            target_columns=state["target_properties"],
            model_provider=state["llm_provider"],
            model_name=state["llm_model"],
            temperature=state["temperature"],
            return_details=True  # 返回详细信息
        )

        # 从 result 中提取预测值（result 是详细信息字典）
        predictions = result.get('predictions', {})

        # 保存 response（包含完整的 LLM 响应信息）
        if sample_idx not in state["responses"]:
            state["responses"][sample_idx] = {}
        state["responses"][sample_idx][current_iteration] = {
            "predictions": predictions,  # 只保存预测值字典
            "llm_response": result.get('llm_response', ''),  # 保存完整的 LLM 响应文本
            "prompt": prompt,
            "similar_samples": similar_samples,  # 保存完整的相似样本列表
            "similar_samples_count": len(similar_samples)
        }

        return predictions

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

