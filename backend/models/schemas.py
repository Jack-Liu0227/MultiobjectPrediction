"""
数据模型定义 - Pydantic schemas
"""

from pydantic import BaseModel, Field, validator
from typing import List, Dict, Optional, Any, Union
from enum import Enum


class TaskStatus(str, Enum):
    """任务状态"""
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"  # 已取消


class UploadResponse(BaseModel):
    """文件上传响应"""
    file_id: str
    filename: str
    columns: List[str]
    row_count: int
    preview: List[Dict]


class PredictionConfig(BaseModel):
    """预测配置"""
    composition_column: Optional[Union[str, List[str]]] = Field(default=None, description="元素组成列名（单列或多列列表，可选）")
    processing_column: Optional[List[str]] = Field(default=None, description="工艺描述列名列表（可选，支持多选）")
    target_columns: List[str] = Field(..., min_items=1, max_items=5, description="目标性质列名列表（支持单目标）")
    feature_columns: Optional[List[str]] = Field(default=None, description="特征列名列表（可选，用于RAG检索时的特征匹配）")
    train_ratio: float = Field(default=0.8, ge=0.5, le=0.9, description="训练集比例")
    random_seed: int = Field(default=42, ge=1, le=9999, description="随机种子")
    max_retrieved_samples: int = Field(default=20, ge=0, description="RAG检索样本数（0表示零样本模式，无上限限制）")

    # 迭代预测配置
    enable_iteration: bool = Field(default=False, description="是否启用迭代预测")
    max_iterations: int = Field(default=1, ge=1, le=10, description="最大迭代次数（1-10）")
    convergence_threshold: float = Field(default=0.01, ge=0.001, le=0.1, description="收敛阈值（0.001-0.1）")
    early_stop: bool = Field(default=True, description="是否启用提前停止")
    max_workers: int = Field(default=5, ge=1, le=20, description="并行工作线程数（1-20）")
    continue_from_task_id: Optional[str] = Field(default=None, description="继续自哪个任务ID（用于失败重试）")
    similarity_threshold: float = Field(default=0.3, ge=0.0, le=1.0, description="相似度阈值")
    model_provider: str = Field(default="openai", description="LLM提供商（固定使用 openai 兼容接口）")
    model_name: str = Field(default="openai/deepseek-chat", description="LLM模型名称（固定使用 DeepSeek）")
    temperature: float = Field(default=0.0, ge=0.0, le=2.0, description="LLM温度参数（默认0表示确定性输出）")
    sample_size: int = Field(default=10, ge=1, description="从测试集随机抽取的样本数量（无上限限制）")
    workers: int = Field(default=5, ge=1, description="并行预测的工作线程数（无上限限制）")
    prompt_template: Optional[Dict[str, Any]] = Field(default=None, description="自定义提示词模板（可选）")
    force_restart: bool = Field(default=False, description="强制重新开始预测，忽略之前的结果")



class PredictionRequest(BaseModel):
    """预测请求"""
    file_id: Optional[str] = None  # 直接上传文件时使用
    dataset_id: Optional[str] = None  # 引用已有数据集时使用
    filename: Optional[str] = None  # 文件名（用于显示）
    config: PredictionConfig
    task_note: Optional[str] = Field(default=None, description="任务备注（可选）")

    @validator('dataset_id', always=True)
    def check_file_or_dataset(cls, v, values):
        """验证必须提供 file_id 或 dataset_id 之一"""
        if not v and not values.get('file_id'):
            raise ValueError('必须提供 file_id 或 dataset_id')
        return v


class PredictionResponse(BaseModel):
    """预测响应"""
    task_id: str
    status: TaskStatus
    message: str


class TaskStatusResponse(BaseModel):
    """任务状态响应"""
    task_id: str
    status: TaskStatus
    progress: float = Field(ge=0.0, le=1.0)
    message: str
    result_id: Optional[str] = None
    error: Optional[str] = None





class PredictionMetrics(BaseModel):
    """预测指标"""
    r2: Optional[float] = None  # 当样本数量 < 2 时，R² 无法计算
    rmse: Optional[float] = None
    mae: Optional[float] = None
    mape: Optional[float] = None


class ResultsResponse(BaseModel):
    """结果响应"""
    result_id: str
    task_id: Optional[str] = None  # 关联的任务 ID（用于溯源）
    predictions: List[Dict]
    metrics: Dict[str, PredictionMetrics]
    execution_time: float
    total_count: Optional[int] = None  # 总记录数（分页时使用）
    page: Optional[int] = None  # 当前页码
    page_size: Optional[int] = None  # 每页数量


class TaskInfo(BaseModel):
    """任务信息"""
    task_id: str
    status: str  # pending, running, completed, failed
    file_id: Optional[str] = None  # 关联的数据集ID或文件ID
    filename: str
    total_rows: Optional[int] = None  # 测试集样本数（任务完成后更新）
    valid_rows: Optional[int] = None  # 测试集有效样本数（任务完成后更新）
    original_total_rows: Optional[int] = None  # 已废弃：不再使用
    original_valid_rows: Optional[int] = None  # 已废弃：不再使用
    composition_column: Optional[Union[str, List[str]]] = None  # 支持单列或多列
    processing_column: Optional[List[str]] = None  # 支持多选
    target_columns: List[str]
    created_at: str
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    error: Optional[str] = None
    result_id: Optional[str] = None
    progress: Optional[float] = None  # 0.0 - 1.0

    # 配置信息
    model_provider: Optional[str] = None
    model_name: Optional[str] = None
    train_ratio: Optional[float] = None
    max_retrieved_samples: Optional[int] = None
    similarity_threshold: Optional[float] = None
    random_seed: Optional[int] = None
    temperature: Optional[float] = None
    sample_size: Optional[int] = None
    workers: Optional[int] = None

    # 任务备注
    note: Optional[str] = None

    # 预测过程详情
    process_details: Optional[List[Dict[str, Any]]] = None

    # 迭代预测信息
    enable_iteration: Optional[bool] = None
    max_iterations: Optional[int] = None
    current_iteration: Optional[int] = None
    convergence_threshold: Optional[float] = None
    early_stop: Optional[bool] = None
    max_workers: Optional[int] = None
    iteration_history: Optional[Dict[str, Any]] = None
    failed_samples: Optional[Dict[str, Any]] = None
    continue_from_task_id: Optional[str] = None


class TaskListResponse(BaseModel):
    """任务列表响应"""
    tasks: List[TaskInfo]
    total: int
    page: int
    page_size: int


class TaskDetailResponse(BaseModel):
    """任务详情响应"""
    task: TaskInfo
    config: Optional[Dict[str, Any]] = None
    logs: Optional[List[str]] = None


class RAGPreviewRequest(BaseModel):
    """RAG 预览请求"""
    file_id: Optional[str] = None  # 直接上传文件时使用
    dataset_id: Optional[str] = None  # 引用已有数据集时使用
    composition_column: Union[str, List[str]] = Field(..., description="元素组成列名（单列或多列列表）")
    processing_column: Optional[List[str]] = Field(default=None, description="工艺描述列名列表（可选，支持多选）")
    target_columns: List[str] = Field(..., min_items=1, description="目标性质列名列表")
    feature_columns: Optional[List[str]] = Field(default=None, description="特征列名列表（可选）")
    train_ratio: float = Field(default=0.8, ge=0.5, le=0.9, description="训练集比例")
    random_seed: int = Field(default=42, description="随机种子")
    max_retrieved_samples: int = Field(default=10, ge=1, description="RAG检索样本数（无上限限制）")
    similarity_threshold: float = Field(default=0.3, ge=0.0, le=1.0, description="相似度阈值")
    test_sample_index: int = Field(default=0, ge=0, description="预览的测试样本索引（从0开始）")

    @validator('dataset_id', always=True)
    def check_file_or_dataset(cls, v, values):
        """验证必须提供 file_id 或 dataset_id 之一"""
        if not v and not values.get('file_id'):
            raise ValueError('必须提供 file_id 或 dataset_id')
        return v


class RAGPreviewResponse(BaseModel):
    """RAG 预览响应"""
    train_count: int = Field(..., description="训练集样本数")
    test_count: int = Field(..., description="测试集样本数")
    test_sample_index: int = Field(..., description="当前预览的测试样本索引")
    test_sample: Dict[str, Any] = Field(..., description="测试样本数据")
    retrieved_samples: List[Dict[str, Any]] = Field(..., description="检索到的相似训练样本")

