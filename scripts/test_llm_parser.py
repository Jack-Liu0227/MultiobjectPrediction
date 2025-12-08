"""测试 LLM 响应解析功能

测试不同格式的 LLM 响应解析能力
"""
import sys
from pathlib import Path

# 添加backend到路径
sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))

from services.simple_rag_engine import LLMResponseParser


def test_parser():
    """测试解析器"""
    parser = LLMResponseParser()
    
    # 测试用例1: 标准多目标格式（带 value 和 unit）
    test_case_1 = """
    ```json
    {
        "predictions": {
            "UTS(MPa)": {"value": 646.0, "unit": "MPa"},
            "El(%)": {"value": 4.65, "unit": "%"}
        },
        "confidence": "high",
        "reasoning": "Based on interpolation..."
    }
    ```
    """
    
    # 测试用例2: 简化多目标格式（直接数值）
    test_case_2 = """
    {
        "predictions": {
            "UTS(MPa)": 646.0,
            "El(%)": 4.65
        },
        "reasoning": "..."
    }
    """
    
    # 测试用例3: 通用键名格式（target_1, target_2）
    test_case_3 = """
    ```json
    {
        "predictions": {
            "target_1": 646.0,
            "target_2": 4.65
        }
    }
    ```
    """
    
    # 测试用例4: 单目标格式
    test_case_4 = """
    {
        "prediction_value": 646.0,
        "unit": "MPa"
    }
    """
    
    # 测试用例5: 三个目标
    test_case_5 = """
    {
        "predictions": {
            "UTS(MPa)": 646.0,
            "El(%)": 4.65,
            "YS(MPa)": 500.0
        }
    }
    """
    
    # 测试用例6: 格式异常（缺少部分目标）
    test_case_6 = """
    {
        "predictions": {
            "UTS(MPa)": 646.0
        }
    }
    """
    
    # 运行测试
    test_cases = [
        ("标准多目标格式（带 value 和 unit）", test_case_1, ["UTS(MPa)", "El(%)"]),
        ("简化多目标格式（直接数值）", test_case_2, ["UTS(MPa)", "El(%)"]),
        ("通用键名格式（target_1, target_2）", test_case_3, ["UTS(MPa)", "El(%)"]),
        ("单目标格式", test_case_4, ["UTS(MPa)"]),
        ("三个目标", test_case_5, ["UTS(MPa)", "El(%)", "YS(MPa)"]),
        ("格式异常（缺少部分目标）", test_case_6, ["UTS(MPa)", "El(%)"]),
    ]
    
    print("="*80)
    print("LLM 响应解析功能测试")
    print("="*80)
    
    for i, (name, text, targets) in enumerate(test_cases, 1):
        print(f"\n测试用例 {i}: {name}")
        print(f"目标属性: {targets}")
        
        result = parser.parse(text, targets)
        
        print(f"解析结果: {result}")
        
        # 验证结果
        all_present = all(target in result for target in targets)
        if all_present:
            print("✅ 成功提取所有目标属性")
        else:
            missing = [t for t in targets if t not in result]
            print(f"⚠️  缺失目标属性: {missing}")
        
        print("-"*80)


def test_real_response():
    """测试真实的 LLM 响应"""
    parser = LLMResponseParser()
    
    # 从实际文件读取
    sample_file = Path(__file__).parent.parent / "storage/results/05105c00-9b7f-4fc9-b301-997a8a1e793d/outputs/sample_0_75915598.txt"
    
    if not sample_file.exists():
        print(f"⚠️  测试文件不存在: {sample_file}")
        return
    
    with open(sample_file, 'r', encoding='utf-8') as f:
        text = f.read()
    
    print("\n" + "="*80)
    print("真实 LLM 响应测试")
    print("="*80)
    print(f"文件: {sample_file.name}")
    
    targets = ["UTS(MPa)", "El(%)"]
    result = parser.parse(text, targets)
    
    print(f"目标属性: {targets}")
    print(f"解析结果: {result}")
    
    # 预期结果
    expected = {"UTS(MPa)": 646.0, "El(%)": 4.65}
    print(f"预期结果: {expected}")
    
    # 验证
    if result == expected:
        print("✅ 解析结果与预期一致")
    else:
        print("⚠️  解析结果与预期不一致")
        for key in expected:
            if result.get(key) != expected[key]:
                print(f"   {key}: 解析={result.get(key)}, 预期={expected[key]}")


if __name__ == '__main__':
    test_parser()
    test_real_response()

