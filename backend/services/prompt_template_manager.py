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
        """确保默认模板存在（统一格式 UNIFIED_PROTOCOL）"""
        from textwrap import dedent

        # 默认列名映射（空字典，由前端根据实际数据集动态生成）
        default_column_mapping = {}

        # UNIFIED_PROTOCOL 格式的默认模板
        default_unified = {
            "template_name": "默认统一模板",
            "template_type": "unified",
            "description": "基于 FEW-SHOT AUGMENTED CORRECTION PROTOCOL 的统一模板",
            "system_role": "",
            "task_description": "Predict {target_properties_list} for the target material using systematic analysis.",
            "input_format": "**Target Material**:\n{test_sample}",
            "output_format": dedent("""
                Provide your systematic analysis and end with EXACTLY this JSON format:

                {{
                  "predictions": {{
                    {predictions_json_template}
                  }},
                  "confidence": "<high/medium/low>",
                  "reasoning": "<your_analysis_summary>"
                }}
            """).strip(),
            "reference_format": "**Reference Samples**:\n\nEach sample shows values for all target properties.\n\n{reference_samples}",
            "analysis_protocol": dedent("""
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
            """).strip(),
            "column_name_mapping": default_column_mapping,
            "created_at": datetime.now().isoformat(),
            "updated_at": datetime.now().isoformat()
        }

        # 保存统一默认模板（如果不存在）
        unified_path = self.templates_dir / "default_unified.json"
        if not unified_path.exists():
            self.save_template("default_unified", default_unified)
    
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

            # 验证模板类型（仅支持统一格式）
            valid_types = ['unified']
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
        - 返回空字典，因为列名映射应该由前端根据实际数据集动态生成
        - 前端会根据用户选择的列名（如 "Processing_Description"）生成映射
        - 这样可以支持任意的列名，而不是硬编码特定的列名

        Returns:
            默认列名映射字典（空字典）
        """
        return {}

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

