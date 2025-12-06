"""
任务对比分析API
提供多任务预测结果对比的接口
"""

from fastapi import APIRouter, HTTPException, Query, Depends
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
import logging
from pathlib import Path
import uuid
import json
from datetime import datetime

from services.task_comparison_service import TaskComparisonService
from config import RESULTS_DIR
from database.models import get_db, TaskComparison
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)
router = APIRouter()

# 初始化服务
comparison_service = TaskComparisonService()


class TaskComparisonRequest(BaseModel):
    """任务对比请求"""
    task_ids: List[str] = Field(..., min_items=2, description="任务ID列表（至少2个）")
    target_columns: List[str] = Field(..., min_items=1, description="要对比的目标列名列表")
    tolerance: float = Field(default=0.0, ge=0.0, le=100.0, description="容差值（相对误差百分比，0-100）")


class TaskComparisonResponse(BaseModel):
    """任务对比响应"""
    task_ids: List[str]
    n_tasks: int
    target_columns: List[str]
    tolerance: float
    total_samples: int
    consistency_distribution: Dict[str, Any]
    sample_details: Optional[List[Dict[str, Any]]] = None
    target_metrics: Optional[Dict[str, Any]] = None  # 每个目标属性的指标


@router.post("/compare", response_model=TaskComparisonResponse)
async def compare_tasks(request: TaskComparisonRequest):
    """
    对比多个任务的预测结果（支持多目标属性）

    请求体示例:
    ```json
    {
        "task_ids": ["task-id-1", "task-id-2"],
        "target_columns": ["UTS(MPa)", "El(%)"],
        "tolerance": 5.0
    }
    ```

    响应示例:
    ```json
    {
        "task_ids": ["task-id-1", "task-id-2"],
        "n_tasks": 2,
        "target_columns": ["UTS(MPa)", "El(%)"],
        "tolerance": 5.0,
        "total_samples": 100,
        "consistency_distribution": {...},
        "target_metrics": {
            "UTS(MPa)": {...},
            "El(%)": {...}
        }
    }
    ```
    """
    try:
        logger.info(f"开始对比任务: {request.task_ids}, 目标列: {request.target_columns}")

        # 执行对比分析
        result = comparison_service.compare_tasks(
            task_ids=request.task_ids,
            target_columns=request.target_columns,
            tolerance=request.tolerance
        )

        logger.info(f"对比完成，共有样本数: {result['total_samples']}")

        return TaskComparisonResponse(**result)
    
    except ValueError as e:
        logger.error(f"参数错误: {e}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"对比任务失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"对比任务失败: {str(e)}")


@router.post("/compare/visualize")
async def visualize_comparison(
    request: TaskComparisonRequest,
    chart_type: str = Query(default="both", regex="^(bar|pie|both)$", description="图表类型")
):
    """
    对比任务并生成可视化图表
    
    参数:
    - chart_type: 图表类型，可选值: 'bar'(柱状图), 'pie'(饼图), 'both'(两者都显示)
    
    返回:
    - PNG格式的图表文件
    """
    try:
        logger.info(f"开始对比任务并生成图表: {request.task_ids}")
        
        # 执行对比分析
        result = comparison_service.compare_tasks(
            task_ids=request.task_ids,
            target_column=request.target_column,
            tolerance=request.tolerance
        )
        
        # 生成图表
        chart_filename = f"comparison_{'_'.join(request.task_ids[:3])}.png"
        chart_path = RESULTS_DIR / chart_filename
        
        comparison_service.visualize_comparison(
            comparison_result=result,
            output_path=chart_path,
            chart_type=chart_type
        )
        
        logger.info(f"图表生成完成: {chart_path}")
        
        return FileResponse(
            path=chart_path,
            media_type="image/png",
            filename=chart_filename
        )
    
    except ValueError as e:
        logger.error(f"参数错误: {e}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"生成图表失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"生成图表失败: {str(e)}")


@router.post("/compare/report")
async def generate_comparison_report(request: TaskComparisonRequest):
    """
    对比任务并生成文本报告
    
    返回:
    - 纯文本格式的对比分析报告
    """
    try:
        logger.info(f"开始生成对比报告: {request.task_ids}")
        
        # 执行对比分析
        result = comparison_service.compare_tasks(
            task_ids=request.task_ids,
            target_column=request.target_column,
            tolerance=request.tolerance
        )
        
        # 生成报告
        report_text = comparison_service.generate_comparison_report(result)
        
        logger.info("报告生成完成")
        
        from fastapi.responses import PlainTextResponse
        return PlainTextResponse(content=report_text)
    
    except ValueError as e:
        logger.error(f"参数错误: {e}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"生成报告失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"生成报告失败: {str(e)}")


# ==================== 对比结果持久化API ====================

class SaveComparisonRequest(BaseModel):
    """保存对比结果请求"""
    task_ids: List[str]
    target_columns: List[str]
    tolerance: float
    comparison_results: Dict[str, Any]  # 完整的对比结果数据
    note: Optional[str] = Field(None, max_length=200, description="用户备注（最多200字符）")


class SaveComparisonResponse(BaseModel):
    """保存对比结果响应"""
    id: str
    message: str
    created_at: str


class ComparisonHistoryItem(BaseModel):
    """历史对比记录项（摘要信息）"""
    id: str
    task_ids: List[str]
    target_columns: List[str]
    tolerance: float
    note: Optional[str]
    created_at: str
    n_tasks: int
    total_samples: int


@router.post("/save", response_model=SaveComparisonResponse)
async def save_comparison(request: SaveComparisonRequest, db: Session = Depends(get_db)):
    """
    保存对比结果到数据库

    请求体示例:
    ```json
    {
        "task_ids": ["task-id-1", "task-id-2"],
        "target_columns": ["UTS(MPa)", "El(%)"],
        "tolerance": 0.0,
        "comparison_results": {...},
        "note": "Initial comparison for paper"
    }
    ```
    """
    try:
        # 生成唯一ID
        comparison_id = str(uuid.uuid4())

        # 创建数据库记录
        comparison = TaskComparison(
            id=comparison_id,
            task_ids=request.task_ids,
            target_columns=request.target_columns,
            tolerance=request.tolerance,
            comparison_results=json.dumps(request.comparison_results),
            note=request.note,
            created_at=datetime.now()
        )

        db.add(comparison)
        db.commit()

        logger.info(f"对比结果已保存: {comparison_id}")

        return SaveComparisonResponse(
            id=comparison_id,
            message="Comparison result saved successfully",
            created_at=comparison.created_at.isoformat()
        )

    except Exception as e:
        db.rollback()
        logger.error(f"保存对比结果失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to save comparison: {str(e)}")


@router.get("/history", response_model=List[ComparisonHistoryItem])
async def get_comparison_history(db: Session = Depends(get_db)):
    """
    获取所有历史对比记录（摘要信息）

    返回按创建时间倒序排列的对比记录列表
    """
    try:
        comparisons = db.query(TaskComparison).order_by(TaskComparison.created_at.desc()).all()

        result = []
        for comp in comparisons:
            # 解析 comparison_results 获取摘要信息
            comp_data = json.loads(comp.comparison_results)

            result.append(ComparisonHistoryItem(
                id=comp.id,
                task_ids=comp.task_ids,
                target_columns=comp.target_columns,
                tolerance=comp.tolerance,
                note=comp.note,
                created_at=comp.created_at.isoformat(),
                n_tasks=comp_data.get('n_tasks', len(comp.task_ids)),
                total_samples=comp_data.get('total_samples', 0)
            ))

        logger.info(f"返回 {len(result)} 条历史对比记录")
        return result

    except Exception as e:
        logger.error(f"获取历史记录失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to get history: {str(e)}")


@router.get("/history/{comparison_id}")
async def get_comparison_detail(comparison_id: str, db: Session = Depends(get_db)):
    """
    获取特定对比记录的完整数据

    返回完整的对比结果，可用于重新显示对比分析
    """
    try:
        comparison = db.query(TaskComparison).filter(TaskComparison.id == comparison_id).first()

        if not comparison:
            raise HTTPException(status_code=404, detail="Comparison not found")

        # 解析完整的对比结果
        comparison_results = json.loads(comparison.comparison_results)

        return {
            "id": comparison.id,
            "task_ids": comparison.task_ids,
            "target_columns": comparison.target_columns,
            "tolerance": comparison.tolerance,
            "note": comparison.note,
            "created_at": comparison.created_at.isoformat(),
            "comparison_results": comparison_results
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"获取对比详情失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to get comparison detail: {str(e)}")


@router.delete("/history/{comparison_id}")
async def delete_comparison(comparison_id: str, db: Session = Depends(get_db)):
    """
    删除对比记录
    """
    try:
        comparison = db.query(TaskComparison).filter(TaskComparison.id == comparison_id).first()

        if not comparison:
            raise HTTPException(status_code=404, detail="Comparison not found")

        db.delete(comparison)
        db.commit()

        logger.info(f"对比记录已删除: {comparison_id}")

        return {"message": "Comparison deleted successfully"}

    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"删除对比记录失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to delete comparison: {str(e)}")
