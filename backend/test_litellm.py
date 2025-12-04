"""
LLM API 配置测试脚本
测试 DeepSeek 和 Gemini 两个 API 配置是否可用
"""
import litellm

def test_litellm_config(config_name, api_key, base_url, model):
    """
    测试单个 LLM API 配置

    Args:
        config_name: 配置名称
        api_key: API 密钥
        base_url: API 基础 URL
        model: 模型名称
    """
    print(f"\n{'='*60}")
    print(f"测试配置: {config_name}")
    print(f"API URL: {base_url}")
    print(f"模型: {model}")
    print(f"{'='*60}")

    try:
        response = litellm.completion(
            model=model,
            messages=[{"role": "user", "content": "你好，请回复1"}],
            api_key=api_key,
            api_base=base_url,
            timeout=30
        )

        content = response['choices'][0]['message']['content']
        print(f"✅ 测试成功")
        print(f"响应内容: {content}")
        return True

    except Exception as e:
        print(f"❌ 测试失败")
        print(f"错误类型: {type(e).__name__}")
        print(f"错误信息: {str(e)}")
        return False


if __name__ == "__main__":
    # 配置 1 - DeepSeek API
    config1 = {
        "name": "DeepSeek API",
        "api_key": "sk-48644e6aff614cdfa8531caaa9bc79a8",
        "base_url": "https://api.deepseek.com/v1",
        "model": "openai/deepseek-chat"
    }

    # 配置 2 - Gemini API
    config2 = {
        "name": "Gemini API",
        "api_key": "sk-liuxingdejiaozi",
        "base_url": "https://gemini-balance-hwwu.onrender.com/v1",
        "model": "openai/gemini-2.5-flash"
    }

    # 测试两个配置
    results = []
    for config in [config1, config2]:
        success = test_litellm_config(
            config["name"],
            config["api_key"],
            config["base_url"],
            config["model"]
        )
        results.append((config["name"], success))

    # 输出测试总结
    print(f"\n{'='*60}")
    print("测试总结")
    print(f"{'='*60}")
    for name, success in results:
        status = "✅ 可用" if success else "❌ 不可用"
        print(f"{name}: {status}")
    print(f"{'='*60}\n")