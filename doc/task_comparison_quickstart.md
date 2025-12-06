# 任务对比分析功能 - 快速入门

## 5分钟快速上手

### 步骤1: 准备任务ID

首先，你需要至少2个已完成的预测任务。可以通过以下方式获取任务ID：

1. 查看 `storage/results/` 目录，每个子目录名就是一个任务ID
2. 或通过API获取任务列表：`GET http://localhost:8000/api/tasks`

示例任务ID：
```
05105c00-9b7f-4fc9-b301-997a8a1e793d
4610455b-1f37-4f10-a157-95cdc27e7465
a147e954-c48d-4c1e-b8d1-fed01ee1f21e
```

### 步骤2: 运行测试脚本

最简单的方式是运行测试脚本：

```bash
cd examples
python test_task_comparison.py
```

这个脚本会自动：
- 查找可用的任务
- 选择前2个任务进行对比
- 生成统计结果
- 生成可视化图表
- 生成文本报告

### 步骤3: 使用Python代码

```python
from services.task_comparison_service import TaskComparisonService

# 初始化服务
service = TaskComparisonService()

# 对比2个任务
result = service.compare_tasks(
    task_ids=[
        "05105c00-9b7f-4fc9-b301-997a8a1e793d",
        "4610455b-1f37-4f10-a157-95cdc27e7465"
    ],
    target_column="UTS(MPa)",  # 目标属性
    tolerance=0.0              # 容差（0表示完全相同）
)

# 查看结果
print(f"共有样本数: {result['total_samples']}")
for label, data in result['consistency_distribution'].items():
    print(f"{label}: {data['count']} ({data['percentage']:.1f}%)")

# 生成图表
service.visualize_comparison(result, chart_type='both')
```

### 步骤4: 使用HTTP API

启动后端服务后，使用curl或Postman调用API：

```bash
curl -X POST "http://localhost:8000/api/task-comparison/compare" \
     -H "Content-Type: application/json" \
     -d '{
         "task_ids": [
             "05105c00-9b7f-4fc9-b301-997a8a1e793d",
             "4610455b-1f37-4f10-a157-95cdc27e7465"
         ],
         "target_column": "UTS(MPa)",
         "tolerance": 0.0
     }'
```

## 常见使用场景

### 场景1: 对比2个模型的预测结果

```python
# 对比使用不同LLM模型的预测结果
result = service.compare_tasks(
    task_ids=["gemini-task-id", "gpt-task-id"],
    target_column="UTS(MPa)",
    tolerance=0.0
)
```

### 场景2: 对比3个或更多任务

```python
# 对比3个任务
result = service.compare_tasks(
    task_ids=["task-1", "task-2", "task-3"],
    target_column="UTS(MPa)",
    tolerance=0.0
)

# 会统计：
# - 3个任务完全一致的样本数
# - 恰好2个任务一致的样本数
# - 3个任务都不同的样本数
```

### 场景3: 使用容差对比

```python
# 允许5%的相对误差
result = service.compare_tasks(
    task_ids=["task-1", "task-2"],
    target_column="UTS(MPa)",
    tolerance=5.0  # 5%容差
)
```

### 场景4: 对比多个目标属性

```python
targets = ["UTS(MPa)", "El(%)"]

for target in targets:
    result = service.compare_tasks(
        task_ids=["task-1", "task-2"],
        target_column=target,
        tolerance=0.0
    )
    print(f"\n{target}:")
    for label, data in result['consistency_distribution'].items():
        print(f"  {label}: {data['count']}")
```

## 输出说明

### 统计结果

```python
{
    "task_ids": ["task-1", "task-2"],
    "n_tasks": 2,
    "target_column": "UTS(MPa)",
    "tolerance": 0.0,
    "total_samples": 100,
    "consistency_distribution": {
        "全部2个任务一致": {
            "count": 60,      # 样本数量
            "percentage": 60.0,  # 百分比
            "level": 2        # 一致性级别
        },
        "全部2个任务都不同": {
            "count": 40,
            "percentage": 40.0,
            "level": 1
        }
    }
}
```

### 可视化图表

生成的图表包括：
- **柱状图**：横轴为一致性级别，纵轴为样本数量
- **饼图**：显示各一致性级别的占比
- **颜色编码**：绿色=高一致性，红色=低一致性

### 文本报告

包含：
- 基本信息（任务数、目标属性、容差、样本数）
- 一致性分布统计表
- 关键发现（完全一致率、平均一致性级别等）

## 下一步

- 查看完整文档：`doc/task_comparison_guide.md`
- 查看更多示例：`examples/task_comparison_example.py`
- API文档：访问 `http://localhost:8000/docs` 查看交互式API文档

