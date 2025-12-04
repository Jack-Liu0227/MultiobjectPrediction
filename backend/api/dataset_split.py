"""
数据集划分和导出 API
"""

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from typing import List, Optional
import pandas as pd
import logging
import io
from pathlib import Path

from services.file_handler import FileHandler
from database.dataset_db import DatasetDatabase

logger = logging.getLogger(__name__)
router = APIRouter()

file_handler = FileHandler()
dataset_db = DatasetDatabase()


class DatasetSplitRequest(BaseModel):
    """数据集划分请求"""
    file_id: Optional[str] = None
    dataset_id: Optional[str] = None
    train_ratio: float = Field(default=0.8, ge=0.1, le=0.9)
    random_seed: int = Field(default=42)


class DatasetSplitPreview(BaseModel):
    """数据集划分预览响应"""
    total_samples: int
    train_samples: int
    test_samples: int
    train_ratio: float
    train_preview: List[dict]  # 前5行训练集数据
    test_preview: List[dict]   # 前5行测试集数据


@router.post("/preview", response_model=DatasetSplitPreview)
async def preview_dataset_split(request: DatasetSplitRequest):
    """
    预览数据集划分结果
    
    返回训练集和测试集的统计信息及前几行数据
    """
    try:
        # 读取数据
        if request.dataset_id:
            dataset_info = dataset_db.get_dataset(request.dataset_id)
            if not dataset_info:
                raise HTTPException(status_code=404, detail="数据集不存在")
            file_path = Path(dataset_info['file_path'])
        elif request.file_id:
            # 从上传文件中读取
            from config import UPLOAD_DIR
            # 查找文件
            file_path = None
            for f in UPLOAD_DIR.glob(f"{request.file_id}_*"):
                file_path = f
                break
            if not file_path:
                raise HTTPException(status_code=404, detail="文件不存在")
        else:
            raise HTTPException(status_code=400, detail="必须提供 file_id 或 dataset_id")
        
        # 读取 CSV
        df = pd.read_csv(file_path)

        # 添加原始行号列（从1开始，不包括表头）
        df.insert(0, '_original_row_id', range(1, len(df) + 1))

        # 划分数据集
        from sklearn.model_selection import train_test_split
        train_df, test_df = train_test_split(
            df,
            train_size=request.train_ratio,
            random_state=request.random_seed,
            shuffle=True
        )
        
        # 准备预览数据
        train_preview = train_df.head(5).to_dict('records')
        test_preview = test_df.head(5).to_dict('records')
        
        return DatasetSplitPreview(
            total_samples=len(df),
            train_samples=len(train_df),
            test_samples=len(test_df),
            train_ratio=request.train_ratio,
            train_preview=train_preview,
            test_preview=test_preview
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"数据集划分预览失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"预览失败: {str(e)}")


@router.post("/export/train")
async def export_train_set(request: DatasetSplitRequest):
    """
    导出训练集为 CSV 文件
    """
    try:
        # 读取数据
        if request.dataset_id:
            dataset_info = dataset_db.get_dataset(request.dataset_id)
            if not dataset_info:
                raise HTTPException(status_code=404, detail="数据集不存在")
            file_path = Path(dataset_info['file_path'])
            original_filename = dataset_info['filename']
        elif request.file_id:
            from config import UPLOAD_DIR
            file_path = None
            for f in UPLOAD_DIR.glob(f"{request.file_id}_*"):
                file_path = f
                original_filename = f.name.split('_', 1)[1]
                break
            if not file_path:
                raise HTTPException(status_code=404, detail="文件不存在")
        else:
            raise HTTPException(status_code=400, detail="必须提供 file_id 或 dataset_id")
        
        # 读取并划分
        df = pd.read_csv(file_path)
        from sklearn.model_selection import train_test_split
        train_df, _ = train_test_split(
            df,
            train_size=request.train_ratio,
            random_state=request.random_seed,
            shuffle=True
        )
        
        # 转换为 CSV
        output = io.StringIO()
        train_df.to_csv(output, index=False)
        output.seek(0)
        
        # 生成文件名
        base_name = original_filename.rsplit('.', 1)[0]
        filename = f"{base_name}_train.csv"
        
        return StreamingResponse(
            io.BytesIO(output.getvalue().encode('utf-8')),
            media_type="text/csv",
            headers={"Content-Disposition": f"attachment; filename={filename}"}
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"导出训练集失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"导出失败: {str(e)}")


@router.post("/export/test")
async def export_test_set(request: DatasetSplitRequest):
    """
    导出测试集为 CSV 文件
    """
    try:
        # 读取数据
        if request.dataset_id:
            dataset_info = dataset_db.get_dataset(request.dataset_id)
            if not dataset_info:
                raise HTTPException(status_code=404, detail="数据集不存在")
            file_path = Path(dataset_info['file_path'])
            original_filename = dataset_info['filename']
        elif request.file_id:
            from config import UPLOAD_DIR
            file_path = None
            for f in UPLOAD_DIR.glob(f"{request.file_id}_*"):
                file_path = f
                original_filename = f.name.split('_', 1)[1]
                break
            if not file_path:
                raise HTTPException(status_code=404, detail="文件不存在")
        else:
            raise HTTPException(status_code=400, detail="必须提供 file_id 或 dataset_id")

        # 读取并划分
        df = pd.read_csv(file_path)
        from sklearn.model_selection import train_test_split
        _, test_df = train_test_split(
            df,
            train_size=request.train_ratio,
            random_state=request.random_seed,
            shuffle=True
        )

        # 转换为 CSV
        output = io.StringIO()
        test_df.to_csv(output, index=False)
        output.seek(0)

        # 生成文件名
        base_name = original_filename.rsplit('.', 1)[0]
        filename = f"{base_name}_test.csv"

        return StreamingResponse(
            io.BytesIO(output.getvalue().encode('utf-8')),
            media_type="text/csv",
            headers={"Content-Disposition": f"attachment; filename={filename}"}
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"导出测试集失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"导出失败: {str(e)}")

