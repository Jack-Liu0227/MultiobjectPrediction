"""验证功能演示脚本

演示如何使用优化后的解析功能和验证脚本
"""
import sys
from pathlib import Path

# 添加backend到路径
sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))

from services.simple_rag_engine import LLMResponseParser


def demo_parsing():
    """演示解析功能"""
    print("="*80)
    print("LLM 响应解析功能演示")
    print("="*80)
    
    parser = LLMResponseParser()
    
    # 示例1: 标准格式
    print("\n【示例1】标准多目标格式")
    response_1 = """
    根据相似样本的分析，我预测该材料的性能如下：
    
    ```json
    {
        "predictions": {
            "UTS(MPa)": {"value": 850.5, "unit": "MPa"},
            "El(%)": {"value": 12.3, "unit": "%"}
        },
        "confidence": "high",
        "reasoning": "基于5个相似样本的插值计算"
    }
    ```
    """
    
    targets = ["UTS(MPa)", "El(%)"]
    result = parser.parse(response_1, targets)
    print(f"目标属性: {targets}")
    print(f"解析结果: {result}")
    
    # 示例2: 简化格式
    print("\n【示例2】简化格式（无代码块）")
    response_2 = """
    预测结果：
    {
        "predictions": {
            "UTS(MPa)": 850.5,
            "El(%)": 12.3
        }
    }
    """
    
    result = parser.parse(response_2, targets)
    print(f"目标属性: {targets}")
    print(f"解析结果: {result}")
    
    # 示例3: 三个目标
    print("\n【示例3】三个目标属性")
    response_3 = """
    ```json
    {
        "predictions": {
            "UTS(MPa)": 850.5,
            "El(%)": 12.3,
            "YS(MPa)": 720.0
        }
    }
    ```
    """
    
    targets_3 = ["UTS(MPa)", "El(%)", "YS(MPa)"]
    result = parser.parse(response_3, targets_3)
    print(f"目标属性: {targets_3}")
    print(f"解析结果: {result}")
    
    # 示例4: 单目标
    print("\n【示例4】单目标预测")
    response_4 = """
    {
        "prediction_value": 850.5,
        "unit": "MPa",
        "confidence": "medium"
    }
    """
    
    targets_4 = ["UTS(MPa)"]
    result = parser.parse(response_4, targets_4)
    print(f"目标属性: {targets_4}")
    print(f"解析结果: {result}")


def demo_batch_verification():
    """演示批量验证功能"""
    print("\n" + "="*80)
    print("批量验证功能演示")
    print("="*80)
    
    print("\n【功能说明】")
    print("批量验证脚本可以：")
    print("1. 从 process_details.json 中提取所有 llm_response")
    print("2. 使用优化后的解析逻辑重新解析")
    print("3. 对比解析结果与已保存的 predicted_values")
    print("4. 生成详细的验证报告 CSV")
    print("5. 更新不匹配的预测结果")
    print("6. 重新计算评估指标")
    
    print("\n【使用示例】")
    print("\n1. 试运行模式（不写入文件）：")
    print("   python scripts/batch_update_predictions.py --dry-run")
    
    print("\n2. 验证特定任务：")
    print("   python scripts/batch_update_predictions.py --filter 05105c00 --dry-run")
    
    print("\n3. 正式运行（更新所有任务）：")
    print("   python scripts/batch_update_predictions.py")
    
    print("\n【输出文件】")
    print("- {task_id}_verification_details.csv: 验证详情")
    print("- predictions.csv: 更新后的预测结果")
    print("- process_details.json: 更新后的处理详情")
    print("- metrics.json: 重新计算的指标")
    print("- verification_report_{timestamp}.json: 总体验证报告")
    
    print("\n【备份机制】")
    print("所有更新的文件都会自动创建带时间戳的备份：")
    print("- predictions.csv.backup_{timestamp}")
    print("- process_details.json.backup_{timestamp}")
    print("- metrics.json.backup_{timestamp}")


def demo_test_parser():
    """演示测试脚本"""
    print("\n" + "="*80)
    print("解析功能测试脚本演示")
    print("="*80)
    
    print("\n【功能说明】")
    print("测试脚本会验证解析器对各种格式的支持：")
    print("- 标准多目标格式（带 value 和 unit）")
    print("- 简化多目标格式（直接数值）")
    print("- 通用键名格式（target_1, target_2）")
    print("- 单目标格式")
    print("- 三个或更多目标")
    print("- 格式异常情况")
    print("- 真实 LLM 响应")
    
    print("\n【运行方法】")
    print("   python scripts/test_llm_parser.py")


if __name__ == '__main__':
    demo_parsing()
    demo_batch_verification()
    demo_test_parser()
    
    print("\n" + "="*80)
    print("演示完成！")
    print("="*80)
    print("\n建议操作流程：")
    print("1. 运行测试脚本验证解析功能：python scripts/test_llm_parser.py")
    print("2. 试运行验证脚本：python scripts/batch_update_predictions.py --dry-run")
    print("3. 检查验证报告，确认无误后正式运行")
    print("4. 查看生成的验证详情 CSV 和更新后的指标")

