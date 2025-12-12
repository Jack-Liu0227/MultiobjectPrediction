# RAG Configuration Quick Reference

## 📊 Statistics Display

```
当前数据集共 1000 个样本
训练集：800 个样本（80%）
测试集：200 个样本
检索样本数：50 个（占训练集 6.25%）
```

**What it means:**
- Your dataset has 1000 total samples
- 80% (800 samples) are used for training
- 20% (200 samples) are used for testing
- You're retrieving 50 samples, which is 6.25% of the training set

## 🔢 Input Methods (Bidirectional Sync)

### Method 1: Absolute Count
```
Input: 50 (in left box)
Result: Retrieves exactly 50 samples
Auto-sync: Right box shows "0.063" (if training set = 800)
```

**When to use:**
- You know exactly how many samples you want
- You want consistent count across different datasets
- Example: Always retrieve 50 samples

**New Feature**: The ratio box automatically updates to show the percentage!

### Method 2: Relative Ratio
```
Input: 0.8 (in right box)
Result: Retrieves 80% of training set
Calculation: 0.8 × 800 = 640 samples
Auto-sync: Left box updates to "640"
```

**When to use:**
- You want a percentage of training data
- You want the count to scale with dataset size
- Example: Always retrieve 80% of training samples

**New Feature**: The count box automatically updates to show the exact number!

## 🎯 Recommended Values

| Dataset Size | Absolute Count | Ratio | Use Case |
|-------------|----------------|-------|----------|
| Small (< 100) | 10-20 | 0.2-0.3 | Quick experiments |
| Medium (100-1000) | 50-100 | 0.3-0.5 | Balanced accuracy/speed |
| Large (> 1000) | 100-200 | 0.1-0.2 | Production use |

## 🔮 Special Modes

### Zero-shot Mode
```
Input: 0 (either box)
Result: No reference samples retrieved
Use: Test LLM's inherent knowledge
```

**When to use:**
- Baseline comparison
- No similar training data available
- Testing model capabilities

### Full Training Set
```
Input: 1.0 (ratio box)
Result: Retrieves all training samples
Use: Maximum context for prediction
```

**When to use:**
- Small datasets
- Maximum accuracy needed
- Speed is not a concern

## 📐 Calculation Formulas

### Training Set Size
```
training_set_size = Math.floor(total_samples × train_ratio)
```

### Test Set Size
```
test_set_size = total_samples - training_set_size
```

### Absolute Count from Ratio
```
max_retrieved_samples = Math.round(ratio × training_set_size)
```

### Ratio from Absolute Count
```
retrieval_ratio = (max_retrieved_samples / training_set_size) × 100%
```

## 🔄 Bidirectional Linkage Behavior

### Scenario 1: Change Absolute Count
```
Action: Type "100" in left box
Effect:
  - Left box: 100
  - Right box: Auto-updates to "0.125" (if training set = 800)
  - Statistics: Shows "占训练集 12.50%"
```

### Scenario 2: Change Ratio
```
Action: Type "0.5" in right box
Effect:
  - Right box: 0.500
  - Left box: Auto-updates to "400" (if training set = 800)
  - Statistics: Shows "占训练集 50.00%"
```

### Scenario 3: Change Train Ratio
```
Action: Change train_ratio from 0.8 → 0.7 in Basic Config
Effect:
  - Training set: 800 → 700
  - Test set: 200 → 300
  - If absolute count = 50:
    - Left box: Still shows 50
    - Right box: Auto-updates to "0.071" (50/700)
    - Statistics: Shows "占训练集 7.14%"
```

**Key Point**: Both boxes **always show values** and stay synchronized!

## ⚠️ Common Mistakes

### Mistake 1: Setting Ratio > 1
```
❌ Input: 1.5 in ratio box
✅ Valid range: 0-1
```

### Mistake 2: Retrieving More Than Training Set
```
❌ Input: 1000 samples (if training set = 800)
⚠️ Warning: You'll retrieve all 800 available samples
```

### Mistake 3: Forgetting to Update After Changing Train Ratio
```
❌ Change train_ratio but forget to check retrieval count
✅ Always review statistics display after changing train_ratio
```

## 💡 Pro Tips

1. **Start with Ratio**: Use ratio mode for initial experiments, then fine-tune with absolute count
2. **Monitor Percentage**: Keep retrieval ratio between 10-50% for best balance
3. **Consider Speed**: Higher counts = slower but more accurate predictions
4. **Use Zero-shot**: Always run a zero-shot baseline for comparison
5. **Scale Appropriately**: Larger datasets need lower ratios (but higher absolute counts)

## 🎓 Examples

### Example 1: Small Dataset Experiment
```
Dataset: 200 samples
Train Ratio: 0.8
Training Set: 160 samples
Recommendation: 30 samples (0.19 ratio)
```

### Example 2: Production Prediction
```
Dataset: 5000 samples
Train Ratio: 0.8
Training Set: 4000 samples
Recommendation: 200 samples (0.05 ratio)
```

### Example 3: Baseline Comparison
```
Dataset: Any size
Train Ratio: 0.8
Zero-shot: 0 samples
Few-shot: 10 samples (0.01-0.05 ratio)
Full-shot: 100+ samples (0.1-0.5 ratio)
```

