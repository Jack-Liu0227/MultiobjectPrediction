"""
文件上传API
"""

from fastapi import APIRouter, UploadFile, File, HTTPException
from fastapi.responses import JSONResponse
import logging

from models.schemas import UploadResponse
from services.file_handler import FileHandler

logger = logging.getLogger(__name__)
router = APIRouter()

file_handler = FileHandler()


@router.post("/file", response_model=UploadResponse)
async def upload_file(file: UploadFile = File(...)):
    """
    上传CSV文件
    
    请求:
    - file: CSV文件 (multipart/form-data)
    
    响应:
    {
        "file_id": "uuid",
        "filename": "data.csv",
        "columns": ["Al(wt%)", "Ti(wt%)", "UTS(MPa)", ...],
        "row_count": 1000,
        "preview": [...]
    }
    """
    try:
        # 验证文件类型
        if not file.filename.endswith('.csv'):
            raise HTTPException(status_code=400, detail="只支持CSV文件")
        
        # 读取文件内容
        content = await file.read()

        # 保存文件（异步）
        file_id, file_path = await file_handler.save_uploaded_file(content, file.filename)
        
        # 获取文件信息
        file_info = file_handler.get_file_info(file_path)
        
        return UploadResponse(
            file_id=file_id,
            filename=file.filename,
            columns=file_info['columns'],
            row_count=file_info['row_count'],
            preview=file_info['preview']
        )
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"文件上传失败: {e}")
        raise HTTPException(status_code=500, detail=f"文件上传失败: {str(e)}")


@router.get("/columns/{file_id}")
async def get_columns(file_id: str, filename: str):
    """
    获取文件列信息
    
    响应:
    {
        "columns": ["col1", "col2", ...],
        "dtypes": {"col1": "float64", "col2": "object", ...}
    }
    """
    try:
        file_path = file_handler.get_file_path(file_id, filename)
        file_info = file_handler.get_file_info(file_path)
        
        return {
            "columns": file_info['columns'],
            "dtypes": file_info['dtypes']
        }
    
    except Exception as e:
        logger.error(f"获取列信息失败: {e}")
        raise HTTPException(status_code=500, detail=f"获取列信息失败: {str(e)}")

