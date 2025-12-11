"""
任务管理 API
"""

from fastapi import APIRouter, HTTPException, Query, Body, BackgroundTasks
from typing import Optional
from pydantic import BaseModel
import logging
from pathlib import Path

from models.schemas import TaskListResponse, TaskDetailResponse, TaskInfo, PredictionConfig
from services.task_manager import TaskManager
from services.rag_prediction_service import RAGPredictionService
from database.dataset_db import DatasetDatabase
from config import UPLOAD_DIR, BASE_DIR, RESULTS_DIR

logger = logging.getLogger(__name__)
router = APIRouter()

task_manager = TaskManager()
prediction_service = RAGPredictionService(task_manager)
dataset_db = DatasetDatabase()


# 请求模型定义
class RerunTaskRequest(BaseModel):
    """重新运行任务请求"""
    config: Optional[dict] = None  # 可选的配置覆盖
    note: Optional[str] = None  # 可选的任务备注


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
async def rerun_task(
    task_id: str,
    background_tasks: BackgroundTasks,
    request: Optional[RerunTaskRequest] = None
):
    """
    重新运行任务（创建新任务并启动预测）

    参数:
    - task_id: 原任务ID
    - request: 可选的配置和备注覆盖
      - config: 配置覆盖（可选）
      - note: 任务备注（可选）

    返回:
    {
        "message": "任务已重新提交",
        "new_task_id": "...",
        "original_task_id": "..."
    }
    """
    try:
        import json

        # 获取原任务信息
        original_task = task_manager.get_task(task_id)

        if not original_task:
            raise HTTPException(status_code=404, detail=f"任务不存在: {task_id}")

        # 获取原任务配置
        config_dict = task_manager.get_task_config(task_id)

        if not config_dict:
            raise HTTPException(status_code=400, detail="无法获取任务配置")

        # 如果请求中包含配置覆盖，合并配置
        if request and request.config:
            logger.info(f"应用配置覆盖: {request.config}")
            config_dict.update(request.config)

        # 获取原任务的文件信息
        # 优先从数据库中的 request_data 获取
        request_data = original_task.get("request_data", {})

        # 如果数据库中没有 request_data，尝试从 task_config.json 文件读取（兼容旧任务）
        if not request_data:
            task_config_file = RESULTS_DIR / task_id / "task_config.json"
            if task_config_file.exists():
                try:
                    with open(task_config_file, 'r', encoding='utf-8') as f:
                        task_config = json.load(f)
                        request_data = task_config.get('request_data', {})
                        logger.info(f"从 task_config.json 读取 request_data: {task_config_file}")
                except Exception as e:
                    logger.warning(f"无法从 task_config.json 读取 request_data: {e}")

        if not request_data:
            raise HTTPException(status_code=404, detail=f"无法获取任务 {task_id} 的文件信息")

        file_id = request_data.get("file_id")
        dataset_id = request_data.get("dataset_id")
        filename = request_data.get("filename", "")

        # 确定文件路径
        actual_file_path = None

        # 方法1: 优先使用 dataset_id
        if dataset_id:
            dataset = dataset_db.get_dataset(dataset_id)
            if dataset:
                actual_file_path = Path(dataset["file_path"])
                filename = dataset["original_filename"]  # 使用原始文件名而不是存储文件名
                if actual_file_path.exists():
                    logger.info(f"从 dataset_id 获取文件路径: {actual_file_path}")

        # 方法2: 如果没有 dataset_id，尝试使用 file_id
        if (not actual_file_path or not actual_file_path.exists()) and file_id:
            # 检查是否为 dataset_id
            dataset = dataset_db.get_dataset(file_id)
            if dataset:
                actual_file_path = Path(dataset["file_path"])
                filename = dataset["original_filename"]  # 使用原始文件名而不是存储文件名
                if actual_file_path.exists():
                    logger.info(f"从 file_id (作为 dataset_id) 获取文件路径: {actual_file_path}")
            else:
                # 尝试作为上传文件路径
                if filename:
                    actual_file_path = UPLOAD_DIR / file_id / filename
                    if actual_file_path.exists():
                        logger.info(f"从上传目录获取文件路径: {actual_file_path}")

        # 方法3: 从 file_path 字段获取（可能是相对路径或绝对路径）
        if not actual_file_path or not actual_file_path.exists():
            file_path_str = request_data.get("file_path")
            if file_path_str:
                # 尝试作为绝对路径
                actual_file_path = Path(file_path_str)
                if not actual_file_path.exists():
                    # 尝试作为相对于项目根目录的路径
                    actual_file_path = BASE_DIR / file_path_str
                    if actual_file_path.exists():
                        logger.info(f"从 file_path (相对路径) 获取文件路径: {actual_file_path}")
                else:
                    logger.info(f"从 file_path (绝对路径) 获取文件路径: {actual_file_path}")

        if not actual_file_path or not actual_file_path.exists():
            error_msg = f"找不到原任务的数据文件。dataset_id={dataset_id}, file_id={file_id}, file_path={request_data.get('file_path')}"
            logger.error(error_msg)
            raise HTTPException(status_code=404, detail=error_msg)

        # 创建 PredictionConfig 对象
        config = PredictionConfig(**config_dict)

        # 创建新任务数据
        task_data = {
            "file_path": str(actual_file_path),
            "filename": filename,
            "config": config_dict,
            "total_rows": request_data.get("total_rows"),
            "valid_rows": request_data.get("valid_rows")
        }

        # 保存 dataset_id 或 file_id
        if dataset_id:
            task_data["dataset_id"] = dataset_id
            task_data["file_id"] = dataset_id
        elif file_id:
            task_data["file_id"] = file_id

        # 如果请求中包含备注，添加到任务数据
        if request and request.note:
            task_data["note"] = request.note
            logger.info(f"添加任务备注: {request.note}")

        # 创建新任务
        new_task_id = task_manager.create_task(task_data)
        logger.info(f"Created rerun task: {new_task_id} from original task: {task_id}")

        # 🔥 关键修复：在后台启动预测任务
        background_tasks.add_task(
            prediction_service.run_prediction,
            task_id=new_task_id,
            file_path=str(actual_file_path),
            config=config
        )

        logger.info(f"Started background prediction for rerun task: {new_task_id}")

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


@router.post("/{task_id}/incremental-predict")
async def incremental_predict_task(task_id: str, background_tasks: BackgroundTasks):
    """
    增量预测任务（继续预测未完成的样本）

    参数:
    - task_id: 原任务ID

    返回:
    {
        "message": "增量预测任务已启动",
        "task_id": "...",
        "original_task_id": "..."
    }
    """
    try:
        from models.schemas import PredictionConfig, TaskStatus
        from config import RESULTS_DIR
        import json

        # 获取原任务信息
        original_task = task_manager.get_task(task_id)

        if not original_task:
            raise HTTPException(status_code=404, detail=f"任务不存在: {task_id}")

        # 获取原任务配置
        config_dict = task_manager.get_task_config(task_id)

        if not config_dict:
            raise HTTPException(status_code=400, detail="无法获取任务配置")

        # 添加增量预测标志
        config_dict['continue_from_task_id'] = task_id

        # 创建配置对象
        config = PredictionConfig(**config_dict)

        # 获取文件路径
        actual_file_path = None
        request_data = original_task.get("request_data", {})
        dataset_id = request_data.get("dataset_id")
        file_id = request_data.get("file_id")

        # 方法1: 从 task_config.json 获取（适用于旧任务）
        task_config_file = RESULTS_DIR / task_id / "task_config.json"
        if task_config_file.exists():
            try:
                with open(task_config_file, 'r', encoding='utf-8') as f:
                    task_config = json.load(f)
                    file_path_str = task_config.get('request_data', {}).get('file_path')
                    if file_path_str:
                        actual_file_path = Path(file_path_str)
                        if actual_file_path.exists():
                            logger.info(f"从 task_config.json 获取文件路径: {actual_file_path}")
            except Exception as e:
                logger.warning(f"无法从 task_config.json 读取文件路径: {e}")

        # 方法2: 从 dataset_id 获取
        if not actual_file_path or not actual_file_path.exists():
            if dataset_id:
                dataset = dataset_db.get_dataset(dataset_id)
                if dataset:
                    actual_file_path = Path(dataset['file_path'])
                    if actual_file_path.exists():
                        logger.info(f"从数据集数据库获取文件路径: {actual_file_path}")

        # 方法3: 从 file_id 获取
        if not actual_file_path or not actual_file_path.exists():
            if file_id:
                # 尝试从数据集数据库获取文件路径
                dataset = dataset_db.get_dataset(file_id)
                if dataset:
                    actual_file_path = Path(dataset['file_path'])
                    if actual_file_path.exists():
                        logger.info(f"从数据集数据库获取文件路径: {actual_file_path}")
                else:
                    # 尝试从上传目录获取文件
                    file_path = UPLOAD_DIR / file_id
                    if file_path.exists():
                        # 查找实际的CSV文件
                        csv_files = list(file_path.glob("*.csv"))
                        if csv_files:
                            actual_file_path = csv_files[0]
                            logger.info(f"从上传目录获取文件路径: {actual_file_path}")

        # 检查是否成功获取文件路径
        if not actual_file_path or not actual_file_path.exists():
            raise HTTPException(status_code=404, detail=f"无法找到任务 {task_id} 的数据文件")

        # 重置任务状态为运行中
        task_manager.update_task_status(
            task_id=task_id,
            status=TaskStatus.RUNNING,
            progress=0.0,
            message="开始增量预测..."
        )

        # 🔥 修复：使用 BackgroundTasks 启动增量预测（与 rerun_task 保持一致）
        background_tasks.add_task(
            prediction_service.run_prediction,
            task_id=task_id,
            file_path=str(actual_file_path),
            config=config
        )

        logger.info(f"Started background incremental prediction for task: {task_id}")

        return {
            "message": "增量预测任务已启动",
            "task_id": task_id,
            "original_task_id": task_id
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"增量预测任务失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"增量预测任务失败: {str(e)}")


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


@router.post("/batch-cancel")
async def batch_cancel_tasks(task_ids: list[str]):
    """
    批量取消任务

    参数:
    - task_ids: 任务ID列表

    返回:
    {
        "message": "批量取消完成",
        "total": 总任务数,
        "success": 成功数量,
        "failed": 失败数量,
        "results": [
            {"task_id": "...", "success": true/false, "message": "..."}
        ]
    }
    """
    try:
        results = []
        success_count = 0
        failed_count = 0

        for task_id in task_ids:
            try:
                task_info = task_manager.get_task(task_id)

                if not task_info:
                    results.append({
                        "task_id": task_id,
                        "success": False,
                        "message": "任务不存在"
                    })
                    failed_count += 1
                    continue

                # 只有运行中或等待中的任务可以取消
                if task_info.get("status") not in ["running", "pending"]:
                    results.append({
                        "task_id": task_id,
                        "success": False,
                        "message": f"任务状态为 {task_info.get('status')}，无法取消"
                    })
                    failed_count += 1
                    continue

                success = task_manager.cancel_task(task_id)

                if success:
                    results.append({
                        "task_id": task_id,
                        "success": True,
                        "message": "任务已取消"
                    })
                    success_count += 1
                else:
                    results.append({
                        "task_id": task_id,
                        "success": False,
                        "message": "取消任务失败"
                    })
                    failed_count += 1

            except Exception as e:
                logger.error(f"取消任务 {task_id} 失败: {e}", exc_info=True)
                results.append({
                    "task_id": task_id,
                    "success": False,
                    "message": str(e)
                })
                failed_count += 1

        return {
            "message": "批量取消完成",
            "total": len(task_ids),
            "success": success_count,
            "failed": failed_count,
            "results": results
        }

    except Exception as e:
        logger.error(f"批量取消任务失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"批量取消任务失败: {str(e)}")


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
