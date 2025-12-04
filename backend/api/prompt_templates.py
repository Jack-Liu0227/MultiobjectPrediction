"""
提示词模板管理 API
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import List, Dict, Optional, Union, Any
import logging

from services.prompt_template_manager import PromptTemplateManager
from utils.data_formatting import format_composition

logger = logging.getLogger(__name__)
router = APIRouter()

template_manager = PromptTemplateManager()


class PromptTemplateData(BaseModel):
    """提示词模板数据"""
    template_name: str = Field(..., description="模板名称")
    template_type: str = Field(..., description="模板类型：single_target 或 multi_target")
    description: str = Field(default="", description="模板描述")
    system_role: str = Field(default="", description="系统角色")
    task_description: str = Field(..., description="任务描述")
    input_format: str = Field(..., description="输入格式")
    output_format: str = Field(..., description="输出格式")
    reference_format: str = Field(..., description="参考样本格式")
    analysis_protocol: str = Field(default="", description="分析协议")
    predictions_json_template: str = Field(default="", description="自定义预测 JSON 模板（可选）")


class PromptTemplateInfo(BaseModel):
    """提示词模板信息"""
    template_id: str
    template_name: str
    template_type: str
    description: str
    created_at: Optional[str]
    updated_at: Optional[str]


class PromptPreviewRequest(BaseModel):
    """提示词预览请求"""
    # 模板字段（从template_data中提升到顶层）
    template_name: str = Field(..., description="模板名称")
    template_type: str = Field(..., description="模板类型")
    task_description: str = Field(..., description="任务描述")
    input_format: str = Field(..., description="输入格式说明")
    output_format: str = Field(..., description="输出格式说明")
    reference_format: str = Field(..., description="参考样本格式")
    description: str = Field(default="", description="模板描述")
    system_role: str = Field(default="", description="系统角色")
    analysis_protocol: str = Field(default="", description="分析协议")
    predictions_json_template: str = Field(default="", description="自定义预测 JSON 模板（可选）")

    # 其他请求字段
    test_sample: Dict = Field(..., description="测试样本数据")
    target_columns: List[str] = Field(..., description="目标属性列表")
    composition_column: Union[str, List[str]] = Field(..., description="组分列名或列名列表")
    processing_column: str = Field(..., description="工艺列名")
    reference_samples: Optional[List[Dict]] = Field(default=[], description="参考样本列表")

class PromptPreviewResponse(BaseModel):
    """提示词预览响应"""
    rendered_prompt: str = Field(..., description="渲染后的完整提示词")
    template_variables: Dict = Field(..., description="模板变量值")


@router.get("/", response_model=List[PromptTemplateInfo])
async def list_templates():
    """列出所有提示词模板"""
    try:
        templates = template_manager.list_templates()
        return templates
    except Exception as e:
        logger.error(f"列出模板失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"列出模板失败: {str(e)}")


@router.get("/{template_id}")
async def get_template(template_id: str):
    """获取指定模板"""
    try:
        template = template_manager.load_template(template_id)
        if not template:
            raise HTTPException(status_code=404, detail=f"模板不存在: {template_id}")
        return template
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"加载模板失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"加载模板失败: {str(e)}")


@router.post("/{template_id}")
async def save_template(template_id: str, template_data: PromptTemplateData):
    """保存提示词模板"""
    try:
        # 转换为字典
        template_dict = template_data.model_dump()

        # 保存模板
        success = template_manager.save_template(template_id, template_dict)
        if not success:
            raise HTTPException(status_code=500, detail="保存模板失败")

        return {"message": "模板保存成功", "template_id": template_id}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"保存模板失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"保存模板失败: {str(e)}")


@router.post("/preview", response_model=PromptPreviewResponse)
async def preview_template(request: PromptPreviewRequest):
    """预览提示词模板：使用与真实预测一致的构造逻辑渲染完整 Prompt"""
    try:
        from services.prompt_builder import PromptBuilder

        # 将模板数据转换为字典格式（从请求对象中提取模板字段）
        template_dict = {
            "template_name": request.template_name,
            "template_type": request.template_type,
            "description": request.description,
            "system_role": request.system_role,
            "task_description": request.task_description,
            "input_format": request.input_format,
            "output_format": request.output_format,
            "reference_format": request.reference_format,
            "analysis_protocol": request.analysis_protocol,
            "predictions_json_template": request.predictions_json_template,
        }

        # 创建 PromptBuilder 实例（复用真实预测中的自定义模板逻辑）
        prompt_builder = PromptBuilder(custom_template=template_dict)

        # 统一组分列为列表
        if isinstance(request.composition_column, str):
            comp_cols = [request.composition_column]
        else:
            comp_cols = request.composition_column or []

        # 测试样本的组分与工艺（使用公共工具函数）
        composition_str = format_composition(request.test_sample, comp_cols)

        # 判断单位类型（仅用于预览变量展示）
        unit = ""
        if any("wt%" in col.lower() for col in comp_cols):
            unit = "wt%"
        elif any("at%" in col.lower() for col in comp_cols):
            unit = "at%"

        processing = request.test_sample.get(request.processing_column, "")

        # 按真实预测路径构造测试样本文本
        test_sample_text = f"Composition: {composition_str}\nProcessing: {processing}"

        # 构造相似样本列表（与 SimpleRAGEngine.generate_multi_target_prediction 一致）
        similar_samples: List[Dict] = []
        for ref_sample in (request.reference_samples or [])[:5]:  # 最多 5 个参考样本
            ref_comp_str = format_composition(ref_sample, comp_cols)
            ref_processing = ref_sample.get(request.processing_column, "")

            sample_data: Dict[str, Any] = {
                "composition": ref_comp_str,
                "processing": ref_processing,
            }

            # 添加所有目标属性的真实值
            for target_col in request.target_columns:
                if target_col in ref_sample and ref_sample[target_col] is not None:
                    sample_data[target_col] = ref_sample[target_col]

            similar_samples.append(sample_data)

        # 转换为 PromptBuilder 需要的 retrieved_samples 结构
        retrieved_samples = []
        for sample in similar_samples:
            sample_text = f"Composition: {sample['composition']}\nProcessing: {sample['processing']}"
            retrieved_samples.append((sample_text, 1.0, sample))

        # 使用 PromptBuilder 统一构建完整提示词（支持单/多目标 + 自定义模板）
        try:
            prompt = prompt_builder.build_prompt(
                retrieved_samples=retrieved_samples,
                test_sample=test_sample_text,
                target_properties=request.target_columns,
            )
        except Exception as build_error:
            logger.error(f"构建提示词时发生错误: {build_error}", exc_info=True)
            # 如果构建失败，返回错误信息而不是空字符串
            raise HTTPException(
                status_code=500,
                detail=f"构建提示词失败: {str(build_error)}"
            )

        # 调试日志
        logger.info(f"预览提示词构建完成，长度: {len(prompt) if prompt else 0}")
        if not prompt or not prompt.strip():
            logger.error("警告：构建的提示词为空！")
            logger.error(f"retrieved_samples 数量: {len(retrieved_samples)}")
            logger.error(f"test_sample: {test_sample_text}")
            logger.error(f"target_properties: {request.target_columns}")
            logger.error(f"template_dict: {template_dict}")
            # 返回错误而不是空提示词
            raise HTTPException(
                status_code=500,
                detail="构建的提示词为空，请检查模板配置"
            )

        # 同步构建模板变量，便于前端调试与展示
        is_multi_target = len(request.target_columns) > 1

        # reference_samples 文本与真实预测保持一致
        if is_multi_target:
            reference_section = prompt_builder._build_multi_target_reference_section(  # type: ignore[attr-defined]
                retrieved_samples,
                request.target_columns,
            )
        else:
            reference_section = prompt_builder._build_single_target_reference_section(  # type: ignore[attr-defined]
                retrieved_samples,
                request.target_columns[0],
            )

        template_variables: Dict[str, Any] = {
            "test_sample": test_sample_text,
            "reference_samples": reference_section,
            "target_properties_list": ", ".join(request.target_columns),
            "num_targets": len(request.target_columns),
            "composition": composition_str,
            "processing": processing,
            "unit": unit,
            "reference_samples_count": len(similar_samples),
        }

        # 预测 JSON 模板（与 PromptBuilder 内部逻辑保持一致）
        if is_multi_target:
            if template_dict.get("predictions_json_template"):
                template_variables["predictions_json_template"] = template_dict["predictions_json_template"]
            else:
                template_variables["predictions_json_template"] = prompt_builder._build_predictions_json_template(  # type: ignore[attr-defined]
                    request.target_columns
                )
        else:
            target_property = request.target_columns[0]
            unit_value = prompt_builder.get_property_unit(target_property)
            template_variables["target_property"] = target_property
            template_variables["unit"] = unit_value

            if template_dict.get("predictions_json_template"):
                template_variables["predictions_json_template"] = template_dict["predictions_json_template"]
            else:
                template_variables["predictions_json_template"] = (
                    f'"{target_property}": {{"value": <number>, "unit": "{unit_value}"}}'
                )

        # 记录成功日志
        logger.info(f"返回预览响应: prompt长度={len(prompt)}, template_variables keys={list(template_variables.keys())}")

        return PromptPreviewResponse(
            rendered_prompt=prompt,
            template_variables=template_variables,
        )

    except HTTPException:
        # 已有明确的 HTTP 异常，直接抛出
        raise
    except Exception as e:
        logger.error(f"预览模板失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"预览模板失败: {str(e)}")


@router.delete("/{template_id}")
async def delete_template(template_id: str):
    """删除提示词模板"""
    try:
        success = template_manager.delete_template(template_id)
        if not success:
            raise HTTPException(status_code=400, detail="删除模板失败（可能是默认模板或不存在）")
        
        return {"message": "模板删除成功", "template_id": template_id}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"删除模板失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"删除模板失败: {str(e)}")

