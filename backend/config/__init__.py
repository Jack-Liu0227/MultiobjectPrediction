"""
配置模块
"""

from pathlib import Path

# 配置目录路径
CONFIG_DIR = Path(__file__).parent
BACKEND_DIR = CONFIG_DIR.parent
PROJECT_ROOT = BACKEND_DIR.parent

# 存储目录
STORAGE_DIR = PROJECT_ROOT / "storage"

# 数据目录
UPLOADS_DIR = STORAGE_DIR / "uploads"
RESULTS_DIR = STORAGE_DIR / "results"
CACHE_DIR = STORAGE_DIR / "cache"
TASKS_DIR = STORAGE_DIR / "tasks"

# 向后兼容的别名
BASE_DIR = PROJECT_ROOT
UPLOAD_DIR = UPLOADS_DIR

# 确保目录存在
for directory in [STORAGE_DIR, UPLOADS_DIR, RESULTS_DIR, CACHE_DIR, TASKS_DIR]:
    directory.mkdir(parents=True, exist_ok=True)

__all__ = [
    "CONFIG_DIR",
    "BACKEND_DIR",
    "PROJECT_ROOT",
    "STORAGE_DIR",
    "UPLOADS_DIR",
    "RESULTS_DIR",
    "CACHE_DIR",
    "TASKS_DIR",
    "BASE_DIR",
    "UPLOAD_DIR"
]

