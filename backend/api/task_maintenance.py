"""
任务维护 API - 用于检测和修复任务状态问题
"""

from fastapi import APIRouter, HTTPException
from typing import List, Dict, Any
from pathlib import Path
import logging

from services.task_manager import TaskManager
from models.schemas import TaskStatus

logger = logging.getLogger(__name__)
router = APIRouter()

task_manager = TaskManager()


@router.post("/fix-stuck-tasks")
async def fix_stuck_tasks() -> Dict[str, Any]:
    """
    检测并修复卡在 running 状态但实际已完成的任务
    
    返回:
    {
        "fixed_count": 1,
        "fixed_tasks": ["task-id-1", "task-id-2"],
        "details": [...]
    }
    """
    try:
        from database.models import get_db_session, Task
        
        fixed_tasks = []
        details = []
        
        with get_db_session() as db:
            # 查找所有 running 状态的任务
            running_tasks = db.query(Task).filter(Task.status == 'running').all()
            
            logger.info(f"Found {len(running_tasks)} running tasks, checking for stuck tasks...")
            
            for task in running_tasks:
                task_id = task.task_id
                result_dir = Path(f'storage/results/{task_id}')
                
                # 检查结果文件是否存在
                predictions_file = result_dir / 'predictions.csv'
                metrics_file = result_dir / 'metrics.json'
                
                if predictions_file.exists() and metrics_file.exists():
                    # 任务实际已完成,更新状态
                    logger.info(f"Fixing stuck task {task_id[:8]}...")
                    
                    task.status = 'completed'
                    task.progress = 1.0
                    task.message = '预测完成'
                    task.result_id = task_id
                    
                    fixed_tasks.append(task_id)
                    details.append({
                        "task_id": task_id,
                        "previous_status": "running",
                        "new_status": "completed",
                        "previous_progress": task.progress,
                        "previous_message": task.message
                    })
                    
                    logger.info(f"Fixed task {task_id[:8]}")
        
        return {
            "fixed_count": len(fixed_tasks),
            "fixed_tasks": fixed_tasks,
            "details": details
        }
    
    except Exception as e:
        logger.error(f"Failed to fix stuck tasks: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"修复失败: {str(e)}")


@router.get("/check-task-health")
async def check_task_health() -> Dict[str, Any]:
    """
    检查任务健康状态,返回可能存在问题的任务
    
    返回:
    {
        "total_tasks": 100,
        "running_tasks": 2,
        "stuck_tasks": 1,
        "stuck_task_ids": ["task-id-1"]
    }
    """
    try:
        from database.models import get_db_session, Task
        
        stuck_tasks = []
        
        with get_db_session() as db:
            # 统计任务状态
            total_tasks = db.query(Task).count()
            running_tasks = db.query(Task).filter(Task.status == 'running').all()
            
            # 检查 running 任务是否卡住
            for task in running_tasks:
                task_id = task.task_id
                result_dir = Path(f'storage/results/{task_id}')
                
                # 检查结果文件是否存在
                predictions_file = result_dir / 'predictions.csv'
                metrics_file = result_dir / 'metrics.json'
                
                if predictions_file.exists() and metrics_file.exists():
                    stuck_tasks.append(task_id)
        
        return {
            "total_tasks": total_tasks,
            "running_tasks": len(running_tasks),
            "stuck_tasks": len(stuck_tasks),
            "stuck_task_ids": stuck_tasks
        }
    
    except Exception as e:
        logger.error(f"Failed to check task health: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"检查失败: {str(e)}")

