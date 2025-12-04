"""
后端配置文件
"""

import os
from pathlib import Path

# 项目根目录
BASE_DIR = Path(__file__).parent.parent

# 存储配置
STORAGE_DIR = BASE_DIR / "storage"
UPLOAD_DIR = STORAGE_DIR / "uploads"
RESULTS_DIR = STORAGE_DIR / "results"
CACHE_DIR = STORAGE_DIR / "cache"
TASKS_DIR = STORAGE_DIR / "tasks"

# 创建目录
for directory in [STORAGE_DIR, UPLOAD_DIR, RESULTS_DIR, CACHE_DIR, TASKS_DIR]:
    directory.mkdir(parents=True, exist_ok=True)

# 文件配置
MAX_FILE_SIZE = 50 * 1024 * 1024  # 50MB
ALLOWED_EXTENSIONS = {".csv"}

# 预测配置
DEFAULT_TRAIN_RATIO = 0.8
DEFAULT_MAX_RETRIEVED_SAMPLES = 10
DEFAULT_SIMILARITY_THRESHOLD = 0.3

# RAG 模型配置
RAG_MODEL_NAME = "all-MiniLM-L6-v2"
RAG_MODEL_PATH = BASE_DIR / RAG_MODEL_NAME

# 设置环境变量以使用本地模型
if RAG_MODEL_PATH.exists():
    os.environ['SENTENCE_TRANSFORMERS_HOME'] = str(BASE_DIR)
    os.environ['TRANSFORMERS_OFFLINE'] = '1'
    os.environ['HF_DATASETS_OFFLINE'] = '1'

# LLM配置
DEFAULT_MODEL_PROVIDER = "gemini"
DEFAULT_MODEL_NAME = "gemini-2.5-flash"
DEFAULT_TEMPERATURE = 1.0

# 任务配置
DEFAULT_WORKERS = 5
TASK_TIMEOUT = 3600  # 1小时

# 日志配置
LOG_DIR = STORAGE_DIR / "logs"
LOG_DIR.mkdir(parents=True, exist_ok=True)
LOG_LEVEL = "INFO"

# 数据库配置（可选）
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./storage/app.db")

# 环境变量
DEBUG = os.getenv("DEBUG", "False").lower() == "true"

