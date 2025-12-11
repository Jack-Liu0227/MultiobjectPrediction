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
        logger.info(f"Task {task_id}: Starting iterative prediction")

        # 更新任务状态
        task_manager.update_task(
            task_id,
            {
                "status": "running",
                "progress": 0.0,
                "message": "正在加载数据..."
            }
        )

        # 1. 加载数据
        df = pd.read_csv(file_path)
        logger.info(f"Task {task_id}: Loaded {len(df)} samples")

        # 2. 识别组分列
        composition_columns = []
        for col in df.columns:
            if any(unit in col.lower() for unit in ['wt%', 'at%']):
                composition_columns.append(col)

        if not composition_columns:
            raise ValueError("未找到组分列（应包含 wt% 或 at%）")

        logger.info(f"Task {task_id}: Found {len(composition_columns)} composition columns")

        # 3. 数据集划分
        from sklearn.model_selection import train_test_split

        train_df, test_df = train_test_split(
            df,
            train_size=config.train_ratio,
            random_state=config.random_seed or 42
        )

        logger.info(
            f"Task {task_id}: Split data into {len(train_df)} train and {len(test_df)} test samples"
        )

        # 4. 构建样本文本和嵌入
        from services.sample_text_builder import SampleTextBuilder

        def format_composition(row, comp_cols):
            """格式化组分"""
            comp_parts = []
            for col in comp_cols:
                value = row[col]
                element = col.split('(')[0].strip()
                if value > 0:
                    comp_parts.append(f"{element} {value}")
            return ", ".join(comp_parts)

        # 构建训练样本文本
        train_texts = []
        train_data = []

        for idx, row in train_df.iterrows():
            composition_str = format_composition(row, composition_columns)

            # 提取工艺列
            processing_dict = {}
            if config.processing_column:
                for proc_col in config.processing_column:
                    if proc_col in row.index and pd.notna(row[proc_col]):
                        processing_dict[proc_col] = row[proc_col]

            # 提取特征列
            feature_dict = {}
            if config.feature_columns:
                for feat_col in config.feature_columns:
                    if feat_col in row.index and pd.notna(row[feat_col]):
                        feature_dict[feat_col] = row[feat_col]

            # 构建样本文本
            sample_text = SampleTextBuilder.build_sample_text(
                composition=composition_str,
                processing_columns=processing_dict if processing_dict else None,
                feature_columns=feature_dict if feature_dict else None
            )

            train_texts.append(sample_text)

            # 保存样本数据
            sample_data = {
                "composition": composition_str,
                "sample_text": sample_text
            }

            # 添加工艺列
            if processing_dict:
                sample_data.update(processing_dict)

            # 添加特征列
            if feature_dict:
                sample_data.update(feature_dict)

            # 添加目标属性
            for target_col in config.target_columns:
                if target_col in row.index and pd.notna(row[target_col]):
                    sample_data[target_col] = float(row[target_col])

            train_data.append(sample_data)

        # 构建测试样本数据
        test_data = []
        for idx, row in test_df.iterrows():
            composition_str = format_composition(row, composition_columns)

            # 提取工艺列
            processing_dict = {}
            if config.processing_column:
                for proc_col in config.processing_column:
                    if proc_col in row.index and pd.notna(row[proc_col]):
                        processing_dict[proc_col] = row[proc_col]

            # 提取特征列
            feature_dict = {}
            if config.feature_columns:
                for feat_col in config.feature_columns:
                    if feat_col in row.index and pd.notna(row[feat_col]):
                        feature_dict[feat_col] = row[feat_col]

            # 保存样本数据
            sample_data = {
                "composition": composition_str
            }

            # 添加工艺列
            if processing_dict:
                sample_data.update(processing_dict)

            # 添加特征列
            if feature_dict:
                sample_data.update(feature_dict)

            test_data.append(sample_data)

        # 5. 生成嵌入
        rag_engine = SimpleRAGEngine(
            max_retrieved_samples=config.max_retrieved_samples,
            similarity_threshold=config.similarity_threshold
        )

        train_embeddings = rag_engine.create_embeddings(train_texts)

        logger.info(f"Task {task_id}: Generated embeddings for {len(train_texts)} training samples")

        # 6. 运行迭代预测
        iterative_service = IterativePredictionService(
            task_manager=task_manager,
            task_db=task_db,
            rag_engine=rag_engine
        )

        result = iterative_service.run_iterative_prediction(
            task_id=task_id,
            config=config,
            train_data=train_data,
            test_data=test_data,
            train_embeddings=train_embeddings
        )

        if result["success"]:
            # 更新任务状态为完成
            task_manager.update_task(
                task_id,
                {
                    "status": "completed",
                    "progress": 1.0,
                    "message": f"迭代预测完成，共{result['total_iterations']}轮，"
                               f"收敛{result['converged_samples']}个样本，"
                               f"失败{result['failed_samples']}个样本"
                }
            )

            logger.info(f"Task {task_id}: Iterative prediction completed successfully")
        else:
            # 更新任务状态为失败
            task_manager.update_task(
                task_id,
                {
                    "status": "failed",
                    "error": result.get("error", "未知错误")
                }
            )

            logger.error(f"Task {task_id}: Iterative prediction failed: {result.get('error')}")

    except Exception as e:
        logger.error(f"Task {task_id}: Iterative prediction failed: {e}", exc_info=True)

        # 更新任务状态为失败
        task_manager.update_task(
            task_id,
            {
                "status": "failed",
                "error": str(e)
            }
        )

