"""
样本文本构建工具

统一管理样本文本的构建逻辑，确保预览和实际预测使用相同的格式。
列名映射由 PromptBuilder 统一应用，此模块只负责使用原始列名构建文本。
"""

from typing import Dict, List, Optional, Any
import pandas as pd
import logging

logger = logging.getLogger(__name__)


class SampleTextBuilder:
    """样本文本构建器：使用原始列名构建样本文本"""
    
    @staticmethod
    def build_sample_text(
        composition: Optional[str] = None,
        processing_columns: Optional[Dict[str, Any]] = None,
        feature_columns: Optional[Dict[str, Any]] = None
    ) -> str:
        """
        构建样本文本（使用原始列名）
        
        Args:
            composition: 组分字符串，例如 "Al 5.3, Co 21, Cr 21.1"
            processing_columns: 工艺列字典，键为原始列名，值为列值
                例如 {"Processing_Description": "Homogenization at 298K", "Aging_Treatment(K)": "1173"}
            feature_columns: 特征列字典，键为原始列名，值为列值
                例如 {"Temperature": 298, "Pressure": 1.0}
        
        Returns:
            格式化的样本文本，例如：
            ```
            Composition: Al 5.3, Co 21, Cr 21.1
            Processing_Description: Homogenization at 298K
            Aging_Treatment(K): 1173
            Temperature: 298
            Pressure: 1.0
            ```
        """
        text_parts = []
        
        # 添加组分
        if composition and str(composition).strip():
            text_parts.append(f"Composition: {composition}")
        
        # 添加工艺列（支持多列，使用原始列名）
        if processing_columns:
            for proc_col, proc_value in processing_columns.items():
                if proc_value is not None and str(proc_value).strip():
                    text_parts.append(f"{proc_col}: {proc_value}")
        
        # 添加特征列（使用原始列名）
        if feature_columns:
            for feat_col, feat_value in feature_columns.items():
                if feat_value is not None and str(feat_value).strip():
                    text_parts.append(f"{feat_col}: {feat_value}")
        
        return "\n".join(text_parts)
    
    @staticmethod
    def build_from_dataframe_row(
        row: pd.Series,
        composition_columns: Optional[List[str]] = None,
        processing_columns: Optional[List[str]] = None,
        feature_columns: Optional[List[str]] = None,
        composition_formatter: Optional[callable] = None
    ) -> str:
        """
        从 DataFrame 行构建样本文本
        
        Args:
            row: DataFrame 行
            composition_columns: 组分列名列表
            processing_columns: 工艺列名列表
            feature_columns: 特征列名列表
            composition_formatter: 组分格式化函数，接受 (row, composition_columns) 返回组分字符串
        
        Returns:
            格式化的样本文本
        """
        # 格式化组分
        composition = None
        if composition_columns and composition_formatter:
            composition = composition_formatter(row, composition_columns)
        
        # 提取工艺列数据
        processing_dict = {}
        if processing_columns:
            for proc_col in processing_columns:
                if proc_col in row.index:
                    proc_value = row[proc_col]
                    if pd.notna(proc_value) and str(proc_value).strip():
                        processing_dict[proc_col] = proc_value
        
        # 提取特征列数据
        feature_dict = {}
        if feature_columns:
            for feat_col in feature_columns:
                if feat_col in row.index:
                    feat_value = row[feat_col]
                    if pd.notna(feat_value):
                        feature_dict[feat_col] = feat_value
        
        return SampleTextBuilder.build_sample_text(
            composition=composition,
            processing_columns=processing_dict if processing_dict else None,
            feature_columns=feature_dict if feature_dict else None
        )
    
    @staticmethod
    def build_from_dict(
        sample_dict: Dict[str, Any],
        composition_key: str = "composition",
        processing_columns: Optional[List[str]] = None,
        feature_columns: Optional[List[str]] = None
    ) -> str:
        """
        从字典构建样本文本
        
        Args:
            sample_dict: 样本数据字典
            composition_key: 组分数据的键名，默认为 "composition"
            processing_columns: 工艺列名列表（从 sample_dict 中提取）
            feature_columns: 特征列名列表（从 sample_dict 中提取）
        
        Returns:
            格式化的样本文本
        """
        # 提取组分
        composition = sample_dict.get(composition_key)
        
        # 提取工艺列数据
        processing_dict = {}
        if processing_columns:
            for proc_col in processing_columns:
                if proc_col in sample_dict:
                    proc_value = sample_dict[proc_col]
                    if proc_value is not None and str(proc_value).strip():
                        processing_dict[proc_col] = proc_value
        
        # 提取特征列数据
        feature_dict = {}
        if feature_columns:
            for feat_col in feature_columns:
                if feat_col in sample_dict:
                    feat_value = sample_dict[feat_col]
                    if feat_value is not None:
                        feature_dict[feat_col] = feat_value
        
        return SampleTextBuilder.build_sample_text(
            composition=composition,
            processing_columns=processing_dict if processing_dict else None,
            feature_columns=feature_dict if feature_dict else None
        )

