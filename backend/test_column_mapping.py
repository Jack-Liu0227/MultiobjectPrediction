"""
列名映射测试脚本
用于验证列名映射配置是否正确应用
"""

import json
import logging
from pathlib import Path
from services.prompt_builder import PromptBuilder
from services.sample_text_builder import SampleTextBuilder

# 配置日志
logging.basicConfig(
    level=logging.DEBUG,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)

logger = logging.getLogger(__name__)


def test_column_mapping():
    """测试列名映射功能"""
    
    print("=" * 80)
    print("列名映射测试")
    print("=" * 80)
    
    # 1. 加载模板配置
    template_path = Path("storage/prompt_templates/default_multi_target.json")
    with open(template_path, 'r', encoding='utf-8') as f:
        template = json.load(f)
    
    print("\n1. 模板配置:")
    print(f"   模板名称: {template['template_name']}")
    print(f"   列名映射配置:")
    for old_name, new_name in template['column_name_mapping'].items():
        print(f"     - {old_name} → {new_name}")
    
    # 2. 构建测试样本（使用原始列名）
    print("\n2. 构建测试样本（使用原始列名）:")
    
    test_sample_text = SampleTextBuilder.build_sample_text(
        composition="Al 5.3, Co 21, Cr 21.1, Fe 26.3, Ni 26.3",
        processing_columns={
            "Processing_Description": "the first heat treatment is Homogenization at 298K. the second step is Cold rolling to 40.0% reduction. the third step is Annealing at 1173K for 10.0 hours.",
            "Aging_Treatment(K)": "1173"
        },
        feature_columns=None
    )
    
    print(f"\n   原始样本文本:")
    print("   " + "\n   ".join(test_sample_text.split('\n')))
    
    # 3. 应用列名映射
    print("\n3. 应用列名映射:")
    
    prompt_builder = PromptBuilder(
        custom_template=template,
        column_name_mapping=template['column_name_mapping'],
        apply_mapping_to_target=True
    )
    
    mapped_text = prompt_builder._apply_column_name_mapping(test_sample_text)
    
    print(f"\n   映射后样本文本:")
    print("   " + "\n   ".join(mapped_text.split('\n')))
    
    # 4. 验证结果
    print("\n4. 验证结果:")
    
    checks = [
        ("Processing_Description:", "应该被替换为 'Heat treatment method:'"),
        ("Heat treatment method:", "应该存在"),
        ("Aging_Treatment(K):", "应该被替换为 'Aging Temperature:'"),
        ("Aging Temperature:", "应该存在"),
        ("Composition:", "应该保持不变")
    ]
    
    for check_text, description in checks:
        if check_text in test_sample_text:
            status = "✓ 原始文本中存在" if "原始" in description or "应该被替换" in description else "✗ 原始文本中不应存在"
        else:
            status = "✗ 原始文本中不存在"
        
        if check_text in mapped_text:
            mapped_status = "✓ 映射后存在" if "应该存在" in description or "应该保持" in description else "✗ 映射后不应存在"
        else:
            mapped_status = "✗ 映射后不存在"
        
        print(f"   {check_text:30s} - {description:40s}")
        print(f"      原始: {status}, 映射后: {mapped_status}")
    
    # 5. 总结
    print("\n5. 总结:")
    
    success = (
        "Processing_Description:" not in mapped_text and
        "Heat treatment method:" in mapped_text and
        "Aging_Treatment(K):" not in mapped_text and
        "Aging Temperature:" in mapped_text and
        "Composition:" in mapped_text
    )
    
    if success:
        print("   ✅ 列名映射测试通过！")
        print("   所有列名都已正确映射。")
    else:
        print("   ❌ 列名映射测试失败！")
        print("   请检查映射配置和应用逻辑。")
    
    print("\n" + "=" * 80)
    
    return success


if __name__ == "__main__":
    try:
        success = test_column_mapping()
        exit(0 if success else 1)
    except Exception as e:
        logger.error(f"测试失败: {e}", exc_info=True)
        exit(1)

