# 迭代预测任务修复说明

## 任务ID
`db937356-801e-48cc-94dc-64f0e587fe8b`

## 修复的问题

### 问题1: `sample_size` 参数未生效 ✅ 已修复

**问题描述:**
- `task_config.json` 中设置了 `sample_size: 1`
- 但实际执行时预测了所有47个样本，而不是每轮只预测1个样本

**根本原因:**
- 代码逻辑已经正确实现了随机采样（第209-222行）
- 参数也正确传递到了 state 中（第1266行）
- 问题可能是之前运行的任务使用了旧代码

**修复方案:**
- 确认代码逻辑正确：
  ```python
  if state["sample_size"] is not None and state["sample_size"] > 0:
      num_to_predict = min(state["sample_size"], len(candidate_samples))
      samples_to_predict = random.sample(candidate_samples, num_to_predict)
  ```
- 重新运行任务将使用正确的 `sample_size` 参数

---

### 问题2: 输出文件格式错误 ✅ 已修复

**问题描述:**
- 当前保存的是 JSON 格式文件（`iteration_X.json`）
- 应该保存为 TXT 格式文件（`iteration_X.txt`），包含三部分内容

**修复方案:**
修改 `_save_prompts_and_responses` 方法，改为保存 TXT 格式文件，包含：

1. **PROMPT 部分**: 发送给 LLM 的完整提示词
2. **LLM RESPONSE 部分**: LLM 返回的原始响应文本
3. **RETRIEVED REFERENCE SAMPLES 部分**: 检索到的参考样本信息

**文件结构:**
```
outputs/
  sample_0/
    iteration_1.txt  (TXT格式，包含三部分内容)
    iteration_2.txt
    ...
  sample_1/
    iteration_1.txt
    ...
```

**文件内容格式:**
```
================================================================================
PROMPT (发送给LLM的完整提示词)
================================================================================
[完整的prompt文本]

================================================================================
LLM RESPONSE (LLM返回的原始响应)
================================================================================
[LLM的原始响应文本]

================================================================================
RETRIEVED REFERENCE SAMPLES (检索到的参考样本)
================================================================================

--- Reference Sample 1 ---
[样本1的详细信息]

--- Reference Sample 2 ---
[样本2的详细信息]
...
```

---

### 问题3: 缺少 `process_details.json` 文件 ✅ 已修复

**问题描述:**
- 迭代预测任务没有生成 `process_details.json` 文件
- 该文件用于记录所有任务执行详情（中文）

**修复方案:**
新增 `_save_process_details` 方法，在每轮迭代后生成/更新 `process_details.json`

**文件内容结构:**
```json
[
  {
    "sample_index": 0,
    "sample_text": "样本的完整文本描述",
    "iteration": 1,
    "true_values": {
      "UTS(MPa)": 1200.0,
      "El(%)": 21.82
    },
    "predicted_values": {
      "UTS(MPa)": 1150.0,
      "El(%)": 20.5
    },
    "prompt": "完整的prompt文本",
    "llm_response": "LLM的响应文本",
    "similar_samples": [...]
  },
  ...
]
```

---

## 修改的文件

### `backend/services/iterative_prediction_service.py`

1. **修改 `_save_prompts_and_responses` 方法** (第843-1008行)
   - 改为保存 TXT 格式文件
   - 包含三部分内容：Prompt、LLM Response、Similar Samples

2. **新增 `_save_process_details` 方法** (第843-938行)
   - 生成 `process_details.json` 文件
   - 记录每个样本每轮迭代的详细信息

3. **修改 `_save_incremental_results_to_filesystem` 方法** (第822-841行)
   - 添加调用 `_save_process_details` 的逻辑

4. **修改 `_predict_single_sample` 方法** (第1212-1222行)
   - 在保存 response 时包含完整的 `similar_samples` 列表

---

## 验证方法

运行测试脚本验证修复:
```bash
python test_iterative_fixes.py
```

或手动检查:
1. 检查 `task_config.json` 中的 `sample_size` 配置
2. 检查 `outputs/` 目录下是否为 `.txt` 文件
3. 检查是否存在 `process_details.json` 文件

---

## 注意事项

1. **已有任务**: 之前运行的任务 `db937356-801e-48cc-94dc-64f0e587fe8b` 需要重新运行才能应用这些修复
2. **文件格式**: 新的输出格式与非迭代预测保持一致，便于统一处理
3. **增量更新**: `process_details.json` 在每轮迭代后都会更新，包含所有已完成的迭代记录

