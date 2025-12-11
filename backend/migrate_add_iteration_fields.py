"""
迁移脚本：添加迭代预测字段到现有数据库
直接使用 SQLAlchemy 添加缺失的列
"""

import sys
from pathlib import Path
import logging

# 添加 backend 目录到 Python 路径
backend_dir = Path(__file__).parent
sys.path.insert(0, str(backend_dir))

from database.models import engine, DB_PATH
from sqlalchemy import text, inspect

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def check_column_exists(table_name: str, column_name: str) -> bool:
    """检查列是否存在"""
    inspector = inspect(engine)
    columns = [col['name'] for col in inspector.get_columns(table_name)]
    return column_name in columns


def add_iteration_fields():
    """添加迭代预测相关字段"""
    
    logger.info(f"Database path: {DB_PATH}")
    
    # 需要添加的字段
    fields_to_add = [
        ('enable_iteration', 'BOOLEAN NOT NULL DEFAULT 0'),
        ('max_iterations', 'INTEGER NOT NULL DEFAULT 1'),
        ('current_iteration', 'INTEGER NOT NULL DEFAULT 0'),
        ('convergence_threshold', 'REAL NOT NULL DEFAULT 0.01'),
        ('early_stop', 'BOOLEAN NOT NULL DEFAULT 1'),
        ('max_workers', 'INTEGER NOT NULL DEFAULT 5'),
        ('iteration_history', 'TEXT'),  # JSON stored as TEXT in SQLite
        ('failed_samples', 'TEXT'),  # JSON stored as TEXT in SQLite
        ('continue_from_task_id', 'VARCHAR(36)'),
    ]
    
    with engine.connect() as conn:
        # 检查并添加每个字段
        for field_name, field_type in fields_to_add:
            if check_column_exists('tasks', field_name):
                logger.info(f"✓ Column '{field_name}' already exists, skipping")
                continue
            
            try:
                # SQLite 使用 ALTER TABLE ADD COLUMN
                sql = f"ALTER TABLE tasks ADD COLUMN {field_name} {field_type}"
                conn.execute(text(sql))
                conn.commit()
                logger.info(f"✓ Added column '{field_name}'")
            except Exception as e:
                logger.error(f"✗ Failed to add column '{field_name}': {e}")
                raise
        
        # 验证所有字段都已添加
        logger.info("\nVerifying columns...")
        inspector = inspect(engine)
        columns = [col['name'] for col in inspector.get_columns('tasks')]
        
        missing_fields = []
        for field_name, _ in fields_to_add:
            if field_name in columns:
                logger.info(f"✓ {field_name}")
            else:
                logger.error(f"✗ {field_name} - MISSING")
                missing_fields.append(field_name)
        
        if missing_fields:
            raise Exception(f"Migration incomplete. Missing fields: {missing_fields}")
        
        logger.info("\n✓ Migration completed successfully!")
        logger.info(f"✓ All {len(fields_to_add)} fields have been added to the tasks table")


def main():
    """主函数"""
    try:
        logger.info("Starting database migration...")
        add_iteration_fields()
        return True
    except Exception as e:
        logger.error(f"Migration failed: {e}", exc_info=True)
        return False


if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)

