"""
初始化数据库
创建所有必要的表
"""

import sys
from pathlib import Path

# 添加 backend 目录到 Python 路径
backend_dir = Path(__file__).parent
sys.path.insert(0, str(backend_dir))

from database.models import init_db, DB_PATH
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def main():
    """初始化数据库"""
    logger.info("Initializing database...")
    logger.info(f"Database path: {DB_PATH}")
    
    try:
        # 创建所有表
        init_db()
        logger.info("✓ Database initialized successfully")
        logger.info(f"✓ Database file created at: {DB_PATH}")
        
        # 验证表是否创建成功
        from database.models import engine
        from sqlalchemy import inspect
        
        inspector = inspect(engine)
        tables = inspector.get_table_names()
        
        logger.info(f"✓ Created {len(tables)} tables:")
        for table in tables:
            logger.info(f"  - {table}")
        
        return True
        
    except Exception as e:
        logger.error(f"✗ Failed to initialize database: {e}", exc_info=True)
        return False


if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)

