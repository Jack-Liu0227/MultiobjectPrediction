"""
数据库迁移脚本：为旧任务回填数据统计信息

为所有 total_rows 和 valid_rows 为 NULL 的任务计算并填充数据统计
"""

import sys
from pathlib import Path
import logging
import pandas as pd

# 添加 backend 目录到 Python 路径
backend_dir = Path(__file__).parent.parent
sys.path.insert(0, str(backend_dir))

from database.task_db import TaskDatabase
from database.dataset_db import DatasetDatabase

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def get_file_path_from_task_config(task_id: str) -> Path:
    """从任务的 task_config.json 获取文件路径"""
    # __file__ 是 backend/database/migrations/backfill_data_statistics.py
    # parent.parent.parent 是项目根目录
    script_dir = Path(__file__).parent  # backend/database/migrations
    backend_dir = script_dir.parent.parent  # backend
    project_root = backend_dir.parent  # 项目根目录
    results_dir = project_root / "storage" / "results"
    task_config_file = results_dir / task_id / "task_config.json"

    if task_config_file.exists():
        import json
        with open(task_config_file, 'r', encoding='utf-8') as f:
            config = json.load(f)
            # 从 request_data 中获取 file_path
            file_path_str = config.get('request_data', {}).get('file_path')
            if file_path_str:
                file_path = Path(file_path_str)
                if file_path.exists():
                    return file_path

    return None

def get_file_path(file_id: str, dataset_db: DatasetDatabase, task_id: str = None) -> Path:
    """从 file_id 获取实际文件路径"""
    # 如果有 task_id，先尝试从 task_config.json 获取
    if task_id:
        file_path = get_file_path_from_task_config(task_id)
        if file_path:
            return file_path

    # 如果没有 file_id，返回 None
    if not file_id:
        return None

    # 先尝试从数据集数据库获取
    dataset = dataset_db.get_dataset(file_id)
    if dataset:
        return Path(dataset['file_path'])

    # 尝试从上传目录获取
    script_dir = Path(__file__).parent  # backend/database/migrations
    backend_dir = script_dir.parent.parent  # backend
    project_root = backend_dir.parent  # 项目根目录
    upload_dir = project_root / "storage" / "uploads"
    file_path = upload_dir / file_id
    if file_path.exists():
        csv_files = list(file_path.glob("*.csv"))
        if csv_files:
            return csv_files[0]

    return None

def calculate_statistics_from_predictions(task_id: str, target_columns: list) -> tuple:
    """从 predictions.csv 计算数据统计信息

    总行数：predictions.csv 的总行数
    有效行数：预测值不为0且不为空的行数
    """
    script_dir = Path(__file__).parent  # backend/database/migrations
    backend_dir = script_dir.parent.parent  # backend
    project_root = backend_dir.parent  # 项目根目录
    results_dir = project_root / "storage" / "results"
    predictions_file = results_dir / task_id / "predictions.csv"

    logger.info(f"尝试读取: {predictions_file}")

    if not predictions_file.exists():
        logger.warning(f"predictions.csv 不存在: {predictions_file}")
        return None, None

    try:
        df = pd.read_csv(predictions_file)
        total_rows = len(df)
        logger.info(f"成功读取 predictions.csv，共 {total_rows} 行")
        logger.info(f"列名: {df.columns.tolist()}")
        logger.info(f"目标列: {target_columns}")

        # 计算有效行数：预测值不为0且不为空的行数
        # 查找带 _predicted 后缀的列
        predicted_cols = [col for col in df.columns if col.endswith('_predicted')]

        if predicted_cols:
            logger.info(f"找到预测列: {predicted_cols}")
            # 创建一个布尔掩码：所有预测列都不为空且不为0
            valid_mask = pd.Series([True] * len(df))
            for col in predicted_cols:
                # 不为空且不为0
                valid_mask &= df[col].notna() & (df[col] != 0)

            valid_rows = int(valid_mask.sum())
            logger.info(f"有效行数（预测值不为0且不为空）: {valid_rows}")
        else:
            # 如果没有找到预测列，尝试使用原始目标列
            logger.warning(f"未找到预测列，尝试使用目标列: {target_columns}")
            if target_columns:
                available_cols = [col for col in target_columns if col in df.columns]
                if available_cols:
                    valid_mask = pd.Series([True] * len(df))
                    for col in available_cols:
                        valid_mask &= df[col].notna() & (df[col] != 0)
                    valid_rows = int(valid_mask.sum())
                    logger.info(f"使用目标列计算有效行数: {valid_rows}")
                else:
                    valid_rows = total_rows
                    logger.warning(f"未找到任何可用列，假设所有行都有效")
            else:
                valid_rows = total_rows

        return total_rows, valid_rows
    except Exception as e:
        logger.error(f"从 predictions.csv 计算统计信息失败: {e}", exc_info=True)
        return None, None

def calculate_statistics(file_path: Path, target_columns: list) -> tuple:
    """计算数据统计信息"""
    try:
        df = pd.read_csv(file_path)
        total_rows = int(len(df))

        # 计算有效行数（目标列非空且非0的行数）
        if target_columns:
            valid_mask = pd.Series([True] * len(df))
            for col in target_columns:
                if col in df.columns:
                    valid_mask &= df[col].notna() & (df[col] != 0)
            valid_rows = int(valid_mask.sum())
        else:
            valid_rows = total_rows

        return total_rows, valid_rows
    except Exception as e:
        logger.error(f"计算统计信息失败: {e}")
        return None, None

def backfill_statistics(force_update=False):
    """为旧任务回填数据统计

    Args:
        force_update: 是否强制更新所有任务（即使已有数据统计）
    """
    logger.info("开始回填数据统计...")
    if force_update:
        logger.info("强制更新模式：将更新所有任务")

    task_db = TaskDatabase()
    dataset_db = DatasetDatabase()

    # 获取所有任务
    all_tasks = []
    page = 1
    page_size = 100

    while True:
        result = task_db.list_tasks(page=page, page_size=page_size)
        all_tasks.extend(result['tasks'])

        if len(result['tasks']) < page_size:
            break
        page += 1

    logger.info(f"找到 {len(all_tasks)} 个任务")

    # 筛选需要更新的任务
    if force_update:
        tasks_to_update = all_tasks
    else:
        # 只更新 total_rows 或 valid_rows 为 None 的任务
        tasks_to_update = [
            task for task in all_tasks
            if task.get('total_rows') is None or task.get('valid_rows') is None
        ]
    
    logger.info(f"需要更新 {len(tasks_to_update)} 个任务")
    
    updated_count = 0
    failed_count = 0
    
    for task in tasks_to_update:
        task_id = task['task_id']
        file_id = task.get('file_id')
        target_columns = task.get('target_columns', [])

        # 优先从 predictions.csv 计算（因为有效行数是指预测值不为0的行数）
        total_rows, valid_rows = calculate_statistics_from_predictions(task_id, target_columns)

        # 如果 predictions.csv 不存在，尝试从原始文件计算
        if total_rows is None:
            logger.info(f"任务 {task_id} 的 predictions.csv 不存在，尝试从原始文件计算")
            file_path = get_file_path(file_id, dataset_db, task_id)
            if file_path and file_path.exists():
                total_rows, valid_rows = calculate_statistics(file_path, target_columns)
            else:
                logger.warning(f"任务 {task_id} 的原始文件也不存在")
        
        if total_rows is not None:
            # 更新数据库
            success = task_db.update_task(task_id, {
                'total_rows': total_rows,
                'valid_rows': valid_rows
            })
            
            if success:
                logger.info(f"✓ 更新任务 {task_id}: 总行数={total_rows}, 有效行数={valid_rows}")
                updated_count += 1
            else:
                logger.error(f"✗ 更新任务 {task_id} 失败")
                failed_count += 1
        else:
            logger.warning(f"任务 {task_id} 无法计算统计信息")
            failed_count += 1
    
    logger.info(f"\n回填完成:")
    logger.info(f"  ✓ 成功更新: {updated_count} 个任务")
    logger.info(f"  ✗ 失败: {failed_count} 个任务")
    logger.info(f"  - 无需更新: {len(all_tasks) - len(tasks_to_update)} 个任务")

if __name__ == "__main__":
    import sys
    # 检查是否有 --force 参数
    force_update = "--force" in sys.argv
    backfill_statistics(force_update=force_update)

