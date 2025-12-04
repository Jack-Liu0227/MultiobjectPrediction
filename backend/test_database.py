"""
测试数据库功能
"""

import sys
from pathlib import Path

# 添加 backend 目录到 Python 路径
backend_dir = Path(__file__).parent
sys.path.insert(0, str(backend_dir))

from database.task_db import TaskDatabase
from database.dataset_db import DatasetDatabase
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def test_task_database():
    """测试任务数据库"""
    logger.info("\n" + "="*60)
    logger.info("测试任务数据库")
    logger.info("="*60)
    
    db = TaskDatabase()
    
    # 1. 创建任务
    logger.info("\n1. 创建测试任务...")
    task_data = {
        "task_id": "test-task-001",
        "status": "pending",
        "progress": 0.0,
        "message": "测试任务",
        "file_id": "test-file-001",
        "filename": "test.csv",
        "config": {
            "composition_column": "Al(wt%)",
            "processing_column": "Processing_Description",
            "target_columns": ["UTS(MPa)", "El(%)"],
            "model_provider": "openai",
            "model_name": "openai/deepseek-chat",
            "temperature": 1.0,
            "sample_size": 10,
            "train_ratio": 0.8,
            "max_retrieved_samples": 20,
            "similarity_threshold": 0.3,
        },
        "note": "这是一个测试任务"
    }
    
    task_id = db.create_task(task_data)
    logger.info(f"✓ 创建任务成功: {task_id}")
    
    # 2. 获取任务
    logger.info("\n2. 获取任务信息...")
    task = db.get_task(task_id)
    if task:
        logger.info(f"✓ 任务状态: {task['status']}")
        logger.info(f"✓ 文件名: {task['filename']}")
        logger.info(f"✓ 目标列: {task['target_columns']}")
    
    # 3. 更新任务
    logger.info("\n3. 更新任务状态...")
    db.update_task(task_id, {
        "status": "running",
        "progress": 0.5,
        "message": "正在预测..."
    })
    logger.info("✓ 更新成功")
    
    # 4. 列出任务
    logger.info("\n4. 列出所有任务...")
    result = db.list_tasks(page=1, page_size=10)
    logger.info(f"✓ 共 {result['total']} 个任务")
    
    # 5. 删除任务
    logger.info("\n5. 删除测试任务...")
    db.delete_task(task_id)
    logger.info("✓ 删除成功")


def test_dataset_database():
    """测试数据集数据库"""
    logger.info("\n" + "="*60)
    logger.info("测试数据集数据库")
    logger.info("="*60)
    
    db = DatasetDatabase()
    
    # 1. 创建数据集
    logger.info("\n1. 创建测试数据集...")
    dataset_data = {
        "dataset_id": "test-dataset-001",
        "filename": "test-dataset-001.csv",
        "original_filename": "test_data.csv",
        "file_path": "/path/to/test_data.csv",
        "row_count": 100,
        "column_count": 10,
        "columns": ["Al(wt%)", "Ti(wt%)", "Processing_Description", "UTS(MPa)", "El(%)"],
        "file_size": 10240,
        "file_hash": "abc123",
        "description": "测试数据集",
        "tags": ["test", "aluminum"],
    }
    
    dataset_id = db.create_dataset(dataset_data)
    logger.info(f"✓ 创建数据集成功: {dataset_id}")
    
    # 2. 获取数据集
    logger.info("\n2. 获取数据集信息...")
    dataset = db.get_dataset(dataset_id)
    if dataset:
        logger.info(f"✓ 文件名: {dataset['original_filename']}")
        logger.info(f"✓ 行数: {dataset['row_count']}")
        logger.info(f"✓ 列数: {dataset['column_count']}")
        logger.info(f"✓ 标签: {dataset['tags']}")
    
    # 3. 更新数据集
    logger.info("\n3. 更新数据集信息...")
    db.update_dataset(dataset_id, {
        "description": "更新后的描述",
        "tags": ["test", "aluminum", "updated"]
    })
    logger.info("✓ 更新成功")
    
    # 4. 增加使用次数
    logger.info("\n4. 增加使用次数...")
    db.increment_usage(dataset_id)
    dataset = db.get_dataset(dataset_id)
    logger.info(f"✓ 使用次数: {dataset['usage_count']}")
    
    # 5. 列出数据集
    logger.info("\n5. 列出所有数据集...")
    result = db.list_datasets(page=1, page_size=10)
    logger.info(f"✓ 共 {result['total']} 个数据集")
    
    # 6. 删除数据集
    logger.info("\n6. 删除测试数据集...")
    db.delete_dataset(dataset_id)
    logger.info("✓ 删除成功")


def main():
    """运行所有测试"""
    try:
        test_task_database()
        test_dataset_database()
        
        logger.info("\n" + "="*60)
        logger.info("✓ 所有测试通过")
        logger.info("="*60)
        return True
        
    except Exception as e:
        logger.error(f"\n✗ 测试失败: {e}", exc_info=True)
        return False


if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)

