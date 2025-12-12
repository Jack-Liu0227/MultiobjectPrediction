# 迭代预测功能开发文档 - 第9部分：收敛判断算法

## 9. 收敛判断算法

### 9.1 数学公式

#### 9.1.1 相对变化率计算

**定义**：
```
相对变化率 = |当前值 - 前一值| / max(|前一值|, 最小阈值)
```

**公式**：
```
relative_change = |v_n - v_{n-1}| / max(|v_{n-1}|, min_value)

其中：
- v_n: 第 n 轮的预测值
- v_{n-1}: 第 n-1 轮的预测值
- min_value: 最小值阈值（默认 0.1）
```

**收敛判断**：
```
if relative_change < convergence_threshold:
    样本已收敛
else:
    样本未收敛，继续迭代
```

#### 9.1.2 边界情况处理

**情况1：预测值接近零**
```
示例：
- 第1轮预测值: 0.05
- 第2轮预测值: 0.06
- 相对变化率 = |0.06 - 0.05| / max(|0.05|, 0.1) = 0.01 / 0.1 = 0.1 (10%)

说明：
- 如果直接使用 |0.06 - 0.05| / |0.05| = 0.2 (20%)，会高估变化率
- 使用最小阈值 0.1 可以避免分母过小导致的数值不稳定
```

**情况2：预测值为零**
```
示例：
- 第1轮预测值: 0
- 第2轮预测值: 0.1
- 相对变化率 = |0.1 - 0| / max(|0|, 0.1) = 0.1 / 0.1 = 1.0 (100%)

说明：
- 使用最小阈值 0.1 作为分母，避免除以零
```

**情况3：预测值振荡**
```
示例：
- 第1轮预测值: 100
- 第2轮预测值: 105 (相对变化率 = 5%)
- 第3轮预测值: 103 (相对变化率 = 1.9%)
- 第4轮预测值: 104 (相对变化率 = 0.97%)

说明：
- 虽然预测值在振荡，但相对变化率逐渐减小
- 当相对变化率 < 阈值时，认为已收敛
```

### 9.2 完整实现代码

#### 9.2.1 收敛检查函数

```python
# backend/services/iterative_prediction_service.py

from typing import Dict, List, Tuple

class ConvergenceChecker:
    """收敛检查器"""
    
    def __init__(self, convergence_threshold: float = 0.01, min_value: float = 0.1):
        """
        初始化收敛检查器
        
        Args:
            convergence_threshold: 收敛阈值（相对变化率）
            min_value: 最小值阈值（用于避免分母过小）
        """
        self.convergence_threshold = convergence_threshold
        self.min_value = min_value
    
    def calculate_relative_change(
        self,
        prev_value: float,
        curr_value: float
    ) -> float:
        """
        计算相对变化率
        
        Args:
            prev_value: 前一轮的预测值
            curr_value: 当前轮的预测值
        
        Returns:
            相对变化率（0.0-1.0）
        
        Examples:
            >>> checker = ConvergenceChecker()
            
            # 示例1：正常情况
            >>> checker.calculate_relative_change(100, 105)
            0.05  # 5%
            
            # 示例2：预测值接近零
            >>> checker.calculate_relative_change(0.05, 0.06)
            0.1  # 10%（使用最小阈值）
            
            # 示例3：预测值为零
            >>> checker.calculate_relative_change(0, 0.1)
            1.0  # 100%（使用最小阈值）
        """
        
        # 计算分母（使用最小阈值避免分母过小）
        denominator = max(abs(prev_value), self.min_value)
        
        # 计算相对变化率
        relative_change = abs(curr_value - prev_value) / denominator
        
        return relative_change
    
    def is_converged(
        self,
        prev_value: float,
        curr_value: float
    ) -> bool:
        """
        判断是否已收敛
        
        Args:
            prev_value: 前一轮的预测值
            curr_value: 当前轮的预测值
        
        Returns:
            True 表示已收敛，False 表示未收敛
        
        Examples:
            >>> checker = ConvergenceChecker(convergence_threshold=0.01)
            
            # 示例1：已收敛
            >>> checker.is_converged(100, 100.5)
            True  # 相对变化率 = 0.5% < 1%
            
            # 示例2：未收敛
            >>> checker.is_converged(100, 105)
            False  # 相对变化率 = 5% > 1%
        """
        
        relative_change = self.calculate_relative_change(prev_value, curr_value)
        return relative_change < self.convergence_threshold
    
    def check_sample_convergence(
        self,
        target_properties: List[str],
        iteration_data: Dict[str, List[float]]
    ) -> Tuple[bool, Dict[str, bool], Dict[str, float]]:
        """
        检查样本的所有目标属性是否都已收敛
        
        Args:
            target_properties: 目标属性列表
            iteration_data: 迭代数据，格式：
                {
                    "UTS(MPa)": [850, 855, 857],
                    "El(%)": [15.0, 14.8, 14.7]
                }
        
        Returns:
            (all_converged, property_convergence, relative_changes)
            - all_converged: 是否所有属性都已收敛
            - property_convergence: 每个属性的收敛状态
            - relative_changes: 每个属性的相对变化率
        
        Examples:
            >>> checker = ConvergenceChecker(convergence_threshold=0.01)
            >>> target_properties = ["UTS(MPa)", "El(%)"]
            >>> iteration_data = {
            ...     "UTS(MPa)": [850, 855, 857],
            ...     "El(%)": [15.0, 14.8, 14.7]
            ... }
            >>> all_converged, prop_conv, rel_changes = checker.check_sample_convergence(
            ...     target_properties, iteration_data
            ... )
            >>> print(all_converged)
            True
            >>> print(prop_conv)
            {'UTS(MPa)': True, 'El(%)': True}
            >>> print(rel_changes)
            {'UTS(MPa)': 0.0023, 'El(%)': 0.0068}
        """
        
        property_convergence = {}
        relative_changes = {}
        
        for prop in target_properties:
            values = iteration_data.get(prop, [])
            
            # 需要至少2个值才能计算相对变化率
            if len(values) < 2:
                property_convergence[prop] = False
                relative_changes[prop] = None
                continue
            
            # 获取最后两个值
            prev_value = values[-2]
            curr_value = values[-1]
            
            # 计算相对变化率
            relative_change = self.calculate_relative_change(prev_value, curr_value)
            relative_changes[prop] = relative_change
            
            # 判断是否收敛
            is_converged = relative_change < self.convergence_threshold
            property_convergence[prop] = is_converged
        
        # 所有属性都已收敛
        all_converged = all(property_convergence.values())
        
        return all_converged, property_convergence, relative_changes
```

#### 9.2.2 在迭代预测服务中的使用

```python
# backend/services/iterative_prediction_service.py

class IterativePredictionService:
    """迭代预测服务"""
    
    def __init__(self):
        """初始化服务"""
        self.graph: Optional[CompiledGraph] = None
        self.convergence_checker = ConvergenceChecker()
        self._build_graph()
    
    def _node_check_convergence(self, state: IterationState) -> IterationState:
        """收敛检查节点"""
        
        logger.info(f"[Task {state['task_id']}] 检查收敛状态")
        
        newly_converged = set()
        
        for sample_key, sample_data in state["iteration_history"].items():
            sample_idx = sample_data["sample_index"]
            
            # 跳过已收敛的样本
            if sample_idx in state["converged_samples"]:
                continue
            
            # 跳过失败的样本
            if sample_idx in state["failed_samples"]:
                continue
            
            # 检查所有目标属性是否都收敛
            all_converged, prop_convergence, relative_changes = (
                self.convergence_checker.check_sample_convergence(
                    state["target_properties"],
                    sample_data["targets"]
                )
            )
            
            # 更新样本的收敛信息
            for prop in state["target_properties"]:
                sample_data["targets"][prop]["relative_change"] = relative_changes.get(prop)
                sample_data["targets"][prop]["is_converged"] = prop_convergence.get(prop, False)
            
            if all_converged:
                newly_converged.add(sample_idx)
                sample_data["convergence_status"] = "converged"
                
                # 记录首次收敛的迭代轮数
                for prop in state["target_properties"]:
                    if sample_data["targets"][prop].get("converged_at_iteration") is None:
                        sample_data["targets"][prop]["converged_at_iteration"] = state["current_iteration"]
                
                logger.info(
                    f"[Task {state['task_id']}] 样本 {sample_idx} 已收敛 "
                    f"(第 {state['current_iteration']} 轮)"
                )
        
        state["converged_samples"].update(newly_converged)
        
        return state
```

### 9.3 测试用例

#### 9.3.1 单元测试

```python
# backend/tests/test_convergence_checker.py

import pytest
from backend.services.iterative_prediction_service import ConvergenceChecker

class TestConvergenceChecker:
    """收敛检查器测试"""
    
    def setup_method(self):
        """测试前准备"""
        self.checker = ConvergenceChecker(convergence_threshold=0.01, min_value=0.1)
    
    # 测试相对变化率计算
    def test_calculate_relative_change_normal(self):
        """测试正常情况下的相对变化率计算"""
        # 从 100 变化到 105，相对变化率应为 5%
        relative_change = self.checker.calculate_relative_change(100, 105)
        assert abs(relative_change - 0.05) < 1e-6
    
    def test_calculate_relative_change_small_value(self):
        """测试预测值接近零的情况"""
        # 从 0.05 变化到 0.06，使用最小阈值 0.1
        relative_change = self.checker.calculate_relative_change(0.05, 0.06)
        assert abs(relative_change - 0.1) < 1e-6
    
    def test_calculate_relative_change_zero_value(self):
        """测试预测值为零的情况"""
        # 从 0 变化到 0.1，使用最小阈值 0.1
        relative_change = self.checker.calculate_relative_change(0, 0.1)
        assert abs(relative_change - 1.0) < 1e-6
    
    def test_calculate_relative_change_negative_value(self):
        """测试负数预测值的情况"""
        # 从 -100 变化到 -105，相对变化率应为 5%
        relative_change = self.checker.calculate_relative_change(-100, -105)
        assert abs(relative_change - 0.05) < 1e-6
    
    # 测试收敛判断
    def test_is_converged_true(self):
        """测试已收敛的情况"""
        # 从 100 变化到 100.5，相对变化率 = 0.5% < 1%
        is_converged = self.checker.is_converged(100, 100.5)
        assert is_converged is True
    
    def test_is_converged_false(self):
        """测试未收敛的情况"""
        # 从 100 变化到 105，相对变化率 = 5% > 1%
        is_converged = self.checker.is_converged(100, 105)
        assert is_converged is False
    
    def test_is_converged_boundary(self):
        """测试边界情况"""
        # 从 100 变化到 101，相对变化率 = 1% = 阈值
        # 应该不收敛（使用 < 而不是 <=）
        is_converged = self.checker.is_converged(100, 101)
        assert is_converged is False
    
    # 测试样本收敛检查
    def test_check_sample_convergence_all_converged(self):
        """测试所有属性都已收敛的情况"""
        target_properties = ["UTS(MPa)", "El(%)"]
        iteration_data = {
            "UTS(MPa)": [850, 855, 857],  # 相对变化率 = 0.23% < 1%
            "El(%)": [15.0, 14.8, 14.7]   # 相对变化率 = 0.68% < 1%
        }
        
        all_converged, prop_conv, rel_changes = (
            self.checker.check_sample_convergence(target_properties, iteration_data)
        )
        
        assert all_converged is True
        assert prop_conv["UTS(MPa)"] is True
        assert prop_conv["El(%)"] is True
    
    def test_check_sample_convergence_partial_converged(self):
        """测试部分属性已收敛的情况"""
        target_properties = ["UTS(MPa)", "El(%)"]
        iteration_data = {
            "UTS(MPa)": [850, 855, 857],  # 相对变化率 = 0.23% < 1%（已收敛）
            "El(%)": [15.0, 14.8, 13.0]   # 相对变化率 = 8.2% > 1%（未收敛）
        }
        
        all_converged, prop_conv, rel_changes = (
            self.checker.check_sample_convergence(target_properties, iteration_data)
        )
        
        assert all_converged is False
        assert prop_conv["UTS(MPa)"] is True
        assert prop_conv["El(%)"] is False
    
    def test_check_sample_convergence_insufficient_data(self):
        """测试数据不足的情况"""
        target_properties = ["UTS(MPa)"]
        iteration_data = {
            "UTS(MPa)": [850]  # 仅有1个值，无法计算相对变化率
        }
        
        all_converged, prop_conv, rel_changes = (
            self.checker.check_sample_convergence(target_properties, iteration_data)
        )
        
        assert all_converged is False
        assert prop_conv["UTS(MPa)"] is False
        assert rel_changes["UTS(MPa)"] is None
```

#### 9.3.2 集成测试

```python
# backend/tests/test_iterative_prediction_convergence.py

import pytest
from backend.services.iterative_prediction_service import IterativePredictionService, IterationState
from datetime import datetime

class TestIterativePredictionConvergence:
    """迭代预测收敛测试"""
    
    def test_convergence_with_early_stop(self):
        """测试启用提前停止的收敛"""
        
        service = IterativePredictionService()
        
        # 模拟状态
        state: IterationState = {
            "task_id": 1,
            "test_samples": [
                {"ID": "Sample_001", "C": 0.5},
                {"ID": "Sample_002", "C": 0.6},
            ],
            "reference_samples": [],
            "target_properties": ["UTS(MPa)"],
            "max_iterations": 5,
            "convergence_threshold": 0.01,
            "early_stop": True,
            "max_workers": 5,
            "current_iteration": 2,
            "iteration_history": {
                "sample_0": {
                    "sample_index": 0,
                    "sample_id": "Sample_001",
                    "targets": {
                        "UTS(MPa)": {
                            "iterations": [850, 855, 857],
                            "relative_changes": [None, 0.0059, 0.0023]
                        }
                    },
                    "convergence_status": "converged"
                },
                "sample_1": {
                    "sample_index": 1,
                    "sample_id": "Sample_002",
                    "targets": {
                        "UTS(MPa)": {
                            "iterations": [860, 865, 868],
                            "relative_changes": [None, 0.0058, 0.0035]
                        }
                    },
                    "convergence_status": "converged"
                }
            },
            "converged_samples": {0, 1},
            "failed_samples": {},
            "llm_provider": "gemini",
            "llm_model": "gemini-2.0-flash",
            "temperature": 0.7,
            "start_time": datetime.utcnow(),
            "iteration_start_times": {}
        }
        
        # 检查是否应该继续迭代
        should_continue = service._should_continue_iteration(state)
        
        # 所有样本都已收敛，且启用提前停止，应该停止
        assert should_continue == "finish"
    
    def test_convergence_without_early_stop(self):
        """测试禁用提前停止的收敛"""
        
        service = IterativePredictionService()
        
        # 模拟状态（禁用提前停止）
        state: IterationState = {
            # ... 同上 ...
            "early_stop": False,
            "current_iteration": 2,
            "max_iterations": 5,
            # ... 其他字段 ...
        }
        
        # 检查是否应该继续迭代
        should_continue = service._should_continue_iteration(state)
        
        # 虽然所有样本都已收敛，但禁用提前停止，应该继续
        assert should_continue == "continue"
    
    def test_convergence_max_iterations_reached(self):
        """测试达到最大迭代次数"""
        
        service = IterativePredictionService()
        
        # 模拟状态（已达到最大迭代次数）
        state: IterationState = {
            # ... 同上 ...
            "current_iteration": 5,
            "max_iterations": 5,
            # ... 其他字段 ...
        }
        
        # 检查是否应该继续迭代
        should_continue = service._should_continue_iteration(state)
        
        # 已达到最大迭代次数，应该停止
        assert should_continue == "finish"
```

### 9.4 收敛性能分析

#### 9.4.1 收敛速度分类

```python
# backend/services/iterative_prediction_service.py

class ConvergenceAnalyzer:
    """收敛分析器"""
    
    @staticmethod
    def classify_convergence_speed(
        converged_at_iteration: int
    ) -> str:
        """
        根据首次收敛的迭代轮数分类收敛速度
        
        Args:
            converged_at_iteration: 首次收敛的迭代轮数
        
        Returns:
            收敛速度分类 ("fast", "medium", "slow")
        """
        
        if converged_at_iteration <= 2:
            return "fast"
        elif converged_at_iteration <= 4:
            return "medium"
        else:
            return "slow"
    
    @staticmethod
    def calculate_convergence_statistics(
        iteration_history: Dict[str, Dict[str, Any]]
    ) -> Dict[str, Any]:
        """
        计算收敛统计信息
        
        Args:
            iteration_history: 迭代历史
        
        Returns:
            收敛统计信息
        """
        
        samples = iteration_history.get("samples", {})
        
        convergence_iterations = []
        for sample_data in samples.values():
            for prop_data in sample_data.get("targets", {}).values():
                converged_at = prop_data.get("converged_at_iteration")
                if converged_at is not None:
                    convergence_iterations.append(converged_at)
        
        if not convergence_iterations:
            return {
                "total_converged": 0,
                "average_convergence_iteration": 0,
                "fastest_convergence_iteration": 0,
                "slowest_convergence_iteration": 0,
                "convergence_speed_distribution": {}
            }
        
        speed_distribution = {
            "fast": sum(1 for i in convergence_iterations if i <= 2),
            "medium": sum(1 for i in convergence_iterations if 2 < i <= 4),
            "slow": sum(1 for i in convergence_iterations if i > 4)
        }
        
        return {
            "total_converged": len(convergence_iterations),
            "average_convergence_iteration": sum(convergence_iterations) / len(convergence_iterations),
            "fastest_convergence_iteration": min(convergence_iterations),
            "slowest_convergence_iteration": max(convergence_iterations),
            "convergence_speed_distribution": speed_distribution
        }
```

