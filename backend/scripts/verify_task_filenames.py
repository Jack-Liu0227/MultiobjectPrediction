"""
验证数据库中任务的 filename 字段是否已正确修复
"""
import sys
from pathlib import Path

# 添加项目根目录到 Python 路径
backend_dir = Path(__file__).parent.parent
sys.path.insert(0, str(backend_dir))

from database.task_db import TaskDatabase

def main():
    task_db = TaskDatabase()
    
    # 需要验证的任务ID
    task_ids = [
        'e3696d88-84c9-4a08-ba38-06a4b59a09d0',
        '4337f28e-9740-4397-9ed2-06472173ea81',
        'b6599b2e-df01-4ef5-aece-d50fd7c1386f'
    ]
    
    print("验证修复后的任务 filename 字段:")
    print("=" * 80)
    
    for task_id in task_ids:
        task = task_db.get_task(task_id)
        if task:
            filename = task.get('filename', 'N/A')
            print(f"任务 {task_id[:8]}... | filename: {filename}")
        else:
            print(f"任务 {task_id[:8]}... | 未找到")
    
    print("=" * 80)

if __name__ == '__main__':
    main()

