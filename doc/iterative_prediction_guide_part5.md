# 迭代预测功能开发文档 - 第5部分：LangGraph工作流设计

## 5. LangGraph工作流设计

### 5.1 LangGraph 版本和依赖

**推荐版本**：LangGraph 1.0.4（2025年11月25日发布）

**依赖配置**：
```toml
# pyproject.toml
[project]
dependencies = [
    "langgraph>=1.0.0,<2.0.0",
    "langchain>=0.1.0",
    "langchain-core>=0.1.0",
    "pydantic>=2.0.0",
    "python-dotenv>=1.0.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=7.0.0",
    "pytest-asyncio>=0.21.0",
]
```

**Python 版本要求**：>= 3.10

### 5.2 状态定义

```python
# backend/services/iterative_prediction_service.py

from typing import TypedDict, List, Dict, Any, Optional
from dataclasses import dataclass, field
from datetime import datetime

class IterationState(TypedDict):
    """迭代预测的状态定义"""
    
    # 任务基本信息
    task_id: int
    """任务 ID"""
    
    test_samples: List[Dict[str, Any]]
    """测试样本列表"""
    
    reference_samples: List[Dict[str, Any]]
    """参考样本列表"""
    
    target_properties: List[str]
    """目标属性列表"""
    
    # 迭代配置
    max_iterations: int
    """最大迭代次数"""
    
    convergence_threshold: float
    """收敛阈值"""
    
    early_stop: bool
    """是否启用提前停止"""
    
    max_workers: int
    """最大并发数"""
    
    # 迭代状态
    current_iteration: int
    """当前迭代轮数"""
    
    iteration_history: Dict[str, Dict[str, Any]]
    """迭代历史，格式：
    {
        "sample_0": {
            "targets": {
                "UTS(MPa)": [850, 855, 857],
                "El(%)": [15.0, 14.8, 14.7]
            },
            "convergence_status": "converged"
        },
        ...
    }
    """
    
    converged_samples: set
    """已收敛的样本索引集合"""
    
    failed_samples: Dict[int, str]
    """失败的样本，格式：{sample_index: error_message}"""
    
    # LLM 配置
    llm_provider: str
    """LLM 提供商（gemini 或 openai）"""
    
    llm_model: str
    """LLM 模型名称"""
    
    temperature: float
    """LLM 温度参数"""
    
    # 时间戳
    start_time: datetime
    """任务开始时间"""
    
    iteration_start_times: Dict[int, datetime]
    """每轮迭代的开始时间"""
```

### 5.3 LangGraph 工作流实现

#### 5.3.1 完整的工作流定义

```python
# backend/services/iterative_prediction_service.py

from langgraph.graph import StateGraph, END
from langgraph.graph.graph import CompiledGraph
from concurrent.futures import ThreadPoolExecutor, as_completed
import logging
from datetime import datetime
import json

logger = logging.getLogger(__name__)

class IterativePredictionService:
    """迭代预测服务"""
    
    def __init__(self):
        """初始化服务"""
        self.graph: Optional[CompiledGraph] = None
        self._build_graph()
    
    def _build_graph(self) -> None:
        """构建 LangGraph 工作流"""
        
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
        
        # 添加边（条件路由）
        workflow.add_edge("initialize", "predict_iteration")
        
        # 从 predict_iteration 到 check_convergence 或 handle_failure
        workflow.add_conditional_edges(
            "predict_iteration",
            self._should_handle_failure,
            {
                "handle_failure": "handle_failure",
                "continue": "check_convergence"
            }
        )
        
        # 从 handle_failure 回到 check_convergence
        workflow.add_edge("handle_failure", "check_convergence")
        
        # 从 check_convergence 到 predict_iteration 或 save_results
        workflow.add_conditional_edges(
            "check_convergence",
            self._should_continue_iteration,
            {
                "continue": "predict_iteration",
                "finish": "save_results"
            }
        )
        
        # 设置结束点
        workflow.add_edge("save_results", END)
        
        # 编译图
        self.graph = workflow.compile()
    
    def _node_initialize(self, state: IterationState) -> IterationState:
        """初始化节点：准备迭代预测"""
        logger.info(f"[Task {state['task_id']}] 初始化迭代预测")
        
        state["current_iteration"] = 0
        state["iteration_history"] = {
            f"sample_{i}": {
                "sample_index": i,
                "sample_id": sample.get("ID", f"Sample_{i}"),
                "targets": {prop: [] for prop in state["target_properties"]},
                "convergence_status": "not_converged",
                "failed_iterations": []
            }
            for i, sample in enumerate(state["test_samples"])
        }
        state["converged_samples"] = set()
        state["failed_samples"] = {}
        state["start_time"] = datetime.utcnow()
        state["iteration_start_times"] = {}
        
        return state
    
    def _node_predict_iteration(self, state: IterationState) -> IterationState:
        """预测节点：执行一轮迭代预测"""
        
        current_iter = state["current_iteration"] + 1
        logger.info(f"[Task {state['task_id']}] 开始第 {current_iter} 轮迭代")
        
        state["iteration_start_times"][current_iter] = datetime.utcnow()
        
        # 确定本轮需要预测的样本（未收敛的样本）
        samples_to_predict = [
            i for i in range(len(state["test_samples"]))
            if i not in state["converged_samples"]
        ]
        
        if not samples_to_predict:
            logger.info(f"[Task {state['task_id']}] 所有样本已收敛，跳过预测")
            state["current_iteration"] = current_iter
            return state
        
        logger.info(
            f"[Task {state['task_id']}] 本轮需要预测 {len(samples_to_predict)} 个样本"
        )
        
        # 并行预测
        with ThreadPoolExecutor(max_workers=state["max_workers"]) as executor:
            futures = {}
            
            for sample_idx in samples_to_predict:
                future = executor.submit(
                    self._predict_single_sample,
                    state,
                    sample_idx,
                    current_iter
                )
                futures[future] = sample_idx
            
            # 收集结果
            for future in as_completed(futures):
                sample_idx = futures[future]
                try:
                    result = future.result()
                    
                    # 更新迭代历史
                    for prop in state["target_properties"]:
                        state["iteration_history"][f"sample_{sample_idx}"]["targets"][prop].append(
                            result["predictions"][prop]
                        )
                    
                    logger.info(
                        f"[Task {state['task_id']}] 样本 {sample_idx} 第 {current_iter} 轮预测成功"
                    )
                
                except Exception as e:
                    logger.error(
                        f"[Task {state['task_id']}] 样本 {sample_idx} 第 {current_iter} 轮预测失败: {str(e)}"
                    )
                    state["failed_samples"][sample_idx] = str(e)
                    state["iteration_history"][f"sample_{sample_idx}"]["failed_iterations"].append(
                        current_iter
                    )
        
        state["current_iteration"] = current_iter
        return state
    
    def _predict_single_sample(
        self,
        state: IterationState,
        sample_idx: int,
        iteration: int
    ) -> Dict[str, Any]:
        """预测单个样本"""
        
        from backend.services.llm_config_loader import get_llm
        from backend.services.prompt_builder import PromptBuilder
        from backend.services.simple_rag_engine import SimpleRAGEngine
        
        test_sample = state["test_samples"][sample_idx]
        
        # 获取参考样本（使用 RAG 引擎）
        rag_engine = SimpleRAGEngine()
        reference_samples = rag_engine.retrieve_similar_samples(
            test_sample,
            state["reference_samples"],
            top_k=3
        )
        
        # 构建 Prompt
        iteration_history_str = None
        if iteration > 1:
            iteration_history_str = PromptBuilder.format_iteration_history(
                sample_id=test_sample.get("ID", f"Sample_{sample_idx}"),
                target_properties=state["target_properties"],
                iteration_data=state["iteration_history"][f"sample_{sample_idx}"]["targets"],
                current_iteration=iteration - 1
            )
        
        prompt = PromptBuilder.build_prompt(
            test_sample=test_sample,
            reference_samples=reference_samples,
            target_properties=state["target_properties"],
            iteration=iteration,
            iteration_history=iteration_history_str,
            llm_provider=state["llm_provider"]
        )
        
        # 调用 LLM
        llm = get_llm(
            provider=state["llm_provider"],
            model_name=state["llm_model"],
            temperature=state["temperature"]
        )
        
        response = llm.invoke(prompt)
        
        # 解析响应
        predictions = self._parse_llm_response(response.content)
        
        return {
            "sample_idx": sample_idx,
            "predictions": predictions,
            "prompt": prompt,
            "llm_response": response.content
        }
    
    def _parse_llm_response(self, response: str) -> Dict[str, float]:
        """解析 LLM 响应"""
        
        import json
        import re
        
        # 尝试提取 JSON 部分
        json_match = re.search(r'\{.*\}', response, re.DOTALL)
        if not json_match:
            raise ValueError("无法从 LLM 响应中提取 JSON")
        
        json_str = json_match.group(0)
        response_data = json.loads(json_str)
        
        # 提取预测值
        predictions = response_data.get("predictions", {})
        
        return predictions
    
    def _should_handle_failure(self, state: IterationState) -> str:
        """判断是否需要处理失败"""
        
        if state["failed_samples"]:
            return "handle_failure"
        else:
            return "continue"
    
    def _node_handle_failure(self, state: IterationState) -> IterationState:
        """失败处理节点"""
        
        logger.warning(
            f"[Task {state['task_id']}] 处理失败样本: {list(state['failed_samples'].keys())}"
        )
        
        # 记录失败信息（已在 _node_predict_iteration 中记录）
        # 这里可以添加额外的失败处理逻辑，如重试等
        
        return state
    
    def _node_check_convergence(self, state: IterationState) -> IterationState:
        """收敛检查节点"""
        
        logger.info(f"[Task {state['task_id']}] 检查收敛状态")
        
        newly_converged = set()
        
        for sample_key, sample_data in state["iteration_history"].items():
            sample_idx = sample_data["sample_index"]
            
            # 跳过已收敛的样本
            if sample_idx in state["converged_samples"]:
                continue
            
            # 跳过失败的样本
            if sample_idx in state["failed_samples"]:
                continue
            
            # 检查所有目标属性是否都收敛
            all_converged = True
            for prop in state["target_properties"]:
                values = sample_data["targets"][prop]
                
                if len(values) < 2:
                    all_converged = False
                    break
                
                # 计算相对变化率
                prev_value = values[-2]
                curr_value = values[-1]
                denominator = max(abs(prev_value), 0.1)
                relative_change = abs((curr_value - prev_value) / denominator)
                
                if relative_change >= state["convergence_threshold"]:
                    all_converged = False
                    break
            
            if all_converged:
                newly_converged.add(sample_idx)
                sample_data["convergence_status"] = "converged"
                logger.info(f"[Task {state['task_id']}] 样本 {sample_idx} 已收敛")
        
        state["converged_samples"].update(newly_converged)
        
        return state
    
    def _should_continue_iteration(self, state: IterationState) -> str:
        """判断是否继续迭代"""
        
        # 检查是否达到最大迭代次数
        if state["current_iteration"] >= state["max_iterations"]:
            logger.info(
                f"[Task {state['task_id']}] 达到最大迭代次数 {state['max_iterations']}"
            )
            return "finish"
        
        # 检查是否所有样本都已收敛
        total_samples = len(state["test_samples"])
        converged_count = len(state["converged_samples"])
        
        if state["early_stop"] and converged_count == total_samples:
            logger.info(
                f"[Task {state['task_id']}] 所有样本已收敛，提前停止"
            )
            return "finish"
        
        return "continue"
    
    def _node_save_results(self, state: IterationState) -> IterationState:
        """保存结果节点"""
        
        logger.info(f"[Task {state['task_id']}] 保存迭代预测结果")
        
        # 构建最终的迭代历史 JSON
        final_history = self._build_final_history(state)
        
        # 保存到文件系统
        self._save_to_file(state["task_id"], final_history)
        
        # 保存到数据库
        self._save_to_database(state["task_id"], final_history)
        
        logger.info(f"[Task {state['task_id']}] 迭代预测完成")
        
        return state
    
    def _build_final_history(self, state: IterationState) -> Dict[str, Any]:
        """构建最终的迭代历史"""
        
        # 详见第3部分的 iteration_history.json 格式
        # 这里省略具体实现
        pass
    
    def _save_to_file(self, task_id: int, history: Dict[str, Any]) -> None:
        """保存到文件系统"""
        
        import os
        import json
        
        result_dir = f"results/{task_id}"
        os.makedirs(result_dir, exist_ok=True)
        
        with open(f"{result_dir}/iteration_history.json", "w") as f:
            json.dump(history, f, indent=2)
    
    def _save_to_database(self, task_id: int, history: Dict[str, Any]) -> None:
        """保存到数据库"""
        
        from backend.database.models import Task
        from backend.database.session import SessionLocal
        
        db = SessionLocal()
        task = db.query(Task).filter(Task.id == task_id).first()
        
        if task:
            task.iteration_history = history
            task.current_iteration = history["global_info"]["total_iterations"]
            task.status = "completed"
            db.commit()
        
        db.close()
    
    def run(self, state: IterationState) -> IterationState:
        """运行迭代预测工作流"""
        
        return self.graph.invoke(state)
```

#### 5.3.2 工作流调用示例

```python
# 使用示例

from backend.services.iterative_prediction_service import IterativePredictionService, IterationState
from datetime import datetime

# 初始化服务
service = IterativePredictionService()

# 准备状态
state: IterationState = {
    "task_id": 123,
    "test_samples": [
        {"ID": "Sample_001", "C": 0.5, "Si": 1.2, "Mn": 0.8},
        {"ID": "Sample_002", "C": 0.6, "Si": 1.3, "Mn": 0.9},
    ],
    "reference_samples": [
        {"ID": "Ref_001", "C": 0.48, "Si": 1.1, "Mn": 0.75, "UTS(MPa)": 840, "El(%)": 15.2},
        {"ID": "Ref_002", "C": 0.52, "Si": 1.3, "Mn": 0.85, "UTS(MPa)": 860, "El(%)": 14.8},
    ],
    "target_properties": ["UTS(MPa)", "El(%)"],
    "max_iterations": 5,
    "convergence_threshold": 0.01,
    "early_stop": True,
    "max_workers": 5,
    "current_iteration": 0,
    "iteration_history": {},
    "converged_samples": set(),
    "failed_samples": {},
    "llm_provider": "gemini",
    "llm_model": "gemini-2.0-flash",
    "temperature": 0.7,
    "start_time": datetime.utcnow(),
    "iteration_start_times": {},
}

# 运行工作流
result_state = service.run(state)

# 获取结果
print(f"完成迭代数: {result_state['current_iteration']}")
print(f"收敛样本数: {len(result_state['converged_samples'])}")
print(f"失败样本数: {len(result_state['failed_samples'])}")
```

### 5.4 工作流执行流程图

```
┌─────────────────────────────────────────────────────────────────┐
│                    START: 初始化状态                              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  initialize 节点                                                  │
│  - 初始化 iteration_history                                      │
│  - 初始化 converged_samples = {}                                 │
│  - 初始化 failed_samples = {}                                    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  predict_iteration 节点                                           │
│  - 确定本轮需要预测的样本（未收敛的）                              │
│  - 并行预测（ThreadPoolExecutor）                                │
│  - 更新 iteration_history                                        │
│  - 记录失败样本                                                   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │ 是否有失败样本？  │
                    └─────────────────┘
                      │              │
                   是 │              │ 否
                      ▼              ▼
        ┌──────────────────────┐  ┌──────────────────────┐
        │ handle_failure 节点   │  │ check_convergence 节点│
        │ - 记录失败信息        │  │ - 检查收敛状态        │
        │ - 可选：重试逻辑      │  │ - 更新 converged_... │
        └──────────────────────┘  └──────────────────────┘
                      │                      │
                      └──────────┬───────────┘
                                 │
                                 ▼
                    ┌─────────────────────────┐
                    │ 是否继续迭代？           │
                    │ - 未达最大迭代次数？     │
                    │ - 未全部收敛？           │
                    └─────────────────────────┘
                      │                    │
                   是 │                    │ 否
                      ▼                    ▼
        ┌──────────────────────┐  ┌──────────────────────┐
        │ predict_iteration    │  │ save_results 节点    │
        │ (下一轮)             │  │ - 构建最终历史       │
        └──────────────────────┘  │ - 保存到文件系统     │
                      │            │ - 保存到数据库       │
                      └────────────┤                      │
                                   └──────────────────────┘
                                            │
                                            ▼
                                   ┌──────────────────┐
                                   │ END: 完成         │
                                   └──────────────────┘
```

### 5.5 错误处理和重试机制

```python
# backend/services/iterative_prediction_service.py

from tenacity import retry, stop_after_attempt, wait_exponential
import logging

logger = logging.getLogger(__name__)

class IterativePredictionService:
    """迭代预测服务"""
    
    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        reraise=True
    )
    def _predict_single_sample_with_retry(
        self,
        state: IterationState,
        sample_idx: int,
        iteration: int
    ) -> Dict[str, Any]:
        """带重试的单样本预测"""
        
        try:
            return self._predict_single_sample(state, sample_idx, iteration)
        except Exception as e:
            logger.error(
                f"[Task {state['task_id']}] 样本 {sample_idx} 预测失败 (重试中): {str(e)}"
            )
            raise
```

### 5.6 与 llm_config_loader 的集成

```python
# backend/services/llm_config_loader.py 的使用示例

from backend.services.llm_config_loader import get_llm

# 在 _predict_single_sample 中调用
llm = get_llm(
    provider=state["llm_provider"],  # "gemini" 或 "openai"
    model_name=state["llm_model"],   # "gemini-2.0-flash" 或 "gpt-4"
    temperature=state["temperature"]  # 0.7
)

# 调用 LLM
response = llm.invoke(prompt)

# 所有 LLM 调用必须通过 get_llm() 函数，不能直接调用 litellm
```

