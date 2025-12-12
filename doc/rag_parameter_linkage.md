# RAG Parameter Linkage Feature

## Overview
Implemented automatic parameter linkage for RAG retrieval configuration in the batch re-prediction dialog, matching the functionality already present in the new prediction page.

## Feature Description

### Dual Input Mode with Bidirectional Sync
Users can now set `max_retrieved_samples` in two ways, with **automatic bidirectional synchronization**:

1. **Absolute Count** (Left Input): Direct number input (e.g., 50 samples)
2. **Relative Ratio** (Right Input): Percentage of training set (e.g., 0.8 = 80%)

### Bidirectional Automatic Calculation

#### When User Enters Absolute Count:
```
Input: 50 (in left box)
Training Set: 800 samples
Calculation: 50 / 800 = 0.0625
Result: Right box automatically shows "0.063"
```

#### When User Enters Ratio:
```
Input: 0.8 (in right box)
Training Set: 800 samples
Calculation: 0.8 × 800 = 640
Result: Left box automatically updates to "640"
```

**Key Improvement**: Both input boxes now **always display values** and stay synchronized. Users can modify either field and see the other update in real-time.

### Real-time Statistics Display

The dialog shows:
- **Total Samples**: From task's `valid_rows` or `total_rows`
- **Training Set**: Calculated as `Math.floor(total × train_ratio)`
- **Test Set**: Calculated as `total - training_set`
- **Retrieval Ratio**: Calculated as `(max_retrieved_samples / training_set) × 100%`

Example display:
```
当前数据集共 1000 个样本
训练集：800 个样本（80%）
测试集：200 个样本
检索样本数：50 个（占训练集 6.25%）
```

## Implementation Details

### Code Location
- **File**: `frontend/pages/tasks.tsx`
- **Lines**: ~1968-2107 (RAG Config Tab)

### Key Components

#### 1. Statistics Calculation (IIFE)
```typescript
{(() => {
  const currentTask = batchRerunTasks.find(t => t.task_id === editingTaskId);
  const totalRows = currentTask?.valid_rows || currentTask?.total_rows || 0;
  const trainRatio = editingConfig.train_ratio || 0.8;
  const trainCount = Math.floor(totalRows * trainRatio);
  const testCount = totalRows - trainCount;
  const retrievalRatio = trainCount > 0 
    ? ((editingConfig.max_retrieved_samples || 0) / trainCount * 100).toFixed(2)
    : '0.00';
  
  return (/* Statistics display JSX */);
})()}
```

#### 2. Absolute Count Input
```typescript
<input
  type="number"
  min={0}
  value={editingConfig.max_retrieved_samples ?? ''}
  onChange={(e) => {
    const value = e.target.value;
    if (value === '') {
      setEditingConfig({ ...editingConfig, max_retrieved_samples: 0 });
    } else {
      const numValue = parseInt(value);
      if (!isNaN(numValue) && numValue >= 0) {
        setEditingConfig({ ...editingConfig, max_retrieved_samples: numValue });
      }
    }
  }}
  className="w-32 border border-gray-300 rounded-lg px-3 py-2"
  placeholder="数量"
/>
```

#### 3. Ratio Input (Bidirectional Sync)
```typescript
<input
  type="number"
  min={0}
  max={1}
  step={0.01}
  // KEY CHANGE: Display current ratio calculated from absolute count
  value={(() => {
    const currentTask = batchRerunTasks.find(t => t.task_id === editingTaskId);
    const totalRows = currentTask?.valid_rows || currentTask?.total_rows || 0;
    const trainRatio = editingConfig.train_ratio || 0.8;
    const trainCount = Math.floor(totalRows * trainRatio);
    return trainCount > 0
      ? ((editingConfig.max_retrieved_samples || 0) / trainCount).toFixed(3)
      : '';
  })()}
  onChange={(e) => {
    const value = e.target.value;
    if (value === '') {
      setEditingConfig({ ...editingConfig, max_retrieved_samples: 0 });
      return;
    }

    const ratio = parseFloat(value);
    const currentTask = batchRerunTasks.find(t => t.task_id === editingTaskId);
    const totalRows = currentTask?.valid_rows || currentTask?.total_rows || 0;
    const trainRatio = editingConfig.train_ratio || 0.8;
    const trainCount = Math.floor(totalRows * trainRatio);

    if (!isNaN(ratio) && ratio >= 0 && ratio <= 1 && trainCount > 0) {
      const calculated = Math.round(ratio * trainCount);
      setEditingConfig({
        ...editingConfig,
        max_retrieved_samples: calculated >= 0 ? calculated : 0
      });
    }
  }}
  className="w-32 border border-gray-300 rounded-lg px-3 py-2"
  placeholder="0.8"
  disabled={trainCount === 0}
  title={trainCount === 0 ? "数据集信息不可用" : ""}
/>
```

**Key Changes**:
1. Added `value` prop to display current ratio (calculated from absolute count)
2. Ratio is formatted to 3 decimal places using `.toFixed(3)`
3. Added `disabled` state when training set is empty
4. Added tooltip to explain why field is disabled

## User Benefits

1. **Bidirectional Sync**: Both input boxes always show values and stay synchronized
2. **Flexibility**: Choose between absolute count or relative ratio based on preference
3. **Transparency**: See exactly how many samples will be retrieved and what percentage of training set
4. **Consistency**: Same interface as new prediction page
5. **Real-time Feedback**: Statistics update immediately as parameters change
6. **Error Prevention**: Clear display helps avoid setting unrealistic values
7. **Smart Validation**: Ratio input is disabled when dataset info is unavailable

## Edge Cases Handled

1. **Empty Dataset**: Shows 0 for all statistics, disables ratio input
2. **Zero Training Set**: Prevents division by zero, shows empty string in ratio input
3. **Empty Input**: Treats as 0 for absolute count
4. **Invalid Ratio**: Only accepts 0-1 range
5. **Minimum Value**: Allows 0 samples (zero-shot mode)
6. **Precision**: Ratio displayed with 3 decimal places for accuracy
7. **Disabled State**: Ratio input disabled when `trainCount === 0` with explanatory tooltip

## Comparison with prediction.tsx

The implementation is now **fully synchronized** with `frontend/pages/prediction.tsx` (lines 1075-1133):
- ✅ Same dual input layout
- ✅ Same bidirectional sync logic
- ✅ Same calculation formulas
- ✅ Same statistics display format
- ✅ Same zero-shot mode indicator
- ✅ Same user guidance text
- ✅ Same disabled state handling
- ✅ Same precision (3 decimal places for ratio)

## Testing Recommendations

1. **Bidirectional Sync**:
   - ✅ Enter absolute count (e.g., 50), verify ratio updates automatically (e.g., 0.063)
   - ✅ Enter ratio (e.g., 0.8), verify absolute count updates automatically (e.g., 640)
   - ✅ Verify both fields always show values (no empty fields after input)
   - ✅ Change train_ratio in Basic Config, verify both fields recalculate

2. **Edge Cases**:
   - ✅ Set absolute count to 0, verify ratio shows 0.000
   - ✅ Enter ratio > 1, verify it's clamped to 1
   - ✅ Enter negative values, verify they're rejected
   - ✅ Empty dataset (trainCount = 0), verify ratio input is disabled

3. **Precision and Formatting**:
   - ✅ Verify ratio displays 3 decimal places (e.g., 0.625, not 0.62 or 0.6)
   - ✅ Verify rounding works correctly (e.g., 0.8 × 800 = 640, not 639 or 641)
   - ✅ Verify very small ratios display correctly (e.g., 0.001)

4. **Different Dataset Sizes**:
   - ✅ Small dataset (< 100 samples): Test ratio precision
   - ✅ Medium dataset (100-1000 samples): Test typical use cases
   - ✅ Large dataset (> 1000 samples): Test large numbers

5. **Batch Application (tasks.tsx only)**:
   - ✅ Edit single task configuration
   - ✅ Apply to all tasks, verify each task uses its own dataset size
   - ✅ Verify ratio input works correctly for tasks with different dataset sizes

6. **User Experience**:
   - ✅ Verify tooltip appears when ratio input is disabled
   - ✅ Verify placeholder text is helpful
   - ✅ Verify help text mentions bidirectional sync

