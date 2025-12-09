# Confidence 字段解析和可视化筛选修复文档

## 版本信息
- **日期**: 2025-12-09
- **版本**: v1.1

## 修复内容

### 1. Confidence 字段解析失败修复

#### 问题描述
- 任务 d0f18aa6-410e-44f7-a331-248952cec873: 47个样本中有1个样本的 confidence 解析失败
- 任务 e8dfb250-25a7-4d97-bc7b-2bb08798af7e: 20个样本中有1个样本的 confidence 解析失败

#### 问题原因
1. **样本 d0f18aa6/40**: LLM 返回的 confidence 值是 "medium-high",不在标准的 high/medium/low 中
2. **样本 e8dfb250/3**: LLM 响应是错误信息 "Error: litellm.InternalServerError"

#### 修复方案

**修改文件**: `backend/services/simple_rag_engine.py`

在 `LLMResponseParser.extract_confidence()` 方法中添加了对变体格式的支持:

```python
# 标准值: high, medium, low
if confidence_lower in ['high', 'medium', 'low']:
    return confidence_lower

# 处理变体: medium-high, medium-low 等
if 'high' in confidence_lower:
    return 'high'
elif 'medium' in confidence_lower:
    return 'medium'
elif 'low' in confidence_lower:
    return 'low'
```

**更新脚本**: `scripts/add_confidence_to_existing_results.py`

- 支持强制更新已存在的 confidence 列
- 自动创建备份文件 (predictions.csv.backup_before_confidence)

#### 修复结果

- ✅ 任务 d0f18aa6: **47/47** 样本成功提取 confidence
  - 23个 high
  - 24个 medium
  
- ⚠️ 任务 e8dfb250: **19/20** 样本成功提取 confidence
  - 13个 high
  - 6个 medium
  - 1个失败 (样本3,LLM返回错误信息,无法提取)

---

### 2. 可视化图表动态筛选修复

#### 问题描述
- ✅ 散点图可以按置信度筛选
- ❌ "真实值 vs 预测值对比"图表中的评估指标没有动态更新
- ❌ "预测误差分布"图表没有根据筛选条件动态更新
- ❌ "预测值 vs 真实值散点图"下方缺少评估指标显示

#### 修复方案

**1. 修改 PredictionScatterChart 组件** (`frontend/components/charts/PredictionScatterChart.tsx`)

添加了评估指标计算和显示:

```typescript
// 计算评估指标
const metrics = useMemo(() => {
  // 计算 MAE, RMSE, R²
  // ...
}, [scatterData]);

// 在图表下方显示评估指标
<div className="mt-6 bg-gray-50 rounded-lg p-4">
  <h4>评估指标 (基于 {metrics.count} 个样本)</h4>
  <div className="grid grid-cols-3 gap-4">
    <div>R² Score: {metrics.r2.toFixed(4)}</div>
    <div>RMSE: {metrics.rmse.toFixed(3)}</div>
    <div>MAE: {metrics.mae.toFixed(3)}</div>
  </div>
</div>
```

**2. 修改 PredictionComparisonChart 组件** (`frontend/components/charts/PredictionComparisonChart.tsx`)

添加了动态评估指标计算:

```typescript
// 动态计算评估指标（基于筛选后的数据）
const calculatedMetrics = useMemo(() => {
  if (data.length === 0) {
    return { r2: 0, rmse: 0, mae: 0, mape: 0 };
  }

  // 计算 MAE, RMSE, R², MAPE
  // ...

  return { r2, rmse, mae, mape };
}, [data]);

// 使用动态计算的指标
const displayMetrics = metrics || calculatedMetrics;
```

**3. ErrorDistributionChart 组件**

- 已经使用 `useMemo`,会自动根据传入的 `predictions` 重新计算
- 前端页面已传入 `filterByConfidence(results.predictions)`

**4. 前端页面** (`frontend/pages/results/[id].tsx`)

- "真实值 vs 预测值对比"部分: 移除固定的 `metrics` 传参,使用组件内部动态计算 ✅
- "预测误差分布"部分: 使用 `filterByConfidence()` 筛选数据 ✅
- "预测值 vs 真实值散点图"部分: 使用 `filterByConfidence()` 筛选数据 + 显示动态指标 ✅

#### 修复结果

所有图表和评估指标现在都能根据置信度筛选条件动态更新:

1. ✅ **预测值 vs 真实值散点图**
   - 散点根据筛选条件显示
   - 下方显示基于筛选后数据的 MAE, RMSE, R² 指标
   - 指标会随筛选条件实时更新

2. ✅ **预测误差分布图**
   - 误差分布根据筛选条件动态计算
   - 统计信息 (均值、中位数、标准差等) 基于筛选后的数据

3. ✅ **真实值 vs 预测值对比**
   - 评估指标根据置信度筛选器动态更新
   - 支持查看不同置信度级别的预测性能

---

## 使用说明

### 重新提取 confidence 字段

如果需要为现有任务重新提取 confidence 字段:

```bash
# 单个任务
python scripts/add_confidence_to_existing_results.py <task_id>

# 所有任务
python scripts/add_confidence_to_existing_results.py --all

# 试运行 (不实际写入文件)
python scripts/add_confidence_to_existing_results.py <task_id> --dry-run
```

### 查看可视化图表

1. 访问任务结果页面
2. 使用置信度筛选器选择要查看的数据:
   - All Data: 显示所有样本
   - High Confidence: 仅显示高置信度样本
   - Medium Confidence: 仅显示中等置信度样本
   - Low Confidence: 仅显示低置信度样本
3. 所有图表和评估指标会自动更新

---

## 技术细节

### Confidence 提取逻辑

支持的格式:
- 标准格式: `"confidence": "high"` / `"medium"` / `"low"`
- 变体格式: `"confidence": "medium-high"` → 解析为 `"high"`
- 包含关键词: 任何包含 "high"/"medium"/"low" 的字符串

### 评估指标计算

所有评估指标 (MAE, RMSE, R²) 都使用 `useMemo` 钩子,确保:
- 仅在数据变化时重新计算
- 性能优化,避免不必要的计算
- 与筛选条件实时同步

---

## 已知限制

1. 如果 LLM 返回错误信息 (如连接错误),无法提取 confidence 字段
   - 这些样本的 confidence 将为 `null`
   - 在筛选时会被排除在所有置信度级别之外

2. 评估指标计算需要至少 2 个样本
   - 如果筛选后样本数 < 2,R² 可能无法准确计算

