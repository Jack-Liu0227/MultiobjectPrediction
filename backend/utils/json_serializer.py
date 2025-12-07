"""
JSON 序列化工具
处理 pandas/numpy 类型的 JSON 序列化
"""

import pandas as pd
import numpy as np
import math
from typing import Any, Dict, List


def make_json_serializable(value: Any) -> Any:
    """
    将 pandas/numpy 类型转换为 Python 原生类型

    Args:
        value: 任意类型的值

    Returns:
        JSON 可序列化的值
    """
    # 先检查是否为 numpy 数组或 pandas Series/DataFrame
    if isinstance(value, np.ndarray):
        # 递归处理数组中的每个元素，确保无效浮点数被转换
        return [make_json_serializable(item) for item in value.tolist()]
    elif isinstance(value, pd.Series):
        # 递归处理 Series 中的每个元素
        return [make_json_serializable(item) for item in value.to_list()]
    elif isinstance(value, pd.DataFrame):
        # 递归处理 DataFrame
        return [make_json_serializable(row) for row in value.to_dict('records')]

    # 检查标量值是否为 NaN（需要先确保不是数组）
    try:
        if pd.isna(value):
            return None
    except (ValueError, TypeError):
        # 如果 pd.isna() 抛出异常，说明是复杂类型，继续处理
        pass

    if isinstance(value, (np.integer, np.int64, np.int32, np.int16, np.int8)):
        return int(value)
    elif isinstance(value, (np.floating, np.float64, np.float32, np.float16)):
        float_value = float(value)
        # 检查是否为无效的浮点数 (inf, -inf, nan)
        if math.isinf(float_value) or math.isnan(float_value):
            return None
        return float_value
    elif isinstance(value, (np.bool_, bool)):
        return bool(value)
    elif isinstance(value, str):
        return value
    elif isinstance(value, (int, float)):
        # 对于 Python 原生 float，也需要检查
        if isinstance(value, float) and (math.isinf(value) or math.isnan(value)):
            return None
        return value
    elif isinstance(value, (list, tuple)):
        return [make_json_serializable(item) for item in value]
    elif isinstance(value, dict):
        return {key: make_json_serializable(val) for key, val in value.items()}
    else:
        return str(value)


def serialize_dataframe_row(row: pd.Series) -> Dict[str, Any]:
    """
    将 pandas Series (DataFrame 的一行) 转换为 JSON 可序列化的字典
    
    Args:
        row: pandas Series
        
    Returns:
        JSON 可序列化的字典
    """
    return {key: make_json_serializable(value) for key, value in row.to_dict().items()}


def serialize_dataframe(df: pd.DataFrame) -> List[Dict[str, Any]]:
    """
    将 pandas DataFrame 转换为 JSON 可序列化的列表
    
    Args:
        df: pandas DataFrame
        
    Returns:
        JSON 可序列化的字典列表
    """
    return [serialize_dataframe_row(row) for _, row in df.iterrows()]

