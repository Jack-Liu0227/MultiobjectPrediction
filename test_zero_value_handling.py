"""
测试增量预测零值处理逻辑
验证零值样本是否会被正确识别并重新预测
"""

import pandas as pd
import sys
from pathlib import Path

# 添加 backend 到路径
sys.path.insert(0, str(Path(__file__).parent / "backend"))

from services.rag_prediction_service import RAGPredictionService
from services.task_manager import TaskManager

def create_test_predictions_csv():
    """创建包含零值的测试 predictions.csv"""
    data = {
        'sample_index': [0, 1, 2, 3, 4, 5],
        'Al(at%)': [5.0, 5.2, 5.5, 5.8, 6.0, 6.2],
        'Co(at%)': [14.0, 13.85, 13.5, 13.2, 13.0, 12.8],
        'Cr(at%)': [17.0, 17.42, 17.5, 17.8, 18.0, 18.2],
        'Processing_Description': ['Heat treatment at 1200°C'] * 6,
        'UTS(MPa)': [1000, 950, 1050, 980, 1020, 990],
        'UTS(MPa)_predicted': [1000, 0, 1050, 0, 1020, 990],  # 索引 1 和 3 为零值
        'El(%)': [15.0, 14.5, 15.5, 14.8, 15.2, 14.9],
        'El(%)_predicted': [15.0, 14.5, 0, 14.8, 15.2, 0],  # 索引 2 和 5 为零值
    }
    return pd.DataFrame(data)

def test_identify_zero_value_samples():
    """测试零值识别功能"""
    print("=" * 80)
    print("测试零值样本识别功能")
    print("=" * 80)

    # 创建测试数据
    predictions_df = create_test_predictions_csv()
    print("\n测试数据（predictions.csv）:")
    print(predictions_df[['sample_index', 'UTS(MPa)_predicted', 'El(%)_predicted']])

    # 创建服务实例（需要 task_manager）
    task_manager = TaskManager()
    service = RAGPredictionService(task_manager)
    
    # 测试单目标（UTS）
    print("\n\n1. 测试单目标属性 [UTS(MPa)]:")
    print("-" * 80)
    target_columns = ['UTS(MPa)']
    zero_indices = service._identify_zero_value_samples(predictions_df, target_columns)
    print(f"识别到的零值样本索引: {sorted(zero_indices)}")
    print(f"预期: {{1, 3}}")
    assert zero_indices == {1, 3}, f"单目标测试失败！预期 {{1, 3}}，实际 {zero_indices}"
    print("✓ 单目标测试通过")
    
    # 测试多目标（UTS + El）
    print("\n\n2. 测试多目标属性 [UTS(MPa), El(%)]:")
    print("-" * 80)
    target_columns = ['UTS(MPa)', 'El(%)']
    zero_indices = service._identify_zero_value_samples(predictions_df, target_columns)
    print(f"识别到的零值样本索引: {sorted(zero_indices)}")
    print(f"预期: {{1, 2, 3, 5}}")
    assert zero_indices == {1, 2, 3, 5}, f"多目标测试失败！预期 {{1, 2, 3, 5}}，实际 {zero_indices}"
    print("✓ 多目标测试通过")
    
    # 测试边界情况：没有零值
    print("\n\n3. 测试边界情况：没有零值")
    print("-" * 80)
    no_zero_df = predictions_df.copy()
    no_zero_df['UTS(MPa)_predicted'] = [1000, 950, 1050, 980, 1020, 990]
    no_zero_df['El(%)_predicted'] = [15.0, 14.5, 15.5, 14.8, 15.2, 14.9]
    zero_indices = service._identify_zero_value_samples(no_zero_df, ['UTS(MPa)', 'El(%)'])
    print(f"识别到的零值样本索引: {sorted(zero_indices)}")
    print(f"预期: set()")
    assert zero_indices == set(), f"无零值测试失败！预期 set()，实际 {zero_indices}"
    print("✓ 无零值测试通过")
    
    # 测试边界情况：缺少 sample_index 列
    print("\n\n4. 测试边界情况：缺少 sample_index 列")
    print("-" * 80)
    no_index_df = predictions_df.drop(columns=['sample_index'])
    zero_indices = service._identify_zero_value_samples(no_index_df, ['UTS(MPa)'])
    print(f"识别到的零值样本索引: {sorted(zero_indices)}")
    print(f"预期: set() (因为缺少 sample_index 列)")
    assert zero_indices == set(), f"缺少索引列测试失败！预期 set()，实际 {zero_indices}"
    print("✓ 缺少索引列测试通过")
    
    # 测试边界情况：包含 NaN 值
    print("\n\n5. 测试边界情况：包含 NaN 值")
    print("-" * 80)
    nan_df = predictions_df.copy()
    nan_df.loc[0, 'UTS(MPa)_predicted'] = float('nan')
    zero_indices = service._identify_zero_value_samples(nan_df, ['UTS(MPa)'])
    print(f"识别到的零值样本索引: {sorted(zero_indices)}")
    print(f"预期: {{1, 3}} (NaN 不被视为零值)")
    assert zero_indices == {1, 3}, f"NaN 测试失败！预期 {{1, 3}}，实际 {zero_indices}"
    print("✓ NaN 测试通过")
    
    print("\n\n" + "=" * 80)
    print("✓ 所有测试通过！")
    print("=" * 80)

def test_integration_scenario():
    """测试完整的增量预测场景"""
    print("\n\n" + "=" * 80)
    print("集成测试：模拟增量预测场景")
    print("=" * 80)
    
    predictions_df = create_test_predictions_csv()
    
    print("\n场景：")
    print("1. 首次预测了 6 个样本（索引 0-5）")
    print("2. 其中索引 1 和 3 的 UTS 预测值为 0")
    print("3. 索引 2 和 5 的 El 预测值为 0")
    print("4. 增量预测时应该重新预测这些零值样本")
    
    # 模拟从 process_details.json 加载的已预测索引
    predicted_indices = {0, 1, 2, 3, 4, 5}
    print(f"\n从 process_details.json 加载的已预测索引: {sorted(predicted_indices)}")
    
    # 识别零值样本
    task_manager = TaskManager()
    service = RAGPredictionService(task_manager)
    zero_indices = service._identify_zero_value_samples(predictions_df, ['UTS(MPa)', 'El(%)'])
    print(f"识别到的零值样本索引: {sorted(zero_indices)}")
    
    # 从已预测索引中移除零值样本
    predicted_indices -= zero_indices
    print(f"移除零值样本后的有效已预测索引: {sorted(predicted_indices)}")
    print(f"预期: {{0, 4}} (只有这两个样本的所有目标属性都非零)")
    
    assert predicted_indices == {0, 4}, f"集成测试失败！预期 {{0, 4}}，实际 {predicted_indices}"
    print("\n✓ 集成测试通过！")
    print("增量预测时将重新预测索引 1, 2, 3, 5 的样本")

if __name__ == "__main__":
    try:
        test_identify_zero_value_samples()
        test_integration_scenario()
        print("\n\n🎉 所有测试通过！零值处理逻辑正确。")
    except Exception as e:
        print(f"\n\n❌ 测试失败: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

