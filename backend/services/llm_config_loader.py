"""
LLM 配置加载器
从 Python 配置模块加载 LLM 模型配置
"""

import logging
from typing import Dict, Optional

logger = logging.getLogger(__name__)


def load_llm_config() -> Dict:
    """
    加载 LLM 配置

    从 config.llm_models 模块获取配置，该模块会自动从环境变量读取 API 密钥

    Returns:
        配置字典，包含 models 和 default_model
    """
    try:
        from config.llm_models import get_llm_models_config

        config = get_llm_models_config()

        # 验证配置
        for model in config.get("models", []):
            if model.get("enabled", True):
                model_id = model.get("id", "")
                api_key = model.get("api_key", "")
                base_url = model.get("base_url", "")

                # 检查是否配置了必需的环境变量
                if not api_key:
                    logger.warning(f"[WARNING] 模型 {model_id} 的 API Key 未设置")
                if not base_url:
                    logger.warning(f"[WARNING] 模型 {model_id} 的 Base URL 未设置")

                # 打印实际加载的配置（隐藏 API Key）
                if api_key and base_url:
                    # 对于短密钥（如 "pwd"），显示为 "***"
                    if len(api_key) > 10:
                        masked_key = api_key[:10] + "..."
                    elif len(api_key) > 0:
                        masked_key = "***"
                    else:
                        masked_key = "未设置"
                    logger.info(f"[OK] 模型 {model_id}: base_url={base_url}, api_key={masked_key}")

        return config

    except ImportError as e:
        logger.error(f"无法导入 LLM 配置模块: {e}")
        return {"models": [], "default_model": ""}
    except Exception as e:
        logger.error(f"加载 LLM 配置失败: {e}", exc_info=True)
        return {"models": [], "default_model": ""}


def get_model_config(model_id: str) -> Optional[Dict]:
    """
    获取指定模型的配置
    
    Args:
        model_id: 模型 ID（如 "deepseek-chat", "gemini-2.5-flash"）
    
    Returns:
        模型配置字典，如果不存在返回 None
    """
    config = load_llm_config()
    
    for model in config.get("models", []):
        if model.get("id") == model_id:
            return model
    
    logger.warning(f"未找到模型配置: {model_id}")
    return None


def get_model_config_by_name(model_name: str) -> Optional[Dict]:
    """
    根据模型名称获取配置（支持 provider/model 格式）
    
    Args:
        model_name: 模型名称（如 "openai/deepseek-chat", "deepseek-chat"）
    
    Returns:
        模型配置字典，如果不存在返回 None
    """
    config = load_llm_config()
    
    # 如果包含 /，提取模型名称部分
    if '/' in model_name:
        model_name = model_name.split('/')[-1]
    
    for model in config.get("models", []):
        # 检查 model 字段是否匹配
        if model.get("model", "").endswith(model_name):
            return model
        # 检查 id 是否匹配
        if model.get("id") == model_name:
            return model
    
    logger.warning(f"未找到模型配置: {model_name}")
    return None

