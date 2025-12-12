# Batch Re-prediction Configuration Enhancement

## Overview
Enhanced the batch re-prediction configuration editing interface with a tabbed dialog that supports all configuration options, providing a more powerful and user-friendly experience.

## Key Features

### 1. Tabbed Configuration Interface
Replaced the simple single-page configuration form with a 4-tab interface:

- **🤖 Basic Config**: Core prediction settings
- **🔍 RAG Config**: Retrieval-Augmented Generation settings
- **⚙️ LLM Config**: Language model settings
- **🔧 Advanced Config**: Read-only column configurations

### 2. Enhanced Configuration Options

#### Basic Config Tab
- **Test Sample Size**: Number of samples to randomly select from test set
- **Workers**: Number of parallel prediction threads (1-20, recommended: 5-10)
- **Train Ratio**: Training set ratio (0.5-0.9, recommended: 0.8)
- **Random Seed**: Random seed for dataset splitting (1-9999, default: 42)

#### RAG Config Tab
- **Dataset Statistics Display**: Shows real-time calculation of dataset split
  - Total samples in dataset
  - Training set size (calculated from train_ratio)
  - Test set size
  - Retrieval ratio (percentage of training set)

- **Max Retrieved Samples**: Dual input mode with automatic linkage
  - **Absolute Count Input**: Directly enter number of samples (e.g., 50)
  - **Relative Ratio Input**: Enter ratio of training set (e.g., 0.8 for 80%)
  - **Automatic Calculation**: Modifying either input automatically updates the other
  - Set to 0 for zero-shot mode (no reference samples)
  - Recommended: 20-100 samples or 0.2-0.5 ratio

- **Similarity Threshold**: Cosine similarity threshold (0-1)
  - Only returns samples with similarity ≥ threshold
  - Recommended: 0.3

- **Parameter Explanation**: Clear documentation of how these parameters work together

**Linkage Logic:**
- When ratio is changed: `max_retrieved_samples = Math.round(ratio × training_set_size)`
- When absolute count is changed: Display shows `ratio = count / training_set_size`
- When train_ratio is changed: Training set size is recalculated and displayed

#### LLM Config Tab
- **Model Provider**: Select from Gemini, OpenAI, Anthropic, DeepSeek, OpenRouter, OneAPI
- **Model Name**: Specific model identifier (e.g., gemini-2.5-flash, gpt-4, deepseek-chat)
- **Temperature**: Controls output randomness (0-2)
  - 0 = completely deterministic
  - 1-2 = more creative

#### Advanced Config Tab (Read-only)
- **Composition Column**: Element composition columns
- **Processing Column**: Processing parameter columns
- **Target Columns**: Target property columns
- **Feature Columns**: Feature columns
- **Note**: These columns cannot be modified in batch re-prediction. To change them, create a new prediction task.

### 3. Improved Table Display
Updated the batch re-prediction preview table to show more configuration details:
- Model provider and name
- Temperature
- Sample size
- Train ratio (displayed as percentage)
- Max retrieved samples

### 4. Enhanced Validation
Added comprehensive validation for all configuration parameters:
- Temperature: 0-2
- Sample size: > 0
- Workers: 1-20
- Train ratio: 0.5-0.9
- Max retrieved samples: ≥ 0
- Similarity threshold: 0-1
- Random seed: 1-9999

### 5. Smart Configuration Preservation
When applying configuration to all tasks:
- Shared settings (model, temperature, etc.) are updated
- Task-specific column configurations are preserved
- Prevents accidental data loss

## User Experience Improvements

1. **Clear Parameter Descriptions**: Each field includes helpful tooltips and recommended values
2. **Visual Feedback**: Active tab highlighting and clear section headers
3. **Batch Application Indicator**: Shows how many tasks will be affected when applying to all
4. **Organized Layout**: Related settings grouped together in logical tabs
5. **Responsive Design**: Dialog expanded to accommodate more content (max-w-4xl)

## Technical Implementation

### State Management
- Added `configTab` state to track active tab
- Enhanced `editingConfig` to include all configuration fields
- Improved initialization to preserve all task configuration properties

### Code Changes
- **File**: `frontend/pages/tasks.tsx`
- **Lines Modified**: ~150 lines
- **Key Functions Updated**:
  - `handleEditConfig`: Opens configuration dialog
  - `handleSaveConfig`: Validates and saves configuration with smart preservation
  - Configuration initialization: Includes all fields (composition_column, processing_column, etc.)

### Validation Logic
Enhanced validation with stricter bounds and better error messages:
- Workers limited to 1-20 (prevents resource exhaustion)
- Train ratio limited to 0.5-0.9 (ensures meaningful splits)
- Random seed limited to 1-9999 (reasonable range)

## Future Enhancements

Potential improvements for future versions:
1. Support editing column configurations (requires backend changes)
2. Add configuration templates/presets
3. Bulk import/export configurations
4. Configuration comparison view
5. Configuration history tracking

## Migration Notes

No breaking changes. Existing batch re-prediction workflows continue to work as before, with additional configuration options now available.

