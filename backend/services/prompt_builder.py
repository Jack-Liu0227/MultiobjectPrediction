"""
提示词构建器 - 独立实现
基于 FEW-SHOT AUGMENTED CORRECTION PROTOCOL
支持自定义模板
"""

from typing import List, Tuple, Dict, Any, Optional
from textwrap import dedent


class PromptBuilder:
    """RAG 提示词构建器"""

    def __init__(self, custom_template: Optional[Dict] = None, column_name_mapping: Optional[Dict[str, str]] = None, apply_mapping_to_target: bool = True):
        """
        初始化提示词构建器

        Args:
            custom_template: 自定义模板数据（可选）
            column_name_mapping: 列名映射字典（可选），例如 {"Processing_Description": "Heat treatment method"}
                注意：键应该是实际数据集中的列名，而不是标准化的名称
            apply_mapping_to_target: 是否对 Target Material 部分应用列名映射（默认为 True）
        """
        self.custom_template = custom_template
        # 使用传入的列名映射，如果没有则使用空字典（不应用任何映射）
        # 注意：不再提供默认映射，因为列名应该由调用者根据实际数据集提供
        self.column_name_mapping = column_name_mapping or {}
        self.apply_mapping_to_target = apply_mapping_to_target

    # 属性单位映射
    PROPERTY_UNITS = {
        "UTS(MPa)": "MPa",
        "El(%)": "%",
        "YS(MPa)": "MPa",
        "HV": "HV",
        "Density(kg/m³)": "kg/m³",
        "Elongation(%)": "%",
        "Hardness(HV)": "HV",
        "Modulus(GPa)": "GPa",
        "Toughness(J)": "J",
        "Temperature(K)": "K",
    }
    
    # 统一协议模板（支持单目标和多目标）
    UNIFIED_PROTOCOL = dedent("""
        ### FEW-SHOT AUGMENTED CORRECTION PROTOCOL
                              
        ### System Role 
        You are a materials science expert specializing in predicting multiple material properties simultaneously.
                              
        **Task**: Predict {target_properties_list} for the target material using systematic analysis.

        **Reference Samples**:

        Each sample shows values for all target properties.

        {reference_samples}

        **Target Material**:
        {test_sample}

        **Required Analysis Protocol**:

        1. **Reference-Driven Baseline Establishment**:
           - **Classification**: First, classify the general family of all materials involved (references and target).
           - **Primary Baseline Selection**: From the provided `Reference Samples`, identify the single sample that is the **most analogous** to the `Target Material`. This sample and its `Known True Values` will serve as your **primary baseline**. Justify your choice.
           - **Sanity Check (Optional but Recommended)**: Use your general knowledge of standard materials as a secondary check.

        2. **Plausibility Assessment**:
           - Assess the expected range for each target property based on your selected **primary baseline sample**.
           - Consider the relationships between properties when applicable (e.g., strength-ductility trade-offs).

        3. **Interpolative Correction & Justification**:
           - Formulate corrected values for each property.
           - Your reasoning must be an **interpolation or extrapolation** from the primary baseline. Quantify how the **differences in characteristics** between the target and the baseline sample translate into specific property adjustments.
           - Use fundamental materials principles to support *why* these differences lead to your calculated adjustments.

        Provide your systematic analysis and end with EXACTLY this JSON format:

        {{
          "predictions": {{
            {predictions_json_template}
          }},
          "confidence": "<high/medium/low>",
          "reasoning": "<your_analysis_summary>"
        }}
    """).strip()
    
    @staticmethod
    def build_sample_text(
        composition: Optional[str] = None,
        processing: Optional[str] = None,
        features: Optional[Dict[str, Any]] = None
    ) -> str:
        """
        构建样本文本表示（用于嵌入和检索）

        Args:
            composition: 组分字符串（可选）
            processing: 工艺字符串（可选）
            features: 特征字典（可选），例如 {"Temperature": 298, "Pressure": 1.0}

        Returns:
            格式化的样本文本，例如：
            "Composition: Al 5.3, Co 21\nProcessing: Cold rolling\nTemperature: 298"
        """
        text_parts = []

        # 添加组分（如果有）
        if composition and str(composition).strip():
            text_parts.append(f"Composition: {composition}")

        # 添加工艺（如果有）
        if processing and str(processing).strip():
            text_parts.append(f"Processing: {processing}")

        # 添加特征列（如果有）
        if features:
            for feat_name, feat_value in features.items():
                text_parts.append(f"{feat_name}: {feat_value}")

        return "\n".join(text_parts)

    def get_property_unit(self, target_property: str) -> str:
        """获取属性单位"""
        # 精确匹配
        if target_property in self.PROPERTY_UNITS:
            return self.PROPERTY_UNITS[target_property]

        # 从括号中提取单位
        if '(' in target_property and target_property.endswith(')'):
            start = target_property.rfind('(')
            unit = target_property[start + 1:-1].strip()
            return unit

        # 模糊匹配
        target_lower = target_property.lower()
        if 'uts' in target_lower or 'tensile' in target_lower:
            return "MPa"
        elif 'ys' in target_lower or 'yield' in target_lower:
            return "MPa"
        elif 'el' in target_lower or 'elongation' in target_lower:
            return "%"
        elif 'hardness' in target_lower or 'hv' in target_lower:
            return "HV"
        elif 'density' in target_lower:
            return "g/cm³"
        elif 'modulus' in target_lower:
            return "GPa"

        return ""

    def _apply_column_name_mapping(self, text: str) -> str:
        """
        应用列名映射到文本中 - 这是整个项目的核心功能之一

        重要性说明：
        列名映射将技术性的数据库列名（如 "Processing", "Temperature"）转换为
        LLM 更容易理解的描述性名称（如 "Heat treatment method", "Test Temperature (K)"）。
        这对提高 LLM 预测准确性至关重要，因为：
        1. LLM 能更好地理解数据的物理含义
        2. 描述性名称提供了更多上下文信息
        3. 减少了 LLM 对专业术语的误解

        工作流程：
        1. SampleTextBuilder 使用原始列名构建样本文本
        2. 本方法将原始列名替换为映射后的显示名称
        3. 映射后的文本用于构建发送给 LLM 的提示词
        4. 前端预览和实际预测都使用相同的映射逻辑

        Args:
            text: 原始文本，例如 "Composition: ...\nProcessing: ..."

        Returns:
            映射后的文本，例如 "Composition: ...\nHeat treatment method: ..."
        """
        import logging
        logger = logging.getLogger(__name__)

        # 调试日志
        logger.debug(f"=== 列名映射调试 ===")
        logger.debug(f"映射配置: {self.column_name_mapping}")
        logger.debug(f"映射前文本（前200字符）: {text[:200]}")

        result = text
        applied_mappings = []
        for old_name, new_name in self.column_name_mapping.items():
            # 替换 "old_name:" 为 "new_name:"
            if f"{old_name}:" in result:
                result = result.replace(f"{old_name}:", f"{new_name}:")
                applied_mappings.append(f"{old_name} → {new_name}")
                logger.debug(f"✓ 应用映射: {old_name}: → {new_name}:")
            else:
                logger.debug(f"✗ 未找到匹配: {old_name}:")

        if applied_mappings:
            logger.info(f"列名映射已应用: {', '.join(applied_mappings)}")
        else:
            logger.warning(f"未应用任何列名映射（可能文本中没有匹配的列名）")

        logger.debug(f"映射后文本（前200字符）: {result[:200]}")

        return result
    
    def build_prompt(
        self,
        retrieved_samples: List[Tuple[str, float, Dict[str, Any]]],
        test_sample: str,
        target_properties: List[str]
    ) -> str:
        """
        构建 RAG 提示词（统一支持单目标和多目标）

        Args:
            retrieved_samples: 检索到的相似样本列表 [(sample_text, similarity, metadata), ...]
            test_sample: 测试样本文本
            target_properties: 目标属性列表（单目标时长度为1，多目标时长度>1）

        Returns:
            完整的提示词
        """
        # 如果有自定义模板，使用自定义模板
        if self.custom_template:
            return self._build_prompt_with_custom_template(
                retrieved_samples,
                test_sample,
                target_properties
            )

        # 否则使用统一的默认模板
        # 零样本情况
        if not retrieved_samples:
            return self._build_zero_shot_prompt(test_sample, target_properties)

        # 应用列名映射到测试样本（根据 apply_mapping_to_target 选项）
        mapped_test_sample = self._apply_column_name_mapping(test_sample) if self.apply_mapping_to_target else test_sample

        # 使用统一的参考样本构建方法（单目标和多目标使用相同格式）
        reference_samples = self._build_reference_section(
            retrieved_samples,
            target_properties
        )
        target_properties_list = ", ".join(target_properties)
        predictions_json_template = self._build_predictions_json_template(target_properties)

        return self.UNIFIED_PROTOCOL.format(
            target_properties_list=target_properties_list,
            reference_samples=reference_samples,
            test_sample=mapped_test_sample,
            predictions_json_template=predictions_json_template
        )

    def _build_prompt_with_custom_template(
        self,
        retrieved_samples: List[Tuple[str, float, Dict[str, Any]]],
        test_sample: str,
        target_properties: List[str]
    ) -> str:
        """使用自定义模板构建 prompt（统一格式）"""
        template = self.custom_template

        # 使用统一的参考样本构建方法
        reference_samples = self._build_reference_section(
            retrieved_samples,
            target_properties
        )

        # 应用列名映射到测试样本（根据 apply_mapping_to_target 选项）
        mapped_test_sample = self._apply_column_name_mapping(test_sample) if self.apply_mapping_to_target else test_sample

        # 准备模板变量（统一格式）
        template_vars = {
            "test_sample": mapped_test_sample,
            "reference_samples": reference_samples,  # 统一使用 reference_samples
            "target_properties_list": ", ".join(target_properties),
            "num_targets": len(target_properties),
        }

        # 使用自定义 JSON 模板或默认模板
        if template.get("predictions_json_template"):
            template_vars["predictions_json_template"] = template["predictions_json_template"]
        else:
            template_vars["predictions_json_template"] = self._build_predictions_json_template(target_properties)

        # 为了向后兼容，保留单目标的特殊变量
        if len(target_properties) == 1:
            template_vars["target_property"] = target_properties[0]
            template_vars["unit"] = self.get_property_unit(target_properties[0])

        # 安全的字符串格式化函数（忽略缺失的占位符）
        def safe_format(text: str, vars_dict: dict) -> str:
            """安全地格式化字符串，忽略缺失的占位符"""
            try:
                # 使用 str.format_map() 和 defaultdict 来处理缺失的键
                from collections import defaultdict
                class SafeDict(dict):
                    def __missing__(self, key):
                        return '{' + key + '}'
                return text.format_map(SafeDict(**vars_dict))
            except Exception as e:
                import logging
                logger = logging.getLogger(__name__)
                logger.warning(f"格式化字符串失败: {e}, 返回原始文本")
                return text

        # 组装 prompt
        prompt_parts = []

        # 系统角色（如果有）
        if template.get("system_role"):
            prompt_parts.append(f"### System Role\n{template['system_role']}\n")

        # 任务描述
        task_desc = template.get("task_description", "")
        if task_desc:
            formatted_task = safe_format(task_desc, template_vars)
            prompt_parts.append(f"### Task\n{formatted_task}\n")

        # 参考样本
        ref_format = template.get("reference_format", "{reference_samples}")
        formatted_ref = safe_format(ref_format, template_vars)
        if formatted_ref and formatted_ref.strip():
            prompt_parts.append(formatted_ref)

        # 输入格式
        input_format = template.get("input_format", "**Target Material**:\n{test_sample}")
        formatted_input = safe_format(input_format, template_vars)
        if formatted_input and formatted_input.strip():
            prompt_parts.append(formatted_input)

        # 分析协议（如果有）
        if template.get("analysis_protocol"):
            prompt_parts.append(f"\n{template['analysis_protocol']}")

        # 输出格式
        output_format = template.get("output_format", "")
        if output_format:
            formatted_output = safe_format(output_format, template_vars)
            if formatted_output and formatted_output.strip():
                prompt_parts.append(f"\n{formatted_output}")

        result = "\n\n".join(prompt_parts)

        # 调试日志
        import logging
        logger = logging.getLogger(__name__)
        logger.info(f"自定义模板构建: prompt_parts 数量={len(prompt_parts)}, 结果长度={len(result)}")
        if len(result) == 0:
            logger.warning(f"自定义模板生成空提示词！template_vars keys: {list(template_vars.keys())}")
            logger.warning(f"template keys: {list(template.keys())}")

        # 防御性检查：如果结果为空，返回默认提示词
        if not result or not result.strip():
            import logging
            logger = logging.getLogger(__name__)
            logger.warning("自定义模板生成的提示词为空，使用默认模板")
            # 使用统一的默认模板
            reference_samples = self._build_reference_section(
                retrieved_samples,
                target_properties
            )
            target_properties_list = ", ".join(target_properties)
            predictions_json_template = self._build_predictions_json_template(target_properties)
            return self.UNIFIED_PROTOCOL.format(
                target_properties_list=target_properties_list,
                reference_samples=reference_samples,
                test_sample=test_sample,
                predictions_json_template=predictions_json_template
            )

        return result

    def _build_reference_section(
        self,
        retrieved_samples: List[Tuple[str, float, Dict[str, Any]]],
        target_properties: List[str]
    ) -> str:
        """
        构建参考样本部分（统一格式，支持单目标和多目标）

        注意：此方法只返回样本列表，不包含标题和说明文字。
        标题和说明文字由模板或 reference_format 控制。
        此方法会应用列名映射，确保预览和实际预测都能正确显示映射后的列名。

        Args:
            retrieved_samples: 检索到的相似样本列表
            target_properties: 目标属性列表（单目标时长度为1，多目标时长度>1）

        Returns:
            格式化的参考样本文本
        """
        if not retrieved_samples:
            return "No similar training examples found in the database."

        reference_lines = []

        for sample_text, _, metadata in retrieved_samples:
            # 应用列名映射到样本文本
            mapped_sample_text = self._apply_column_name_mapping(sample_text)

            # 提取组成和处理信息（使用映射后的文本）
            for line in mapped_sample_text.split('\n'):
                # 跳过空行
                if not line.strip():
                    continue
                # 添加所有非空行（已经应用了列名映射）
                reference_lines.append(line)

            # 添加所有目标属性的值
            reference_lines.append("Properties:")
            for prop in target_properties:
                value = metadata.get(prop)
                if value is not None:
                    unit = self.get_property_unit(prop)
                    reference_lines.append(f"  - {prop}: {value} {unit}")

            reference_lines.append("")

        return "\n".join(reference_lines)

    def _build_predictions_json_template(self, target_properties: List[str]) -> str:
        """构建预测结果的 JSON 模板（统一格式）"""
        json_lines = []
        for prop in target_properties:
            unit = self.get_property_unit(prop)
            json_lines.append(f'"{prop}": {{"value": <number>, "unit": "{unit}"}}')

        return ",\n            ".join(json_lines)

    def _build_zero_shot_prompt(
        self,
        test_sample: str,
        target_properties: List[str]
    ) -> str:
        """构建零样本提示词（统一格式，支持单目标和多目标）"""
        # 应用列名映射（根据 apply_mapping_to_target 选项）
        mapped_test_sample = self._apply_column_name_mapping(test_sample) if self.apply_mapping_to_target else test_sample

        target_properties_list = ", ".join(target_properties)
        predictions_json_template = self._build_predictions_json_template(target_properties)

        zero_shot_template = dedent(f"""
            ### ZERO-SHOT CORRECTION PROTOCOL

            **Task**: Predict {target_properties_list} for the target material using systematic analysis.

            **Reference Samples**: No similar training examples found in the database.

            **Target Material**:
            {mapped_test_sample}

            **Required Analysis Protocol**:

            1. **Reference-Driven Baseline Establishment**:
               - **Classification**: First, classify the general family of the target material.
               - **Knowledge-Based Baseline Selection**: Since no reference samples are available, identify typical materials from your knowledge base that are **most analogous** to the `Target Material`. Use standard alloys or well-documented compositions as your **knowledge baseline**. Justify your choice.
               - **Sanity Check**: Apply your general knowledge of standard materials to ensure the baseline is in a reasonable range for this material family.

            2. **Plausibility Assessment**:
               - Assess the expected range for each target property based on your selected **knowledge baseline**.
               - Consider the relationships between properties when applicable.

            3. **Interpolative Correction & Justification**:
               - Formulate corrected values for each property.
               - Your reasoning must be an **interpolation or extrapolation** from the knowledge baseline. Quantify how the **differences in characteristics** between the target and the baseline material translate into specific property adjustments.
               - Use fundamental materials principles to support *why* these differences lead to your calculated adjustments.

            Provide your systematic analysis and end with EXACTLY this JSON format:

            {{
              "predictions": {{
                {predictions_json_template}
              }},
              "confidence": "<high/medium/low>",
              "reasoning": "<your_analysis_summary>"
            }}
        """).strip()

        return zero_shot_template

