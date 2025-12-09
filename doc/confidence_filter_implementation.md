# 置信度筛选功能实现文档

## 概述

本文档描述了基于置信度（confidence）的数据筛选功能的实现，包括后端数据处理和前端筛选展示两部分。

## 版本信息

- **实现日期**: 2025-12-09
- **版本**: v1.0

## 后端实现

### 1. 数据提取和存储

#### 1.1 Confidence 字段提取

- **位置**: `backend/services/simple_rag_engine.py` (lines 263-291)
- **类**: `LLMResponseParser`
- **方法**: `extract_confidence(text: str) -> Optional[str]`
- **功能**: 从 LLM 响应的 JSON 中提取 `confidence` 字段
- **返回值**: `"high"` | `"medium"` | `"low"` | `None`

#### 1.2 Confidence 存储位置

Confidence 值被存储在以下三个位置：

1. **process_details.json**
   - 路径: `storage/results/{task_id}/process_details.json`
   - 位置: 每个样本的顶层字段（与 `llm_response` 同级）
   - 实现: `backend/services/rag_prediction_service.py` (line 730)

2. **predictions.csv**
   - 路径: `storage/results/{task_id}/predictions.csv`
   - 位置: 新增的 `confidence` 列
   - 实现: 通过脚本 `scripts/add_confidence_to_existing_results.py` 添加

3. **metrics.json**
   - 当前版本不包含 confidence 信息（metrics 是针对整体数据集的统计）

### 2. 为现有数据添加 Confidence

对于已经生成的预测结果，可以使用以下脚本添加 confidence 字段：

```bash
# 为单个任务添加 confidence
python scripts/add_confidence_to_existing_results.py <task_id>

# 为所有任务添加 confidence
python scripts/add_confidence_to_existing_results.py --all

# 试运行模式（不实际写入文件）
python scripts/add_confidence_to_existing_results.py <task_id> --dry-run
```

**脚本功能**:
- 从 `process_details.json` 中读取每个样本的 `llm_response`
- 使用 `LLMResponseParser.extract_confidence()` 提取 confidence 值
- 将 confidence 添加到 `process_details.json` 的每个样本中
- 将 confidence 添加到 `predictions.csv` 中
- 自动创建备份文件（`process_details.json.backup_before_confidence`）

## 前端实现

### 1. 可复用组件

#### 1.1 useConfidenceFilter Hook

- **位置**: `frontend/hooks/useConfidenceFilter.ts`
- **功能**: 提供置信度筛选的状态管理和筛选逻辑
- **导出**:
  - `confidenceFilter`: 当前筛选条件 (`'all'` | `'high'` | `'medium'` | `'low'`)
  - `setConfidenceFilter`: 设置筛选条件
  - `filterByConfidence`: 筛选函数
  - `getFilterStats`: 获取筛选统计信息

**使用示例**:
```typescript
const { confidenceFilter, setConfidenceFilter, filterByConfidence, getFilterStats } = useConfidenceFilter();

// 筛选数据
const filteredData = filterByConfidence(predictions);

// 获取统计信息
const stats = getFilterStats(predictions);
// stats = { total, high, medium, low, unknown, filtered }
```

#### 1.2 ConfidenceFilter 组件

- **位置**: `frontend/components/ConfidenceFilter.tsx`
- **功能**: 提供按钮组样式的筛选器 UI
- **Props**:
  - `value`: 当前筛选值
  - `onChange`: 筛选值变化回调
  - `stats`: 统计信息（可选）
  - `className`: 自定义样式（可选）

**使用示例**:
```tsx
<ConfidenceFilter
  value={confidenceFilter}
  onChange={setConfidenceFilter}
  stats={getFilterStats(predictions)}
/>
```

### 2. 页面集成

#### 2.1 结果详情页 (`frontend/pages/results/[id].tsx`)

**集成位置**:
- 预测结果标签页（predictions）
- 可视化图表标签页（charts）
- 预测对比散点图标签页（scatter）

**筛选应用范围**:
- 预测数据表格
- Pareto 前沿图
- 真实值 vs 预测值对比图
- 误差分布图
- 预测散点图

#### 2.2 任务对比页 (`frontend/pages/task-comparison.tsx`)

**集成位置**:
- 对比结果展示区域

**筛选应用范围**:
- Multi-Target Scatter Plots
- Consistency Distribution Chart

### 3. 筛选器 UI 设计

**筛选选项**（按顺序）:
1. **All Data** - 默认选中，显示所有结果
2. **High Confidence** - 仅显示 `confidence === "high"` 的数据
3. **Medium Confidence** - 仅显示 `confidence === "medium"` 的数据
4. **Low Confidence** - 仅显示 `confidence === "low"` 的数据

**UI 特性**:
- 按钮组样式，带颜色区分
- 显示每个选项的样本数量
- 激活状态带有 ring 高亮效果
- 显示当前筛选结果数量

## 数据流

```
LLM Response (JSON with confidence)
    ↓
LLMResponseParser.extract_confidence()
    ↓
process_details.json (confidence field)
    ↓
Frontend loads process_details.json
    ↓
useConfidenceFilter Hook
    ↓
ConfidenceFilter UI Component
    ↓
Filtered Charts & Tables
```

## 测试验证

### 后端验证

1. 检查 `process_details.json` 中是否包含 `confidence` 字段
2. 检查 `predictions.csv` 中是否包含 `confidence` 列
3. 验证 confidence 值是否正确提取（`"high"`, `"medium"`, `"low"`, 或 `null`）

### 前端验证

1. 筛选器 UI 是否正确显示
2. 筛选器是否能正确筛选数据
3. 所有图表是否响应筛选条件的变化
4. 分页是否正确更新
5. 统计信息是否准确

## 注意事项

1. **向后兼容**: 对于没有 confidence 字段的旧数据，筛选器会将其视为 `null`，不会在任何特定置信度筛选中显示
2. **性能**: 筛选操作使用 `useMemo` 优化，避免不必要的重新计算
3. **数据一致性**: 确保后端生成的 confidence 值与前端筛选逻辑一致

