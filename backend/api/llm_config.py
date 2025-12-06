"""
LLM 模型配置 API
提供可用模型列表和配置信息
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional
import logging
from services.llm_config_loader import load_llm_config

logger = logging.getLogger(__name__)
router = APIRouter()


class LLMModel(BaseModel):
    """LLM 模型配置"""
    id: str
    name: str
    provider: str
    api_key: str
    base_url: str
    model: str
    description: str
    temperature_range: List[float]
    default_temperature: float
    enabled: bool


class LLMConfigResponse(BaseModel):
    """LLM 配置响应"""
    models: List[LLMModel]
    default_model: str


@router.get("/models", response_model=LLMConfigResponse)
async def get_available_models():
    """
    获取可用的 LLM 模型列表

    返回所有已配置且启用的模型（已替换环境变量）
    """
    try:
        # 使用 llm_config_loader 加载配置（自动替换环境变量）
        config = load_llm_config()

        if not config or not config.get('models'):
            raise HTTPException(status_code=500, detail="模型配置为空或加载失败")

        # 过滤启用的模型
        enabled_models = [m for m in config['models'] if m.get('enabled', True)]

        return LLMConfigResponse(
            models=enabled_models,
            default_model=config.get('default_model', enabled_models[0]['id'] if enabled_models else '')
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"获取模型配置失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"获取模型配置失败: {str(e)}")


@router.get("/models/{model_id}", response_model=LLMModel)
async def get_model_config(model_id: str):
    """
    获取指定模型的配置信息

    Args:
        model_id: 模型 ID
    """
    try:
        # 使用 llm_config_loader 加载配置（自动替换环境变量）
        config = load_llm_config()

        if not config or not config.get('models'):
            raise HTTPException(status_code=500, detail="模型配置为空或加载失败")

        # 查找指定模型
        for model in config['models']:
            if model['id'] == model_id:
                return LLMModel(**model)

        raise HTTPException(status_code=404, detail=f"模型不存在: {model_id}")

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"获取模型配置失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"获取模型配置失败: {str(e)}")

