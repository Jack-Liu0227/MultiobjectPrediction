#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
LLM 服务可用性测试脚本

功能：
1. 从 llm_models.py 配置模块读取所有配置的 LLM 模型
2. 自动从 .env 文件加载 API 密钥
3. 测试每个 LLM 服务的连接和认证
4. 输出详细的测试结果
"""

import sys
from pathlib import Path
from typing import Dict
import litellm

# 添加 backend 目录到 Python 路径
BACKEND_DIR = Path(__file__).parent
sys.path.insert(0, str(BACKEND_DIR))

# 测试用的简单 prompt
TEST_PROMPT = "Hello! Please respond with 'OK' if you can read this message."


def load_llm_config() -> Dict:
    """加载 LLM 配置"""
    try:
        from services.llm_config_loader import load_llm_config
        config = load_llm_config()

        if not config or not config.get("models"):
            print("✗ 配置加载失败或为空")
            sys.exit(1)

        print(f"✓ 已从配置模块加载 LLM 配置\n")
        return config
    except Exception as e:
        print(f"✗ 加载配置失败: {e}")
        sys.exit(1)


def test_llm_service(model_config: Dict) -> Dict:
    """
    测试单个 LLM 服务
    
    Args:
        model_config: 模型配置字典
    
    Returns:
        测试结果字典，包含 success, message, response_preview
    """
    model_id = model_config.get("id", "unknown")
    model_name = model_config.get("model", "")
    provider = model_config.get("provider", "")
    api_key = model_config.get("api_key", "")
    base_url = model_config.get("base_url", "")
    
    # 检查配置完整性
    if not api_key or "${" in api_key:
        return {
            "success": False,
            "message": f"API Key 未配置或环境变量未设置",
            "response_preview": None
        }
    
    if not base_url or "${" in base_url:
        return {
            "success": False,
            "message": f"Base URL 未配置或环境变量未设置",
            "response_preview": None
        }
    
    # 尝试调用 LLM
    try:
        response = litellm.completion(
            model=model_name,
            messages=[{"role": "user", "content": TEST_PROMPT}],
            temperature=0.0,
            api_key=api_key,
            base_url=base_url,
            timeout=100  # 30秒超时
        )
        
        # 提取响应内容
        response_text = response.choices[0].message.content
        response_preview = response_text[:100] + "..." if len(response_text) > 100 else response_text
        
        return {
            "success": True,
            "message": "连接成功，API 正常工作",
            "response_preview": response_preview
        }
    
    except Exception as e:
        error_msg = str(e)
        
        # 分类错误类型
        if "authentication" in error_msg.lower() or "api_key" in error_msg.lower() or "unauthorized" in error_msg.lower():
            message = "认证失败：API Key 无效或已过期"
        elif "timeout" in error_msg.lower():
            message = "连接超时：无法访问服务"
        elif "connection" in error_msg.lower() or "network" in error_msg.lower():
            message = "网络错误：无法连接到服务器"
        else:
            message = f"请求失败：{error_msg[:100]}"
        
        return {
            "success": False,
            "message": message,
            "response_preview": None
        }


def main():
    """主函数"""
    print("=" * 80)
    print("LLM 服务可用性测试")
    print("=" * 80)
    print()

    # 加载配置（环境变量会在配置模块中自动加载）
    config = load_llm_config()
    
    models = config.get("models", [])
    enabled_models = [m for m in models if m.get("enabled", True)]
    
    print(f"找到 {len(enabled_models)} 个启用的模型配置\n")
    print("=" * 80)
    print()
    
    # 测试每个模型
    results = []
    for idx, model in enumerate(enabled_models, 1):
        model_id = model.get("id", "unknown")
        model_name = model.get("name", model_id)
        provider = model.get("provider", "unknown")

        print(f"[{idx}/{len(enabled_models)}] 测试: {model_name} ({provider})")
        print(f"    模型ID: {model_id}")
        print(f"    模型路径: {model.get('model', 'N/A')}")

        # 显示配置信息（隐藏 API Key）
        api_key = model.get("api_key", "")
        if api_key:
            if len(api_key) > 10:
                masked_key = api_key[:10] + "..."
            else:
                masked_key = api_key[:3] + "***" if len(api_key) > 3 else "***"
        else:
            masked_key = "未设置"
        print(f"    API Key: {masked_key}")
        print(f"    Base URL: {model.get('base_url', 'N/A')}")

        # 执行测试
        result = test_llm_service(model)
        results.append({
            "model_id": model_id,
            "model_name": model_name,
            "provider": provider,
            **result
        })

        # 显示测试结果
        if result["success"]:
            print(f"    状态: ✓ 成功")
            print(f"    消息: {result['message']}")
            if result["response_preview"]:
                print(f"    响应预览: {result['response_preview']}")
        else:
            print(f"    状态: ✗ 失败")
            print(f"    错误: {result['message']}")

        print()

    # 输出汇总
    print("=" * 80)
    print("测试汇总")
    print("=" * 80)
    print()

    success_count = sum(1 for r in results if r["success"])
    fail_count = len(results) - success_count

    print(f"总计: {len(results)} 个模型")
    print(f"成功: {success_count} 个")
    print(f"失败: {fail_count} 个")
    print()

    # 成功的服务
    if success_count > 0:
        print("✓ 可用的服务:")
        for r in results:
            if r["success"]:
                print(f"  - {r['model_name']} ({r['provider']})")
        print()

    # 失败的服务
    if fail_count > 0:
        print("✗ 不可用的服务:")
        for r in results:
            if not r["success"]:
                print(f"  - {r['model_name']} ({r['provider']}): {r['message']}")
        print()

    print("=" * 80)

    # 返回退出码
    return 0 if fail_count == 0 else 1


if __name__ == "__main__":
    try:
        exit_code = main()
        sys.exit(exit_code)
    except KeyboardInterrupt:
        print("\n\n测试被用户中断")
        sys.exit(1)
    except Exception as e:
        print(f"\n\n✗ 测试过程中发生错误: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

