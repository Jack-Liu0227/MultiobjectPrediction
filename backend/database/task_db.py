"""
任务数据库管理器
提供任务的 CRUD 操作
"""

from typing import Optional, Dict, Any, List
from datetime import datetime
from sqlalchemy.orm import Session
from sqlalchemy import desc, asc
import logging
import json

from database.models import Task, SessionLocal, init_db

logger = logging.getLogger(__name__)


class TaskDatabase:
    """任务数据库管理器"""
    
    def __init__(self):
        """初始化数据库"""
        init_db()
        logger.info("Task database initialized")
    
    def create_task(self, task_data: Dict[str, Any]) -> str:
        """
        创建新任务
        
        Args:
            task_data: 任务数据字典
            
        Returns:
            task_id: 任务ID
        """
        db = SessionLocal()
        try:
            # 提取配置信息
            config = task_data.get("config", {})
            
            task = Task(
                task_id=task_data["task_id"],
                status=task_data["status"],
                progress=task_data.get("progress", 0.0),
                message=task_data.get("message", ""),
                file_id=task_data["file_id"],
                filename=task_data["filename"],
                composition_column=config.get("composition_column"),
                processing_column=config.get("processing_column"),
                target_columns=config.get("target_columns", []),
                model_provider=config.get("model_provider"),
                model_name=config.get("model_name"),
                temperature=config.get("temperature"),
                sample_size=config.get("sample_size"),
                train_ratio=config.get("train_ratio"),
                max_retrieved_samples=config.get("max_retrieved_samples"),
                similarity_threshold=config.get("similarity_threshold"),
                note=task_data.get("note"),
                config_json=config,
                created_at=datetime.now()
            )
            
            db.add(task)
            db.commit()
            db.refresh(task)
            
            logger.info(f"Created task: {task.task_id}")
            return task.task_id
            
        except Exception as e:
            db.rollback()
            logger.error(f"Failed to create task: {e}", exc_info=True)
            raise
        finally:
            db.close()
    
    def update_task(self, task_id: str, updates: Dict[str, Any]) -> bool:
        """
        更新任务信息
        
        Args:
            task_id: 任务ID
            updates: 更新字段字典
            
        Returns:
            是否更新成功
        """
        db = SessionLocal()
        try:
            task = db.query(Task).filter(Task.task_id == task_id).first()
            if not task:
                logger.warning(f"Task not found: {task_id}")
                return False
            
            # 更新字段
            for key, value in updates.items():
                if hasattr(task, key):
                    setattr(task, key, value)
            
            # 更新时间戳
            task.updated_at = datetime.now()
            
            # 根据状态更新时间戳
            if updates.get("status") == "running" and not task.started_at:
                task.started_at = datetime.now()
            elif updates.get("status") in ["completed", "failed"]:
                task.completed_at = datetime.now()
            
            db.commit()
            logger.info(f"Updated task: {task_id}")
            return True
            
        except Exception as e:
            db.rollback()
            logger.error(f"Failed to update task {task_id}: {e}", exc_info=True)
            raise
        finally:
            db.close()
    
    def get_task(self, task_id: str) -> Optional[Dict[str, Any]]:
        """
        获取任务信息
        
        Args:
            task_id: 任务ID
            
        Returns:
            任务信息字典，不存在返回 None
        """
        db = SessionLocal()
        try:
            task = db.query(Task).filter(Task.task_id == task_id).first()
            if not task:
                return None
            
            return self._task_to_dict(task)
            
        finally:
            db.close()
    
    def _safe_json_field(self, value: Any, default: Any = None) -> Any:
        """
        安全地处理 JSON 字段
        处理旧数据中可能存在的字符串格式或无效 JSON
        """
        if value is None:
            return default

        # 如果已经是 list 或 dict，直接返回
        if isinstance(value, (list, dict)):
            return value

        # 如果是字符串，尝试解析为 JSON
        if isinstance(value, str):
            # 空字符串返回默认值
            if not value.strip():
                return default

            try:
                # 尝试解析 JSON
                parsed = json.loads(value)
                return parsed
            except json.JSONDecodeError:
                # 解析失败，可能是旧格式的单个字符串值
                # 将其转换为数组格式
                logger.warning(f"Failed to parse JSON field, converting string to array: {value[:50]}")
                return [value] if default is None or isinstance(default, list) else value

        return value

    def _task_to_dict(self, task: Task) -> Dict[str, Any]:
        """将 Task 对象转换为字典（安全处理 JSON 字段）"""
        try:
            # 安全处理 composition_column（可能是字符串或数组）
            composition_column = self._safe_json_field(task.composition_column, default=[])

            # 安全处理 target_columns（应该是数组）
            target_columns = self._safe_json_field(task.target_columns, default=[])

            # 安全处理 process_details（应该是对象或数组）
            process_details = self._safe_json_field(task.process_details, default=None)

            return {
                "task_id": task.task_id,
                "status": task.status,
                "progress": task.progress,
                "message": task.message,
                "filename": task.filename,
                "composition_column": composition_column,
                "processing_column": task.processing_column,
                "target_columns": target_columns,
                "created_at": task.created_at.isoformat() if task.created_at else None,
                "started_at": task.started_at.isoformat() if task.started_at else None,
                "completed_at": task.completed_at.isoformat() if task.completed_at else None,
                "result_id": task.result_id,
                "error": task.error,
                "model_provider": task.model_provider,
                "model_name": task.model_name,
                "train_ratio": task.train_ratio,
                "max_retrieved_samples": task.max_retrieved_samples,
                "note": task.note,
                "process_details": process_details,
            }
        except Exception as e:
            logger.error(f"Error converting task {task.task_id} to dict: {e}")
            # 返回基本信息，避免整个列表查询失败
            return {
                "task_id": task.task_id,
                "status": task.status,
                "progress": task.progress,
                "message": task.message,
                "filename": task.filename,
                "composition_column": [],
                "processing_column": task.processing_column,
                "target_columns": [],
                "created_at": task.created_at.isoformat() if task.created_at else None,
                "started_at": task.started_at.isoformat() if task.started_at else None,
                "completed_at": task.completed_at.isoformat() if task.completed_at else None,
                "result_id": task.result_id,
                "error": task.error or f"数据格式错误: {str(e)}",
                "model_provider": task.model_provider,
                "model_name": task.model_name,
                "train_ratio": task.train_ratio,
                "max_retrieved_samples": task.max_retrieved_samples,
                "note": task.note,
                "process_details": None,
            }

    def list_tasks(
        self,
        page: int = 1,
        page_size: int = 20,
        status_filter: Optional[str] = None,
        sort_by: str = "created_at",
        sort_order: str = "desc"
    ) -> Dict[str, Any]:
        """
        列出任务（支持分页和筛选）

        Args:
            page: 页码（从1开始）
            page_size: 每页数量
            status_filter: 状态筛选
            sort_by: 排序字段
            sort_order: 排序顺序（asc/desc）

        Returns:
            {"tasks": [...], "total": 100}
        """
        db = SessionLocal()
        try:
            # 构建查询
            query = db.query(Task)

            # 状态筛选
            if status_filter:
                query = query.filter(Task.status == status_filter)

            # 总数
            total = query.count()

            # 排序
            sort_column = getattr(Task, sort_by, Task.created_at)
            if sort_order == "desc":
                query = query.order_by(desc(sort_column))
            else:
                query = query.order_by(asc(sort_column))

            # 分页
            offset = (page - 1) * page_size
            tasks = query.offset(offset).limit(page_size).all()

            return {
                "tasks": [self._task_to_dict(task) for task in tasks],
                "total": total
            }

        finally:
            db.close()

    def delete_task(self, task_id: str) -> bool:
        """
        删除任务

        Args:
            task_id: 任务ID

        Returns:
            是否删除成功
        """
        db = SessionLocal()
        try:
            task = db.query(Task).filter(Task.task_id == task_id).first()
            if not task:
                logger.warning(f"Task not found: {task_id}")
                return False

            db.delete(task)
            db.commit()
            logger.info(f"Deleted task: {task_id}")
            return True

        except Exception as e:
            db.rollback()
            logger.error(f"Failed to delete task {task_id}: {e}", exc_info=True)
            raise
        finally:
            db.close()

    def get_task_count_by_status(self) -> Dict[str, int]:
        """
        获取各状态的任务数量

        Returns:
            {"pending": 5, "running": 2, "completed": 100, "failed": 3}
        """
        db = SessionLocal()
        try:
            from sqlalchemy import func

            result = db.query(
                Task.status,
                func.count(Task.task_id)
            ).group_by(Task.status).all()

            return {status: count for status, count in result}

        finally:
            db.close()

