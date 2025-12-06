# 特征列增强功能 - 完整实现文档

## 实现概述

已成功实现特征列的完整支持，包括列名映射、空值处理、Target Material 映射控制和前端集成。

## 重要修复（2024-12-05）

### 问题：预览和预测显示了所有列而不是仅显示用户选择的列

**修复前的问题**：
- 系统会显示数据集中的所有列（包括 ID、Number、未选择的特征列等）
- 用户无法控制哪些列显示在提示词中

**修复内容**：
1. **后端修复**：
   - `backend/api/prompt_templates.py`：修复预览 API，仅包含用户选择的特征列
   - `backend/services/simple_rag_engine.py`：修复实际预测逻辑，仅包含用户选择的特征列

2. **前端改进**：
   - 添加特征列选择界面（复选框列表）
   - 用户可以明确选择哪些列作为特征列
   - 提供"将选择的特征列添加到列名映射配置"快捷按钮
   - 数据集切换时自动清空特征列选择

**修复后的行为**：
- ✅ 仅显示用户选择的列：组分列、工艺列、特征列
- ✅ 不显示未选择的列（ID、Number、其他特征列等）
- ✅ 用户完全控制哪些列显示在提示词中

## 核心功能

### 1. 特征列支持
- ✅ 特征列在提示词中独立显示（每个特征一行）
- ✅ 特征列支持列名映射（与组分、工艺相同机制）
- ✅ 支持完全可选的输入组合（组分、工艺、特征任意组合）

### 2. 空值处理
- ✅ 当组分列为空时，不显示 "Composition:" 标签
- ✅ 当工艺列为空时，不显示 "Processing:" 标签
- ✅ 当特征列为空时，不显示任何特征行

### 3. Target Material 映射控制
- ✅ 新增 `apply_mapping_to_target` 配置选项（默认为 True）
- ✅ 当设置为 False 时，Target Material 保持原始列名
- ✅ Reference Samples 始终应用列名映射

### 4. 前端集成
- ✅ 列名映射配置界面（添加/删除/编辑映射条目）
- ✅ Target Material 映射控制复选框
- ✅ 预览功能支持特征列和新配置选项
- ✅ 保存/加载模板包含所有新字段

## 代码修改清单

### 后端修改（共 4 个文件）

#### 1. `backend/services/prompt_builder.py`
- **修改点 1**：添加 `apply_mapping_to_target` 参数到 `__init__` 方法
- **修改点 2**：在 `build_prompt` 中根据 `apply_mapping_to_target` 选择性应用映射
- **修改点 3**：在 `_build_prompt_with_custom_template` 中应用相同逻辑
- **修改点 4**：在 `_build_zero_shot_prompt` 中应用相同逻辑
- **修改点 5**：在 `_build_zero_shot_multi_target_prompt` 中应用相同逻辑

#### 2. `backend/services/simple_rag_engine.py`
- **修改点 1**：从 `custom_template` 中提取 `apply_mapping_to_target` 选项
- **修改点 2**：传递 `apply_mapping_to_target` 到 `PromptBuilder` 构造函数
- **修改点 3**：在样本文本构建中实现空值处理（测试样本）
- **修改点 4**：在样本文本构建中实现空值处理（相似样本）

#### 3. `backend/api/prompt_templates.py`
- **修改点 1**：在 `PromptTemplateData` 中添加 `apply_mapping_to_target` 字段
- **修改点 2**：在 `PromptPreviewRequest` 中添加 `apply_mapping_to_target` 和 `feature_columns` 字段
- **修改点 3**：在 `preview_template` 中传递 `apply_mapping_to_target` 到 `PromptBuilder`
- **修改点 4**：在测试样本构建中实现空值处理和特征列支持
- **修改点 5**：在相似样本构建中实现空值处理和特征列支持

#### 4. `backend/models/schemas.py`
- **之前已完成**：在 `RAGPreviewRequest` 中添加 `feature_columns` 字段

### 前端修改（1 个文件）

#### `frontend/components/PromptTemplateEditor.tsx`
- **修改点 1**：在 `PromptTemplate` 接口中添加 `apply_mapping_to_target` 字段
- **修改点 2**：在初始状态中设置 `apply_mapping_to_target: true`
- **修改点 3**：更新列名映射 UI，支持添加/删除映射条目
- **修改点 4**：添加 Target Material 映射控制复选框
- **修改点 5**：在预览请求中自动检测并包含特征列
- **修改点 6**：在加载模板时确保默认值正确设置

## 使用示例

### 示例 1：完整配置（组分 + 工艺 + 特征）

**配置**：
```json
{
  "column_name_mapping": {
    "Composition": "合金成分",
    "Processing": "热处理工艺",
    "Temperature": "测试温度",
    "Pressure": "施加压力",
    "Time": "保温时间"
  },
  "apply_mapping_to_target": true
}
```

**输出**：
```
=== Reference Samples ===
Sample 1:
合金成分: Al 5.3, Co 21, Cr 21.1
热处理工艺: Homogenization at 1200K
测试温度: 298K
施加压力: 1atm
保温时间: 2h

=== Target Material ===
合金成分: Al 6.0, Co 22, Cr 20.5
热处理工艺: Cold rolling to 60%
测试温度: 300K
施加压力: 1atm
保温时间: 3h
```

### 示例 2：仅特征列（无组分、无工艺）

**配置**：
```json
{
  "composition_column": [],
  "processing_column": "",
  "feature_columns": ["Temperature", "Pressure"],
  "column_name_mapping": {
    "Temperature": "温度",
    "Pressure": "压力"
  }
}
```

**输出**：
```
=== Reference Samples ===
Sample 1:
温度: 298K
压力: 1atm

=== Target Material ===
温度: 300K
压力: 1.2atm
```

### 示例 3：Target Material 不应用映射

**配置**：
```json
{
  "column_name_mapping": {
    "Processing": "热处理工艺"
  },
  "apply_mapping_to_target": false
}
```

**输出**：
```
=== Reference Samples ===
Sample 1:
热处理工艺: Homogenization at 1200K

=== Target Material ===
Processing: Cold rolling to 60%
```

## 向后兼容性

- ✅ 现有模板继续正常工作（`apply_mapping_to_target` 默认为 True）
- ✅ 不使用特征列的任务不受影响
- ✅ 空的 `column_name_mapping` 被正确处理

## 测试验证

### 后端测试结果 ✅

已通过以下测试场景：

1. **空值处理测试**：仅特征列（无组分、无工艺）
   - ✅ 不显示空的 "Composition:" 或 "Processing:" 标签
   - ✅ 特征列正确应用列名映射

2. **Target Material 映射控制测试**：
   - ✅ `apply_mapping_to_target = False`：Reference Samples 使用映射名，Target Material 使用原始名
   - ✅ `apply_mapping_to_target = True`：两部分都使用映射名

3. **特征列与列名映射测试**：
   - ✅ 组分、工艺、特征列都正确应用列名映射
   - ✅ 所有列独立显示（每个一行）

### 前端测试建议

#### 场景 1：列名映射配置
1. 打开模板编辑器
2. 点击 "添加列名映射" 按钮
3. 输入原始列名（如 "Temperature"）和显示名称（如 "测试温度"）
4. 添加多个映射条目
5. 删除某些条目
6. 保存模板并重新加载，验证配置保持不变

#### 场景 2：Target Material 映射控制
1. 配置列名映射
2. 取消勾选 "对 Target Material 部分应用列名映射"
3. 点击 "预览模板"
4. 验证 Reference Samples 使用映射名，Target Material 使用原始名

#### 场景 3：使用真实数据预览
1. 勾选 "使用真实数据预览"
2. 选择包含特征列的数据集
3. 配置列名映射（包括特征列）
4. 预览并验证特征列正确显示

## 快速开始

### 1. 启动后端服务
```bash
cd backend
uvicorn main:app --reload
```

### 2. 启动前端服务
```bash
cd frontend
npm run dev
```

### 3. 访问模板编辑器
打开浏览器访问：`http://localhost:3000`

### 4. 创建包含列名映射的模板
1. 点击 "新建模板"
2. 填写基本信息
3. 在 "列名映射配置" 部分添加映射条目
4. 配置 "对 Target Material 部分应用列名映射" 选项
5. 点击 "预览模板" 查看效果
6. 点击 "保存模板"

## 技术要点

### 列名映射的应用时机
- **训练样本文本构建**：在 `rag_prediction_service.py` 中构建样本文本时，特征列已格式化为独立行
- **查询样本文本构建**：同上
- **提示词构建**：在 `PromptBuilder._apply_column_name_mapping` 中统一应用映射
- **Target Material 控制**：通过 `apply_mapping_to_target` 参数控制是否对测试样本应用映射

### 空值处理的实现
使用列表拼接方式构建样本文本：
```python
sample_parts = []
if composition and composition.strip():
    sample_parts.append(f"Composition: {composition}")
if processing and processing.strip():
    sample_parts.append(f"Processing: {processing}")
# 添加特征列...
sample_text = "\n".join(sample_parts)
```

### 前端状态管理
- `column_name_mapping`：Record<string, string> 类型，存储列名映射
- `apply_mapping_to_target`：boolean 类型，控制 Target Material 映射
- 保存/加载时自动包含所有字段

