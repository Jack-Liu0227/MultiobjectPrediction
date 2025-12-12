# 迭代预测功能开发文档 - 第6部分：API接口设计

## 6. API接口设计

### 6.1 API 端点列表

| 方法 | 端点 | 功能 | 状态 |
|------|------|------|------|
| POST | `/api/iterative-prediction/start` | 启动迭代预测任务 | 新增 |
| GET | `/api/tasks/{task_id}` | 获取任务状态（扩展） | 修改 |
| GET | `/api/results/{result_id}/iterations` | 获取迭代历史 | 新增 |
| POST | `/api/iterative-prediction/retry-failed` | 重试失败样本 | 新增 |
| GET | `/api/iterative-prediction/convergence-stats` | 获取收敛统计 | 新增 |

### 6.2 详细接口文档

#### 6.2.1 启动迭代预测任务

**端点**：`POST /api/iterative-prediction/start`

**功能**：启动一个新的迭代预测任务

**请求体**：
```json
{
  "task_name": "钛合金迭代预测",
  "task_description": "对新型钛合金进行5轮迭代预测",
  "test_file_path": "data/test_samples.csv",
  "reference_file_path": "data/reference_samples.csv",
  "target_properties": ["UTS(MPa)", "El(%)"],
  "llm_provider": "gemini",
  "llm_model": "gemini-2.0-flash",
  "temperature": 0.7,
  "enable_iteration": true,
  "max_iterations": 5,
  "convergence_threshold": 0.01,
  "early_stop": true,
  "max_workers": 5
}
```

**请求体字段说明**：
- `task_name` (string, 必需): 任务名称
- `task_description` (string, 可选): 任务描述
- `test_file_path` (string, 必需): 测试样本文件路径
- `reference_file_path` (string, 必需): 参考样本文件路径
- `target_properties` (array, 必需): 目标属性列表
- `llm_provider` (string, 必需): LLM 提供商 ("gemini" 或 "openai")
- `llm_model` (string, 必需): LLM 模型名称
- `temperature` (number, 可选): LLM 温度参数 (0.0-2.0, 默认 0.7)
- `enable_iteration` (boolean, 必需): 是否启用迭代预测
- `max_iterations` (integer, 必需): 最大迭代次数 (1-10)
- `convergence_threshold` (number, 可选): 收敛阈值 (0.001-0.1, 默认 0.01)
- `early_stop` (boolean, 可选): 是否启用提前停止 (默认 true)
- `max_workers` (integer, 可选): 最大并发数 (1-20, 默认 5)

**响应体**（成功，HTTP 200）：
```json
{
  "task_id": 123,
  "task_name": "钛合金迭代预测",
  "status": "running",
  "created_at": "2025-12-09T10:30:00Z",
  "message": "迭代预测任务已启动"
}
```

**响应体字段说明**：
- `task_id` (integer): 任务 ID
- `task_name` (string): 任务名称
- `status` (string): 任务状态 ("pending", "running", "completed", "failed")
- `created_at` (string): 任务创建时间 (ISO 8601 格式)
- `message` (string): 响应消息

**错误响应**（HTTP 400）：
```json
{
  "error": "Invalid request",
  "details": "max_iterations must be between 1 and 10"
}
```

**错误响应**（HTTP 500）：
```json
{
  "error": "Internal server error",
  "details": "Failed to create task"
}
```

**实现代码**：
```python
# backend/api/iterative_prediction.py

from fastapi import APIRouter, HTTPException, BackgroundTasks
from backend.models.schemas import PredictionConfig
from backend.services.iterative_prediction_service import IterativePredictionService
from backend.database.models import Task
from backend.database.session import SessionLocal
import logging

router = APIRouter(prefix="/api/iterative-prediction", tags=["iterative-prediction"])
logger = logging.getLogger(__name__)

@router.post("/start")
async def start_iterative_prediction(
    config: PredictionConfig,
    background_tasks: BackgroundTasks
):
    """启动迭代预测任务"""
    
    # 验证配置
    if not config.enable_iteration:
        raise HTTPException(
            status_code=400,
            detail="enable_iteration must be True for iterative prediction"
        )
    
    if config.max_iterations < 1 or config.max_iterations > 10:
        raise HTTPException(
            status_code=400,
            detail="max_iterations must be between 1 and 10"
        )
    
    if config.convergence_threshold < 0.001 or config.convergence_threshold > 0.1:
        raise HTTPException(
            status_code=400,
            detail="convergence_threshold must be between 0.001 and 0.1"
        )
    
    try:
        # 创建任务记录
        db = SessionLocal()
        task = Task(
            task_name=config.task_name,
            task_description=config.task_description,
            status="running",
            enable_iteration=True,
            max_iterations=config.max_iterations,
            convergence_threshold=config.convergence_threshold,
            early_stop=config.early_stop,
            max_workers=config.max_workers
        )
        db.add(task)
        db.commit()
        db.refresh(task)
        db.close()
        
        # 后台启动迭代预测
        background_tasks.add_task(
            _run_iterative_prediction,
            task_id=task.id,
            config=config
        )
        
        return {
            "task_id": task.id,
            "task_name": task.task_name,
            "status": task.status,
            "created_at": task.created_at.isoformat(),
            "message": "迭代预测任务已启动"
        }
    
    except Exception as e:
        logger.error(f"Failed to start iterative prediction: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail="Failed to create task"
        )

async def _run_iterative_prediction(task_id: int, config: PredictionConfig):
    """后台运行迭代预测"""
    
    try:
        # 加载数据
        test_samples = load_csv(config.test_file_path)
        reference_samples = load_csv(config.reference_file_path)
        
        # 初始化服务
        service = IterativePredictionService()
        
        # 准备状态
        state = {
            "task_id": task_id,
            "test_samples": test_samples,
            "reference_samples": reference_samples,
            "target_properties": config.target_properties,
            "max_iterations": config.max_iterations,
            "convergence_threshold": config.convergence_threshold,
            "early_stop": config.early_stop,
            "max_workers": config.max_workers,
            "llm_provider": config.llm_provider,
            "llm_model": config.llm_model,
            "temperature": config.temperature,
            # ... 其他字段
        }
        
        # 运行工作流
        result_state = service.run(state)
        
        logger.info(f"Iterative prediction task {task_id} completed")
    
    except Exception as e:
        logger.error(f"Iterative prediction task {task_id} failed: {str(e)}")
        
        # 更新任务状态为失败
        db = SessionLocal()
        task = db.query(Task).filter(Task.id == task_id).first()
        if task:
            task.status = "failed"
            db.commit()
        db.close()
```

#### 6.2.2 获取任务状态（扩展）

**端点**：`GET /api/tasks/{task_id}`

**功能**：获取任务的当前状态（包括迭代进度）

**路径参数**：
- `task_id` (integer): 任务 ID

**响应体**（成功，HTTP 200）：
```json
{
  "task_id": 123,
  "task_name": "钛合金迭代预测",
  "status": "running",
  "enable_iteration": true,
  "max_iterations": 5,
  "current_iteration": 3,
  "progress": 0.6,
  "converged_samples": 45,
  "total_samples": 100,
  "failed_samples": 2,
  "created_at": "2025-12-09T10:30:00Z",
  "updated_at": "2025-12-09T10:45:00Z"
}
```

**响应体字段说明**：
- `task_id` (integer): 任务 ID
- `task_name` (string): 任务名称
- `status` (string): 任务状态
- `enable_iteration` (boolean): 是否启用迭代预测
- `max_iterations` (integer): 最大迭代次数
- `current_iteration` (integer): 当前已完成的迭代轮数
- `progress` (number): 进度百分比 (0.0-1.0)
- `converged_samples` (integer): 已收敛的样本数
- `total_samples` (integer): 总样本数
- `failed_samples` (integer): 失败的样本数
- `created_at` (string): 任务创建时间
- `updated_at` (string): 任务最后更新时间

**实现代码**：
```python
# backend/api/tasks.py (修改现有端点)

@router.get("/{task_id}")
async def get_task(task_id: int):
    """获取任务状态"""
    
    db = SessionLocal()
    task = db.query(Task).filter(Task.id == task_id).first()
    db.close()
    
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    # 计算进度
    if task.enable_iteration:
        progress = task.current_iteration / task.max_iterations
        
        # 从 iteration_history 中获取收敛样本数
        converged_samples = 0
        total_samples = len(task.test_samples) if task.test_samples else 0
        failed_samples = len(task.failed_samples) if task.failed_samples else 0
        
        if task.iteration_history:
            converged_samples = task.iteration_history.get("global_info", {}).get("converged_samples", 0)
    else:
        progress = 1.0 if task.status == "completed" else 0.0
        converged_samples = 0
        total_samples = 0
        failed_samples = 0
    
    return {
        "task_id": task.id,
        "task_name": task.task_name,
        "status": task.status,
        "enable_iteration": task.enable_iteration,
        "max_iterations": task.max_iterations,
        "current_iteration": task.current_iteration,
        "progress": progress,
        "converged_samples": converged_samples,
        "total_samples": total_samples,
        "failed_samples": failed_samples,
        "created_at": task.created_at.isoformat(),
        "updated_at": task.updated_at.isoformat()
    }
```

#### 6.2.3 获取迭代历史

**端点**：`GET /api/results/{result_id}/iterations`

**功能**：获取完整的迭代历史数据

**路径参数**：
- `result_id` (integer): 结果 ID（与 task_id 相同）

**查询参数**：
- `sample_index` (integer, 可选): 仅获取指定样本的迭代历史

**响应体**（成功，HTTP 200）：
```json
{
  "global_info": {
    "task_id": 123,
    "total_iterations": 3,
    "max_iterations": 5,
    "convergence_threshold": 0.01,
    "early_stopped": true,
    "early_stop_reason": "all_samples_converged",
    "total_samples": 2,
    "converged_samples": 2,
    "failed_samples": 0,
    "created_at": "2025-12-09T10:30:00Z",
    "completed_at": "2025-12-09T10:45:00Z",
    "total_duration_seconds": 900
  },
  "samples": {
    "sample_0": {
      "sample_index": 0,
      "sample_id": "Sample_001",
      "targets": {
        "UTS(MPa)": {
          "iterations": [850, 855, 857],
          "converged_at_iteration": 3,
          "convergence_status": "converged",
          "relative_changes": [null, 0.0059, 0.0023]
        }
      }
    }
  },
  "iteration_summaries": [
    {
      "iteration": 1,
      "timestamp": "2025-12-09T10:30:30Z",
      "duration_seconds": 120,
      "processed_samples": 2,
      "failed_samples": 0,
      "newly_converged": 0
    }
  ]
}
```

**实现代码**：
```python
# backend/api/results.py (新增)

@router.get("/{result_id}/iterations")
async def get_iteration_history(
    result_id: int,
    sample_index: Optional[int] = None
):
    """获取迭代历史"""
    
    db = SessionLocal()
    task = db.query(Task).filter(Task.id == result_id).first()
    db.close()
    
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    if not task.iteration_history:
        raise HTTPException(status_code=404, detail="No iteration history found")
    
    history = task.iteration_history
    
    # 如果指定了 sample_index，仅返回该样本的数据
    if sample_index is not None:
        sample_key = f"sample_{sample_index}"
        if sample_key not in history.get("samples", {}):
            raise HTTPException(status_code=404, detail="Sample not found")
        
        return {
            "global_info": history["global_info"],
            "samples": {sample_key: history["samples"][sample_key]},
            "iteration_summaries": history["iteration_summaries"]
        }
    
    return history
```

#### 6.2.4 重试失败样本

**端点**：`POST /api/iterative-prediction/retry-failed`

**功能**：重新预测失败的样本

**请求体**：
```json
{
  "task_id": 123,
  "sample_indices": [0, 5, 10]
}
```

**响应体**（成功，HTTP 200）：
```json
{
  "new_task_id": 124,
  "original_task_id": 123,
  "retrying_samples": [0, 5, 10],
  "message": "失败样本重试任务已启动"
}
```

**实现代码**：
```python
# backend/api/iterative_prediction.py

@router.post("/retry-failed")
async def retry_failed_samples(
    task_id: int,
    sample_indices: List[int],
    background_tasks: BackgroundTasks
):
    """重试失败样本"""
    
    db = SessionLocal()
    original_task = db.query(Task).filter(Task.id == task_id).first()
    db.close()
    
    if not original_task:
        raise HTTPException(status_code=404, detail="Original task not found")
    
    # 创建新任务（增量预测）
    db = SessionLocal()
    new_task = Task(
        task_name=f"{original_task.task_name} (重试失败样本)",
        task_description=f"重试原任务 {task_id} 的失败样本",
        status="running",
        enable_iteration=original_task.enable_iteration,
        max_iterations=original_task.max_iterations,
        convergence_threshold=original_task.convergence_threshold,
        early_stop=original_task.early_stop,
        max_workers=original_task.max_workers,
        continue_from_task_id=task_id
    )
    db.add(new_task)
    db.commit()
    db.refresh(new_task)
    db.close()
    
    # 后台启动重试
    background_tasks.add_task(
        _retry_failed_samples,
        original_task_id=task_id,
        new_task_id=new_task.id,
        sample_indices=sample_indices
    )
    
    return {
        "new_task_id": new_task.id,
        "original_task_id": task_id,
        "retrying_samples": sample_indices,
        "message": "失败样本重试任务已启动"
    }
```

#### 6.2.5 获取收敛统计

**端点**：`GET /api/iterative-prediction/convergence-stats`

**功能**：获取收敛统计信息

**查询参数**：
- `task_id` (integer, 必需): 任务 ID

**响应体**（成功，HTTP 200）：
```json
{
  "task_id": 123,
  "total_samples": 100,
  "converged_samples": 95,
  "convergence_rate": 0.95,
  "average_convergence_iteration": 2.8,
  "fastest_convergence_iteration": 1,
  "slowest_convergence_iteration": 5,
  "samples_by_convergence_speed": {
    "fast": 45,
    "medium": 35,
    "slow": 15
  }
}
```

**实现代码**：
```python
# backend/api/iterative_prediction.py

@router.get("/convergence-stats")
async def get_convergence_stats(task_id: int):
    """获取收敛统计"""
    
    db = SessionLocal()
    task = db.query(Task).filter(Task.id == task_id).first()
    db.close()
    
    if not task or not task.iteration_history:
        raise HTTPException(status_code=404, detail="Task or iteration history not found")
    
    history = task.iteration_history
    samples = history.get("samples", {})
    
    total_samples = len(samples)
    converged_samples = sum(
        1 for s in samples.values()
        if s.get("convergence_status") == "converged"
    )
    
    convergence_iterations = [
        s.get("targets", {}).get(list(s.get("targets", {}).keys())[0], {}).get("converged_at_iteration")
        for s in samples.values()
        if s.get("convergence_status") == "converged"
    ]
    convergence_iterations = [i for i in convergence_iterations if i is not None]
    
    return {
        "task_id": task_id,
        "total_samples": total_samples,
        "converged_samples": converged_samples,
        "convergence_rate": converged_samples / total_samples if total_samples > 0 else 0,
        "average_convergence_iteration": sum(convergence_iterations) / len(convergence_iterations) if convergence_iterations else 0,
        "fastest_convergence_iteration": min(convergence_iterations) if convergence_iterations else 0,
        "slowest_convergence_iteration": max(convergence_iterations) if convergence_iterations else 0,
        "samples_by_convergence_speed": {
            "fast": sum(1 for i in convergence_iterations if i <= 2),
            "medium": sum(1 for i in convergence_iterations if 2 < i <= 4),
            "slow": sum(1 for i in convergence_iterations if i > 4)
        }
    }
```

### 6.3 错误代码定义

| 错误代码 | HTTP 状态码 | 说明 |
|---------|-----------|------|
| INVALID_CONFIG | 400 | 配置参数无效 |
| TASK_NOT_FOUND | 404 | 任务不存在 |
| ITERATION_HISTORY_NOT_FOUND | 404 | 迭代历史不存在 |
| INTERNAL_ERROR | 500 | 内部服务器错误 |
| LLM_API_ERROR | 503 | LLM API 调用失败 |

### 6.4 数据验证规则

```python
# backend/models/schemas.py

from pydantic import BaseModel, Field, validator

class PredictionConfig(BaseModel):
    """预测配置"""
    
    max_iterations: int = Field(
        default=1,
        ge=1,
        le=10,
        description="最大迭代次数"
    )
    
    convergence_threshold: float = Field(
        default=0.01,
        ge=0.001,
        le=0.1,
        description="收敛阈值"
    )
    
    max_workers: int = Field(
        default=5,
        ge=1,
        le=20,
        description="最大并发数"
    )
    
    @validator('max_iterations')
    def validate_max_iterations(cls, v):
        if v < 1 or v > 10:
            raise ValueError('max_iterations must be between 1 and 10')
        return v
    
    @validator('convergence_threshold')
    def validate_convergence_threshold(cls, v):
        if v < 0.001 or v > 0.1:
            raise ValueError('convergence_threshold must be between 0.001 and 0.1')
        return v
    
    @validator('max_workers')
    def validate_max_workers(cls, v):
        if v < 1 or v > 20:
            raise ValueError('max_workers must be between 1 and 20')
        return v
```

