# LLM 响应解析优化指南

## 版本信息
- **版本**: v1.0
- **日期**: 2025-12-08
- **状态**: 已完成

## 概述

本次优化对 LLM 响应解析功能进行了全面重构，采用模块化设计，支持动态数量的目标属性和多种响应格式。

## 一、优化内容

### 1.1 核心解析模块 (`backend/services/simple_rag_engine.py`)

#### 新增模块化组件

**JSONExtractor（JSON 提取器）**
- `extract_from_code_blocks()`: 从 markdown 代码块中提取 JSON
- `extract_json_objects()`: 使用非贪婪匹配从文本中提取 JSON 对象
- `extract_all_candidates()`: 提取所有候选 JSON 字符串

**PredictionExtractor（预测值提取器）**
- `extract_from_predictions_field()`: 从 predictions 字段提取预测值
  - 支持格式1: `{"predictions": {"UTS(MPa)": {"value": 1000, "unit": "MPa"}}}`
  - 支持格式2: `{"predictions": {"UTS(MPa)": 1000}}`
  - 支持格式3: `{"predictions": {"target_1": 1000, "target_2": 2000}}`
- `extract_from_single_value_field()`: 从单值字段提取（仅适用于单目标）

**TextPatternExtractor（文本模式提取器）**
- `extract_by_patterns()`: 使用正则表达式从文本中直接提取数字

**LLMResponseParser（统一解析入口）**
- `parse()`: 主解析方法，按优先级尝试多种解析策略

**PredictionValidator（预测值验证器）**
- `validate_and_fill()`: 验证预测值并填充缺失值

### 1.2 批量验证脚本 (`scripts/batch_update_predictions.py`)

#### 框架化设计，包含以下模块：

**FileReader（文件读取模块）**
- `read_process_details()`: 读取 process_details.json
- `read_predictions_csv()`: 读取 predictions.csv

**ResponseParser（LLM 响应解析模块）**
- `parse_response()`: 解析 LLM 响应

**ResultComparator（结果对比验证模块）**
- `compare_predictions()`: 对比解析结果与已保存的预测值

**MetricsCalculator（指标计算模块）**
- `calculate_metrics()`: 计算预测指标（R², RMSE, MAE, MAPE）

**PredictionUpdater（主控制器）**
- `verify_task_predictions()`: 验证单个任务的预测结果
- `update_predictions_and_metrics()`: 更新预测结果和指标
- `process_task()`: 处理单个任务（验证、对比、更新）
- `run_batch_verification()`: 批量验证和更新所有任务

## 二、支持的 LLM 响应格式

### 2.1 多目标格式（带 value 和 unit）
```json
{
    "predictions": {
        "UTS(MPa)": {"value": 646.0, "unit": "MPa"},
        "El(%)": {"value": 4.65, "unit": "%"}
    },
    "reasoning": "..."
}
```

### 2.2 多目标格式（直接数值）
```json
{
    "predictions": {
        "UTS(MPa)": 646.0,
        "El(%)": 4.65
    }
}
```

### 2.3 通用键名格式
```json
{
    "predictions": {
        "target_1": 646.0,
        "target_2": 4.65
    }
}
```

### 2.4 单目标格式
```json
{
    "prediction_value": 646.0,
    "unit": "MPa"
}
```

### 2.5 三个或更多目标
```json
{
    "predictions": {
        "UTS(MPa)": 646.0,
        "El(%)": 4.65,
        "YS(MPa)": 500.0
    }
}
```

## 三、使用方法

### 3.1 测试解析功能
```bash
# 运行解析功能测试
python scripts/test_llm_parser.py
```

### 3.2 批量验证和更新

**试运行模式（不写入文件）**
```bash
python scripts/batch_update_predictions.py --dry-run
```

**正式运行（更新所有任务）**
```bash
python scripts/batch_update_predictions.py
```

**处理特定任务**
```bash
python scripts/batch_update_predictions.py --filter 05105c00
```

**指定结果目录**
```bash
python scripts/batch_update_predictions.py --results-dir storage/results
```

## 四、输出文件

### 4.1 验证详情 CSV
- **路径**: `storage/results/{task_id}/{task_id}_verification_details.csv`
- **包含列**:
  - `sample_index`: 样本索引
  - `is_match`: 是否匹配
  - `{target}_parsed`: 解析得到的预测值
  - `{target}_saved`: 已保存的预测值
  - `{target}_diff`: 差异值
  - `parsed_result`: 匹配到的完整解析结果（JSON 格式）
  - `saved_result`: 已保存的完整结果（JSON 格式）

### 4.2 更新的文件
- `predictions.csv`: 更新后的预测结果
- `process_details.json`: 更新后的处理详情
- `metrics.json`: 重新计算的评估指标

### 4.3 备份文件
所有更新的文件都会自动创建带时间戳的备份：
- `predictions.csv.backup_{timestamp}`
- `process_details.json.backup_{timestamp}`
- `metrics.json.backup_{timestamp}`

### 4.4 验证报告
- **路径**: `storage/results/verification_report_{timestamp}.json`
- **包含内容**: 总体统计信息和每个任务的详细统计

## 五、测试结果

所有测试用例均通过：
- ✅ 标准多目标格式（带 value 和 unit）
- ✅ 简化多目标格式（直接数值）
- ✅ 通用键名格式（target_1, target_2）
- ✅ 单目标格式
- ✅ 三个目标
- ✅ 真实 LLM 响应解析

## 六、技术特点

1. **非贪婪匹配**: 使用 `.*?` 而非 `.*` 避免过度匹配
2. **多策略解析**: 按优先级尝试多种解析策略
3. **动态目标支持**: 支持任意数量的目标属性
4. **模块化设计**: 各功能模块独立，易于维护和扩展
5. **完整的错误处理**: 包含详细的日志记录和异常处理
6. **自动备份**: 更新文件前自动创建备份

