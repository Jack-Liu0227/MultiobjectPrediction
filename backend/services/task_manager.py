"""
任务管理器 - 管理异步预测任务的状态和结果
"""

import uuid
import json
import os
from datetime import datetime
from typing import Dict, Optional, Any, List
from pathlib import Path
import threading
import logging
import shutil

from models.schemas import TaskStatus
from database.task_db import TaskDatabase
from config import TASKS_DIR

logger = logging.getLogger(__name__)


class TaskManager:
    """
    管理预测任务的生命周期、状态和结果
    使用 SQLite 数据库存储任务信息
    """

    def __init__(self, storage_dir: Path = None):
        """
        初始化任务管理器

        Args:
            storage_dir: 任务信息存储目录（用于兼容性，实际使用数据库）
        """
        # 使用配置文件中的路径，如果未提供则使用默认值
        self.storage_dir = storage_dir if storage_dir is not None else TASKS_DIR
        self.storage_dir.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()

        # 初始化数据库
        self.db = TaskDatabase()
        logger.info(f"TaskManager initialized with SQLite database, storage_dir: {self.storage_dir}")
    
    def create_task(self, request_data: Dict[str, Any]) -> str:
        """
        创建新任务

        Args:
            request_data: 请求数据（包含 file_id, filename, config, note, total_rows, valid_rows）

        Returns:
            task_id: 任务唯一标识符
        """
        task_id = str(uuid.uuid4())

        task_data = {
            "task_id": task_id,
            "status": TaskStatus.PENDING.value,
            "progress": 0.0,
            "message": "任务已创建，等待执行",
            "file_id": request_data.get("file_id", ""),
            "filename": request_data.get("filename", ""),
            "config": request_data.get("config", {}),
            "note": request_data.get("note", ""),
            "total_rows": request_data.get("total_rows"),
            "valid_rows": request_data.get("valid_rows"),
        }

        # 保存到数据库
        self.db.create_task(task_data)

        # 同时保存到文件系统（用于兼容性）
        task_info = {
            "task_id": task_id,
            "status": TaskStatus.PENDING.value,
            "progress": 0.0,
            "message": "任务已创建，等待执行",
            "created_at": datetime.now().isoformat(),
            "updated_at": datetime.now().isoformat(),
            "request_data": request_data,
            "result_id": None,
            "error": None
        }
        self._save_task(task_id, task_info)

        return task_id
    
    def update_task_status(
        self,
        task_id: str,
        status: TaskStatus,
        progress: float = None,
        message: str = None,
        result_id: str = None,
        error: str = None
    ):
        """
        更新任务状态

        Args:
            task_id: 任务ID
            status: 新状态
            progress: 进度 (0.0-1.0)
            message: 状态消息
            result_id: 结果ID（完成时）
            error: 错误信息（失败时）
        """
        with self._lock:
            # 更新数据库
            updates = {"status": status.value}
            if progress is not None:
                updates["progress"] = progress
            if message is not None:
                updates["message"] = message
            if result_id is not None:
                updates["result_id"] = result_id
            if error is not None:
                updates["error"] = error

            self.db.update_task(task_id, updates)

            # 同时更新文件系统（兼容性）
            task_info = self._load_task(task_id)
            if not task_info:
                logger.warning(f"Task not found in file system: {task_id}")
                return

            task_info["status"] = status.value
            task_info["updated_at"] = datetime.now().isoformat()

            # 记录状态变化时间
            if status == TaskStatus.RUNNING and "started_at" not in task_info:
                task_info["started_at"] = datetime.now().isoformat()
            elif status in [TaskStatus.COMPLETED, TaskStatus.FAILED]:
                task_info["completed_at"] = datetime.now().isoformat()

            if progress is not None:
                task_info["progress"] = progress
            if message is not None:
                task_info["message"] = message
            if result_id is not None:
                task_info["result_id"] = result_id
            if error is not None:
                task_info["error"] = error

            self._save_task(task_id, task_info)

    def update_task_process_details(self, task_id: str, process_details: List[Dict]):
        """
        更新任务的预测过程详情

        注意：process_details 只保存到数据库，不保存到任务文件中（避免文件过大）

        Args:
            task_id: 任务ID
            process_details: 预测过程详细信息列表
        """
        with self._lock:
            # 更新数据库
            self.db.update_task(task_id, {"process_details": process_details})

            # 不再将 process_details 保存到文件系统
            # process_details 应该保存在 storage/results/{task_id}/process_details.json 中
            # 这里只更新任务文件中的计数信息
            task_info = self._load_task(task_id)
            if task_info:
                task_info["process_details_count"] = len(process_details) if isinstance(process_details, list) else 0
                task_info["updated_at"] = datetime.now().isoformat()
                self._save_task(task_id, task_info)

    def update_task(self, task_id: str, updates: Dict[str, Any]):
        """
        更新任务信息（通用方法）

        Args:
            task_id: 任务ID
            updates: 要更新的字段字典
        """
        with self._lock:
            task_info = self._load_task(task_id)
            if not task_info:
                raise ValueError(f"任务不存在: {task_id}")

            # 更新字段
            task_info.update(updates)
            task_info["updated_at"] = datetime.now().isoformat()

            # 保存到文件
            self._save_task(task_id, task_info)

            # 同时更新数据库
            self.db.update_task(task_id, updates)

    def get_task_status(self, task_id: str) -> Optional[Dict[str, Any]]:
        """
        获取任务状态

        Args:
            task_id: 任务ID

        Returns:
            任务信息字典，如果不存在返回 None
        """
        return self._load_task(task_id)

    def _save_task(self, task_id: str, task_info: Dict[str, Any]):
        """
        保存任务信息到文件（使用原子写入避免损坏，带重试机制）

        注意：不保存 process_details 字段，该字段应保存在 process_details.json 中
        """
        task_file = self.storage_dir / f"{task_id}.json"
        temp_file = self.storage_dir / f"{task_id}.json.tmp"

        # 创建任务信息的副本，移除 process_details（避免文件过大）
        task_info_copy = task_info.copy()
        if "process_details" in task_info_copy:
            # 只保留 process_details 的数量信息，不保存完整内容
            process_details = task_info_copy.pop("process_details")
            task_info_copy["process_details_count"] = len(process_details) if isinstance(process_details, list) else 0

        # 重试配置
        max_retries = 3
        retry_delay = 0.5  # 秒

        for attempt in range(max_retries):
            try:
                # 先写入临时文件
                with open(temp_file, 'w', encoding='utf-8') as f:
                    json.dump(task_info_copy, f, ensure_ascii=False, indent=2)

                # 原子性地重命名（Windows上需要先删除目标文件）
                if task_file.exists():
                    try:
                        task_file.unlink()
                    except PermissionError:
                        if attempt < max_retries - 1:
                            import time
                            time.sleep(retry_delay)
                            continue
                        raise

                temp_file.rename(task_file)
                return  # 成功保存，退出

            except PermissionError as e:
                if attempt < max_retries - 1:
                    logger.warning(f"❌ 文件权限错误 (尝试 {attempt + 1}/{max_retries}): {e}")
                    import time
                    time.sleep(retry_delay)
                else:
                    logger.error(f"❌ 文件权限错误: {e}")
                    # 清理临时文件
                    if temp_file.exists():
                        try:
                            temp_file.unlink()
                        except:
                            pass
                    raise
            except Exception as e:
                logger.error(f"Failed to save task {task_id}: {e}", exc_info=True)
                # 清理临时文件
                if temp_file.exists():
                    try:
                        temp_file.unlink()
                    except:
                        pass
                raise
    
    def _load_task(self, task_id: str) -> Optional[Dict[str, Any]]:
        """从文件加载任务信息（带重试机制）"""
        task_file = self.storage_dir / f"{task_id}.json"
        if not task_file.exists():
            return None

        # 重试配置
        max_retries = 3
        retry_delay = 0.3  # 秒

        for attempt in range(max_retries):
            try:
                with open(task_file, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except json.JSONDecodeError as e:
                logger.error(f"Failed to parse task file {task_id}: {e}")
                logger.error(f"Task file path: {task_file}")
                # 返回一个最小的任务信息，避免完全失败
                return {
                    "task_id": task_id,
                    "status": TaskStatus.FAILED.value,
                    "progress": 0.0,
                    "message": f"任务文件损坏，无法加载: {str(e)}",
                    "error": f"JSON解析错误: {str(e)}",
                    "created_at": datetime.now().isoformat(),
                    "updated_at": datetime.now().isoformat(),
                }
            except PermissionError as e:
                if attempt < max_retries - 1:
                    logger.warning(f"文件被占用，重试读取 (尝试 {attempt + 1}/{max_retries}): {task_id}")
                    import time
                    time.sleep(retry_delay)
                else:
                    logger.warning(f"❌ 文件权限错误: {e}")
                    logger.warning(f"Task file path: {task_file}")
                    # 返回一个最小的任务信息，表示文件被占用
                    return {
                        "task_id": task_id,
                        "status": TaskStatus.FAILED.value,
                        "progress": 0.0,
                        "message": "任务文件被占用，无法读取",
                        "error": f"文件权限错误: [Errno 13] Permission denied",
                        "created_at": datetime.now().isoformat(),
                        "updated_at": datetime.now().isoformat(),
                    }
            except Exception as e:
                logger.error(f"Failed to load task file {task_id}: {e}", exc_info=True)
                return None

        return None
    
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
            {
                "tasks": [...],
                "total": 100
            }
        """
        # 从数据库查询
        return self.db.list_tasks(
            page=page,
            page_size=page_size,
            status_filter=status_filter,
            sort_by=sort_by,
            sort_order=sort_order
        )

    def _list_tasks_from_files(
        self,
        page: int = 1,
        page_size: int = 20,
        status_filter: Optional[str] = None,
        sort_by: str = "created_at",
        sort_order: str = "desc"
    ) -> Dict[str, Any]:
        """从文件系统列出任务（兼容性方法）"""
        all_tasks = []

        # 加载所有任务
        for task_file in self.storage_dir.glob("*.json"):
            task_info = self._load_task(task_file.stem)
            if task_info:
                # 状态筛选
                if status_filter and task_info.get("status") != status_filter:
                    continue

                # 转换为 TaskInfo 格式
                task_data = self._convert_to_task_info(task_info)
                all_tasks.append(task_data)

        # 排序
        reverse = (sort_order == "desc")
        all_tasks.sort(key=lambda x: x.get(sort_by, ""), reverse=reverse)

        # 分页
        total = len(all_tasks)
        start_idx = (page - 1) * page_size
        end_idx = start_idx + page_size
        page_tasks = all_tasks[start_idx:end_idx]

        return {
            "tasks": page_tasks,
            "total": total
        }

    def get_task(self, task_id: str) -> Optional[Dict[str, Any]]:
        """
        获取任务信息

        Args:
            task_id: 任务ID

        Returns:
            任务信息（TaskInfo 格式）
        """
        task_info = self._load_task(task_id)
        if not task_info:
            return None

        return self._convert_to_task_info(task_info)

    def get_task_config(self, task_id: str) -> Optional[Dict[str, Any]]:
        """
        获取任务配置

        Args:
            task_id: 任务ID

        Returns:
            任务配置字典
        """
        # 先尝试从文件系统加载
        task_info = self._load_task(task_id)
        if task_info:
            config = task_info.get("request_data", {}).get("config", {})
            if config:
                return config

        # 如果文件系统中没有，尝试从数据库获取
        from database.task_db import TaskDatabase
        task_db = TaskDatabase()
        db_task = task_db.get_task(task_id)

        if not db_task:
            return None

        # 从数据库任务信息重建配置
        config = {
            "composition_column": db_task.get("composition_column"),
            "processing_column": db_task.get("processing_column"),
            "target_columns": db_task.get("target_columns", []),
            "model_provider": db_task.get("model_provider"),
            "model_name": db_task.get("model_name"),
            "temperature": db_task.get("temperature"),
            "sample_size": db_task.get("sample_size"),
            "train_ratio": db_task.get("train_ratio"),
            "max_retrieved_samples": db_task.get("max_retrieved_samples"),
            "similarity_threshold": db_task.get("similarity_threshold"),
            "random_seed": db_task.get("random_seed"),
            "workers": db_task.get("workers"),
        }

        # 移除 None 值
        config = {k: v for k, v in config.items() if v is not None}

        return config

    def get_task_logs(self, task_id: str, limit: int = 100) -> list:
        """
        获取任务日志

        Args:
            task_id: 任务ID
            limit: 最大日志条数

        Returns:
            日志列表
        """
        # 从任务信息中获取日志
        task_info = self._load_task(task_id)
        if not task_info:
            return []

        logs = task_info.get("logs", [])
        return logs[-limit:] if len(logs) > limit else logs

    def delete_task(self, task_id: str) -> bool:
        """
        删除任务

        Args:
            task_id: 任务ID

        Returns:
            是否成功删除
        """
        from config import RESULTS_DIR

        # 从数据库删除
        db_result = self.db.delete_task(task_id)

        # 从文件系统删除（兼容性）
        task_file = self.storage_dir / f"{task_id}.json"
        if task_file.exists():
            try:
                task_file.unlink()
                logger.info(f"Deleted task file: {task_file}")
            except Exception as e:
                logger.warning(f"Failed to delete task file {task_id}: {e}")

        # 删除结果文件夹 - 使用 config.py 中的 RESULTS_DIR
        results_dir = RESULTS_DIR / task_id

        logger.info(f"Attempting to delete results directory: {results_dir}")

        if results_dir.exists():
            try:
                shutil.rmtree(results_dir)
                logger.info(f"Successfully deleted results directory for task {task_id}: {results_dir}")
            except Exception as e:
                logger.error(f"Failed to delete results directory for task {task_id} at {results_dir}: {e}", exc_info=True)
        else:
            logger.info(f"Results directory does not exist: {results_dir}")

        return db_result

    def cancel_task(self, task_id: str) -> bool:
        """
        取消任务

        Args:
            task_id: 任务ID

        Returns:
            是否成功取消
        """
        with self._lock:
            task_info = self._load_task(task_id)
            if not task_info:
                return False

            # 只能取消 pending 或 running 状态的任务
            if task_info.get("status") not in ["pending", "running"]:
                return False

            task_info["status"] = "cancelled"
            task_info["completed_at"] = datetime.now().isoformat()
            task_info["error"] = "用户取消"

            self._save_task(task_id, task_info)

            # 同步更新数据库
            self.db.update_task(task_id, {
                "status": "cancelled",
                "error": "用户取消"
            })

            return True

    def create_task_from_config(self, config: Dict[str, Any]) -> str:
        """
        从配置创建新任务（用于重新运行）

        Args:
            config: 任务配置

        Returns:
            新任务ID
        """
        return self.create_task({"config": config})

    def add_task_log(self, task_id: str, log_message: str):
        """
        添加任务日志

        Args:
            task_id: 任务ID
            log_message: 日志消息
        """
        with self._lock:
            task_info = self._load_task(task_id)
            if not task_info:
                return

            if "logs" not in task_info:
                task_info["logs"] = []

            task_info["logs"].append({
                "timestamp": datetime.now().isoformat(),
                "message": log_message
            })

            self._save_task(task_id, task_info)

    def _convert_to_task_info(self, task_info: Dict[str, Any]) -> Dict[str, Any]:
        """
        将内部任务信息转换为 TaskInfo 格式

        Args:
            task_info: 内部任务信息

        Returns:
            TaskInfo 格式的字典
        """
        request_data = task_info.get("request_data", {})
        config = request_data.get("config", {})

        return {
            "task_id": task_info.get("task_id"),
            "status": task_info.get("status"),
            "filename": request_data.get("filename", "未知"),
            "composition_column": config.get("composition_column"),
            "processing_column": config.get("processing_column"),
            "target_columns": config.get("target_columns", []),
            "created_at": task_info.get("created_at"),
            "started_at": task_info.get("started_at"),
            "completed_at": task_info.get("completed_at"),
            "error": task_info.get("error"),
            "result_id": task_info.get("result_id"),
            "progress": task_info.get("progress"),
            "model_provider": config.get("model_provider"),
            "model_name": config.get("model_name"),
            "train_ratio": config.get("train_ratio"),
            "max_retrieved_samples": config.get("max_retrieved_samples"),
            "similarity_threshold": config.get("similarity_threshold"),
            "random_seed": config.get("random_seed"),
            "temperature": config.get("temperature"),
            "sample_size": config.get("sample_size"),
            "workers": config.get("workers"),
            "note": request_data.get("note"),
            "process_details": task_info.get("process_details"),  # 添加预测过程详情
            "request_data": request_data,  # 🔥 保留完整的 request_data 以便增量预测获取 file_id/dataset_id
        }


# 全局任务管理器实例
_task_manager = None


def get_task_manager() -> TaskManager:
    """获取全局任务管理器实例"""
    global _task_manager
    if _task_manager is None:
        _task_manager = TaskManager()
    return _task_manager

