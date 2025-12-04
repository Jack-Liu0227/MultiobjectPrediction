"""
任务管理 API
"""

from fastapi import APIRouter, HTTPException, Query, Body
from typing import Optional
from pydantic import BaseModel
import logging

from models.schemas import TaskListResponse, TaskDetailResponse, TaskInfo
from services.task_manager import TaskManager

logger = logging.getLogger(__name__)
router = APIRouter()

task_manager = TaskManager()


@router.get("/list", response_model=TaskListResponse)
async def list_tasks(
    page: int = Query(1, ge=1, description="页码"),
    page_size: int = Query(20, ge=1, le=100, description="每页数量"),
    status: Optional[str] = Query(None, description="状态筛选"),
    sort_by: str = Query("created_at", description="排序字段"),
    sort_order: str = Query("desc", description="排序顺序")
):
    """
    获取任务列表
    
    参数:
    - page: 页码（从1开始）
    - page_size: 每页数量（1-100）
    - status: 状态筛选（pending/running/completed/failed）
    - sort_by: 排序字段（created_at/completed_at/status）
    - sort_order: 排序顺序（asc/desc）
    
    返回:
    {
        "tasks": [...],
        "total": 100,
        "page": 1,
        "page_size": 20
    }
    """
    try:
        result = task_manager.list_tasks(
            page=page,
            page_size=page_size,
            status_filter=status,
            sort_by=sort_by,
            sort_order=sort_order
        )
        
        return TaskListResponse(
            tasks=[TaskInfo(**task) for task in result['tasks']],
            total=result['total'],
            page=page,
            page_size=page_size
        )
    
    except Exception as e:
        logger.error(f"获取任务列表失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"获取任务列表失败: {str(e)}")


@router.get("/{task_id}", response_model=TaskDetailResponse)
async def get_task_detail(task_id: str):
    """
    获取任务详情
    
    参数:
    - task_id: 任务ID
    
    返回:
    {
        "task": {...},
        "config": {...},
        "logs": [...]
    }
    """
    try:
        task_info = task_manager.get_task(task_id)
        
        if not task_info:
            raise HTTPException(status_code=404, detail=f"任务不存在: {task_id}")
        
        # 获取任务配置
        config = task_manager.get_task_config(task_id)
        
        # 获取任务日志（最近100条）
        logs = task_manager.get_task_logs(task_id, limit=100)
        
        return TaskDetailResponse(
            task=TaskInfo(**task_info),
            config=config,
            logs=logs
        )
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"获取任务详情失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"获取任务详情失败: {str(e)}")


@router.delete("/{task_id}")
async def delete_task(task_id: str):
    """
    删除任务
    
    参数:
    - task_id: 任务ID
    
    返回:
    {
        "message": "任务已删除",
        "task_id": "..."
    }
    """
    try:
        success = task_manager.delete_task(task_id)
        
        if not success:
            raise HTTPException(status_code=404, detail=f"任务不存在: {task_id}")
        
        return {
            "message": "任务已删除",
            "task_id": task_id
        }
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"删除任务失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"删除任务失败: {str(e)}")


@router.post("/{task_id}/rerun")
async def rerun_task(task_id: str):
    """
    重新运行任务

    参数:
    - task_id: 原任务ID

    返回:
    {
        "message": "任务已重新提交",
        "new_task_id": "...",
        "original_task_id": "..."
    }
    """
    try:
        # 获取原任务信息
        original_task = task_manager.get_task(task_id)

        if not original_task:
            raise HTTPException(status_code=404, detail=f"任务不存在: {task_id}")

        # 获取原任务配置
        config = task_manager.get_task_config(task_id)

        if not config:
            raise HTTPException(status_code=400, detail="无法获取任务配置")

        # 创建新任务（使用相同配置）
        new_task_id = task_manager.create_task_from_config(config)

        return {
            "message": "任务已重新提交",
            "new_task_id": new_task_id,
            "original_task_id": task_id
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"重新运行任务失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"重新运行任务失败: {str(e)}")


@router.post("/{task_id}/cancel")
async def cancel_task(task_id: str):
    """
    取消任务

    参数:
    - task_id: 任务ID

    返回:
    {
        "message": "任务已取消",
        "task_id": "..."
    }
    """
    try:
        task_info = task_manager.get_task(task_id)

        if not task_info:
            raise HTTPException(status_code=404, detail=f"任务不存在: {task_id}")

        # 只能取消 pending 或 running 状态的任务
        if task_info.get('status') not in ['pending', 'running']:
            raise HTTPException(
                status_code=400,
                detail=f"无法取消状态为 {task_info.get('status')} 的任务"
            )

        success = task_manager.cancel_task(task_id)

        if not success:
            raise HTTPException(status_code=500, detail="取消任务失败")

        return {
            "message": "任务已取消",
            "task_id": task_id
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"取消任务失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"取消任务失败: {str(e)}")


class UpdateNoteRequest(BaseModel):
    """更新任务备注请求"""
    note: str


@router.patch("/{task_id}/note")
async def update_task_note(task_id: str, request: UpdateNoteRequest):
    """
    更新任务备注

    参数:
    - task_id: 任务ID
    - note: 新的备注内容

    返回:
    {
        "message": "备注已更新",
        "task_id": "...",
        "note": "..."
    }
    """
    try:
        # 获取任务信息
        task_info = task_manager.get_task(task_id)

        if not task_info:
            raise HTTPException(status_code=404, detail=f"任务不存在: {task_id}")

        # 更新备注
        task_manager.update_task(task_id, {"note": request.note})

        return {
            "message": "备注已更新",
            "task_id": task_id,
            "note": request.note
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"更新任务备注失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"更新任务备注失败: {str(e)}")
