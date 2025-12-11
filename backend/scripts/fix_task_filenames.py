"""
修复数据库中任务的 filename 字段
将 UUID 格式的文件名替换为原始文件名
"""
import sys
import re
from pathlib import Path

# 添加项目根目录到 Python 路径
backend_dir = Path(__file__).parent.parent
sys.path.insert(0, str(backend_dir))

from database.task_db import TaskDatabase
from database.dataset_db import DatasetDatabase
from datetime import datetime
import json


def is_uuid_filename(filename: str) -> bool:
    """检查文件名是否为 UUID 格式"""
    if not filename:
        return False
    # UUID 格式: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx.csv
    pattern = r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.csv$'
    return bool(re.match(pattern, filename, re.IGNORECASE))


def main():
    print("=" * 80)
    print("开始检查数据库中的任务 filename 字段")
    print("=" * 80)
    print()

    task_db = TaskDatabase()
    dataset_db = DatasetDatabase()

    # 1. 查询所有任务（分页获取）
    print("步骤 1: 查询所有任务...")
    all_tasks = []
    page = 1
    page_size = 100

    while True:
        result = task_db.list_tasks(page=page, page_size=page_size, sort_by="created_at", sort_order="asc")
        tasks = result.get('tasks', [])
        if not tasks:
            break
        all_tasks.extend(tasks)
        page += 1

    print(f"数据库中共有 {len(all_tasks)} 个任务")
    print()
    
    # 2. 找出所有使用 UUID 格式文件名的任务
    print("步骤 2: 查找使用 UUID 格式文件名的任务...")
    affected_tasks = []
    
    for task in all_tasks:
        filename = task.get('filename', '')
        if is_uuid_filename(filename):
            affected_tasks.append(task)
            print(f"  - 任务 {task['task_id'][:8]}... | filename: {filename}")
    
    print()
    print(f"找到 {len(affected_tasks)} 个受影响的任务")
    print()
    
    if not affected_tasks:
        print("✅ 没有需要修复的任务！")
        return
    
    # 3. 备份受影响的任务数据
    print("步骤 3: 备份受影响的任务数据...")
    backup_data = []
    
    for task in affected_tasks:
        backup_data.append({
            'task_id': task['task_id'],
            'old_filename': task['filename'],
            'file_id': task.get('file_id', ''),
            'dataset_id': task.get('dataset_id', '')
        })
    
    # 保存备份到文件
    backup_file = backend_dir / 'scripts' / f'task_filename_backup_{datetime.now().strftime("%Y%m%d_%H%M%S")}.json'
    with open(backup_file, 'w', encoding='utf-8') as f:
        json.dump(backup_data, f, ensure_ascii=False, indent=2)
    
    print(f"备份已保存到: {backup_file}")
    print()
    
    # 4. 批量修复
    print("步骤 4: 批量修复任务的 filename 字段...")
    fixed_count = 0
    failed_count = 0
    
    for task in affected_tasks:
        task_id = task['task_id']
        old_filename = task['filename']
        dataset_id = task.get('dataset_id') or task.get('file_id')
        
        if not dataset_id:
            print(f"  ❌ 任务 {task_id[:8]}... 没有 dataset_id，跳过")
            failed_count += 1
            continue
        
        # 从数据集数据库获取原始文件名
        dataset = dataset_db.get_dataset(dataset_id)
        if not dataset:
            print(f"  ❌ 任务 {task_id[:8]}... 找不到数据集 {dataset_id[:8]}...，跳过")
            failed_count += 1
            continue
        
        original_filename = dataset.get('original_filename')
        if not original_filename:
            print(f"  ❌ 任务 {task_id[:8]}... 数据集没有 original_filename，跳过")
            failed_count += 1
            continue
        
        # 更新数据库
        try:
            task_db.update_task(task_id, {'filename': original_filename})
            print(f"  ✅ 任务 {task_id[:8]}... | {old_filename} -> {original_filename}")
            fixed_count += 1
        except Exception as e:
            print(f"  ❌ 任务 {task_id[:8]}... 更新失败: {e}")
            failed_count += 1
    
    print()
    print("=" * 80)
    print("修复完成！")
    print(f"  - 成功修复: {fixed_count} 个任务")
    print(f"  - 修复失败: {failed_count} 个任务")
    print(f"  - 备份文件: {backup_file}")
    print("=" * 80)
    
    # 5. 验证修复结果
    print()
    print("步骤 5: 验证修复结果...")
    remaining_issues = []
    
    for task_id in [t['task_id'] for t in affected_tasks]:
        task = task_db.get_task(task_id)
        if task and is_uuid_filename(task.get('filename', '')):
            remaining_issues.append(task_id)
    
    if remaining_issues:
        print(f"⚠️  仍有 {len(remaining_issues)} 个任务的 filename 为 UUID 格式")
        for task_id in remaining_issues:
            print(f"  - {task_id}")
    else:
        print("✅ 所有任务的 filename 已修复为原始文件名！")


if __name__ == '__main__':
    main()

