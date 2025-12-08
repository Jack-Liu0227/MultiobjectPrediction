"""
数据集管理 API 路由
"""

from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from typing import Optional, List
from pydantic import BaseModel
import uuid
import shutil
from pathlib import Path
import pandas as pd
import hashlib
import logging

from database.dataset_db import DatasetDatabase

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/datasets", tags=["datasets"])

# 数据集存储目录
UPLOAD_DIR = Path("data/uploads")
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

# 数据库管理器
dataset_db = DatasetDatabase()


class DatasetUpdateRequest(BaseModel):
    """数据集更新请求"""
    filename: Optional[str] = None
    description: Optional[str] = None
    tags: Optional[List[str]] = None


class DatasetResponse(BaseModel):
    """数据集响应"""
    dataset_id: str
    filename: str
    original_filename: str
    row_count: int
    column_count: int
    columns: List[str]
    file_size: int
    uploaded_at: str
    last_used_at: Optional[str]
    description: Optional[str]
    tags: List[str]
    usage_count: int


@router.post("/upload", response_model=DatasetResponse)
async def upload_dataset(
    file: UploadFile = File(...),
    description: Optional[str] = Form(None),
    tags: Optional[str] = Form(None)
):
    """
    上传数据集文件
    
    Args:
        file: CSV 文件
        description: 数据集描述
        tags: 标签（逗号分隔）
    """
    try:
        # 验证文件类型
        if not file.filename.endswith('.csv'):
            raise HTTPException(status_code=400, detail="仅支持 CSV 文件")
        
        # 生成唯一 ID
        dataset_id = str(uuid.uuid4())
        
        # 保存文件（流式处理，避免大文件内存占用）
        file_path = UPLOAD_DIR / f"{dataset_id}.csv"

        # 使用 aiofiles 异步流式写入
        import aiofiles
        chunk_size = 1024 * 1024  # 1MB chunks

        async with aiofiles.open(file_path, "wb") as buffer:
            while chunk := await file.read(chunk_size):
                await buffer.write(chunk)

        # 读取文件信息
        df = pd.read_csv(file_path)
        file_size = file_path.stat().st_size

        # 计算文件哈希（流式处理）
        import hashlib
        hash_md5 = hashlib.md5()
        async with aiofiles.open(file_path, "rb") as f:
            while chunk := await f.read(chunk_size):
                hash_md5.update(chunk)
        file_hash = hash_md5.hexdigest()
        
        # 解析标签
        tag_list = [t.strip() for t in tags.split(",")] if tags else []
        
        # 保存到数据库
        dataset_data = {
            "dataset_id": dataset_id,
            "filename": f"{dataset_id}.csv",
            "original_filename": file.filename,
            "file_path": str(file_path),
            "row_count": len(df),
            "column_count": len(df.columns),
            "columns": df.columns.tolist(),
            "file_size": file_size,
            "file_hash": file_hash,
            "description": description,
            "tags": tag_list,
        }
        
        dataset_db.create_dataset(dataset_data)
        
        logger.info(f"Uploaded dataset: {dataset_id} ({file.filename})")
        
        # 返回数据集信息
        dataset_info = dataset_db.get_dataset(dataset_id)
        return DatasetResponse(**dataset_info)
        
    except Exception as e:
        logger.error(f"Failed to upload dataset: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"上传失败: {str(e)}")


@router.get("/list")
async def list_datasets(
    page: int = 1,
    page_size: int = 20,
    sort_by: str = "uploaded_at",
    sort_order: str = "desc"
):
    """
    列出所有数据集
    
    Args:
        page: 页码
        page_size: 每页数量
        sort_by: 排序字段
        sort_order: 排序顺序
    """
    try:
        result = dataset_db.list_datasets(
            page=page,
            page_size=page_size,
            sort_by=sort_by,
            sort_order=sort_order
        )
        return result
    except Exception as e:
        logger.error(f"Failed to list datasets: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"查询失败: {str(e)}")


@router.get("/{dataset_id}", response_model=DatasetResponse)
async def get_dataset(dataset_id: str):
    """获取数据集详情"""
    dataset = dataset_db.get_dataset(dataset_id)
    if not dataset:
        raise HTTPException(status_code=404, detail="数据集不存在")
    return DatasetResponse(**dataset)


@router.put("/{dataset_id}", response_model=DatasetResponse)
async def update_dataset(dataset_id: str, request: DatasetUpdateRequest):
    """
    更新数据集信息

    Args:
        dataset_id: 数据集ID
        request: 更新请求
    """
    try:
        # 检查数据集是否存在
        dataset = dataset_db.get_dataset(dataset_id)
        if not dataset:
            raise HTTPException(status_code=404, detail="数据集不存在")

        # 构建更新字典
        updates = {}
        if request.filename is not None:
            updates["filename"] = request.filename
        if request.description is not None:
            updates["description"] = request.description
        if request.tags is not None:
            updates["tags"] = request.tags

        # 更新数据库
        if updates:
            dataset_db.update_dataset(dataset_id, updates)

        # 返回更新后的数据集信息
        updated_dataset = dataset_db.get_dataset(dataset_id)
        return DatasetResponse(**updated_dataset)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to update dataset {dataset_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"更新失败: {str(e)}")


@router.delete("/{dataset_id}")
async def delete_dataset(dataset_id: str):
    """
    删除数据集

    Args:
        dataset_id: 数据集ID
    """
    try:
        # 检查数据集是否存在
        dataset = dataset_db.get_dataset(dataset_id)
        if not dataset:
            raise HTTPException(status_code=404, detail="数据集不存在")

        # 删除文件
        file_path = Path(dataset["file_path"])
        if file_path.exists():
            file_path.unlink()

        # 从数据库删除
        dataset_db.delete_dataset(dataset_id)

        logger.info(f"Deleted dataset: {dataset_id}")
        return {"message": "数据集已删除", "dataset_id": dataset_id}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to delete dataset {dataset_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"删除失败: {str(e)}")


@router.post("/{dataset_id}/use")
async def use_dataset(dataset_id: str):
    """
    标记数据集被使用（增加使用次数）

    Args:
        dataset_id: 数据集ID
    """
    try:
        dataset = dataset_db.get_dataset(dataset_id)
        if not dataset:
            raise HTTPException(status_code=404, detail="数据集不存在")

        dataset_db.increment_usage(dataset_id)
        return {"message": "使用次数已更新", "dataset_id": dataset_id}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to mark dataset usage {dataset_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"操作失败: {str(e)}")

