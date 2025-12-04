"""
LLM 配置加载器
从配置文件加载 LLM 模型配置
"""

import json
import logging
from pathlib import Path
from typing import Dict, Optional

logger = logging.getLogger(__name__)

# 配置文件路径
CONFIG_DIR = Path(__file__).parent.parent / "config"
LLM_CONFIG_FILE = CONFIG_DIR / "llm_models.json"


def load_llm_config() -> Dict:
    """
    加载 LLM 配置文件
    
    Returns:
        配置字典，包含 models 和 default_model
    """
    try:
        if not LLM_CONFIG_FILE.exists():
            logger.warning(f"LLM 配置文件不存在: {LLM_CONFIG_FILE}")
            return {"models": [], "default_model": ""}
        
        with open(LLM_CONFIG_FILE, 'r', encoding='utf-8') as f:
            config = json.load(f)
        
        return config
    
    except json.JSONDecodeError as e:
        logger.error(f"LLM 配置文件格式错误: {e}")
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

