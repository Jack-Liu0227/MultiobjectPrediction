"""
迭代预测服务 - 使用LangGraph实现迭代预测工作流
"""

from typing import TypedDict, List, Dict, Any, Optional, Set
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed
import logging
import json

from langgraph.graph import StateGraph, END
from langgraph.graph.state import CompiledStateGraph

from services.simple_rag_engine import SimpleRAGEngine
from services.prompt_builder import PromptBuilder
from services.convergence_checker import ConvergenceChecker
from services.task_manager import TaskManager
from database.task_db import TaskDatabase
from models.schemas import PredictionConfig

logger = logging.getLogger(__name__)


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
        初始化节点

        初始化迭代预测的状态
        """
        logger.info(f"Task {state['task_id']}: 初始化迭代预测")

        # 初始化迭代结果存储
        state["iteration_results"] = {}
        state["iteration_history"] = {}
        state["converged_samples"] = set()
        state["failed_samples"] = {}
        state["iteration_start_times"] = {}
        state["current_iteration"] = 1
        state["start_time"] = datetime.now()

        # 更新任务状态
        self.task_manager.update_task(
            state["task_id"],
            {
                "status": "running",
                "message": f"开始迭代预测（最大{state['max_iterations']}轮）"
            }
        )

        logger.info(
            f"Task {state['task_id']}: 初始化完成，"
            f"测试样本数={len(state['test_data'])}, "
            f"最大迭代次数={state['max_iterations']}"
        )

        return state

    def _node_predict_iteration(self, state: IterationState) -> IterationState:
        """
        预测迭代节点

        对所有未收敛的样本进行预测
        """
        current_iter = state["current_iteration"]
        logger.info(f"Task {state['task_id']}: 开始第{current_iter}轮迭代预测")

        state["iteration_start_times"][current_iter] = datetime.now()

        # 确定需要预测的样本（排除已收敛和失败的样本）
        samples_to_predict = []
        for idx, test_sample in enumerate(state["test_data"]):
            if idx not in state["converged_samples"] and idx not in state["failed_samples"]:
                samples_to_predict.append((idx, test_sample))

        logger.info(
            f"Task {state['task_id']}: 第{current_iter}轮需要预测{len(samples_to_predict)}个样本"
        )

        # 并行预测
        iteration_predictions = {}
        total_samples = len(state["test_data"])
        completed_count = 0

        with ThreadPoolExecutor(max_workers=state["max_workers"]) as executor:
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

            for future in as_completed(futures):
                sample_idx = futures[future]
                try:
                    predictions = future.result()
                    iteration_predictions[sample_idx] = predictions

                    # 更新迭代历史
                    if sample_idx not in state["iteration_history"]:
                        state["iteration_history"][sample_idx] = {
                            prop: [] for prop in state["target_properties"]
                        }

                    for prop in state["target_properties"]:
                        state["iteration_history"][sample_idx][prop].append(
                            predictions.get(prop, 0.0)
                        )

                    # 每完成一个样本就更新进度
                    completed_count += 1
                    progress = (len(state["converged_samples"]) + len(state["failed_samples"]) + completed_count) / total_samples
                    self.task_manager.update_task(
                        state["task_id"],
                        {
                            "progress": progress,
                            "message": f"第{current_iter}轮: 已完成{completed_count}/{len(samples_to_predict)}个样本"
                        }
                    )

                except Exception as e:
                    logger.error(
                        f"Task {state['task_id']}: 样本{sample_idx}预测失败: {e}",
                        exc_info=True
                    )
                    state["failed_samples"][sample_idx] = str(e)

                    # 失败的样本也要更新进度
                    completed_count += 1
                    progress = (len(state["converged_samples"]) + len(state["failed_samples"]) + completed_count) / total_samples
                    self.task_manager.update_task(
                        state["task_id"],
                        {
                            "progress": progress,
                            "message": f"第{current_iter}轮: 已完成{completed_count}/{len(samples_to_predict)}个样本 (含失败)"
                        }
                    )

        # 保存本轮迭代结果
        state["iteration_results"][current_iter] = iteration_predictions

        # 立即保存当前迭代的结果到数据库
        self._save_iteration_results(state, current_iter)

        # 更新任务进度
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
            f"成功预测{len(iteration_predictions)}个样本，结果已保存"
        )

        return state

    def _node_check_convergence(self, state: IterationState) -> IterationState:
        """
        收敛检查节点

        检查每个样本是否收敛
        """
        current_iter = state["current_iteration"]
        logger.info(f"Task {state['task_id']}: 检查第{current_iter}轮收敛情况")

        # 只在第2轮及以后检查收敛
        if current_iter < 2:
            logger.info(f"Task {state['task_id']}: 第1轮不检查收敛")
            return state

        # 更新收敛检查器的阈值
        self.convergence_checker.threshold = state["convergence_threshold"]

        newly_converged = []
        for sample_idx in state["iteration_history"].keys():
            # 跳过已收敛或失败的样本
            if sample_idx in state["converged_samples"] or sample_idx in state["failed_samples"]:
                continue

            # 检查收敛
            converged, rel_changes = self.convergence_checker.check_sample_convergence(
                sample_idx,
                state["target_properties"],
                state["iteration_history"][sample_idx]
            )

            if converged:
                state["converged_samples"].add(sample_idx)
                newly_converged.append(sample_idx)
                logger.info(
                    f"Task {state['task_id']}: 样本{sample_idx}在第{current_iter}轮收敛，"
                    f"相对变化率={rel_changes}"
                )

        logger.info(
            f"Task {state['task_id']}: 第{current_iter}轮新增收敛{len(newly_converged)}个样本，"
            f"累计收敛{len(state['converged_samples'])}个样本"
        )

        return state

    def _node_handle_failure(self, state: IterationState) -> IterationState:
        """
        失败处理节点

        记录失败样本，不中断整体流程
        """
        logger.info(
            f"Task {state['task_id']}: 处理失败样本，"
            f"失败数量={len(state['failed_samples'])}"
        )

        # 失败样本已在predict_iteration节点中记录
        # 这里只需要记录日志
        for sample_idx, error_msg in state["failed_samples"].items():
            logger.warning(
                f"Task {state['task_id']}: 样本{sample_idx}失败: {error_msg}"
            )

        return state

    def _node_save_results(self, state: IterationState) -> IterationState:
        """
        保存结果节点

        保存迭代历史和最终结果
        """
        logger.info(f"Task {state['task_id']}: 保存迭代预测结果")

        # 构建迭代历史JSON
        iteration_history_json = {
            "global_info": {
                "task_id": state["task_id"],
                "total_iterations": state["current_iteration"],
                "max_iterations": state["max_iterations"],
                "convergence_threshold": state["convergence_threshold"],
                "early_stopped": state["early_stop"] and state["current_iteration"] < state["max_iterations"],
                "total_samples": len(state["test_data"]),
                "converged_samples": len(state["converged_samples"]),
                "failed_samples": len(state["failed_samples"])
            },
            "samples": {}
        }

        # 添加每个样本的迭代历史
        for sample_idx, history in state["iteration_history"].items():
            sample_info = {
                "sample_index": sample_idx,
                "targets": {}
            }

            for target_prop in state["target_properties"]:
                iterations = history.get(target_prop, [])

                # 计算相对变化率
                relative_changes = [None]  # 第1轮没有变化率
                for i in range(1, len(iterations)):
                    if abs(iterations[i-1]) > 1e-6:
                        rel_change = abs(iterations[i] - iterations[i-1]) / abs(iterations[i-1])
                    else:
                        rel_change = abs(iterations[i] - iterations[i-1])
                    relative_changes.append(rel_change)

                # 判断收敛状态
                if sample_idx in state["converged_samples"]:
                    convergence_status = "converged"
                    converged_at = len(iterations)
                elif sample_idx in state["failed_samples"]:
                    convergence_status = "failed"
                    converged_at = None
                else:
                    convergence_status = "not_converged"
                    converged_at = None

                sample_info["targets"][target_prop] = {
                    "iterations": iterations,
                    "converged_at_iteration": converged_at,
                    "convergence_status": convergence_status,
                    "relative_changes": relative_changes
                }

            iteration_history_json["samples"][f"sample_{sample_idx}"] = sample_info

        # 更新任务数据库
        self.task_db.update_task(
            state["task_id"],
            {
                "current_iteration": state["current_iteration"],
                "iteration_history": iteration_history_json,
                "failed_samples": state["failed_samples"]
            }
        )

        logger.info(
            f"Task {state['task_id']}: 迭代预测完成，"
            f"总迭代次数={state['current_iteration']}, "
            f"收敛样本={len(state['converged_samples'])}, "
            f"失败样本={len(state['failed_samples'])}"
        )

        return state

    def _save_iteration_results(self, state: IterationState, current_iter: int):
        """
        保存当前迭代的结果到数据库

        Args:
            state: 当前状态
            current_iter: 当前迭代轮次
        """
        try:
            # 构建迭代历史JSON（只包含到当前迭代的数据）
            iteration_history_json = {
                "global_info": {
                    "task_id": state["task_id"],
                    "current_iteration": current_iter,
                    "max_iterations": state["max_iterations"],
                    "convergence_threshold": state["convergence_threshold"],
                    "total_samples": len(state["test_data"]),
                    "converged_samples": len(state["converged_samples"]),
                    "failed_samples": len(state["failed_samples"])
                },
                "samples": {}
            }

            # 添加每个样本的迭代历史
            for sample_idx, history in state["iteration_history"].items():
                sample_info = {
                    "sample_index": sample_idx,
                    "targets": {}
                }

                for target_prop in state["target_properties"]:
                    iterations = history.get(target_prop, [])

                    # 计算相对变化率
                    relative_changes = [None]  # 第1轮没有变化率
                    for i in range(1, len(iterations)):
                        if abs(iterations[i-1]) > 1e-6:
                            rel_change = abs(iterations[i] - iterations[i-1]) / abs(iterations[i-1])
                        else:
                            rel_change = abs(iterations[i] - iterations[i-1])
                        relative_changes.append(rel_change)

                    # 判断收敛状态
                    if sample_idx in state["converged_samples"]:
                        convergence_status = "converged"
                        converged_at = len(iterations)
                    elif sample_idx in state["failed_samples"]:
                        convergence_status = "failed"
                        converged_at = None
                    else:
                        convergence_status = "in_progress"
                        converged_at = None

                    sample_info["targets"][target_prop] = {
                        "iterations": iterations,
                        "converged_at_iteration": converged_at,
                        "convergence_status": convergence_status,
                        "relative_changes": relative_changes
                    }

                iteration_history_json["samples"][f"sample_{sample_idx}"] = sample_info

            # 更新任务数据库
            self.task_db.update_task(
                state["task_id"],
                {
                    "current_iteration": current_iter,
                    "iteration_history": iteration_history_json,
                    "failed_samples": state["failed_samples"]
                }
            )

            logger.info(
                f"Task {state['task_id']}: 第{current_iter}轮结果已保存到数据库"
            )

        except Exception as e:
            logger.error(
                f"Task {state['task_id']}: 保存第{current_iter}轮结果失败: {e}",
                exc_info=True
            )

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
        判断是否继续迭代

        Returns:
            "continue" 或 "finish"
        """
        # 检查是否达到最大迭代次数
        if state["current_iteration"] >= state["max_iterations"]:
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
        state["current_iteration"] += 1
        logger.info(
            f"Task {state['task_id']}: 继续第{state['current_iteration']}轮迭代"
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
        # 构建样本文本
        from services.sample_text_builder import SampleTextBuilder

        composition = test_sample.get("composition", "")
        processing_dict = {}

        # 提取工艺列
        config = state["config"]
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

        # 构建Prompt
        prompt_builder = PromptBuilder()

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

        # 调用LLM
        result = self.rag_engine.generate_multi_target_prediction(
            query_composition=composition,
            query_processing=processing_dict if processing_dict else "",
            similar_samples=similar_samples,
            target_columns=state["target_properties"],
            model_provider=state["llm_provider"],
            model_name=state["llm_model"],
            temperature=state["temperature"],
            return_details=False
        )

        return result

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
        # 初始化状态
        initial_state: IterationState = {
            "task_id": task_id,
            "config": config.dict(),
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
            "target_properties": config.target_columns
        }

        # 运行工作流
        logger.info(f"Task {task_id}: 开始运行迭代预测工作流")

        try:
            final_state = self.workflow.invoke(initial_state)

            logger.info(f"Task {task_id}: 迭代预测工作流完成")

            return {
                "success": True,
                "total_iterations": final_state["current_iteration"],
                "converged_samples": len(final_state["converged_samples"]),
                "failed_samples": len(final_state["failed_samples"]),
                "iteration_history": final_state["iteration_history"]
            }

        except Exception as e:
            logger.error(
                f"Task {task_id}: 迭代预测工作流失败: {e}",
                exc_info=True
            )

            # 更新任务状态为失败
            self.task_manager.update_task(
                task_id,
                {
                    "status": "failed",
                    "error": str(e)
                }
            )

            return {
                "success": False,
                "error": str(e)
            }

