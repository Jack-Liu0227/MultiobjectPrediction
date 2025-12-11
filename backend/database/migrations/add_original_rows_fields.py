"""
数据库迁移脚本：添加 original_total_rows 和 original_valid_rows 字段

这个脚本为 tasks 表添加两个新字段来保存原始数据集的统计信息：
- original_total_rows: 原始数据集总行数（创建时保存，不会被覆盖）
- original_valid_rows: 原始数据集有效行数（创建时保存，不会被覆盖）

运行方式：
    python -m backend.database.migrations.add_original_rows_fields
"""

import sys
from pathlib import Path

# 添加项目根目录到 Python 路径
project_root = Path(__file__).parent.parent.parent.parent
sys.path.insert(0, str(project_root))

from sqlalchemy import Column, Integer, text
from backend.database.models import engine, Base
from backend.database.task_db import TaskDatabase
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def add_columns():
    """添加新列到 tasks 表"""
    with engine.connect() as conn:
        try:
            # 添加 original_total_rows 列
            logger.info("Adding column: original_total_rows")
            conn.execute(text(
                "ALTER TABLE tasks ADD COLUMN original_total_rows INTEGER"
            ))
            conn.commit()
            logger.info("✓ Added column: original_total_rows")
        except Exception as e:
            if "duplicate column name" in str(e).lower() or "already exists" in str(e).lower():
                logger.info("Column original_total_rows already exists, skipping")
            else:
                logger.error(f"Error adding original_total_rows: {e}")
                raise

        try:
            # 添加 original_valid_rows 列
            logger.info("Adding column: original_valid_rows")
            conn.execute(text(
                "ALTER TABLE tasks ADD COLUMN original_valid_rows INTEGER"
            ))
            conn.commit()
            logger.info("✓ Added column: original_valid_rows")
        except Exception as e:
            if "duplicate column name" in str(e).lower() or "already exists" in str(e).lower():
                logger.info("Column original_valid_rows already exists, skipping")
            else:
                logger.error(f"Error adding original_valid_rows: {e}")
                raise


def migrate_existing_data():
    """
    迁移现有数据：将 total_rows 和 valid_rows 复制到新字段
    
    注意：对于已完成的任务，这些值可能是结果文件的统计信息，不准确。
    但这是我们能做的最好的估算。
    """
    with engine.connect() as conn:
        try:
            logger.info("Migrating existing data...")
            
            # 将现有的 total_rows 复制到 original_total_rows（如果 original_total_rows 为 NULL）
            result = conn.execute(text(
                """
                UPDATE tasks 
                SET original_total_rows = total_rows 
                WHERE original_total_rows IS NULL AND total_rows IS NOT NULL
                """
            ))
            conn.commit()
            logger.info(f"✓ Migrated {result.rowcount} rows for original_total_rows")
            
            # 将现有的 valid_rows 复制到 original_valid_rows（如果 original_valid_rows 为 NULL）
            result = conn.execute(text(
                """
                UPDATE tasks 
                SET original_valid_rows = valid_rows 
                WHERE original_valid_rows IS NULL AND valid_rows IS NOT NULL
                """
            ))
            conn.commit()
            logger.info(f"✓ Migrated {result.rowcount} rows for original_valid_rows")
            
        except Exception as e:
            logger.error(f"Error migrating data: {e}")
            raise


def main():
    """执行迁移"""
    logger.info("=" * 60)
    logger.info("Database Migration: Add original_total_rows and original_valid_rows")
    logger.info("=" * 60)
    
    try:
        # 1. 添加新列
        logger.info("\n[Step 1] Adding new columns...")
        add_columns()
        
        # 2. 迁移现有数据
        logger.info("\n[Step 2] Migrating existing data...")
        migrate_existing_data()
        
        logger.info("\n" + "=" * 60)
        logger.info("✓ Migration completed successfully!")
        logger.info("=" * 60)
        logger.info("\nNote: For existing completed tasks, the original_*_rows values")
        logger.info("may not be accurate as they were copied from result file statistics.")
        logger.info("New tasks will have accurate original dataset information.")
        
    except Exception as e:
        logger.error(f"\n✗ Migration failed: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()

