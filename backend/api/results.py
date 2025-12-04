"""
结果查询API
"""

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, PlainTextResponse
import logging
import os
import json
import pandas as pd
from pathlib import Path

from models.schemas import ResultsResponse, PredictionMetrics
from services.pareto_analyzer import analyze_pareto_front
from config import RESULTS_DIR

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/{result_id}", response_model=ResultsResponse)
async def get_results(result_id: str):
    """
    获取预测结果

    响应:
    {
        "result_id": "uuid",
        "predictions": [...],
        "metrics": {...},
        "execution_time": 123.45
    }
    """
    try:
        result_dir = RESULTS_DIR / result_id

        if not result_dir.exists():
            raise HTTPException(status_code=404, detail=f"结果不存在: {result_id}")

        # 读取预测结果
        predictions_file = result_dir / "predictions.csv"
        if not predictions_file.exists():
            raise HTTPException(status_code=404, detail="预测结果文件不存在")

        df = pd.read_csv(predictions_file)
        predictions = df.to_dict('records')

        # 读取评估指标
        metrics_file = result_dir / "metrics.json"
        if metrics_file.exists():
            with open(metrics_file, 'r', encoding='utf-8') as f:
                metrics_data = json.load(f)

            # 转换为 PredictionMetrics 格式
            metrics = {}
            for target, metric_values in metrics_data.items():
                metrics[target] = PredictionMetrics(**metric_values)
        else:
            metrics = {}

        # 读取执行时间和 task_id（如果有）
        execution_time = 0.0
        task_id = None

        # 尝试从数据库查找 task_id
        from database.task_db import TaskDatabase
        task_db = TaskDatabase()

        # 通过 result_id 查找任务
        from database.models import SessionLocal, Task
        db = SessionLocal()
        try:
            task = db.query(Task).filter(Task.result_id == result_id).first()
            if task:
                task_id = task.task_id
                if task.created_at and task.completed_at:
                    execution_time = (task.completed_at - task.created_at).total_seconds()
        finally:
            db.close()

        # 如果数据库中没有，尝试从文件系统读取
        if not task_id:
            task_file = RESULTS_DIR.parent / "tasks" / f"{result_id}.json"
            if task_file.exists():
                with open(task_file, 'r', encoding='utf-8') as f:
                    task_info = json.load(f)
                    task_id = task_info.get("task_id", result_id)
                    from datetime import datetime
                    created = datetime.fromisoformat(task_info["created_at"])
                    updated = datetime.fromisoformat(task_info["updated_at"])
                    execution_time = (updated - created).total_seconds()

        return ResultsResponse(
            result_id=result_id,
            task_id=task_id,
            predictions=predictions,
            metrics=metrics,
            execution_time=execution_time
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"获取结果失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"获取结果失败: {str(e)}")


@router.get("/{result_id}/download")
async def download_results(result_id: str):
    """
    下载结果CSV文件

    返回: CSV文件
    """
    try:
        result_dir = RESULTS_DIR / result_id
        predictions_file = result_dir / "predictions.csv"

        if not predictions_file.exists():
            raise HTTPException(status_code=404, detail="结果文件不存在")

        return FileResponse(
            path=str(predictions_file),
            media_type="text/csv",
            filename=f"predictions_{result_id}.csv"
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"下载结果失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"下载结果失败: {str(e)}")


@router.get("/{result_id}/task_config.json")
async def get_task_config_file(result_id: str):
    """获取任务配置文件 task_config.json 的内容"""
    try:
        result_dir = RESULTS_DIR / result_id
        config_file = result_dir / "task_config.json"

        if not config_file.exists():
            raise HTTPException(status_code=404, detail="任务配置文件不存在")

        with open(config_file, "r", encoding="utf-8") as f:
            config_data = json.load(f)

        return config_data

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"读取任务配置失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"读取任务配置失败: {str(e)}")


@router.get("/{result_id}/process_details.json")
async def get_process_details_file(result_id: str):
    """获取预测过程详情文件 process_details.json 的内容"""
    try:
        result_dir = RESULTS_DIR / result_id
        process_details_file = result_dir / "process_details.json"

        if not process_details_file.exists():
            raise HTTPException(status_code=404, detail="预测过程详情文件不存在")

        with open(process_details_file, "r", encoding="utf-8") as f:
            process_details_data = json.load(f)

        return process_details_data

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"读取预测过程详情失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"读取预测过程详情失败: {str(e)}")


@router.get("/{result_id}/pareto")
async def get_pareto_analysis(result_id: str):
    """
    获取 Pareto 前沿分析结果

    响应:
    {
        "pareto_points": [...],
        "pareto_indices": [...],
        "total_points": 100,
        "pareto_count": 15,
        "pareto_ratio": 0.15,
        "metrics": {
            "hypervolume": 123.45,
            "spacing": 0.12,
            "spread": 1.23
        }
    }
    """
    try:
        result_dir = RESULTS_DIR / result_id
        predictions_file = result_dir / "predictions.csv"

        if not predictions_file.exists():
            raise HTTPException(status_code=404, detail="预测结果文件不存在")

        df = pd.read_csv(predictions_file)

        # 识别目标列（以 _predicted 结尾的列）
        predicted_cols = [col for col in df.columns if col.endswith('_predicted')]

        if len(predicted_cols) < 2:
            raise HTTPException(
                status_code=400,
                detail="至少需要 2 个目标才能进行 Pareto 分析"
            )

        # 执行 Pareto 分析（默认所有目标都最大化）
        # 注意：实际应用中可能需要根据具体目标调整最大化/最小化
        pareto_result = analyze_pareto_front(
            df=df,
            objective_columns=predicted_cols,
            maximize_objectives=[True] * len(predicted_cols)
        )

        return pareto_result

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"获取 Pareto 分析失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"获取 Pareto 分析失败: {str(e)}")


@router.get("/{result_id}/inputs/{filename}", response_class=PlainTextResponse)
async def get_input_file(result_id: str, filename: str):
    """
    获取输入文件（prompt）

    参数:
    - result_id: 结果ID（任务ID）
    - filename: 文件名，如 sample_0.txt

    返回:
    - 文本内容
    """
    try:
        file_path = RESULTS_DIR / result_id / "inputs" / filename

        if not file_path.exists():
            raise HTTPException(status_code=404, detail=f"文件不存在: {filename}")

        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()

        return content

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"读取输入文件失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"读取失败: {str(e)}")


@router.get("/{result_id}/outputs/{filename}", response_class=PlainTextResponse)
async def get_output_file(result_id: str, filename: str):
    """
    获取输出文件（LLM response）

    参数:
    - result_id: 结果ID（任务ID）
    - filename: 文件名，如 sample_0.txt

    返回:
    - 文本内容
    """
    try:
        file_path = RESULTS_DIR / result_id / "outputs" / filename

        if not file_path.exists():
            raise HTTPException(status_code=404, detail=f"文件不存在: {filename}")

        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()

        return content

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"读取输出文件失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"读取失败: {str(e)}")

