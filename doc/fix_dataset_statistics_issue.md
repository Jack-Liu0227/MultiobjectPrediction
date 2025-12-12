# Fix: Dataset Statistics Display Issue in Batch Re-prediction

## Problem Description

### Symptom
In the batch re-prediction configuration dialog (`frontend/pages/tasks.tsx`), the RAG configuration tab displayed incorrect dataset statistics:

```
当前数据集共 9 个样本
训练集：7 个样本（80%）
测试集：2 个样本
检索样本数：186 个（占训练集 2657.14%）
```

The retrieval ratio of 2657.14% is clearly incorrect and indicates a fundamental issue with the dataset size calculation.

### Root Cause

The `total_rows` and `valid_rows` fields in the Task model were being **overwritten** after task completion:

1. **Task Creation** (`backend/api/prediction.py` lines 154-161):
   - `total_rows` = original CSV file row count
   - `valid_rows` = rows with non-null target values

2. **Task Completion** (`backend/services/rag_prediction_service.py` lines 1209-1227):
   - `total_rows` = **result file row count** (overwritten!)
   - `valid_rows` = rows with all predicted values non-null and non-zero (overwritten!)

For completed tasks, the result file might only contain a subset of samples (e.g., 9 samples), while the original dataset had many more samples (e.g., 186+ samples based on `max_retrieved_samples`).

## Solution

### Backend Changes

#### 1. Database Schema Update (`backend/database/models.py`)

Added two new fields to preserve original dataset information:

```python
# Data statistics
total_rows = Column(Integer, nullable=True)  # Overwritten after completion
valid_rows = Column(Integer, nullable=True)  # Overwritten after completion
original_total_rows = Column(Integer, nullable=True)  # Preserved original value
original_valid_rows = Column(Integer, nullable=True)  # Preserved original value
```

#### 2. Task Creation Logic (`backend/database/task_db.py`)

When creating a task, save the original dataset statistics:

```python
task = Task(
    # ... other fields ...
    total_rows=task_data.get("total_rows"),
    valid_rows=task_data.get("valid_rows"),
    original_total_rows=task_data.get("total_rows"),  # Save original
    original_valid_rows=task_data.get("valid_rows"),  # Save original
    # ... other fields ...
)
```

#### 3. Task Serialization (`backend/database/task_db.py`)

Include new fields in task dictionary:

```python
result = {
    # ... other fields ...
    "total_rows": task.total_rows,
    "valid_rows": task.valid_rows,
    "original_total_rows": task.original_total_rows,
    "original_valid_rows": task.original_valid_rows,
    # ... other fields ...
}
```

#### 4. API Schema Update (`backend/models/schemas.py`)

Updated `TaskInfo` schema to include new fields:

```python
class TaskInfo(BaseModel):
    # ... other fields ...
    total_rows: Optional[int] = None  # Result file statistics
    valid_rows: Optional[int] = None  # Result file statistics
    original_total_rows: Optional[int] = None  # Original dataset
    original_valid_rows: Optional[int] = None  # Original dataset
    # ... other fields ...
```

### Frontend Changes

#### 1. Task Interface Update (`frontend/pages/tasks.tsx`)

Added new fields to Task interface:

```typescript
interface Task {
  // ... other fields ...
  total_rows?: number; // Result file statistics (after completion)
  valid_rows?: number; // Result file statistics (after completion)
  original_total_rows?: number; // Original dataset (preserved)
  original_valid_rows?: number; // Original dataset (preserved)
  // ... other fields ...
}
```

#### 2. Dataset Statistics Display Logic

Updated to use `original_total_rows` with fallback for old tasks:

```typescript
// Prefer original_total_rows (won't be overwritten)
// Fallback to total_rows for old tasks
const originalTotalRows = currentTask?.original_total_rows || currentTask?.total_rows || 0;

// Show warning for old tasks
const isUsingFallback = !currentTask?.original_total_rows && currentTask?.total_rows;
const showWarning = isUsingFallback && isCompleted;
```

#### 3. Ratio Input Calculation

Updated to use `original_total_rows` for accurate training set size calculation:

```typescript
const totalRows = currentTask?.original_total_rows || currentTask?.total_rows || 0;
const trainCount = Math.floor(totalRows * trainRatio);
const ratio = (max_retrieved_samples / trainCount).toFixed(3);
```

### Database Migration

Created migration script: `backend/database/migrations/add_original_rows_fields.py`

**To run the migration:**
```bash
python -m backend.database.migrations.add_original_rows_fields
```

**What it does:**
1. Adds `original_total_rows` and `original_valid_rows` columns to `tasks` table
2. Copies existing `total_rows` and `valid_rows` values to new columns (for old tasks)
3. Note: For old completed tasks, these values may still be inaccurate (result file stats)

## Impact

### For New Tasks
- ✅ Accurate dataset statistics always displayed
- ✅ Correct retrieval ratio calculation
- ✅ Reliable parameter linkage between absolute count and ratio

### For Old Tasks (Before Migration)
- ⚠️ May show inaccurate statistics (result file stats)
- ⚠️ Warning message displayed to inform users
- ⚠️ Recommendation: Re-create tasks for accurate statistics

### For Old Tasks (After Migration)
- ⚠️ Statistics copied from current values (may be inaccurate)
- ⚠️ Warning message displayed for completed tasks
- ✅ New re-runs will have accurate statistics

## Testing

### Test Cases

1. **New Task Creation**:
   - Create task with 1000-row dataset
   - Verify `original_total_rows` = 1000
   - Complete task
   - Verify `original_total_rows` still = 1000
   - Verify `total_rows` = result file row count

2. **Batch Re-prediction Dialog**:
   - Open dialog for completed task
   - Verify dataset statistics show original values
   - Verify retrieval ratio is reasonable (0-100%)
   - Test ratio input → absolute count conversion
   - Test absolute count → ratio display

3. **Old Task Compatibility**:
   - Open dialog for old task (before migration)
   - Verify warning message appears
   - Verify fallback to `total_rows` works

## Files Modified

### Backend
- `backend/database/models.py` - Added new columns
- `backend/database/task_db.py` - Save and serialize new fields
- `backend/models/schemas.py` - Updated TaskInfo schema

### Frontend
- `frontend/pages/tasks.tsx` - Updated Task interface and display logic

### Migration
- `backend/database/migrations/add_original_rows_fields.py` - Database migration script

### Documentation
- `doc/fix_dataset_statistics_issue.md` - This document

