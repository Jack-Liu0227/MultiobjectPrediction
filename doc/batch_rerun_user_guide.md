# Batch Re-prediction User Guide

## Quick Start

### Step 1: Select Tasks
1. Navigate to the Tasks page
2. Select one or more completed tasks using checkboxes
3. Click the "批量重新预测" (Batch Re-run) button

### Step 2: Review and Configure
The batch re-run dialog will show a preview table with all selected tasks and their configurations.

**Table Columns:**
- **序号**: Task number
- **任务ID**: Task identifier (truncated)
- **数据集**: Dataset filename
- **模型**: Model provider and name
- **温度**: Temperature setting
- **样本**: Sample size
- **训练比**: Training ratio (as percentage)
- **检索数**: Max retrieved samples
- **备注**: Optional notes for this re-run
- **操作**: Edit configuration button

### Step 3: Edit Configuration (Optional)

#### Individual Task Configuration
Click "编辑配置" (Edit Config) on any task row to modify that task's configuration.

#### Batch Configuration
Click "统一编辑所有任务配置" (Edit All Tasks Config) to apply the same configuration to all selected tasks.

### Step 4: Configure Settings

The configuration dialog has 4 tabs:

#### 🤖 Basic Config
**Test Sample Size**
- Number of samples to randomly select from test set
- Must be > 0
- Example: 100

**Workers (Parallel Threads)**
- Number of concurrent prediction threads
- Range: 1-20
- Recommended: 5-10
- Higher values = faster but more resource-intensive

**Train Ratio**
- Percentage of data used for training
- Range: 0.5-0.9 (50%-90%)
- Recommended: 0.8 (80%)
- Remaining data is used for testing

**Random Seed**
- Seed for reproducible dataset splitting
- Range: 1-9999
- Default: 42
- Use the same seed to get identical train/test splits

#### 🔍 RAG Config

**Dataset Statistics (Auto-calculated)**
The dialog automatically displays:
- Total samples in the dataset
- Training set size (based on train_ratio from Basic Config)
- Test set size
- Current retrieval ratio (percentage of training set)

Example:
```
当前数据集共 1000 个样本
训练集：800 个样本（80%）
测试集：200 个样本
检索样本数：50 个（占训练集 6.25%）
```

**Max Retrieved Samples (Dual Input Mode)**
You can set this value in two ways:

1. **Absolute Count** (Left input):
   - Directly enter the number of samples to retrieve
   - Example: Enter `50` to retrieve 50 samples
   - Range: ≥ 0
   - Recommended: 20-100

2. **Relative Ratio** (Right input):
   - Enter a ratio of the training set
   - Example: Enter `0.8` to retrieve 80% of training samples
   - Range: 0-1
   - Recommended: 0.2-0.5 (20%-50%)

**Automatic Linkage:**
- When you enter a ratio (e.g., 0.8), the absolute count is automatically calculated
  - If training set = 800 samples, then 0.8 × 800 = 640 samples
- When you enter an absolute count (e.g., 50), the display shows the ratio
  - If training set = 800 samples, then 50 / 800 = 6.25%
- When you change train_ratio in Basic Config, the training set size is recalculated

**Zero-shot Mode:**
- Set to 0 (either input) for zero-shot mode
- System will not retrieve any reference samples
- Prediction relies entirely on LLM's knowledge

**Similarity Threshold**
- Minimum cosine similarity score to include a sample
- Range: 0-1
- Recommended: 0.3
- Higher values = more selective (only very similar samples)
- Lower values = more inclusive (more diverse samples)

**How it works:**
1. System calculates similarity between test sample and all training samples
2. Filters samples with similarity ≥ threshold
3. Returns top-k samples up to max retrieved samples
4. If no samples meet threshold, returns most similar samples as fallback

#### ⚙️ LLM Config
**Model Provider**
- Select from: Gemini, OpenAI, Anthropic, DeepSeek, OpenRouter, OneAPI
- Different providers have different pricing and capabilities

**Model Name**
- Specific model identifier
- Examples:
  - Gemini: `gemini-2.5-flash`, `gemini-1.5-pro`
  - OpenAI: `gpt-4`, `gpt-3.5-turbo`
  - DeepSeek: `deepseek-chat`

**Temperature**
- Controls output randomness
- Range: 0-2
- 0 = Completely deterministic (same input → same output)
- 0.5-1.0 = Balanced (recommended for most tasks)
- 1.5-2.0 = More creative/diverse outputs

#### 🔧 Advanced Config
This tab shows read-only column configurations:
- **Composition Column**: Element composition columns
- **Processing Column**: Processing parameter columns
- **Target Columns**: Target property columns
- **Feature Columns**: Additional feature columns

**Note:** These cannot be modified in batch re-run. To change column configurations, create a new prediction task from the Prediction page.

### Step 5: Save Configuration
1. Review your settings
2. Click "保存" (Save) to apply to the current task
3. Or click "应用到所有任务" (Apply to All Tasks) if editing in batch mode

The dialog will validate your inputs and show error messages if any values are out of range.

### Step 6: Add Notes (Optional)
In the preview table, you can add notes for each task in the "备注" column. This helps track why you're re-running the task.

### Step 7: Confirm and Submit
1. Review all task configurations in the preview table
2. Click "确认重新预测" (Confirm Re-run) to submit
3. The system will create new prediction tasks with the specified configurations

## Tips and Best Practices

### When to Use Batch Re-run
- Testing different model configurations on the same dataset
- Comparing performance across different models
- Re-running failed tasks with adjusted parameters
- Experimenting with different RAG settings

### Configuration Recommendations

**For Quick Experiments:**
- Sample size: 50-100
- Workers: 5
- Temperature: 0.7
- Max retrieved samples: 50

**For Production/Final Results:**
- Sample size: Full test set
- Workers: 10
- Temperature: 0.5
- Max retrieved samples: 100

**For Zero-shot Baseline:**
- Max retrieved samples: 0
- This tests the model without any reference examples

### Common Pitfalls

1. **Too many workers**: Setting workers > 20 may overwhelm the system
2. **Extreme train ratios**: Values < 0.5 or > 0.9 may not provide meaningful results
3. **Very high temperature**: Values > 1.5 may produce inconsistent results
4. **Forgetting to add notes**: Add notes to remember why you re-ran tasks

## Troubleshooting

**Error: "温度参数必须在 0-2 之间"**
- Temperature must be between 0 and 2

**Error: "并发数必须在 1-20 之间"**
- Workers must be between 1 and 20

**Error: "训练集比例必须在 0.5-0.9 之间"**
- Train ratio must be between 0.5 and 0.9

**Configuration not saving:**
- Check that all required fields are filled
- Ensure all values are within valid ranges
- Try refreshing the page and trying again

