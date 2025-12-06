"""
LLM 配置加载器
从配置文件加载 LLM 模型配置，支持环境变量替换
"""

import json
import logging
import os
import re
from pathlib import Path
from typing import Dict, Optional
from dotenv import load_dotenv

logger = logging.getLogger(__name__)

# 加载环境变量 - 优先从 backend/.env 加载，其次从项目根目录加载
BACKEND_DIR = Path(__file__).parent.parent  # backend/services -> backend
PROJECT_ROOT = BACKEND_DIR.parent  # backend -> project_root

# 优先加载 backend/.env
BACKEND_ENV_FILE = BACKEND_DIR / ".env"
ROOT_ENV_FILE = PROJECT_ROOT / ".env"

if BACKEND_ENV_FILE.exists():
    load_dotenv(BACKEND_ENV_FILE, override=True)
    logger.info(f"✓ 已从 {BACKEND_ENV_FILE} 加载环境变量")
elif ROOT_ENV_FILE.exists():
    load_dotenv(ROOT_ENV_FILE, override=True)
    logger.info(f"✓ 已从 {ROOT_ENV_FILE} 加载环境变量")
else:
    load_dotenv()  # 尝试从默认位置加载
    logger.warning(f"⚠ .env 文件不存在，尝试从默认位置加载")

# 配置文件路径
CONFIG_DIR = Path(__file__).parent.parent / "config"
LLM_CONFIG_FILE = CONFIG_DIR / "llm_models.json"


def _replace_env_variables(value: str) -> str:
    """
    替换字符串中的环境变量占位符

    支持格式：${VAR_NAME} 或 $VAR_NAME

    Args:
        value: 包含环境变量占位符的字符串

    Returns:
        替换后的字符串
    """
    if not isinstance(value, str):
        return value

    # 匹配 ${VAR_NAME} 格式
    pattern = r'\$\{([^}]+)\}'

    def replacer(match):
        var_name = match.group(1)
        env_value = os.getenv(var_name)
        if env_value is None:
            logger.error(f"❌ 环境变量 {var_name} 未设置！请检查 .env 文件")
            return match.group(0)  # 保持原占位符
        logger.debug(f"✓ 环境变量 {var_name} 已替换")
        return env_value

    return re.sub(pattern, replacer, value)


def _process_config_dict(config: Dict) -> Dict:
    """
    递归处理配置字典，替换所有环境变量

    Args:
        config: 配置字典

    Returns:
        处理后的配置字典
    """
    if isinstance(config, dict):
        return {k: _process_config_dict(v) for k, v in config.items()}
    elif isinstance(config, list):
        return [_process_config_dict(item) for item in config]
    elif isinstance(config, str):
        return _replace_env_variables(config)
    else:
        return config


def load_llm_config() -> Dict:
    """
    加载 LLM 配置文件，并替换环境变量

    Returns:
        配置字典，包含 models 和 default_model
    """
    try:
        if not LLM_CONFIG_FILE.exists():
            logger.warning(f"LLM 配置文件不存在: {LLM_CONFIG_FILE}")
            return {"models": [], "default_model": ""}

        with open(LLM_CONFIG_FILE, 'r', encoding='utf-8') as f:
            config = json.load(f)

        # 处理配置，替换环境变量
        config = _process_config_dict(config)

        # 验证必需的环境变量
        for model in config.get("models", []):
            if model.get("enabled", True):
                model_id = model.get("id", "")
                api_key = model.get("api_key", "")
                base_url = model.get("base_url", "")

                # 检查是否还包含未替换的占位符
                if "${" in api_key:
                    logger.error(
                        f"❌ 模型 {model_id} 的 API Key 包含未替换的环境变量: {api_key}"
                    )
                if "${" in base_url:
                    logger.error(
                        f"❌ 模型 {model_id} 的 Base URL 包含未替换的环境变量: {base_url}"
                    )

                # 打印实际加载的配置（隐藏 API Key）
                masked_key = api_key[:10] + "..." if len(api_key) > 10 else "未设置"
                logger.info(f"✓ 模型 {model_id}: base_url={base_url}, api_key={masked_key}")

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

