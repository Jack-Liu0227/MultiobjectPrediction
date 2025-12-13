"""
数据库模型定义
使用 SQLAlchemy ORM
"""

from sqlalchemy import Column, String, Float, Integer, Text, DateTime, JSON, Boolean, ForeignKey, CheckConstraint, create_engine, TypeDecorator, Index
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from datetime import datetime
from pathlib import Path
import os
import json
import logging

logger = logging.getLogger(__name__)

Base = declarative_base()


class FlexibleJSON(TypeDecorator):
    """
    灵活的 JSON 类型
    可以处理旧数据中的字符串格式和新数据中的 JSON 格式
    """
    impl = Text
    cache_ok = True

    def process_bind_param(self, value, dialect):
        """存储时：将 Python 对象转换为 JSON 字符串"""
        if value is None:
            return None
        if isinstance(value, str):
            # 如果已经是字符串，尝试解析验证
            try:
                json.loads(value)
                return value
            except:
                # 不是有效 JSON，转换为 JSON 数组
                return json.dumps([value])
        return json.dumps(value)

    def process_result_value(self, value, dialect):
        """读取时：将 JSON 字符串转换为 Python 对象"""
        if value is None:
            return None
        if not value.strip():
            return None

        try:
            # 尝试解析 JSON
            return json.loads(value)
        except json.JSONDecodeError:
            # 解析失败，可能是旧格式的字符串
            # 只在非常规列名时记录警告（避免日志噪音）
            if value not in ['Processing_Description', 'Composition', 'composition']:
                logger.warning(f"Converting non-JSON field to array format: {value[:50]}")
            # 将字符串转换为数组格式
            return [value]

# 数据库路径
DB_DIR = Path(__file__).parent.parent.parent / "storage" / "database"
DB_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = DB_DIR / "app.db"
DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{DB_PATH}")

# 创建引擎（添加 SQLite 优化配置）
# pool_pre_ping: 确保连接有效
# pool_size: 连接池大小
# max_overflow: 最大溢出连接数
# connect_args: SQLite 特定参数
#   - check_same_thread: 允许多线程访问
#   - timeout: 数据库锁定时的等待时间（秒）
engine = create_engine(
    DATABASE_URL, 
    echo=False, 
    pool_pre_ping=True,
    pool_size=10,
    max_overflow=20,
    connect_args={
        "check_same_thread": False,
        "timeout": 30  # 30秒超时，防止长时间锁定
    }
)

# 配置 WAL 模式以改善并发性能（仅对 SQLite 有效）
if "sqlite" in DATABASE_URL.lower():
    from sqlalchemy import event
    
    @event.listens_for(engine, "connect")
    def set_sqlite_pragma(dbapi_conn, connection_record):
        cursor = dbapi_conn.cursor()
        # 启用 WAL 模式：允许并发读写
        cursor.execute("PRAGMA journal_mode=WAL")
        # 设置忙碌超时
        cursor.execute("PRAGMA busy_timeout=30000")  # 30秒
        cursor.close()

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Task(Base):
    """任务表"""
    __tablename__ = "tasks"

    task_id = Column(String(36), primary_key=True, index=True)
    status = Column(String(20), nullable=False, index=True)  # pending, running, completed, failed
    progress = Column(Float, default=0.0)
    message = Column(Text, nullable=True)

    # 文件信息
    file_id = Column(String(36), nullable=False)
    filename = Column(String(255), nullable=False)

    # 数据统计信息
    total_rows = Column(Integer, nullable=True)  # 测试集样本数（任务完成后更新）
    valid_rows = Column(Integer, nullable=True)  # 测试集有效样本数（任务完成后更新）
    original_total_rows = Column(Integer, nullable=True)  # 已废弃：不再使用（应从数据集获取原始行数）
    original_valid_rows = Column(Integer, nullable=True)  # 已废弃：不再使用（应从数据集获取原始行数）

    # 配置信息（使用 FlexibleJSON 处理旧数据）
    composition_column = Column(FlexibleJSON, nullable=True)  # 存储为 JSON 数组（支持多个元素列）
    processing_column = Column(FlexibleJSON, nullable=True)  # 存储为 JSON 数组（支持多个工艺列）
    target_columns = Column(FlexibleJSON, nullable=True)  # 存储为 JSON 数组
    
    # LLM 配置
    model_provider = Column(String(50), nullable=True)
    model_name = Column(String(100), nullable=True)
    temperature = Column(Float, nullable=True)
    sample_size = Column(Integer, nullable=True)
    
    # RAG 配置
    train_ratio = Column(Float, nullable=True)
    max_retrieved_samples = Column(Integer, nullable=True)
    similarity_threshold = Column(Float, nullable=True)
    
    # 时间戳
    created_at = Column(DateTime, default=datetime.now, nullable=False, index=True)
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now, nullable=False)
    
    # 结果和错误
    result_id = Column(String(36), nullable=True)
    error = Column(Text, nullable=True)
    
    # 任务备注
    note = Column(Text, nullable=True)
    
    # 完整配置（JSON 格式存储）
    config_json = Column(JSON, nullable=True)

    # 预测过程详情（JSON 格式存储）
    process_details = Column(JSON, nullable=True)

    # 迭代预测相关字段
    enable_iteration = Column(Boolean, default=False, nullable=False)  # 是否启用迭代预测
    max_iterations = Column(Integer, default=1, nullable=False)  # 最大迭代次数（1-10）
    current_iteration = Column(Integer, default=0, nullable=False)  # 当前迭代轮数
    convergence_threshold = Column(Float, default=0.01, nullable=False)  # 收敛阈值（0.001-0.1）
    early_stop = Column(Boolean, default=True, nullable=False)  # 是否启用提前停止
    max_workers = Column(Integer, default=5, nullable=False)  # 并行工作线程数（1-20）
    iteration_history = Column(JSON, nullable=True)  # 迭代历史记录（JSON格式）
    failed_samples = Column(JSON, nullable=True)  # 失败样本记录（JSON格式）
    continue_from_task_id = Column(String(36), ForeignKey('tasks.task_id'), nullable=True)  # 继续自哪个任务

    # 复合索引：优化常见查询
    __table_args__ = (
        Index('idx_status_created_at', 'status', 'created_at'),  # 按状态和时间查询
        Index('idx_status_updated_at', 'status', 'updated_at'),  # 按状态和更新时间查询
        CheckConstraint('max_iterations >= 1 AND max_iterations <= 10', name='check_max_iterations'),
        CheckConstraint('convergence_threshold >= 0.001 AND convergence_threshold <= 0.1', name='check_convergence_threshold'),
        CheckConstraint('max_workers >= 1 AND max_workers <= 20', name='check_max_workers'),
    )


class Dataset(Base):
    """数据集表"""
    __tablename__ = "datasets"

    dataset_id = Column(String(36), primary_key=True, index=True)
    filename = Column(String(255), nullable=False)
    original_filename = Column(String(255), nullable=False)
    file_path = Column(String(500), nullable=False)

    # 数据集信息
    row_count = Column(Integer, nullable=False)
    column_count = Column(Integer, nullable=False)
    columns = Column(JSON, nullable=False)  # 列名列表

    # 元数据
    file_size = Column(Integer, nullable=False)  # 字节
    file_hash = Column(String(64), nullable=True)  # MD5 哈希

    # 时间戳
    uploaded_at = Column(DateTime, default=datetime.now, nullable=False, index=True)
    last_used_at = Column(DateTime, nullable=True)

    # 描述和标签
    description = Column(Text, nullable=True)
    tags = Column(JSON, nullable=True)  # 标签列表

    # 使用统计
    usage_count = Column(Integer, default=0)


class TaskComparison(Base):
    """任务对比记录表"""
    __tablename__ = "task_comparisons"

    id = Column(String(36), primary_key=True, index=True)
    task_ids = Column(JSON, nullable=False)  # 对比的任务ID列表
    target_columns = Column(JSON, nullable=False)  # 对比的目标列列表
    tolerance = Column(Float, default=0.0)  # 容差值
    comparison_results = Column(Text, nullable=False)  # 完整的对比结果（JSON字符串）
    note = Column(String(200), nullable=True)  # 用户备注
    created_at = Column(DateTime, default=datetime.now, nullable=False, index=True)


def init_db():
    """初始化数据库，创建所有表"""
    Base.metadata.create_all(bind=engine)


def get_db():
    """获取数据库会话（用于 FastAPI 依赖注入）"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# 上下文管理器：确保数据库会话正确关闭
from contextlib import contextmanager

@contextmanager
def get_db_session():
    """
    获取数据库会话的上下文管理器
    自动处理提交、回滚和关闭

    使用示例:
        with get_db_session() as db:
            task = db.query(Task).filter(Task.task_id == task_id).first()
            # ... 数据库操作 ...
    """
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()

