# 提示词模板预览功能修复

## 问题描述
前端提示词模板预览功能报错，显示"预览响应数据无效：rendered_prompt 为 undefined"。实际生成的提示词中出现重复的 `**Reference Samples**` 标题。

## 问题根源
1. `_build_multi_target_reference_section` 和 `_build_single_target_reference_section` 方法的设计不一致
2. 默认模板 `MULTI_TARGET_PROTOCOL` 没有包含参考样本的标题，期望由 `_build_*_reference_section` 方法提供
3. 自定义模板的 `reference_format` 已经包含了标题，但 `_build_*_reference_section` 方法也返回了标题，导致重复

## 修复方案
采用**统一设计原则**：所有 `_build_*_reference_section` 方法只返回样本列表，不包含标题和说明文字。标题和说明文字由模板控制。

### 修改内容
1. **修改 `backend/services/prompt_builder.py`**：
   - `MULTI_TARGET_PROTOCOL` 模板：添加 `**Reference Samples**:` 标题和说明文字
   - 单目标默认模板：添加 `**Reference Samples**:` 标题
   - `_build_single_target_reference_section` 方法：移除标题，只返回样本列表

### 修改前后对比

#### 修改前（有重复）
```
**Reference Samples**:

Each sample shows values for all 2 target properties.

**Reference Samples**:

Each sample shows values for all 2 target properties.

Composition: Al 5.3, Co 21.0, Cr 21.1, Fe 26.3, Ni 26.3
...
```

#### 修改后（无重复）
```
**Reference Samples**:

Each sample shows values for all 2 target properties.

Composition: Al 5.3, Co 21.0, Cr 21.1, Fe 26.3, Ni 26.3
...
```

## 验证结果
✅ 自定义模板：没有重复的标题和说明文字
✅ 默认模板：没有重复的标题
✅ 单目标模板：没有重复的标题
✅ 多目标模板：没有重复的标题

## 影响范围
- 提示词模板预览功能
- 实际预测任务生成的提示词文件
- 所有使用 `PromptBuilder` 的功能

## 测试建议
1. 在前端测试提示词模板预览功能
2. 运行一次实际预测任务，检查生成的提示词文件格式
3. 验证单目标和多目标预测的提示词格式

