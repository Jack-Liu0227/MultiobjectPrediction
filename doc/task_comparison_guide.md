# 任务对比分析功能使用指南

## 功能概述

任务对比分析功能允许用户选择多个任务进行预测结果对比，统计和可视化这些任务之间预测结果的一致性。

## 核心功能

### 1. 任务选择
- 支持选择2个或多个任务进行对比
- 自动识别所有任务的共有样本
- 支持对不同目标属性分别进行对比

### 2. 一致性统计
对选中的N个任务，统计每个预测样本在不同任务间的一致性情况：

- **N个任务对比**：统计从N个全部相同到完全不同的各种情况
- **示例（4个任务）**：
  - 4个任务预测结果完全相同的样本数量
  - 恰好3个任务预测结果相同的样本数量
  - 恰好2个任务预测结果相同的样本数量
  - 4个任务预测结果都不同的样本数量

### 3. 容差设置
- 支持设置容差值（相对误差百分比）
- 容差为0时，要求预测值完全相同
- 容差>0时，相对误差在容差范围内的预测值视为一致
- 例如：容差设为5%，则相对误差≤5%的预测值被视为一致

### 4. 可视化展示
提供多种图表类型：
- **柱状图**：清晰展示各一致性级别的样本分布
- **饼图**：直观显示各一致性级别的占比
- **组合图**：同时显示柱状图和饼图

图表特点：
- 使用颜色渐变表示一致性程度（绿色=高一致性，红色=低一致性）
- 显示样本数量和百分比
- 中文标注，清晰易懂

### 5. 文本报告
生成详细的文本报告，包括：
- 基本信息（任务数、目标属性、容差、样本数）
- 一致性分布统计表
- 关键发现（完全一致率、完全不一致率、平均一致性级别）

## 使用方式

### 方式1: Python API

```python
from services.task_comparison_service import TaskComparisonService

# 初始化服务
service = TaskComparisonService()

# 对比任务
result = service.compare_tasks(
    task_ids=["task-id-1", "task-id-2", "task-id-3"],
    target_column="UTS(MPa)",
    tolerance=5.0  # 5%容差
)

# 生成可视化图表
chart_path = service.visualize_comparison(
    comparison_result=result,
    chart_type='both'  # 'bar', 'pie', 或 'both'
)

# 生成文本报告
report = service.generate_comparison_report(result)
print(report)
```

### 方式2: HTTP API

#### 2.1 获取统计结果

```bash
POST http://localhost:8000/api/task-comparison/compare
Content-Type: application/json

{
    "task_ids": ["task-id-1", "task-id-2", "task-id-3"],
    "target_column": "UTS(MPa)",
    "tolerance": 5.0
}
```

响应示例：
```json
{
    "task_ids": ["task-id-1", "task-id-2", "task-id-3"],
    "n_tasks": 3,
    "target_column": "UTS(MPa)",
    "tolerance": 5.0,
    "total_samples": 100,
    "consistency_distribution": {
        "全部3个任务一致": {
            "count": 45,
            "percentage": 45.0,
            "level": 3
        },
        "恰好2个任务一致": {
            "count": 40,
            "percentage": 40.0,
            "level": 2
        },
        "全部3个任务都不同": {
            "count": 15,
            "percentage": 15.0,
            "level": 1
        }
    }
}
```

#### 2.2 生成可视化图表

```bash
POST http://localhost:8000/api/task-comparison/compare/visualize?chart_type=both
Content-Type: application/json

{
    "task_ids": ["task-id-1", "task-id-2"],
    "target_column": "UTS(MPa)",
    "tolerance": 0.0
}
```

返回PNG格式的图表文件。

#### 2.3 生成文本报告

```bash
POST http://localhost:8000/api/task-comparison/compare/report
Content-Type: application/json

{
    "task_ids": ["task-id-1", "task-id-2"],
    "target_column": "UTS(MPa)",
    "tolerance": 0.0
}
```

返回纯文本格式的对比分析报告。

## 使用示例

详细的使用示例请参考 `examples/task_comparison_example.py`，包括：

1. **示例1**：对比2个任务
2. **示例2**：对比3个任务
3. **示例3**：对比4个任务
4. **示例4**：使用容差进行对比
5. **示例5**：对比多个目标属性
6. **示例6**：API使用说明

运行示例：
```bash
cd examples
python task_comparison_example.py
```

## 注意事项

1. **任务ID获取**：可以从任务列表API或结果目录中获取任务ID
2. **共有样本**：只对比所有任务都包含的样本（基于sample_index）
3. **目标列名**：确保所有任务都包含指定的目标列
4. **容差设置**：根据实际需求设置合适的容差值
5. **图表保存**：图表默认保存在 `storage/results/` 目录下

## 技术实现

- **后端服务**：`backend/services/task_comparison_service.py`
- **API端点**：`backend/api/task_comparison.py`
- **可视化**：使用matplotlib生成高质量图表
- **统计算法**：基于相似度分组的一致性级别计算

## 扩展功能

未来可以扩展的功能：
- 支持批量对比多个目标属性
- 添加更多图表类型（散点图、热力图等）
- 支持导出Excel格式的详细对比报告
- 添加前端界面进行交互式对比分析

