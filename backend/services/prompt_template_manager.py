"""
提示词模板管理服务
支持模板的保存、加载和管理
"""

import json
import logging
from pathlib import Path
from typing import Dict, List, Optional
from datetime import datetime

logger = logging.getLogger(__name__)


class PromptTemplateManager:
    """提示词模板管理器"""
    
    def __init__(self, templates_dir: Path = None):
        """
        初始化模板管理器
        
        Args:
            templates_dir: 模板存储目录，默认为 storage/prompt_templates/
        """
        if templates_dir is None:
            from config import STORAGE_DIR
            templates_dir = STORAGE_DIR / "prompt_templates"
        
        self.templates_dir = templates_dir
        self.templates_dir.mkdir(parents=True, exist_ok=True)
        
        # 初始化默认模板
        self._ensure_default_templates()
    
    def _ensure_default_templates(self):
        """确保默认模板存在"""
        # 默认列名映射
        default_column_mapping = {
            "Processing": "Heat treatment method",
            "Composition": "Alloy Composition"
        }

        default_single_target = {
            "template_name": "默认单目标模板",
            "template_type": "single_target",
            "description": "用于单目标预测的默认模板",
            "system_role": "You are a materials science expert specializing in predicting material properties.",
            "task_description": "Predict {target_property} for the target material using systematic analysis.",
            "input_format": "**Target Material**:\n{test_sample}",
            "output_format": """**Final Prediction**:
```json
{{
    "predicted_value": <number>,
    "unit": "{unit}",
    "confidence": "<high/medium/low>",
    "reasoning": "<brief explanation>"
}}
```""",
            "reference_format": "**Reference Samples**:\n\n{reference_samples}",
            "analysis_protocol": """**Required Analysis Protocol**:

1. **Reference-Driven Baseline Establishment**:
   - **Classification**: Classify the general family of all materials.
   - **Primary Baseline Selection**: Identify the most analogous sample from references.
   - **Sanity Check**: Use general knowledge of standard materials as secondary check.

2. **Plausibility Assessment**:
   - Assess the expected range based on your selected baseline sample.
   - State clearly whether the prediction is plausible relative to this reference point.

3. **Final Prediction**:
   - Provide a single numerical value.
   - Include confidence level and brief reasoning.""",
            "column_name_mapping": default_column_mapping,
            "created_at": datetime.now().isoformat(),
            "updated_at": datetime.now().isoformat()
        }
        
        default_multi_target = {
            "template_name": "默认多目标模板",
            "template_type": "multi_target",
            "description": "用于多目标预测的默认模板",
            "system_role": "You are a materials science expert specializing in predicting multiple material properties simultaneously.",
            "task_description": "Predict {target_properties_list} for the target material using systematic analysis.",
            "input_format": "**Target Material**:\n{test_sample}",
            "output_format": """**Final Predictions**:
```json
{{
    "predictions": {{
        {predictions_json_template}
    }},
    "confidence": "<high/medium/low>",
    "reasoning": "<brief explanation>"
}}
```""",
            "reference_format": "**Reference Samples**:\n\nEach sample shows values for all {num_targets} target properties.\n\n{reference_samples}",
            "analysis_protocol": """**Required Analysis Protocol**:

1. **Reference-Driven Baseline Establishment**:
   - **Classification**: Classify the general family of all materials.
   - **Primary Baseline Selection**: Identify the most analogous sample from references.
   - **Sanity Check**: Use general knowledge of standard materials as secondary check.

2. **Multi-Property Correlation Analysis**:
   - Analyze relationships between target properties.
   - Consider trade-offs and dependencies.

3. **Final Predictions**:
   - Provide numerical values for all target properties.
   - Include confidence level and brief reasoning.""",
            "column_name_mapping": default_column_mapping,
            "created_at": datetime.now().isoformat(),
            "updated_at": datetime.now().isoformat()
        }
        
        # 保存默认模板（如果不存在）
        single_target_path = self.templates_dir / "default_single_target.json"
        if not single_target_path.exists():
            self.save_template("default_single_target", default_single_target)
        
        multi_target_path = self.templates_dir / "default_multi_target.json"
        if not multi_target_path.exists():
            self.save_template("default_multi_target", default_multi_target)
    
    def save_template(self, template_id: str, template_data: Dict) -> bool:
        """
        保存模板

        Args:
            template_id: 模板ID
            template_data: 模板数据

        Returns:
            是否保存成功
        """
        try:
            # 验证必填字段
            required_fields = {
                'template_name': '模板名称',
                'template_type': '模板类型',
                'task_description': '任务描述',
                'input_format': '输入格式',
                'output_format': '输出格式',
                'reference_format': '参考样本格式'
            }

            for field, field_name in required_fields.items():
                if not template_data.get(field):
                    logger.error(f"缺少必填字段: {field_name} ({field})")
                    return False

            # 验证模板类型
            valid_types = ['single_target', 'multi_target']
            if template_data['template_type'] not in valid_types:
                logger.error(f"无效的模板类型: {template_data['template_type']}，必须是 {valid_types} 之一")
                return False

            # 添加时间戳
            template_data["updated_at"] = datetime.now().isoformat()
            if "created_at" not in template_data:
                template_data["created_at"] = datetime.now().isoformat()

            # 保存到文件
            template_path = self.templates_dir / f"{template_id}.json"
            with open(template_path, 'w', encoding='utf-8') as f:
                json.dump(template_data, f, ensure_ascii=False, indent=2)

            logger.info(f"Template saved: {template_id}")
            return True
        except Exception as e:
            logger.error(f"Failed to save template {template_id}: {e}", exc_info=True)
            return False

    def load_template(self, template_id: str) -> Optional[Dict]:
        """
        加载模板

        Args:
            template_id: 模板ID

        Returns:
            模板数据，如果不存在则返回 None
        """
        try:
            template_path = self.templates_dir / f"{template_id}.json"
            if not template_path.exists():
                logger.warning(f"Template not found: {template_id}")
                return None

            with open(template_path, 'r', encoding='utf-8') as f:
                template_data = json.load(f)

            # 向后兼容：如果模板没有 column_name_mapping，使用默认值
            if "column_name_mapping" not in template_data:
                template_data["column_name_mapping"] = self.get_default_column_mapping()

            logger.info(f"Template loaded: {template_id}")
            return template_data
        except Exception as e:
            logger.error(f"Failed to load template {template_id}: {e}", exc_info=True)
            return None

    @staticmethod
    def get_default_column_mapping() -> Dict[str, str]:
        """
        获取默认的列名映射

        注意：
        - "Processing" 和 "Processing_Description" 是工艺列的映射
        - 其他列（特征列、目标属性列）需要单独映射
        - "Composition" 不需要映射,因为它已经是显示名称

        Returns:
            默认列名映射字典
        """
        return {
            "Processing": "Heat treatment method",
            "Processing_Description": "Heat treatment method"
        }

    def list_templates(self) -> List[Dict]:
        """
        列出所有模板

        Returns:
            模板列表，每个模板包含基本信息
        """
        try:
            templates = []
            for template_file in self.templates_dir.glob("*.json"):
                try:
                    with open(template_file, 'r', encoding='utf-8') as f:
                        template_data = json.load(f)

                    templates.append({
                        "template_id": template_file.stem,
                        "template_name": template_data.get("template_name", "未命名模板"),
                        "template_type": template_data.get("template_type", "unknown"),
                        "description": template_data.get("description", ""),
                        "created_at": template_data.get("created_at"),
                        "updated_at": template_data.get("updated_at")
                    })
                except Exception as e:
                    logger.error(f"Failed to read template {template_file}: {e}")
                    continue

            return sorted(templates, key=lambda x: x.get("updated_at", ""), reverse=True)
        except Exception as e:
            logger.error(f"Failed to list templates: {e}", exc_info=True)
            return []

    def delete_template(self, template_id: str) -> bool:
        """
        删除模板

        Args:
            template_id: 模板ID

        Returns:
            是否删除成功
        """
        try:
            # 不允许删除默认模板
            if template_id.startswith("default_"):
                logger.warning(f"Cannot delete default template: {template_id}")
                return False

            template_path = self.templates_dir / f"{template_id}.json"
            if not template_path.exists():
                logger.warning(f"Template not found: {template_id}")
                return False

            template_path.unlink()
            logger.info(f"Template deleted: {template_id}")
            return True
        except Exception as e:
            logger.error(f"Failed to delete template {template_id}: {e}", exc_info=True)
            return False

