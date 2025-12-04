# 修复验证测试

## 问题1：提示词模板预览功能

### 已修复内容
1. **前端错误处理改进** (`frontend/components/PromptTemplateEditor.tsx`)
   - 添加了详细的控制台日志记录
   - 改进了Pydantic验证错误的解析逻辑
   - 添加了`rawDetail`属性来保存原始错误信息
   - 改进了`formatValue`函数，正确处理对象和数组

2. **测试步骤**
   - 打开 http://localhost:3000/prediction
   - 点击"提示词模板"标签
   - 点击"预览模板"按钮
   - 检查控制台日志和预览结果

### 预期结果
- 如果有验证错误，应该显示清晰的错误信息（字段路径 + 错误消息）
- 如果成功，应该显示完整的渲染后的提示词

---

## 问题2：增量预测的sample_index逻辑

### 已修复内容
1. **保留原始索引** (`backend/services/rag_prediction_service.py` 第464-477行)
   - 在测试集开始时重置索引为0, 1, 2...
   - 移除了随机抽样后的`reset_index(drop=True)`
   - 抽样后的索引保持原始测试集的索引

2. **process_details排序** (`backend/services/rag_prediction_service.py` 第203-232行)
   - 合并后按`sample_index`升序排序

### 测试步骤
1. 第一次预测：设置sample_size=2
2. 第二次增量预测：设置sample_size=6，使用continue_from_task_id
3. 检查`process_details.json`中的sample_index是否为0, 1, 2, 3, 4, 5

### 预期结果
- `process_details.json`中的样本按sample_index升序排列
- sample_index对应测试集的原始行号（0-based）

---

## 问题3：增量预测的predictions.csv合并格式

### 已修复内容
1. **列顺序保持** (`backend/services/rag_prediction_service.py` 第639-685行)
   - 以已有结果的列顺序为基准
   - 新增列追加到末尾
   - 避免使用set导致的列顺序混乱

2. **排序逻辑** 
   - 如果存在`_original_row_id`列，按该列排序
   - 否则保持合并后的顺序

3. **详细日志**
   - 添加了合并前后的行数日志

### 测试步骤
1. 第一次预测：预测2个样本
2. 第二次增量预测：预测4个新样本（无重复）
3. 检查`predictions.csv`的列顺序和数据完整性

### 预期结果
- 列顺序与原始文件一致
- 数据类型正确（数值列不变成字符串）
- 无重复行
- 共6行数据（2+4）

---

## 测试场景

### 场景1：无重复的增量预测
1. 第一次：预测样本索引0, 1（共2个）
2. 第二次：预测样本索引2, 3, 4, 5（共4个）
3. 结果：6个样本，索引0-5

### 场景2：有重复的重新预测
1. 第一次：预测样本索引0, 1, 2, 3, 4（共5个）
2. 第二次：重新预测样本索引1, 3（共2个，覆盖原有值）
3. 结果：5个样本，索引0-4，其中1和3的值被更新

