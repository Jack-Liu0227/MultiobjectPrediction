"""
LLM 模型配置模块
从环境变量中读取 API 配置，避免硬编码敏感信息
"""

import os
from typing import List, Dict, Any
from dotenv import load_dotenv
from pathlib import Path

# 加载环境变量
BACKEND_DIR = Path(__file__).parent.parent
ENV_FILE = BACKEND_DIR / ".env"

if ENV_FILE.exists():
    load_dotenv(ENV_FILE, override=True)


def get_llm_models_config() -> Dict[str, Any]:
    """
    获取 LLM 模型配置
    
    Returns:
        包含 models 和 default_model 的配置字典
    """
    models: List[Dict[str, Any]] = [
        {
            "id": "deepseek-chat",
            "name": "DeepSeek Chat",
            "provider": "deepseek",
            "api_key": os.getenv("DEEPSEEK_API_KEY", ""),
            "base_url": os.getenv("DEEPSEEK_BASE_URL", ""),
            "model": "openai/deepseek-chat",
            "description": "DeepSeek 对话模型，性价比高",
            "temperature_range": [0.0, 2.0],
            "default_temperature": 0.0,
            "enabled": True
        },
        {
            "id": "gemini-2.5-flash",
            "name": "Gemini 2.5 Flash",
            "provider": "gemini",
            "api_key": os.getenv("GEMINI_API_KEY", ""),
            "base_url": os.getenv("GEMINI_BASE_URL", ""),
            "model": "openai/gemini-2.5-flash",
            "description": "Gemini Flash 模型，速度快",
            "temperature_range": [0.0, 2.0],
            "default_temperature": 0.0,
            "enabled": True
        },
        {
            "id": "gemini-2.5-pro",
            "name": "Gemini 2.5 Pro",
            "provider": "gemini",
            "api_key": os.getenv("GEMINI_API_KEY", ""),
            "base_url": os.getenv("GEMINI_BASE_URL", ""),
            "model": "openai/gemini-2.5-pro",
            "description": "Gemini Pro 模型，性能强",
            "temperature_range": [0.0, 2.0],
            "default_temperature": 0.0,
            "enabled": True
        },
        {
            "id": "gemini-2.5-pro-gcli2api",
            "name": "Gemini 2.5 Pro (GCLI2API)",
            "provider": "GCLI2API",
            "api_key": os.getenv("GCLI2API_API_KEY", ""),
            "base_url": os.getenv("GCLI2API_BASE_URL", ""),
            "model": "gemini-2.5-pro",
            "description": "Gemini Pro 模型，通过 GCLI2API 本地代理访问",
            "temperature_range": [0.0, 2.0],
            "default_temperature": 0.0,
            "enabled": True
        },
        {
            "id": "gemini-2.5-flash-gcli2api",
            "name": "Gemini 2.5 Flash (GCLI2API)",
            "provider": "GCLI2API",
            "api_key": os.getenv("GCLI2API_API_KEY", ""),
            "base_url": os.getenv("GCLI2API_BASE_URL", ""),
            "model": "gemini-2.5-flash",
            "description": "Gemini Flash 模型，通过 GCLI2API 本地代理访问",
            "temperature_range": [0.0, 2.0],
            "default_temperature": 0.0,
            "enabled": True
        },
        # {
        #     "id": "hajimi-gemini",
        #     "name": "Hajimi Gemini",
        #     "provider": "hajimi",
        #     "api_key": os.getenv("HAJIMI_API_KEY", ""),
        #     "base_url": os.getenv("HAJIMI_BASE_URL", ""),
        #     "model": "openai/gemini-2.5-flash",
        #     "description": "通过 Hajimi API 访问的 Gemini 模型",
        #     "temperature_range": [0.0, 2.0],
        #     "default_temperature": 0.0,
        #     "enabled": True
        # }
    ]
    
    # 过滤掉未配置环境变量的模型
    enabled_models = []
    for model in models:
        if model["api_key"] and model["base_url"]:
            enabled_models.append(model)
        else:
            # 如果环境变量未设置，标记为禁用
            model["enabled"] = False
            enabled_models.append(model)
    
    return {
        "models": enabled_models,
        "default_model": "deepseek-chat"
    }


# 导出配置获取函数
__all__ = ["get_llm_models_config"]

