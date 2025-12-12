#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
测试新的 LLM 配置系统
"""

import sys
from pathlib import Path

# 添加 backend 目录到 Python 路径
BACKEND_DIR = Path(__file__).parent
sys.path.insert(0, str(BACKEND_DIR))

def test_config_loading():
    """测试配置加载"""
    print("=" * 80)
    print("测试 LLM 配置加载")
    print("=" * 80)
    print()
    
    from services.llm_config_loader import load_llm_config
    
    config = load_llm_config()
    
    if not config:
        print("✗ 配置加载失败")
        return False
    
    models = config.get("models", [])
    default_model = config.get("default_model", "")
    
    print(f"✓ 成功加载配置")
    print(f"  - 模型数量: {len(models)}")
    print(f"  - 默认模型: {default_model}")
    print()
    
    # 显示每个模型的配置
    print("模型列表:")
    print("-" * 80)
    for model in models:
        model_id = model.get("id", "")
        name = model.get("name", "")
        provider = model.get("provider", "")
        enabled = model.get("enabled", False)
        api_key = model.get("api_key", "")
        base_url = model.get("base_url", "")

        # 隐藏 API Key
        if api_key:
            if len(api_key) > 10:
                masked_key = api_key[:10] + "..."
            else:
                masked_key = api_key[:3] + "***" if len(api_key) > 3 else "***"
        else:
            masked_key = "未设置"

        status = "✓ 启用" if enabled and api_key and base_url else "✗ 禁用"
        
        print(f"{status} {name} ({provider})")
        print(f"     ID: {model_id}")
        print(f"     API Key: {masked_key}")
        print(f"     Base URL: {base_url or '未设置'}")
        print()
    
    print("=" * 80)
    print("配置测试完成")
    print("=" * 80)
    
    return True


def test_model_retrieval():
    """测试模型检索功能"""
    print()
    print("=" * 80)
    print("测试模型检索功能")
    print("=" * 80)
    print()
    
    from services.llm_config_loader import get_model_config, get_model_config_by_name
    
    # 测试通过 ID 获取
    test_id = "deepseek-chat"
    model = get_model_config(test_id)
    
    if model:
        print(f"✓ 通过 ID 获取模型成功: {test_id}")
        print(f"  - 名称: {model.get('name')}")
        print(f"  - 提供商: {model.get('provider')}")
    else:
        print(f"✗ 通过 ID 获取模型失败: {test_id}")
    
    print()
    
    # 测试通过名称获取
    test_name = "openai/deepseek-chat"
    model = get_model_config_by_name(test_name)
    
    if model:
        print(f"✓ 通过名称获取模型成功: {test_name}")
        print(f"  - ID: {model.get('id')}")
        print(f"  - 名称: {model.get('name')}")
    else:
        print(f"✗ 通过名称获取模型失败: {test_name}")
    
    print()
    print("=" * 80)
    
    return True


if __name__ == "__main__":
    try:
        success = test_config_loading()
        if success:
            test_model_retrieval()
        sys.exit(0 if success else 1)
    except Exception as e:
        print(f"\n✗ 测试失败: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

