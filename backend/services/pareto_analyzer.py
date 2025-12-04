"""
Pareto 前沿分析服务
实现多目标优化的 Pareto 前沿计算和相关指标
"""

import numpy as np
import pandas as pd
from typing import List, Dict, Any, Tuple
import logging

logger = logging.getLogger(__name__)


class ParetoAnalyzer:
    """
    Pareto 前沿分析器
    用于多目标优化问题的 Pareto 最优解集计算
    """
    
    def __init__(self, maximize_objectives: List[bool] = None):
        """
        初始化 Pareto 分析器
        
        Args:
            maximize_objectives: 每个目标是否最大化（True=最大化，False=最小化）
                                如果为 None，默认所有目标都最大化
        """
        self.maximize_objectives = maximize_objectives
    
    def find_pareto_front(
        self,
        df: pd.DataFrame,
        objective_columns: List[str],
        maximize_objectives: List[bool] = None
    ) -> Dict[str, Any]:
        """
        找出 Pareto 前沿
        
        Args:
            df: 包含目标值的数据框
            objective_columns: 目标列名列表
            maximize_objectives: 每个目标是否最大化
            
        Returns:
            包含 Pareto 前沿信息的字典
        """
        if maximize_objectives is None:
            # 默认所有目标都最大化
            maximize_objectives = [True] * len(objective_columns)
        
        # 提取目标值矩阵
        objectives = df[objective_columns].values
        
        # 移除包含 NaN 的行
        valid_mask = ~np.isnan(objectives).any(axis=1)
        objectives = objectives[valid_mask]
        valid_indices = df.index[valid_mask].tolist()
        
        if len(objectives) == 0:
            logger.warning("No valid objectives found for Pareto analysis")
            return self._empty_pareto_result()
        
        # 转换为最大化问题（将最小化目标取负）
        objectives_normalized = objectives.copy()
        for i, maximize in enumerate(maximize_objectives):
            if not maximize:
                objectives_normalized[:, i] = -objectives_normalized[:, i]
        
        # 执行非支配排序
        pareto_mask = self._non_dominated_sort(objectives_normalized)
        pareto_indices = [valid_indices[i] for i, is_pareto in enumerate(pareto_mask) if is_pareto]
        
        # 提取 Pareto 前沿点
        pareto_df = df.loc[pareto_indices].copy()
        
        # 计算 Pareto 指标
        metrics = self._calculate_pareto_metrics(
            objectives_normalized,
            pareto_mask,
            maximize_objectives
        )
        
        logger.info(f"Pareto front: {len(pareto_indices)} points out of {len(valid_indices)}")
        
        return {
            "pareto_points": pareto_df.to_dict('records'),
            "pareto_indices": pareto_indices,
            "total_points": len(valid_indices),
            "pareto_count": len(pareto_indices),
            "pareto_ratio": len(pareto_indices) / len(valid_indices) if len(valid_indices) > 0 else 0,
            "metrics": metrics
        }
    
    def _non_dominated_sort(self, objectives: np.ndarray) -> np.ndarray:
        """
        非支配排序算法
        
        Args:
            objectives: 目标值矩阵 (n_samples, n_objectives)，已转换为最大化问题
            
        Returns:
            布尔数组，True 表示该点在 Pareto 前沿上
        """
        n_points = len(objectives)
        is_pareto = np.ones(n_points, dtype=bool)
        
        for i in range(n_points):
            if not is_pareto[i]:
                continue
            
            # 检查是否有其他点支配当前点
            for j in range(n_points):
                if i == j or not is_pareto[j]:
                    continue
                
                # 检查 j 是否支配 i
                if self._dominates(objectives[j], objectives[i]):
                    is_pareto[i] = False
                    break
        
        return is_pareto
    
    def _dominates(self, point_a: np.ndarray, point_b: np.ndarray) -> bool:
        """
        检查点 A 是否支配点 B（在最大化问题中）
        
        支配条件：A 在所有目标上不差于 B，且至少在一个目标上严格优于 B
        """
        # A 在所有目标上不差于 B
        not_worse = np.all(point_a >= point_b)
        # A 至少在一个目标上严格优于 B
        strictly_better = np.any(point_a > point_b)
        
        return not_worse and strictly_better
    
    def _calculate_pareto_metrics(
        self,
        objectives: np.ndarray,
        pareto_mask: np.ndarray,
        maximize_objectives: List[bool]
    ) -> Dict[str, float]:
        """
        计算 Pareto 前沿的质量指标
        
        Returns:
            包含 hypervolume, spacing, spread 等指标的字典
        """
        pareto_points = objectives[pareto_mask]
        
        if len(pareto_points) < 2:
            return {
                "hypervolume": 0.0,
                "spacing": 0.0,
                "spread": 0.0
            }
        
        # 计算 Spacing（均匀性指标）
        spacing = self._calculate_spacing(pareto_points)
        
        # 计算 Spread（分布范围指标）
        spread = self._calculate_spread(pareto_points)
        
        # 计算 Hypervolume（超体积指标）
        # 注意：这是一个简化版本，完整实现需要更复杂的算法
        hypervolume = self._calculate_hypervolume_simple(pareto_points)
        
        return {
            "hypervolume": float(hypervolume),
            "spacing": float(spacing),
            "spread": float(spread)
        }

    def _calculate_spacing(self, pareto_points: np.ndarray) -> float:
        """
        计算 Spacing 指标（均匀性）

        Spacing 衡量 Pareto 前沿点之间的距离分布均匀程度
        值越小表示分布越均匀
        """
        if len(pareto_points) < 2:
            return 0.0

        # 计算每个点到最近邻点的距离
        distances = []
        for i in range(len(pareto_points)):
            min_dist = float('inf')
            for j in range(len(pareto_points)):
                if i != j:
                    dist = np.linalg.norm(pareto_points[i] - pareto_points[j])
                    min_dist = min(min_dist, dist)
            distances.append(min_dist)

        distances = np.array(distances)
        mean_dist = np.mean(distances)

        # Spacing = 标准差 / 平均距离
        if mean_dist > 0:
            spacing = np.std(distances) / mean_dist
        else:
            spacing = 0.0

        return spacing

    def _calculate_spread(self, pareto_points: np.ndarray) -> float:
        """
        计算 Spread 指标（分布范围）

        Spread 衡量 Pareto 前沿的覆盖范围
        值越大表示覆盖范围越广
        """
        if len(pareto_points) < 2:
            return 0.0

        # 计算每个目标维度的范围
        ranges = np.ptp(pareto_points, axis=0)  # ptp = peak to peak (max - min)

        # 归一化范围（避免不同量纲的影响）
        normalized_ranges = ranges / (np.abs(np.mean(pareto_points, axis=0)) + 1e-10)

        # Spread = 平均归一化范围
        spread = np.mean(normalized_ranges)

        return spread

    def _calculate_hypervolume_simple(self, pareto_points: np.ndarray) -> float:
        """
        计算 Hypervolume 指标（简化版本）

        Hypervolume 衡量 Pareto 前沿覆盖的目标空间体积
        这是一个简化实现，使用参考点方法
        """
        if len(pareto_points) < 2:
            return 0.0

        # 使用最差点作为参考点
        reference_point = np.min(pareto_points, axis=0)

        # 计算每个点相对于参考点的"体积贡献"
        # 简化方法：计算每个点到参考点的超矩形体积之和
        volumes = []
        for point in pareto_points:
            # 计算超矩形体积（各维度差值的乘积）
            volume = np.prod(point - reference_point)
            volumes.append(max(0, volume))  # 确保非负

        # 总 Hypervolume（简化：直接求和，实际应去除重叠部分）
        hypervolume = np.sum(volumes)

        return hypervolume

    def _empty_pareto_result(self) -> Dict[str, Any]:
        """返回空的 Pareto 结果"""
        return {
            "pareto_points": [],
            "pareto_indices": [],
            "total_points": 0,
            "pareto_count": 0,
            "pareto_ratio": 0.0,
            "metrics": {
                "hypervolume": 0.0,
                "spacing": 0.0,
                "spread": 0.0
            }
        }


def analyze_pareto_front(
    df: pd.DataFrame,
    objective_columns: List[str],
    maximize_objectives: List[bool] = None
) -> Dict[str, Any]:
    """
    便捷函数：分析 Pareto 前沿

    Args:
        df: 数据框
        objective_columns: 目标列名
        maximize_objectives: 每个目标是否最大化

    Returns:
        Pareto 分析结果
    """
    analyzer = ParetoAnalyzer(maximize_objectives)
    return analyzer.find_pareto_front(df, objective_columns, maximize_objectives)

