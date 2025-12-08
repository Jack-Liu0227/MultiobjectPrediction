# 提示词模板统一化修改文档

## 修改概述

本次修改统一了单目标和多目标的提示词模板格式，消除了重复代码，使用统一的模板结构。

## 修改日期

2025-12-08

## 核心变更

### 1. 统一模板格式

**原有设计：**
- 单目标和多目标使用不同的模板结构
- 有独立的 `_build_single_target_reference_section` 和 `_build_multi_target_reference_section` 方法
- 有独立的 `_build_zero_shot_prompt` 和 `_build_zero_shot_multi_target_prompt` 方法

**新设计：**
- 所有场景使用统一的多目标模板结构
- 单目标场景：`target_properties_list` 和 `reference_section` 中只包含一个属性元素
- 通过属性列表长度区分单目标（长度=1）和多目标（长度>1）

### 2. 后端修改

#### 2.1 `backend/services/prompt_builder.py`

**主要变更：**

1. **重命名协议模板**
   - `MULTI_TARGET_PROTOCOL` → `UNIFIED_PROTOCOL`
   - 适用于所有场景（单目标和多目标）

2. **统一参考样本构建方法**
   - 新增 `_build_reference_section(retrieved_samples, target_properties)` 方法
   - 删除 `_build_single_target_reference_section` 和 `_build_multi_target_reference_section`
   - 统一使用多目标格式，Properties 部分列出所有目标属性

3. **统一零样本提示词方法**
   - 更新 `_build_zero_shot_prompt(test_sample, target_properties)` 方法
   - 删除 `_build_zero_shot_multi_target_prompt`
   - 接受 `List[str]` 类型的 `target_properties` 参数

4. **简化 build_prompt 方法**
   - 移除 `is_multi_target` 分支判断
   - 统一调用 `_build_reference_section()` 和 `_build_zero_shot_prompt()`
   - 使用 `UNIFIED_PROTOCOL.format()` 构建所有提示词

5. **删除辅助方法**
   - 删除 `_build_initial_guess_section`
   - 删除 `_build_plausibility_section`

#### 2.2 `backend/services/prompt_template_manager.py`

**主要变更：**

1. **统一默认模板**
   - 新增 `default_unified` 模板（template_type: "unified"）
   - 移除单独的 `default_single_target` 和 `default_multi_target` 创建逻辑
   - 保留对旧模板的向后兼容

2. **更新模板类型验证**
   - 支持的类型：`['single_target', 'multi_target', 'unified']`
   - 推荐使用 `unified` 类型

#### 2.3 `backend/api/prompt_templates.py`

**主要变更：**

1. **更新模板数据模型**
   - `template_type` 字段描述更新为："unified（统一格式，推荐）、single_target（旧格式）或 multi_target（旧格式）"

2. **统一模板变量构建**
   - 移除 `is_multi_target` 分支判断
   - 统一使用 `_build_predictions_json_template(request.target_columns)`
   - 为单目标场景（长度=1）添加向后兼容变量：`target_property` 和 `unit`

### 3. 前端修改

#### 3.1 `frontend/components/PromptTemplateEditor.tsx`

**主要变更：**

1. **更新模板类型选项**
   ```tsx
   <option value="unified">统一格式（推荐）</option>
   <option value="single_target">单目标（旧格式）</option>
   <option value="multi_target">多目标（旧格式）</option>
   ```

2. **更新默认 JSON 模板**
   - `unified` 和 `multi_target` 使用相同的多目标格式
   - `single_target` 保留旧格式以向后兼容

## 向后兼容性

### 保留的兼容性措施

1. **模板类型**
   - 继续支持 `single_target` 和 `multi_target` 类型
   - 已存在的旧模板可以正常使用

2. **模板变量**
   - 单目标场景下仍提供 `target_property` 和 `unit` 变量
   - 旧模板中的占位符仍然有效

3. **存储的模板文件**
   - 不删除已存在的 `default_single_target.json` 和 `default_multi_target.json`
   - 新创建的模板使用 `default_unified.json`

## 优势

1. **代码简化**
   - 消除了大量重复代码
   - 减少了维护成本

2. **一致性**
   - 单目标和多目标使用相同的模板结构
   - 减少了出错的可能性

3. **可扩展性**
   - 更容易支持动态数量的目标属性
   - 统一的处理逻辑便于未来扩展

## 测试建议

1. **单目标预测测试**
   - 验证单个目标属性的预测功能正常
   - 检查生成的提示词格式正确

2. **多目标预测测试**
   - 验证多个目标属性的预测功能正常
   - 检查所有目标属性都包含在参考样本中

3. **自定义模板测试**
   - 测试使用统一格式的自定义模板
   - 测试旧格式模板的向后兼容性

4. **模板预览测试**
   - 验证前端模板预览功能正常
   - 检查模板变量正确替换

## 迁移指南

### 对于新用户

- 直接使用 `unified` 模板类型
- 参考 `default_unified.json` 创建自定义模板

### 对于现有用户

- 现有模板继续有效，无需修改
- 建议逐步迁移到 `unified` 格式
- 新建模板时选择 `unified` 类型

