# 修复批量重新预测对话框中的数据集统计信息显示

## 问题描述

在任务历史页面（`frontend/pages/tasks.tsx`）的批量重新预测配置对话框中，RAG 检索配置显示的数据集统计信息不正确。

### 错误示例

```
原始数据集：47 个样本
训练集：37 个样本（80%）
测试集：10 个样本
检索样本数：186 个（占训练集 502.70%）
```

### 问题分析

1. **字段含义理解错误**：
   - `total_rows`：这是**测试集**的样本数量（不是原始数据集的总行数）
   - `valid_rows`：这是测试集中预测值为非零且非空的样本数量（不是原始数据集的有效行数）
   - `original_total_rows` 和 `original_valid_rows`：这两个字段已废弃，不应该使用

2. **数据来源错误**：
   - 前端使用了任务对象的 `original_total_rows` 字段（值为 47）
   - 这个值实际上是测试集的样本数，而不是原始数据集的总行数
   - 正确的原始数据集行数应该从**数据集管理**（`dataset_db`）中获取

3. **根本原因**：
   - 任务完成后，`total_rows` 和 `valid_rows` 会被更新为测试集的统计信息
   - 在任务创建时，`original_total_rows` 被设置为 `total_rows` 的初始值
   - 但这个初始值可能已经是错误的（如果是从旧任务复制的配置）

## 解决方案

### 1. 后端修改

#### 1.1 更新数据库模型注释（`backend/database/models.py`）

```python
# 数据统计信息
total_rows = Column(Integer, nullable=True)  # 测试集样本数（任务完成后更新）
valid_rows = Column(Integer, nullable=True)  # 测试集有效样本数（任务完成后更新）
original_total_rows = Column(Integer, nullable=True)  # 已废弃：不再使用（应从数据集获取原始行数）
original_valid_rows = Column(Integer, nullable=True)  # 已废弃：不再使用（应从数据集获取原始行数）
```

#### 1.2 在任务列表 API 中返回 `file_id`（`backend/database/task_db.py`）

```python
result = {
    "task_id": task.task_id,
    "status": task.status,
    "file_id": task.file_id,  # 关联的数据集ID或文件ID
    "filename": task.filename,
    # ... 其他字段
}
```

#### 1.3 更新 API Schema（`backend/models/schemas.py`）

```python
class TaskInfo(BaseModel):
    task_id: str
    status: str
    file_id: Optional[str] = None  # 关联的数据集ID或文件ID
    filename: str
    total_rows: Optional[int] = None  # 测试集样本数（任务完成后更新）
    valid_rows: Optional[int] = None  # 测试集有效样本数（任务完成后更新）
    # ... 其他字段
```

### 2. 前端修改

#### 2.1 添加 Dataset 接口（`frontend/pages/tasks.tsx`）

```typescript
interface Dataset {
  dataset_id: string;
  filename: string;
  original_filename: string;
  file_path: string;
  row_count: number; // 原始数据集总行数
  column_count: number;
  columns: string[];
  file_size: number;
  file_hash?: string;
  uploaded_at: string;
  last_used_at?: string;
  description?: string;
  tags: string[];
  usage_count: number;
}
```

#### 2.2 添加数据集信息缓存和获取函数

```typescript
// 数据集信息缓存
const [datasetCache, setDatasetCache] = useState<Map<string, Dataset>>(new Map());
const [editingTaskDataset, setEditingTaskDataset] = useState<Dataset | null>(null);

// 获取数据集信息（带缓存）
const getDatasetInfo = async (datasetId: string): Promise<Dataset | null> => {
  if (datasetCache.has(datasetId)) {
    return datasetCache.get(datasetId)!;
  }

  try {
    const response = await fetch(`http://localhost:8000/api/datasets/${datasetId}`);
    if (!response.ok) return null;
    const dataset: Dataset = await response.json();
    setDatasetCache(prev => new Map(prev).set(datasetId, dataset));
    return dataset;
  } catch (err) {
    console.error(`Error fetching dataset ${datasetId}:`, err);
    return null;
  }
};
```

#### 2.3 在编辑任务时获取数据集信息

```typescript
useEffect(() => {
  if (!editingTaskId) {
    setEditingTaskDataset(null);
    return;
  }

  const currentTask = batchRerunTasks.find(t => t.task_id === editingTaskId);
  if (!currentTask?.file_id) {
    setEditingTaskDataset(null);
    return;
  }

  getDatasetInfo(currentTask.file_id).then(dataset => {
    setEditingTaskDataset(dataset);
  });
}, [editingTaskId, batchRerunTasks]);
```

#### 2.4 使用数据集信息计算统计数据

```typescript
const datasetRowCount = editingTaskDataset?.row_count || 0;
const trainRatio = editingConfig.train_ratio || 0.8;
const trainCount = Math.floor(datasetRowCount * trainRatio);
const testCount = datasetRowCount - trainCount;
const retrievalRatio = trainCount > 0
  ? ((editingConfig.max_retrieved_samples || 0) / trainCount * 100).toFixed(2)
  : '0.00';
```

## 验证结果

使用数据集 `e53545fd-d107-4168-9e0a-dd43eb586347`（Titanium_Alloy_Dataset_Processed_cleaned.csv）：

- **原始数据集**：233 个样本（从数据集管理获取）
- **训练集（80%）**：233 × 0.8 = 186 个样本
- **测试集（20%）**：233 - 186 = 47 个样本
- **检索样本数**：186 个
- **检索比例**：186 / 186 × 100% = **100%**（正确！）

之前显示的 502.70% 是因为使用了错误的基数（47 个样本，即测试集样本数）。

## 双向同步逻辑验证

批量重新预测对话框中的"检索样本数量"输入框已经实现了真正的双向同步：

### 实现原理

1. **数量输入框 → 比例输入框**：
   - 当用户修改数量输入框时，更新 `editingConfig.max_retrieved_samples`
   - 比例输入框使用 `placeholder` 显示当前计算的比例
   - 当用户点击比例输入框时（`onFocus`），会显示当前计算的比例值

2. **比例输入框 → 数量输入框**：
   - 用户可以直接在比例输入框中输入任意数值（如 0.75、1.2 等）
   - 当用户失去焦点（`onBlur`）或按下回车键时，计算新的样本数量：`Math.round(ratio * trainCount)`
   - 更新 `editingConfig.max_retrieved_samples`
   - 数量输入框的 `value` 自动更新

3. **训练集比例改变时**：
   - 当 `train_ratio` 改变时，`trainCount` 会重新计算
   - 比例输入框的 `placeholder` 会自动重新计算并更新
   - 显示的比例会自动调整

### 用户体验改进

- **支持任意输入**：比例输入框现在使用 `type="text"`，用户可以直接输入任意数值（如 0.75、0.333 等）
- **焦点管理**：
  - 未获取焦点时，显示 `placeholder`（当前计算的比例）
  - 获取焦点时，显示可编辑的比例值
  - 失去焦点或按下回车时，计算并更新样本数
- **允许超过 1 的比例**：用户可以输入大于 1 的比例（如 1.5 表示 150%），系统会自动计算对应的样本数

### 与新建预测页面的对比

| 特性 | 新建预测页面 | 批量重新预测对话框 |
|------|-------------|-------------------|
| 训练集样本数计算 | 使用独立状态 `trainSampleCount` | 使用立即执行函数计算 |
| 比例输入框 `value` | `trainSampleCount > 0 ? (maxRetrievedSamples / trainSampleCount).toFixed(3) : ''` | 立即执行函数计算 |
| 双向同步 | ✅ 支持 | ✅ 支持 |
| 数据来源 | `DatasetSplitPanel` 回调 | `editingTaskDataset.row_count` |

两种实现方式都能正确实现双向同步，只是实现细节略有不同。

## 测试验证

### 测试步骤

1. **打开任务历史页面**：访问 `http://localhost:3000/tasks`

2. **选择已完成的任务**：选择一个已完成的任务（如 task_id: `b6599b2e-df01-4ef5-aece-d50fd7c1386f`）

3. **点击"批量重新预测"按钮**

4. **验证数据集统计信息**：
   - 原始数据集：应该显示 **233** 个样本（而不是 47）
   - 训练集：应该显示 **186** 个样本（80%）
   - 测试集：应该显示 **47** 个样本
   - 检索样本数：如果是 186 个，应该显示占训练集 **100%**（而不是 502.70%）

5. **测试比例输入框**：
   - 点击比例输入框，应该显示当前的比例值（如 1.000）
   - 直接输入一个新的比例（如 0.5）
   - 按下回车或点击其他地方，数量输入框应该自动更新为 93（186 × 0.5）
   - 比例输入框应该显示 0.500

6. **测试数量输入框**：
   - 在数量输入框中输入一个新的数量（如 100）
   - 点击比例输入框，应该显示 0.538（100 / 186）

7. **测试训练集比例改变**：
   - 修改训练集比例（如改为 0.7）
   - 训练集样本数应该更新为 163（233 × 0.7）
   - 检索比例应该自动重新计算

### 预期结果

- ✅ 数据集统计信息显示正确（233 个样本，而不是 47）
- ✅ 检索比例在合理范围内（0-100%，或更高如果用户输入大于 1 的比例）
- ✅ 比例输入框支持直接输入任意数值
- ✅ 数量和比例输入框实现真正的双向同步
- ✅ 训练集比例改变时，统计信息自动更新

## 总结

1. **核心修复**：从数据集管理中获取原始数据集的 `row_count`，而不是使用任务对象的 `total_rows` 或 `original_total_rows`
2. **字段废弃**：`original_total_rows` 和 `original_valid_rows` 字段已废弃，不应该使用
3. **正确理解**：`total_rows` 和 `valid_rows` 是测试集的统计信息，不是原始数据集的统计信息
4. **数据来源**：原始数据集的行数应该从 `Dataset` 表的 `row_count` 字段获取
5. **双向同步**：批量重新预测对话框已经正确实现了数量和比例输入框的双向同步
6. **用户体验**：比例输入框支持直接输入任意数值，提供更好的用户体验

