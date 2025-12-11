"""
收敛检查器 - 用于迭代预测的收敛判断
基于相对变化率算法
"""

from typing import List, Dict, Optional, Tuple
import logging

logger = logging.getLogger(__name__)


class ConvergenceChecker:
    """
    收敛检查器
    
    使用相对变化率算法判断迭代预测是否收敛
    """
    
    def __init__(self, threshold: float = 0.01, min_threshold: float = 0.1):
        """
        初始化收敛检查器
        
        Args:
            threshold: 收敛阈值（相对变化率），默认0.01（1%）
            min_threshold: 最小绝对阈值，默认0.1（防止小值时相对变化率过大）
        """
        self.threshold = threshold
        self.min_threshold = min_threshold
    
    def check_convergence(
        self,
        current_value: float,
        previous_value: float,
        property_name: str = ""
    ) -> Tuple[bool, float]:
        """
        检查单个属性是否收敛
        
        Args:
            current_value: 当前迭代的预测值
            previous_value: 上一轮迭代的预测值
            property_name: 属性名称（用于日志）
        
        Returns:
            (是否收敛, 相对变化率)
        """
        # 计算绝对变化
        abs_change = abs(current_value - previous_value)
        
        # 如果绝对变化小于最小阈值，直接判定为收敛
        if abs_change < self.min_threshold:
            logger.debug(
                f"{property_name}: 绝对变化 {abs_change:.4f} < 最小阈值 {self.min_threshold}，判定收敛"
            )
            return True, 0.0
        
        # 计算相对变化率（使用上一轮值作为基准）
        if abs(previous_value) < 1e-6:
            # 避免除以零
            relative_change = abs_change
            logger.warning(
                f"{property_name}: 上一轮值接近0，使用绝对变化 {abs_change:.4f}"
            )
        else:
            relative_change = abs_change / abs(previous_value)
        
        # 判断是否收敛
        converged = relative_change < self.threshold
        
        logger.debug(
            f"{property_name}: 当前值={current_value:.2f}, "
            f"上一轮值={previous_value:.2f}, "
            f"相对变化率={relative_change:.4f}, "
            f"收敛阈值={self.threshold}, "
            f"收敛={converged}"
        )
        
        return converged, relative_change
    
    def check_multi_target_convergence(
        self,
        current_predictions: Dict[str, float],
        previous_predictions: Dict[str, float]
    ) -> Tuple[bool, Dict[str, float]]:
        """
        检查多目标预测是否全部收敛
        
        Args:
            current_predictions: 当前迭代的预测值字典
            previous_predictions: 上一轮迭代的预测值字典
        
        Returns:
            (是否全部收敛, 各属性的相对变化率字典)
        """
        all_converged = True
        relative_changes = {}
        
        for prop_name in current_predictions.keys():
            current_val = current_predictions.get(prop_name, 0.0)
            previous_val = previous_predictions.get(prop_name, 0.0)
            
            converged, rel_change = self.check_convergence(
                current_val, previous_val, prop_name
            )
            
            relative_changes[prop_name] = rel_change
            
            if not converged:
                all_converged = False
        
        logger.info(
            f"多目标收敛检查: 全部收敛={all_converged}, "
            f"相对变化率={relative_changes}"
        )
        
        return all_converged, relative_changes
    
    def check_sample_convergence(
        self,
        sample_index: int,
        target_properties: List[str],
        iteration_history: Dict[str, List[float]]
    ) -> Tuple[bool, Dict[str, float]]:
        """
        检查单个样本的所有目标属性是否收敛
        
        Args:
            sample_index: 样本索引
            target_properties: 目标属性列表
            iteration_history: 迭代历史，格式为 {property: [iter1_val, iter2_val, ...]}
        
        Returns:
            (是否全部收敛, 各属性的相对变化率字典)
        """
        if not iteration_history:
            return False, {}
        
        # 检查是否至少有2轮迭代
        first_prop = target_properties[0]
        if len(iteration_history.get(first_prop, [])) < 2:
            return False, {}
        
        # 提取当前轮和上一轮的预测值
        current_predictions = {}
        previous_predictions = {}
        
        for prop in target_properties:
            values = iteration_history.get(prop, [])
            if len(values) >= 2:
                current_predictions[prop] = values[-1]
                previous_predictions[prop] = values[-2]
            else:
                # 如果某个属性没有足够的历史数据，判定为未收敛
                return False, {}
        
        return self.check_multi_target_convergence(
            current_predictions, previous_predictions
        )

