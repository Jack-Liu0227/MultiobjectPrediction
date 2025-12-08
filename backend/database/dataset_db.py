"""
数据集数据库管理器
提供数据集的 CRUD 操作
"""

from typing import Optional, Dict, Any, List
from datetime import datetime
from sqlalchemy.orm import Session
from sqlalchemy import desc, asc
import logging
import hashlib
from pathlib import Path

from .models import Dataset, SessionLocal, init_db, get_db_session

logger = logging.getLogger(__name__)


class DatasetDatabase:
    """数据集数据库管理器"""
    
    def __init__(self):
        """初始化数据库"""
        init_db()
        logger.info("Dataset database initialized")
    
    def create_dataset(self, dataset_data: Dict[str, Any]) -> str:
        """
        创建新数据集记录

        Args:
            dataset_data: 数据集数据字典

        Returns:
            dataset_id: 数据集ID
        """
        with get_db_session() as db:
            dataset = Dataset(
                dataset_id=dataset_data["dataset_id"],
                filename=dataset_data["filename"],
                original_filename=dataset_data["original_filename"],
                file_path=dataset_data["file_path"],
                row_count=dataset_data["row_count"],
                column_count=dataset_data["column_count"],
                columns=dataset_data["columns"],
                file_size=dataset_data["file_size"],
                file_hash=dataset_data.get("file_hash"),
                description=dataset_data.get("description"),
                tags=dataset_data.get("tags", []),
                uploaded_at=datetime.now()
            )

            db.add(dataset)
            db.flush()

            logger.info(f"Created dataset: {dataset.dataset_id}")
            return dataset.dataset_id
    
    def get_dataset(self, dataset_id: str) -> Optional[Dict[str, Any]]:
        """
        获取数据集信息

        Args:
            dataset_id: 数据集ID

        Returns:
            数据集信息字典，不存在返回 None
        """
        with get_db_session() as db:
            dataset = db.query(Dataset).filter(Dataset.dataset_id == dataset_id).first()
            if not dataset:
                return None

            return self._dataset_to_dict(dataset)
    
    def list_datasets(
        self,
        page: int = 1,
        page_size: int = 20,
        sort_by: str = "uploaded_at",
        sort_order: str = "desc"
    ) -> Dict[str, Any]:
        """
        列出数据集（支持分页）

        Args:
            page: 页码（从1开始）
            page_size: 每页数量
            sort_by: 排序字段
            sort_order: 排序顺序（asc/desc）

        Returns:
            {"datasets": [...], "total": 100}
        """
        with get_db_session() as db:
            # 构建查询
            query = db.query(Dataset)

            # 总数
            total = query.count()

            # 排序
            sort_column = getattr(Dataset, sort_by, Dataset.uploaded_at)
            if sort_order == "desc":
                query = query.order_by(desc(sort_column))
            else:
                query = query.order_by(asc(sort_column))

            # 分页
            offset = (page - 1) * page_size
            datasets = query.offset(offset).limit(page_size).all()

            return {
                "datasets": [self._dataset_to_dict(ds) for ds in datasets],
                "total": total
            }

    def update_dataset(self, dataset_id: str, updates: Dict[str, Any]) -> bool:
        """
        更新数据集信息

        Args:
            dataset_id: 数据集ID
            updates: 更新字段字典

        Returns:
            是否更新成功
        """
        with get_db_session() as db:
            dataset = db.query(Dataset).filter(Dataset.dataset_id == dataset_id).first()
            if not dataset:
                return False

            for key, value in updates.items():
                if hasattr(dataset, key):
                    setattr(dataset, key, value)

            logger.info(f"Updated dataset: {dataset_id}")
            return True

    def delete_dataset(self, dataset_id: str) -> bool:
        """
        删除数据集

        Args:
            dataset_id: 数据集ID

        Returns:
            是否删除成功
        """
        with get_db_session() as db:
            dataset = db.query(Dataset).filter(Dataset.dataset_id == dataset_id).first()
            if not dataset:
                return False

            db.delete(dataset)
            logger.info(f"Deleted dataset: {dataset_id}")
            return True

    def increment_usage(self, dataset_id: str):
        """增加数据集使用次数"""
        with get_db_session() as db:
            dataset = db.query(Dataset).filter(Dataset.dataset_id == dataset_id).first()
            if dataset:
                dataset.usage_count += 1
                dataset.last_used_at = datetime.now()

    def _dataset_to_dict(self, dataset: Dataset) -> Dict[str, Any]:
        """将 Dataset 对象转换为字典"""
        return {
            "dataset_id": dataset.dataset_id,
            "filename": dataset.filename,
            "original_filename": dataset.original_filename,
            "file_path": dataset.file_path,
            "row_count": dataset.row_count,
            "column_count": dataset.column_count,
            "columns": dataset.columns or [],
            "file_size": dataset.file_size,
            "file_hash": dataset.file_hash,
            "uploaded_at": dataset.uploaded_at.isoformat() if dataset.uploaded_at else None,
            "last_used_at": dataset.last_used_at.isoformat() if dataset.last_used_at else None,
            "description": dataset.description,
            "tags": dataset.tags or [],
            "usage_count": dataset.usage_count,
        }

