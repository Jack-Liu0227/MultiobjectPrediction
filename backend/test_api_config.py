"""
测试 API 配置验证
验证 PredictionConfig 的字段和验证规则
"""

from models.schemas import PredictionConfig
from pydantic import ValidationError
import json


def test_valid_config():
    """测试有效配置"""
    print("=" * 60)
    print("测试 1: 有效配置")
    print("=" * 60)
    
    config = PredictionConfig(
        composition_column="Al(wt%)",
        processing_column="Processing_Description",
        target_columns=["UTS(MPa)", "El(%)"],
        max_retrieved_samples=20
    )
    
    print("✓ 配置创建成功")
    print(f"  - 元素组成列: {config.composition_column}")
    print(f"  - 工艺描述列: {config.processing_column}")
    print(f"  - 目标列: {config.target_columns}")
    print(f"  - RAG 检索样本数: {config.max_retrieved_samples}")
    print(f"  - 训练集比例: {config.train_ratio}")
    print(f"  - 相似度阈值: {config.similarity_threshold}")
    print()


def test_default_values():
    """测试默认值"""
    print("=" * 60)
    print("测试 2: 默认值")
    print("=" * 60)
    
    config = PredictionConfig(
        composition_column="Al(wt%)",
        processing_column="Processing_Description",
        target_columns=["UTS(MPa)", "El(%)"]
    )
    
    print("✓ 使用默认值创建配置成功")
    print(f"  - max_retrieved_samples: {config.max_retrieved_samples} (默认: 20)")
    print(f"  - train_ratio: {config.train_ratio} (默认: 0.8)")
    print(f"  - similarity_threshold: {config.similarity_threshold} (默认: 0.3)")
    print(f"  - model_provider: {config.model_provider} (默认: gemini)")
    print(f"  - model_name: {config.model_name} (默认: gemini-2.5-flash)")
    print(f"  - temperature: {config.temperature} (默认: 1.0)")
    print()


def test_invalid_target_columns():
    """测试无效的目标列数量"""
    print("=" * 60)
    print("测试 3: 无效的目标列数量")
    print("=" * 60)
    
    # 测试只有 1 个目标列
    try:
        config = PredictionConfig(
            composition_column="Al(wt%)",
            processing_column="Processing_Description",
            target_columns=["UTS(MPa)"]
        )
        print("✗ 应该抛出验证错误（只有 1 个目标列）")
    except ValidationError as e:
        print("✓ 正确拒绝了只有 1 个目标列的配置")
        print(f"  错误信息: {e.errors()[0]['msg']}")
    
    # 测试超过 5 个目标列
    try:
        config = PredictionConfig(
            composition_column="Al(wt%)",
            processing_column="Processing_Description",
            target_columns=["UTS(MPa)", "El(%)", "Hardness(HV)", "YS(MPa)", "Density(g/cm3)", "Extra"]
        )
        print("✗ 应该抛出验证错误（超过 5 个目标列）")
    except ValidationError as e:
        print("✓ 正确拒绝了超过 5 个目标列的配置")
        print(f"  错误信息: {e.errors()[0]['msg']}")
    
    print()


def test_invalid_max_retrieved_samples():
    """测试无效的 RAG 检索样本数"""
    print("=" * 60)
    print("测试 4: 无效的 RAG 检索样本数")
    print("=" * 60)
    
    # 测试小于 5
    try:
        config = PredictionConfig(
            composition_column="Al(wt%)",
            processing_column="Processing_Description",
            target_columns=["UTS(MPa)", "El(%)"],
            max_retrieved_samples=3
        )
        print("✗ 应该抛出验证错误（小于 5）")
    except ValidationError as e:
        print("✓ 正确拒绝了小于 5 的样本数")
        print(f"  错误信息: {e.errors()[0]['msg']}")
    
    # 测试大于 50
    try:
        config = PredictionConfig(
            composition_column="Al(wt%)",
            processing_column="Processing_Description",
            target_columns=["UTS(MPa)", "El(%)"],
            max_retrieved_samples=100
        )
        print("✗ 应该抛出验证错误（大于 50）")
    except ValidationError as e:
        print("✓ 正确拒绝了大于 50 的样本数")
        print(f"  错误信息: {e.errors()[0]['msg']}")
    
    print()


def test_boundary_values():
    """测试边界值"""
    print("=" * 60)
    print("测试 5: 边界值")
    print("=" * 60)
    
    # 测试最小值
    config_min = PredictionConfig(
        composition_column="Al(wt%)",
        processing_column="Processing_Description",
        target_columns=["UTS(MPa)", "El(%)"],
        max_retrieved_samples=5,
        train_ratio=0.5
    )
    print("✓ 最小边界值配置成功")
    print(f"  - max_retrieved_samples: {config_min.max_retrieved_samples}")
    print(f"  - train_ratio: {config_min.train_ratio}")
    
    # 测试最大值
    config_max = PredictionConfig(
        composition_column="Al(wt%)",
        processing_column="Processing_Description",
        target_columns=["UTS(MPa)", "El(%)", "Hardness(HV)", "YS(MPa)", "Density(g/cm3)"],
        max_retrieved_samples=50,
        train_ratio=0.9
    )
    print("✓ 最大边界值配置成功")
    print(f"  - target_columns 数量: {len(config_max.target_columns)}")
    print(f"  - max_retrieved_samples: {config_max.max_retrieved_samples}")
    print(f"  - train_ratio: {config_max.train_ratio}")
    
    print()


if __name__ == "__main__":
    print("\n" + "=" * 60)
    print("PredictionConfig 验证测试")
    print("=" * 60 + "\n")
    
    test_valid_config()
    test_default_values()
    test_invalid_target_columns()
    test_invalid_max_retrieved_samples()
    test_boundary_values()
    
    print("=" * 60)
    print("所有测试完成！")
    print("=" * 60)

