"""
文件处理服务
"""

import pandas as pd
import os
import uuid
from typing import Tuple, List
import logging
from datetime import datetime

logger = logging.getLogger(__name__)


class FileHandler:
    """文件处理器"""
    
    def __init__(self, upload_dir: str = "storage/uploads"):
        """初始化文件处理器"""
        self.upload_dir = upload_dir
        os.makedirs(upload_dir, exist_ok=True)
    
    def save_uploaded_file(
        self,
        file_content: bytes,
        filename: str
    ) -> Tuple[str, str]:
        """
        保存上传的文件
        
        返回:
            (file_id, file_path)
        """
        # 生成文件ID
        file_id = str(uuid.uuid4())
        
        # 保存文件
        file_path = os.path.join(self.upload_dir, f"{file_id}_{filename}")
        
        with open(file_path, 'wb') as f:
            f.write(file_content)
        
        logger.info(f"文件已保存: {file_path}")
        
        return file_id, file_path
    
    def read_csv_file(self, file_path: str) -> pd.DataFrame:
        """读取CSV文件"""
        try:
            df = pd.read_csv(file_path)
            logger.info(f"文件已读取: {file_path} ({len(df)} 行)")
            return df
        except Exception as e:
            logger.error(f"读取文件失败: {e}")
            raise
    
    def get_file_info(self, file_path: str) -> dict:
        """获取文件信息"""
        df = self.read_csv_file(file_path)
        
        return {
            'row_count': len(df),
            'column_count': len(df.columns),
            'columns': df.columns.tolist(),
            'dtypes': df.dtypes.to_dict(),
            'preview': df.head(5).to_dict(orient='records')
        }
    
    def validate_csv_file(
        self,
        file_path: str,
        required_columns: List[str] = None
    ) -> Tuple[bool, str]:
        """
        验证CSV文件
        
        返回:
            (is_valid, message)
        """
        try:
            df = self.read_csv_file(file_path)
            
            # 检查是否为空
            if len(df) == 0:
                return False, "文件为空"
            
            # 检查必需列
            if required_columns:
                missing_cols = [col for col in required_columns if col not in df.columns]
                if missing_cols:
                    return False, f"缺少列: {missing_cols}"
            
            return True, "文件有效"
        
        except Exception as e:
            return False, f"验证失败: {str(e)}"
    
    def get_file_path(self, file_id: str, filename: str) -> str:
        """获取文件路径"""
        return os.path.join(self.upload_dir, f"{file_id}_{filename}")
    
    def delete_file(self, file_path: str) -> bool:
        """删除文件"""
        try:
            if os.path.exists(file_path):
                os.remove(file_path)
                logger.info(f"文件已删除: {file_path}")
                return True
            return False
        except Exception as e:
            logger.error(f"删除文件失败: {e}")
            return False

