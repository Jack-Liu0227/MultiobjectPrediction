"""
数据库迁移脚本：添加数据统计字段

添加字段：
- total_rows: 数据集总行数
- valid_rows: 有效数据行数（目标列非空的行数）
"""

import sqlite3
from pathlib import Path
import logging

logger = logging.getLogger(__name__)

def migrate():
    """执行迁移"""
    db_path = Path(__file__).parent.parent.parent.parent / "storage" / "database" / "app.db"

    if not db_path.exists():
        logger.warning(f"数据库文件不存在: {db_path}")
        logger.info("请先运行后端服务以创建数据库")
        return
    
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    try:
        # 检查字段是否已存在
        cursor.execute("PRAGMA table_info(tasks)")
        columns = [row[1] for row in cursor.fetchall()]
        
        # 添加 total_rows 字段
        if 'total_rows' not in columns:
            logger.info("添加 total_rows 字段...")
            cursor.execute("ALTER TABLE tasks ADD COLUMN total_rows INTEGER")
            logger.info("✓ total_rows 字段已添加")
        else:
            logger.info("total_rows 字段已存在，跳过")
        
        # 添加 valid_rows 字段
        if 'valid_rows' not in columns:
            logger.info("添加 valid_rows 字段...")
            cursor.execute("ALTER TABLE tasks ADD COLUMN valid_rows INTEGER")
            logger.info("✓ valid_rows 字段已添加")
        else:
            logger.info("valid_rows 字段已存在，跳过")
        
        conn.commit()
        logger.info("✓ 数据库迁移完成")
        
    except Exception as e:
        logger.error(f"迁移失败: {e}")
        conn.rollback()
        raise
    finally:
        conn.close()

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    migrate()

