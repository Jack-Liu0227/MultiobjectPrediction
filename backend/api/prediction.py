"""
预测API
"""

from fastapi import APIRouter, HTTPException, BackgroundTasks
import logging
from pathlib import Path

from models.schemas import (
    PredictionRequest,
    PredictionResponse,
    TaskStatus,
    TaskStatusResponse,
    RAGPreviewRequest,
    RAGPreviewResponse
)
from services.task_manager import get_task_manager
from services.rag_prediction_service import RAGPredictionService
from services.file_handler import FileHandler
from config import UPLOAD_DIR

logger = logging.getLogger(__name__)
router = APIRouter()

# 初始化服务
task_manager = get_task_manager()
prediction_service = RAGPredictionService(task_manager)
file_handler = FileHandler()


@router.post("/start", response_model=PredictionResponse)
async def start_prediction(request: PredictionRequest, background_tasks: BackgroundTasks):
    """
    启动预测任务

    请求体:
    {
        "file_id": "uuid",
        "config": {
            "composition_column": "composition",
            "processing_column": "Processing_Description",
            "target_columns": ["UTS(MPa)", "El(%)"],
            "train_ratio": 0.8,
            "max_retrieved_samples": 10,
            "similarity_threshold": 0.3,
            "model_provider": "gemini",
            "model_name": "gemini-2.5-flash",
            "temperature": 1.0
        }
    }

    响应:
    {
        "task_id": "uuid",
        "status": "pending",
        "message": "预测任务已启动"
    }
    """
    try:
        # 确定文件路径
        actual_file_path = None
        file_id_for_task = None

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
            logger.info(f"Using existing dataset: {request.dataset_id} ({dataset['original_filename']})")

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
            logger.info(f"Using uploaded file: {request.file_id}")
        else:
            raise HTTPException(status_code=400, detail="必须提供 file_id 或 dataset_id")

        logger.info(f"Starting prediction for file: {actual_file_path}")

        # 确定文件名
        filename = request.filename
        if not filename:
            if request.dataset_id:
                # 从数据集获取原始文件名
                from database.dataset_db import DatasetDatabase
                dataset_db = DatasetDatabase()
                dataset = dataset_db.get_dataset(request.dataset_id)
                filename = dataset.get('original_filename', actual_file_path.name) if dataset else actual_file_path.name
            else:
                # 使用文件路径的文件名
                filename = actual_file_path.name

        # 检查是否为增量预测（重新预测）
        if request.config.continue_from_task_id:
            # 增量预测：使用原任务ID，不创建新任务
            task_id = request.config.continue_from_task_id
            logger.info(f"增量预测模式：使用原任务ID {task_id}")

            # 处理备注更新（增量预测时追加备注）
            if request.task_note:
                from datetime import datetime
                # 获取现有任务信息
                existing_task = task_manager.get_task(task_id)
                existing_note = existing_task.get('note', '') if existing_task else ''

                # 生成时间戳
                timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

                # 追加新备注（带时间戳）
                if existing_note:
                    new_note = f"{existing_note}\n\n[{timestamp}] {request.task_note}"
                else:
                    new_note = f"[{timestamp}] {request.task_note}"

                # 更新任务备注
                task_manager.update_task(task_id, {'note': new_note})
                logger.info(f"增量预测：追加备注到任务 {task_id}")

            # 重置任务状态为运行中
            task_manager.update_task_status(
                task_id=task_id,
                status=TaskStatus.RUNNING,
                progress=0.0,
                message="重新开始预测..."
            )
        else:
            # 创建新任务
            # 构建任务数据，保留 dataset_id 或 file_id 信息
            task_data = {
                "file_path": str(actual_file_path),
                "filename": filename,
                "config": request.config.dict()
            }

            # 保存 dataset_id 或 file_id（优先保存 dataset_id）
            if request.dataset_id:
                task_data["dataset_id"] = request.dataset_id
                task_data["file_id"] = request.dataset_id  # 兼容性：也保存为 file_id
            else:
                task_data["file_id"] = file_id_for_task

            # 保存任务备注（如果提供）
            if request.task_note:
                task_data["note"] = request.task_note

            task_id = task_manager.create_task(task_data)
            logger.info(f"Created task: {task_id}")

        # 在后台执行预测
        background_tasks.add_task(
            prediction_service.run_prediction,
            task_id=task_id,
            file_path=str(actual_file_path),
            config=request.config
        )

        return PredictionResponse(
            task_id=task_id,
            status=TaskStatus.PENDING,
            message="预测任务已启动"
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"启动预测失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"启动预测失败: {str(e)}")


@router.get("/status/{task_id}", response_model=TaskStatusResponse)
async def get_task_status(task_id: str):
    """
    查询任务状态

    响应:
    {
        "task_id": "uuid",
        "status": "running" | "completed" | "failed",
        "progress": 0.75,
        "message": "正在预测目标 2/3: El(%)",
        "result_id": "uuid",  // 完成时返回
        "error": null  // 失败时返回错误信息
    }
    """
    try:
        task_info = task_manager.get_task_status(task_id)

        if not task_info:
            raise HTTPException(status_code=404, detail=f"任务不存在: {task_id}")

        return TaskStatusResponse(
            task_id=task_info["task_id"],
            status=TaskStatus(task_info["status"]),
            progress=task_info["progress"],
            message=task_info["message"],
            result_id=task_info.get("result_id"),
            error=task_info.get("error")
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"查询任务状态失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"查询任务状态失败: {str(e)}")


@router.post("/preview-rag", response_model=RAGPreviewResponse)
async def preview_rag_retrieval(request: RAGPreviewRequest):
    """
    预览 RAG 检索结果（不执行 LLM 预测）

    用于在正式预测前查看 RAG 检索效果，帮助用户调整参数
    """
    try:
        logger.info(f"RAG 预览请求: dataset_id={request.dataset_id}, file_id={request.file_id}")

        # 1. 获取文件路径
        if request.dataset_id:
            # 从数据库查询数据集
            from database.dataset_db import DatasetDatabase
            dataset_db = DatasetDatabase()
            dataset_info = dataset_db.get_dataset(request.dataset_id)
            if not dataset_info:
                raise HTTPException(status_code=404, detail=f"数据集不存在: {request.dataset_id}")
            file_path = Path(dataset_info['file_path'])
        elif request.file_id:
            # 使用上传的文件
            file_path = UPLOAD_DIR / request.file_id
            if not file_path.exists():
                raise HTTPException(status_code=404, detail=f"文件不存在: {request.file_id}")
            csv_files = list(file_path.glob("*.csv"))
            if not csv_files:
                raise HTTPException(status_code=404, detail=f"未找到CSV文件: {request.file_id}")
            file_path = csv_files[0]
        else:
            raise HTTPException(status_code=400, detail="必须提供 dataset_id 或 file_id")

        logger.info(f"使用文件: {file_path}")

        # 2. 读取数据并划分训练/测试集
        import pandas as pd
        from sklearn.model_selection import train_test_split

        df = pd.read_csv(file_path)

        # 添加原始行号列（从1开始，不包括表头）
        df.insert(0, '_original_row_id', range(1, len(df) + 1))

        # 处理 composition_column：可能是单个列名或列名列表
        if isinstance(request.composition_column, str):
            composition_columns = [request.composition_column]
        else:
            composition_columns = request.composition_column

        # 验证列存在
        required_cols = composition_columns + [request.processing_column] + request.target_columns
        missing_cols = [col for col in required_cols if col not in df.columns]
        if missing_cols:
            raise HTTPException(status_code=400, detail=f"缺少必需的列: {missing_cols}")

        # 清洗数据
        df_clean = df.dropna(subset=request.target_columns)

        # 划分训练/测试集（使用用户指定的比例和随机种子）
        train_df, test_df = train_test_split(
            df_clean,
            train_size=request.train_ratio,
            random_state=request.random_seed,
            shuffle=True
        )

        logger.info(f"数据划分: 训练集 {len(train_df)} 行, 测试集 {len(test_df)} 行")

        # 验证测试样本索引
        if request.test_sample_index >= len(test_df):
            raise HTTPException(
                status_code=400,
                detail=f"测试样本索引 {request.test_sample_index} 超出范围（测试集共 {len(test_df)} 个样本）"
            )

        # 辅助函数：格式化组分信息
        def format_composition(row, comp_cols):
            """
            格式化组分信息

            Returns:
                (unit_type, composition_str) - 例如 ("at%", "Fe 26.3, Ni 26.3, ...")
            """
            # 判断单位类型
            unit_type = ""
            if any('wt%' in col.lower() for col in comp_cols):
                unit_type = "wt%"
            elif any('at%' in col.lower() for col in comp_cols):
                unit_type = "at%"

            # 格式化组分
            comp_parts = []
            for col in comp_cols:
                value = row[col]
                element = col.split('(')[0].strip()
                if value > 0:
                    comp_parts.append(f"{element} {value}")

            composition_str = ", ".join(comp_parts)
            return unit_type, composition_str

        # 3. 初始化 RAG 引擎
        from services.simple_rag_engine import SimpleRAGEngine

        rag_engine = SimpleRAGEngine(
            max_retrieved_samples=request.max_retrieved_samples,
            similarity_threshold=request.similarity_threshold
        )

        # 4. 创建训练集嵌入
        train_texts = []
        for _, row in train_df.iterrows():
            unit_type, composition_str = format_composition(row, composition_columns)
            if unit_type:
                text = f"Composition ({unit_type}): {composition_str}\nProcessing: {row[request.processing_column]}"
            else:
                text = f"Composition: {composition_str}\nProcessing: {row[request.processing_column]}"
            train_texts.append(text)

        train_embeddings = rag_engine.create_embeddings(train_texts)

        logger.info(f"创建嵌入: {train_embeddings.shape}")

        # 5. 对指定的测试样本执行 RAG 检索
        test_row = test_df.iloc[request.test_sample_index]

        # 构建查询文本（格式化组分）
        unit_type, test_composition_str = format_composition(test_row, composition_columns)
        if unit_type:
            query_text = f"Composition ({unit_type}): {test_composition_str}\nProcessing: {test_row[request.processing_column]}"
        else:
            query_text = f"Composition: {test_composition_str}\nProcessing: {test_row[request.processing_column]}"

        # 检索相似样本
        similar_indices = rag_engine.retrieve_similar_samples(
            query_text=query_text,
            train_texts=train_texts,
            train_embeddings=train_embeddings
        )

        # 计算相似度分数
        query_embedding = rag_engine.create_embeddings([query_text])[0]
        import numpy as np
        similarities = np.dot(train_embeddings, query_embedding) / (
            np.linalg.norm(train_embeddings, axis=1) * np.linalg.norm(query_embedding)
        )

        # 准备相似样本数据（包含完整行数据）
        similar_samples = []
        for sim_idx in similar_indices:
            # 获取完整行数据并转换为字典
            row_data = train_df.iloc[sim_idx].to_dict()
            # 转换所有值为可序列化的类型
            sample_data = {}
            for key, value in row_data.items():
                if pd.isna(value):
                    sample_data[key] = None
                elif isinstance(value, (int, float, str, bool)):
                    sample_data[key] = value
                else:
                    sample_data[key] = str(value)

            # 添加相似度分数
            sample_data['similarity_score'] = float(similarities[sim_idx])
            similar_samples.append(sample_data)

        # 准备测试样本数据（包含完整行数据）
        test_sample_data = test_row.to_dict()
        # 转换所有值为可序列化的类型
        test_sample_serializable = {}
        for key, value in test_sample_data.items():
            if pd.isna(value):
                test_sample_serializable[key] = None
            elif isinstance(value, (int, float, str, bool)):
                test_sample_serializable[key] = value
            else:
                test_sample_serializable[key] = str(value)

        logger.info(f"RAG 预览完成: 测试样本索引 {request.test_sample_index}, 检索到 {len(similar_samples)} 个相似样本")

        return RAGPreviewResponse(
            train_count=len(train_df),
            test_count=len(test_df),
            test_sample_index=request.test_sample_index,
            test_sample=test_sample_serializable,
            retrieved_samples=similar_samples
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"RAG 预览失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"RAG 预览失败: {str(e)}")

