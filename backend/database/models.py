"""
数据库模型定义
使用 SQLAlchemy ORM
"""

from sqlalchemy import Column, String, Float, Integer, Text, DateTime, JSON, create_engine, TypeDecorator
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
            logger.warning(f"Failed to parse JSON, treating as string: {value[:50]}")
            # 将字符串转换为数组格式
            return [value]

# 数据库路径
DB_DIR = Path(__file__).parent.parent.parent / "storage" / "database"
DB_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = DB_DIR / "app.db"
DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{DB_PATH}")

# 创建引擎
engine = create_engine(DATABASE_URL, echo=False, connect_args={"check_same_thread": False})
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

    # 配置信息（使用 FlexibleJSON 处理旧数据）
    composition_column = Column(FlexibleJSON, nullable=True)  # 存储为 JSON 数组（支持多个元素列）
    processing_column = Column(String(100), nullable=True)
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


def init_db():
    """初始化数据库，创建所有表"""
    Base.metadata.create_all(bind=engine)


def get_db():
    """获取数据库会话"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

