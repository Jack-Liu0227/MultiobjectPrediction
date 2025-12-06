"""
数据格式化工具函数
提供通用的数据格式化功能，避免代码重复
"""

from typing import Dict, List


def format_composition(sample: Dict, columns: List[str]) -> str:
    """
    从样本中提取组成字符串
    
    Args:
        sample: 样本数据字典
        columns: 组分列名列表
        
    Returns:
        格式化的组成字符串，如 "Al 5.2, Co 13.85, Cr 17.42"
        
    Example:
        >>> sample = {'Al(at%)': 5.2, 'Co(at%)': 13.85}
        >>> columns = ['Al(at%)', 'Co(at%)']
        >>> format_composition(sample, columns)
        'Al 5.2, Co 13.85'
    """
    parts = []
    for col in columns:
        # 先按原始列名查找
        value = sample.get(col)

        # 如果不存在，尝试几种常见等价写法（处理 "Al at%" 和 "Al(at%)" 等情况）
        if value is None:
            alt_names = [
                col.replace(" at%", "(at%)"),
                col.replace("(at%)", " at%"),
                col.replace(" wt%", "(wt%)"),
                col.replace("(wt%)", " wt%"),
            ]
            for alt in alt_names:
                if alt in sample:
                    value = sample[alt]
                    break

        if value is None:
            continue

        # 跳过零值元素
        if value == 0 or value == 0.0:
            continue

        # 提取元素名称，去掉单位后缀
        element = col
        if "(" in element:
            element = element.split("(")[0].strip()
        else:
            element = (
                element.replace("_wt%", "")
                .replace("_at%", "")
                .replace(" wt%", "")
                .replace(" at%", "")
                .strip()
            )

        parts.append(f"{element} {value}")

    return ", ".join(parts)

