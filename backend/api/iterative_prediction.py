"""
迭代预测API
"""

from fastapi import APIRouter, HTTPException, BackgroundTasks
import logging
from pathlib import Path
import pandas as pd
import numpy as np

from models.schemas import PredictionRequest, PredictionResponse, TaskStatus
from services.task_manager import get_task_manager
from services.iterative_prediction_service import IterativePredictionService
from services.simple_rag_engine import SimpleRAGEngine
from database.task_db import TaskDatabase
from config import UPLOAD_DIR

logger = logging.getLogger(__name__)
router = APIRouter()

# 初始化服务
task_manager = get_task_manager()
task_db = TaskDatabase()


@router.post("/start", response_model=PredictionResponse)
async def start_iterative_prediction(request: PredictionRequest, background_tasks: BackgroundTasks):
    """
    启动迭代预测任务
    
    请求体:
    {
        "file_id": "uuid" 或 "dataset_id": "uuid",
        "config": {
            "composition_column": "composition",
            "processing_column": ["Processing_Description"],
            "target_columns": ["UTS(MPa)", "El(%)"],
            "train_ratio": 0.8,
            "max_retrieved_samples": 10,
            "similarity_threshold": 0.3,
            "model_provider": "gemini",
            "model_name": "gemini-2.5-flash",
            "temperature": 1.0,
            "enable_iteration": true,
            "max_iterations": 5,
            "convergence_threshold": 0.01,
            "early_stop": true,
            "max_workers": 5
        }
    }
    
    响应:
    {
        "task_id": "uuid",
        "status": "pending",
        "message": "迭代预测任务已启动"
    }
    """
    try:
        # 验证迭代预测配置
        if not request.config.enable_iteration:
            raise HTTPException(
                status_code=400,
                detail="迭代预测未启用，请设置 enable_iteration=true"
            )
        
        # 确定文件路径
        actual_file_path = None
        file_id_for_task = None
        
        # 初始化变量
        original_filename = None

        if request.dataset_id:
            # 使用已有数据集
            from database.dataset_db import DatasetDatabase
            dataset_db = DatasetDatabase()
            dataset = dataset_db.get_dataset(request.dataset_id)

            if not dataset:
                raise HTTPException(status_code=404, detail=f"数据集不存在: {request.dataset_id}")

            actual_file_path = Path(dataset['file_path'])
            if not actual_file_path.exists():
                raise HTTPException(status_code=404, detail=f"数据集文件不存在: {dataset['file_path']}")

            file_id_for_task = request.dataset_id
            original_filename = dataset['original_filename']  # 使用原始文件名
            logger.info(f"Using existing dataset: {request.dataset_id} ({original_filename})")

            # 增加使用次数
            dataset_db.increment_usage(request.dataset_id)

        elif request.file_id:
            # 使用直接上传的文件
            file_path = UPLOAD_DIR / request.file_id
            if not file_path.exists():
                raise HTTPException(status_code=404, detail=f"文件不存在: {request.file_id}")

            # 查找实际的CSV文件
            csv_files = list(file_path.glob("*.csv"))
            if not csv_files:
                raise HTTPException(status_code=404, detail=f"未找到CSV文件: {request.file_id}")

            actual_file_path = csv_files[0]
            file_id_for_task = request.file_id

            # 从文件名中提取原始文件名（格式：uuid_originalname.csv）
            filename_parts = actual_file_path.name.split('_', 1)
            if len(filename_parts) > 1:
                original_filename = filename_parts[1]  # 获取原始文件名部分
            else:
                original_filename = actual_file_path.name  # 如果没有下划线，使用完整文件名

            logger.info(f"Using uploaded file: {request.file_id} ({original_filename})")
        else:
            raise HTTPException(status_code=400, detail="必须提供 file_id 或 dataset_id")

        # 创建任务
        task_data = {
            "file_id": file_id_for_task,
            "filename": original_filename or actual_file_path.name,  # 使用原始文件名
            "config": request.config.dict(),
            "note": request.task_note or ""
        }
        
        task_id = task_manager.create_task(task_data)
        
        # 在后台执行迭代预测
        background_tasks.add_task(
            _run_iterative_prediction_task,
            task_id,
            actual_file_path,
            request.config
        )
        
        logger.info(f"Iterative prediction task created: {task_id}")
        
        return PredictionResponse(
            task_id=task_id,
            status=TaskStatus.PENDING,
            message="迭代预测任务已启动"
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to start iterative prediction: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"启动迭代预测失败: {str(e)}")


def _run_iterative_prediction_task(task_id: str, file_path: Path, config):
    """
    后台执行迭代预测任务

    Args:
        task_id: 任务ID
        file_path: 数据文件路径
        config: 预测配置
    """
    try:
        # 初始化 RAG 引擎
        rag_engine = SimpleRAGEngine(
            max_retrieved_samples=config.max_retrieved_samples,
            similarity_threshold=config.similarity_threshold
        )

        # 初始化迭代预测服务
        iterative_service = IterativePredictionService(
            task_manager=task_manager,
            task_db=task_db,
            rag_engine=rag_engine
        )

        # 执行任务
        iterative_service.run_task(
            task_id=task_id,
            file_path=file_path,
            config=config
        )

    except Exception as e:
        logger.error(f"Task {task_id}: Iterative prediction task wrapper failed: {e}", exc_info=True)
        
        # 更新任务状态为失败
        task_manager.update_task(
            task_id,
            {
                "status": "failed",
                "error": str(e)
            }
        )

