"""
提示词构建器 - 独立实现
基于 FEW-SHOT AUGMENTED CORRECTION PROTOCOL
支持自定义模板
"""

from typing import List, Tuple, Dict, Any, Optional
from textwrap import dedent


class PromptBuilder:
    """RAG 提示词构建器"""

    def __init__(self, custom_template: Optional[Dict] = None):
        """
        初始化提示词构建器

        Args:
            custom_template: 自定义模板数据（可选）
        """
        self.custom_template = custom_template

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
    
    # 多目标协议模板（与单目标保持一致的主体结构）
    MULTI_TARGET_PROTOCOL = dedent("""
        ### FEW-SHOT AUGMENTED CORRECTION PROTOCOL

        **Task**: Predict {target_properties_list} for the target material using systematic analysis.

        **Reference Samples**:

        Each sample shows values for all target properties.

        {reference_section}

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
          "reasoning": "<your_analysis_summary>"
        }}
    """).strip()
    
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
    
    def build_prompt(
        self,
        retrieved_samples: List[Tuple[str, float, Dict[str, Any]]],
        test_sample: str,
        target_properties: List[str]
    ) -> str:
        """
        构建 RAG 提示词（支持单目标和多目标）

        Args:
            retrieved_samples: 检索到的相似样本列表 [(sample_text, similarity, metadata), ...]
            test_sample: 测试样本文本
            target_properties: 目标属性列表（可以是单个或多个）

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

        # 否则使用默认模板
        # 判断是单目标还是多目标
        is_multi_target = len(target_properties) > 1

        # 零样本情况
        if not retrieved_samples:
            if is_multi_target:
                return self._build_zero_shot_multi_target_prompt(test_sample, target_properties)
            else:
                unit = self.get_property_unit(target_properties[0])
                return self._build_zero_shot_prompt(test_sample, target_properties[0], unit, None)

        # 多目标预测
        if is_multi_target:
            reference_section = self._build_multi_target_reference_section(
                retrieved_samples,
                target_properties
            )
            target_properties_list = ", ".join(target_properties)
            predictions_json_template = self._build_predictions_json_template(target_properties)

            return self.MULTI_TARGET_PROTOCOL.format(
                target_properties_list=target_properties_list,
                reference_section=reference_section,
                test_sample=test_sample,
                predictions_json_template=predictions_json_template
            )

        # 单目标预测（使用简化的单目标模板）
        else:
            target_property = target_properties[0]
            unit = self.get_property_unit(target_property)
            reference_section = self._build_single_target_reference_section(
                retrieved_samples,
                target_property
            )

            single_target_prompt = dedent(f"""
                ### FEW-SHOT AUGMENTED CORRECTION PROTOCOL

                **Task**: Predict {target_property} for the target material using systematic analysis.

                **Reference Samples**:

                {reference_section}

                **Target Material**:
                {test_sample}

                **Required Analysis Protocol**:

                1. **Reference-Driven Baseline Establishment**:
                   - **Classification**: Classify the general family of all materials.
                   - **Primary Baseline Selection**: Identify the most analogous sample from references.
                   - **Sanity Check**: Use general knowledge of standard materials as secondary check.

                2. **Plausibility Assessment**:
                   - Assess the expected range based on your selected baseline sample.

                3. **Interpolative Correction & Justification**:
                   - Formulate a corrected value via interpolation/extrapolation from baseline.
                   - Quantify how composition and processing differences affect the property.
                   - Use materials science principles to support your adjustment.

                Provide your analysis and end with EXACTLY this JSON format:

                {{
                  "prediction_value": <your_corrected_number>,
                  "reasoning": "<your_analysis_summary>",
                  "property": "{target_property}",
                  "unit": "{unit}"
                }}
            """).strip()

            return single_target_prompt

    def _build_prompt_with_custom_template(
        self,
        retrieved_samples: List[Tuple[str, float, Dict[str, Any]]],
        test_sample: str,
        target_properties: List[str]
    ) -> str:
        """使用自定义模板构建 prompt"""
        template = self.custom_template
        is_multi_target = len(target_properties) > 1

        # 构建参考样本部分
        if is_multi_target:
            reference_samples = self._build_multi_target_reference_section(
                retrieved_samples,
                target_properties
            )
        else:
            reference_samples = self._build_single_target_reference_section(
                retrieved_samples,
                target_properties[0]
            )

        # 准备模板变量
        template_vars = {
            "test_sample": test_sample,
            "reference_samples": reference_samples,
            "target_properties_list": ", ".join(target_properties),
            "num_targets": len(target_properties),
        }

        if is_multi_target:
            # 使用自定义 JSON 模板或默认模板
            if template.get("predictions_json_template"):
                template_vars["predictions_json_template"] = template["predictions_json_template"]
            else:
                template_vars["predictions_json_template"] = self._build_predictions_json_template(target_properties)
        else:
            template_vars["target_property"] = target_properties[0]
            template_vars["unit"] = self.get_property_unit(target_properties[0])
            # 使用自定义 JSON 模板或默认模板
            if template.get("predictions_json_template"):
                template_vars["predictions_json_template"] = template["predictions_json_template"]
            else:
                # 单目标默认模板
                unit = self.get_property_unit(target_properties[0])
                template_vars["predictions_json_template"] = f'"{target_properties[0]}": {{"value": <number>, "unit": "{unit}"}}'

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
            # 使用默认模板
            if is_multi_target:
                reference_section = self._build_multi_target_reference_section(
                    retrieved_samples,
                    target_properties
                )
                target_properties_list = ", ".join(target_properties)
                predictions_json_template = self._build_predictions_json_template(target_properties)
                return self.MULTI_TARGET_PROTOCOL.format(
                    target_properties_list=target_properties_list,
                    reference_section=reference_section,
                    test_sample=test_sample,
                    predictions_json_template=predictions_json_template
                )
            else:
                target_property = target_properties[0]
                unit = self.get_property_unit(target_property)
                reference_section = self._build_single_target_reference_section(
                    retrieved_samples,
                    target_property
                )
                return dedent(f"""
                    ### FEW-SHOT AUGMENTED CORRECTION PROTOCOL

                    **Task**: Predict {target_property} for the target material using systematic analysis.

                    {reference_section}

                    **Target Material**:
                    {test_sample}

                    **Required Analysis Protocol**:

                    1. **Reference-Driven Baseline Establishment**:
                       - **Classification**: Classify the general family of all materials.
                       - **Primary Baseline Selection**: Identify the most analogous sample from references.
                       - **Sanity Check**: Use general knowledge of standard materials as secondary check.

                    2. **Plausibility Assessment**:
                       - Assess the expected range based on your selected baseline sample.

                    3. **Interpolative Correction & Justification**:
                       - Formulate a corrected value via interpolation/extrapolation from baseline.
                       - Quantify how composition and processing differences affect the property.
                       - Use materials science principles to support your adjustment.

                    Provide your analysis and end with EXACTLY this JSON format:

                    {{
                      "prediction_value": <your_corrected_number>,
                      "reasoning": "<your_analysis_summary>",
                      "property": "{target_property}",
                      "unit": "{unit}"
                    }}
                """).strip()

        return result

    def _build_single_target_reference_section(
        self,
        retrieved_samples: List[Tuple[str, float, Dict[str, Any]]],
        target_property: str
    ) -> str:
        """
        构建单目标参考样本部分

        注意：此方法只返回样本列表，不包含标题和说明文字。
        标题和说明文字由模板或 reference_format 控制。
        """
        if not retrieved_samples:
            return "No similar training examples found in the database."

        reference_lines = []

        for sample_text, _, _ in retrieved_samples:
            reference_lines.extend([sample_text, ""])

        return "\n".join(reference_lines)

    def _build_multi_target_reference_section(
        self,
        retrieved_samples: List[Tuple[str, float, Dict[str, Any]]],
        target_properties: List[str]
    ) -> str:
        """
        构建多目标参考样本部分

        注意：此方法只返回样本列表，不包含标题和说明文字。
        标题和说明文字由 reference_format 模板控制。
        """
        if not retrieved_samples:
            return "No similar training examples found in the database."

        reference_lines = []

        for i, (sample_text, _, metadata) in enumerate(retrieved_samples, 1):
            # 提取组成和处理信息
            for line in sample_text.split('\n'):
                if 'Composition:' in line:
                    reference_lines.append(line)
                elif 'Processing:' in line:
                    # 提取 Processing: 后面的内容
                    processing_content = line.split('Processing:', 1)[1].strip()
                    reference_lines.append(f"Heat treatment method: {processing_content}")

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
        """构建预测结果的 JSON 模板"""
        json_lines = []
        for prop in target_properties:
            unit = self.get_property_unit(prop)
            json_lines.append(f'"{prop}": {{"value": <number>, "unit": "{unit}"}}')

        return ",\n            ".join(json_lines)
    
    def _build_initial_guess_section(self, initial_guess: Optional[float], unit: str) -> str:
        """构建初始猜测部分"""
        if initial_guess is not None:
            return f"**Initial Guess**: {initial_guess} {unit}\n"
        return ""
    
    def _build_plausibility_section(self, initial_guess: Optional[float], unit: str) -> str:
        """构建合理性评估部分"""
        if initial_guess is not None:
            return f"   - Compare the `Initial Guess` ({initial_guess} {unit}) directly to the value of your selected **primary baseline sample**.\n   - State clearly whether the guess is plausible relative to this highly relevant data point."
        else:
            return "   - Assess the expected range based on your selected **primary baseline sample**."

    def _build_zero_shot_prompt(
        self,
        test_sample: str,
        target_property: str,
        unit: str,
        initial_guess: Optional[float] = None
    ) -> str:
        """构建零样本提示词"""
        initial_guess_section = self._build_initial_guess_section(initial_guess, unit)

        if initial_guess is not None:
            plausibility_section = f"   - Compare the `Initial Guess` ({initial_guess} {unit}) directly to the value of your selected **knowledge baseline**.\n   - State clearly whether the guess is plausible relative to this knowledge-based reference point."
        else:
            plausibility_section = "   - Assess the expected range based on your selected **knowledge baseline** and similar materials from literature."

        zero_shot_template = dedent("""
            ### ZERO-SHOT CORRECTION PROTOCOL

            **Task**: Predict {target_property} for the target material using systematic analysis.

            **Reference Samples**: No similar training examples found in the database.

            **Target Material**:
            {test_sample}

            {initial_guess_section}

            **Required Analysis Protocol**:

            1. **Reference-Driven Baseline Establishment**:
               - **Classification**: First, classify the general family of the target material.
               - **Knowledge-Based Baseline Selection**: Since no reference samples are available, identify typical materials from your knowledge base that are **most analogous** to the `Target Material`. Use standard alloys or well-documented compositions as your **knowledge baseline**. Justify your choice.
               - **Sanity Check**: Apply your general knowledge of standard materials to ensure the baseline is in a reasonable range for this material family.

            2. **Plausibility Assessment**:
            {plausibility_section}

            3. **Interpolative Correction & Justification**:
               - Formulate a corrected value.
               - Your reasoning must be an **interpolation or extrapolation** from the knowledge baseline. Quantify how the **differences in characteristics** between the target and the baseline material translate into a specific property adjustment.
               - Use fundamental materials principles to support *why* these differences lead to your calculated adjustment.

            Provide your systematic analysis and end with EXACTLY this JSON format:

            {{
              "prediction_value": <your_corrected_number>,
              "reasoning": "<your_analysis_summary>",
              "property": "{target_property}",
              "unit": "{unit}"
            }}
        """).strip()

        return zero_shot_template.format(
            target_property=target_property,
            test_sample=test_sample,
            initial_guess_section=initial_guess_section,
            plausibility_section=plausibility_section,
            unit=unit
        )

    def _build_zero_shot_multi_target_prompt(
        self,
        test_sample: str,
        target_properties: List[str]
    ) -> str:
        """构建零样本多目标提示词（与主模板保持一致）"""
        target_properties_list = ", ".join(target_properties)
        predictions_json_template = self._build_predictions_json_template(target_properties)

        zero_shot_multi_target = dedent(f"""
            ### ZERO-SHOT CORRECTION PROTOCOL

            **Task**: Predict {target_properties_list} for the target material using systematic analysis.

            **Reference Samples**: No similar training examples found in the database.

            **Target Material**:
            {test_sample}

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
              "reasoning": "<your_analysis_summary>"
            }}
        """).strip()

        return zero_shot_multi_target

