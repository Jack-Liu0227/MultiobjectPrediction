# 迭代预测功能开发文档 - 第3部分：数据模型设计

## 3. 数据模型设计

### 3.1 数据库表结构扩展

#### 3.1.1 Task 表扩展

在现有 `Task` 表中新增以下字段：

```python
# backend/database/models.py

from sqlalchemy import Column, Integer, Boolean, Float, JSON, String
from datetime import datetime

class Task(Base):
    __tablename__ = "tasks"
    
    # 现有字段（保持不变）
    id = Column(Integer, primary_key=True)
    task_name = Column(String(255), nullable=False)
    task_description = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    status = Column(String(50), default="pending")  # pending, running, completed, failed
    
    # 新增迭代预测字段
    enable_iteration = Column(Boolean, default=False, nullable=False)
    # 说明：是否启用迭代预测功能
    # 默认值：False（保持向后兼容）
    # 影响：当为 True 时，使用 IterativePredictionService；当为 False 时，使用现有的单次预测流程
    
    max_iterations = Column(Integer, default=1, nullable=False)
    # 说明：最大迭代次数
    # 范围：1-10
    # 默认值：1（相当于单次预测）
    # 约束：CHECK (max_iterations >= 1 AND max_iterations <= 10)
    
    current_iteration = Column(Integer, default=0, nullable=False)
    # 说明：当前已完成的迭代轮数
    # 初始值：0
    # 更新时机：每完成一轮迭代后 +1
    # 用途：前端显示进度 (current_iteration / max_iterations)
    
    convergence_threshold = Column(Float, default=0.01, nullable=False)
    # 说明：收敛阈值（相对变化率）
    # 范围：0.001-0.1
    # 默认值：0.01（1%）
    # 含义：当预测值的相对变化率 < 此值时，认为该样本已收敛
    
    early_stop = Column(Boolean, default=True, nullable=False)
    # 说明：是否启用提前停止
    # 默认值：True
    # 含义：当所有样本都收敛时，提前终止迭代（不继续到 max_iterations）
    
    max_workers = Column(Integer, default=5, nullable=False)
    # 说明：同一轮迭代内的最大并发数
    # 范围：1-20
    # 默认值：5
    # 约束：CHECK (max_workers >= 1 AND max_workers <= 20)
    
    iteration_history = Column(JSON, nullable=True)
    # 说明：完整的迭代历史（JSON 格式）
    # 结构：见 3.2 节
    # 更新时机：每轮迭代完成后更新
    # 用途：快速查询迭代历史，无需读取文件系统
    
    failed_samples = Column(JSON, nullable=True)
    # 说明：失败样本列表（JSON 格式）
    # 结构：[{"sample_index": 0, "error": "API timeout", "iteration": 2}, ...]
    # 用途：支持失败样本的增量重预测
    
    continue_from_task_id = Column(Integer, ForeignKey("tasks.id"), nullable=True)
    # 说明：如果是增量预测，指向原始任务的 ID
    # 用途：支持失败样本的重试（复用现有机制）
```

#### 3.1.2 数据库迁移脚本

```python
# backend/database/migrations/add_iteration_fields.py

from alembic import op
import sqlalchemy as sa

def upgrade():
    """添加迭代预测相关字段"""
    op.add_column('tasks', sa.Column('enable_iteration', sa.Boolean(), nullable=False, server_default='false'))
    op.add_column('tasks', sa.Column('max_iterations', sa.Integer(), nullable=False, server_default='1'))
    op.add_column('tasks', sa.Column('current_iteration', sa.Integer(), nullable=False, server_default='0'))
    op.add_column('tasks', sa.Column('convergence_threshold', sa.Float(), nullable=False, server_default='0.01'))
    op.add_column('tasks', sa.Column('early_stop', sa.Boolean(), nullable=False, server_default='true'))
    op.add_column('tasks', sa.Column('max_workers', sa.Integer(), nullable=False, server_default='5'))
    op.add_column('tasks', sa.Column('iteration_history', sa.JSON(), nullable=True))
    op.add_column('tasks', sa.Column('failed_samples', sa.JSON(), nullable=True))
    op.add_column('tasks', sa.Column('continue_from_task_id', sa.Integer(), nullable=True))
    
    # 添加外键约束
    op.create_foreign_key('fk_continue_from_task_id', 'tasks', 'tasks', ['continue_from_task_id'], ['id'])
    
    # 添加检查约束
    op.create_check_constraint('ck_max_iterations', 'tasks', 'max_iterations >= 1 AND max_iterations <= 10')
    op.create_check_constraint('ck_max_workers', 'tasks', 'max_workers >= 1 AND max_workers <= 20')

def downgrade():
    """回滚迭代预测相关字段"""
    op.drop_constraint('fk_continue_from_task_id', 'tasks', type_='foreignkey')
    op.drop_constraint('ck_max_iterations', 'tasks', type_='check')
    op.drop_constraint('ck_max_workers', 'tasks', type_='check')
    
    op.drop_column('tasks', 'enable_iteration')
    op.drop_column('tasks', 'max_iterations')
    op.drop_column('tasks', 'current_iteration')
    op.drop_column('tasks', 'convergence_threshold')
    op.drop_column('tasks', 'early_stop')
    op.drop_column('tasks', 'max_workers')
    op.drop_column('tasks', 'iteration_history')
    op.drop_column('tasks', 'failed_samples')
    op.drop_column('tasks', 'continue_from_task_id')
```

### 3.2 iteration_history.json 格式

#### 3.2.1 完整结构定义

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
      "composition": {
        "C": 0.5,
        "Si": 1.2,
        "Mn": 0.8
      },
      "targets": {
        "UTS(MPa)": {
          "iterations": [850, 855, 857],
          "converged_at_iteration": 3,
          "convergence_status": "converged",
          "relative_changes": [null, 0.0059, 0.0023]
        },
        "El(%)": {
          "iterations": [15.0, 14.8, 14.7],
          "converged_at_iteration": 2,
          "convergence_status": "converged",
          "relative_changes": [null, 0.0133, 0.0068]
        }
      },
      "final_predictions": {
        "UTS(MPa)": 857,
        "El(%)": 14.7
      },
      "failed_iterations": []
    },
    "sample_1": {
      "sample_index": 1,
      "sample_id": "Sample_002",
      "composition": {
        "C": 0.6,
        "Si": 1.3,
        "Mn": 0.9
      },
      "targets": {
        "UTS(MPa)": {
          "iterations": [860, 865, 868],
          "converged_at_iteration": null,
          "convergence_status": "not_converged",
          "relative_changes": [null, 0.0058, 0.0035]
        },
        "El(%)": {
          "iterations": [14.5, 14.3, 14.2],
          "converged_at_iteration": 2,
          "convergence_status": "converged",
          "relative_changes": [null, 0.0138, 0.0070]
        }
      },
      "final_predictions": {
        "UTS(MPa)": 868,
        "El(%)": 14.2
      },
      "failed_iterations": []
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
    },
    {
      "iteration": 2,
      "timestamp": "2025-12-09T10:32:30Z",
      "duration_seconds": 110,
      "processed_samples": 2,
      "failed_samples": 0,
      "newly_converged": 2
    },
    {
      "iteration": 3,
      "timestamp": "2025-12-09T10:34:30Z",
      "duration_seconds": 100,
      "processed_samples": 2,
      "failed_samples": 0,
      "newly_converged": 0
    }
  ]
}
```

#### 3.2.2 字段说明

**global_info 部分**：
- `task_id`: 任务 ID，用于关联数据库记录
- `total_iterations`: 实际完成的迭代轮数
- `max_iterations`: 配置的最大迭代次数
- `convergence_threshold`: 收敛阈值
- `early_stopped`: 是否提前停止
- `early_stop_reason`: 提前停止的原因（"all_samples_converged" 或 "max_iterations_reached"）
- `total_samples`: 总样本数
- `converged_samples`: 已收敛的样本数
- `failed_samples`: 失败的样本数
- `created_at`, `completed_at`: 任务开始和完成时间
- `total_duration_seconds`: 总耗时（秒）

**samples 部分**：
- 每个样本独立维护自己的迭代历史
- `sample_index`: 样本在输入文件中的索引
- `sample_id`: 样本的唯一标识符
- `composition`: 样本的组分信息
- `targets`: 目标属性的迭代历史
  - `iterations`: 每轮迭代的预测值列表
  - `converged_at_iteration`: 首次收敛的迭代轮数（null 表示未收敛）
  - `convergence_status`: "converged" 或 "not_converged"
  - `relative_changes`: 相对变化率列表（第一个为 null）
- `final_predictions`: 最终预测值
- `failed_iterations`: 失败的迭代轮数列表

**iteration_summaries 部分**：
- 每轮迭代的统计信息
- `iteration`: 迭代轮数
- `timestamp`: 该轮完成时间
- `duration_seconds`: 该轮耗时
- `processed_samples`: 该轮处理的样本数
- `failed_samples`: 该轮失败的样本数
- `newly_converged`: 该轮新收敛的样本数

### 3.3 PredictionConfig 扩展

```python
# backend/models/schemas.py

from pydantic import BaseModel, Field
from typing import Optional

class PredictionConfig(BaseModel):
    """预测配置"""
    
    # 现有字段（保持不变）
    test_file_path: str
    reference_file_path: str
    target_properties: List[str]
    llm_provider: str  # "gemini" 或 "openai"
    llm_model: str
    temperature: float = Field(default=0.7, ge=0.0, le=2.0)
    
    # 新增迭代预测字段
    enable_iteration: bool = Field(
        default=False,
        description="是否启用迭代预测功能"
    )
    
    max_iterations: int = Field(
        default=1,
        ge=1,
        le=10,
        description="最大迭代次数（1-10）"
    )
    
    convergence_threshold: float = Field(
        default=0.01,
        ge=0.001,
        le=0.1,
        description="收敛阈值（相对变化率，0.001-0.1）"
    )
    
    early_stop: bool = Field(
        default=True,
        description="是否启用提前停止（所有样本收敛时）"
    )
    
    max_workers: int = Field(
        default=5,
        ge=1,
        le=20,
        description="同一轮迭代内的最大并发数（1-20）"
    )
    
    class Config:
        json_schema_extra = {
            "example": {
                "test_file_path": "data/test_samples.csv",
                "reference_file_path": "data/reference_samples.csv",
                "target_properties": ["UTS(MPa)", "El(%)"],
                "llm_provider": "gemini",
                "llm_model": "gemini-2.0-flash",
                "temperature": 0.7,
                "enable_iteration": True,
                "max_iterations": 5,
                "convergence_threshold": 0.01,
                "early_stop": True,
                "max_workers": 5
            }
        }
```

### 3.4 TypeScript 类型定义

```typescript
// frontend/lib/types.ts

export interface IterationHistory {
  global_info: {
    task_id: number;
    total_iterations: number;
    max_iterations: number;
    convergence_threshold: number;
    early_stopped: boolean;
    early_stop_reason: "all_samples_converged" | "max_iterations_reached";
    total_samples: number;
    converged_samples: number;
    failed_samples: number;
    created_at: string;
    completed_at: string;
    total_duration_seconds: number;
  };
  samples: {
    [key: string]: {
      sample_index: number;
      sample_id: string;
      composition: Record<string, number>;
      targets: {
        [targetName: string]: {
          iterations: number[];
          converged_at_iteration: number | null;
          convergence_status: "converged" | "not_converged";
          relative_changes: (number | null)[];
        };
      };
      final_predictions: Record<string, number>;
      failed_iterations: number[];
    };
  };
  iteration_summaries: {
    iteration: number;
    timestamp: string;
    duration_seconds: number;
    processed_samples: number;
    failed_samples: number;
    newly_converged: number;
  }[];
}

export interface IterativePredictionTask extends Task {
  enable_iteration: boolean;
  max_iterations: number;
  current_iteration: number;
  convergence_threshold: number;
  early_stop: boolean;
  max_workers: number;
  iteration_history?: IterationHistory;
  failed_samples?: Array<{
    sample_index: number;
    error: string;
    iteration: number;
  }>;
}
```

