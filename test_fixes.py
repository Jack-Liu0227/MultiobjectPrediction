#!/usr/bin/env python3
"""
测试修复的功能
"""

import requests
import json

def test_prompt_preview():
    """测试提示词预览功能"""
    print("=== 测试提示词预览功能 ===")
    
    # 使用默认多目标模板
    test_data = {
        "template_name": "默认多目标模板",
        "template_type": "multi_target",
        "description": "用于多目标预测的默认模板",
        "system_role": "You are a materials science expert specializing in predicting multiple material properties simultaneously.",
        "task_description": "Predict {target_properties_list} for the target material using systematic analysis.",
        "input_format": "**Target Material**:\n{test_sample}",
        "output_format": "**Final Predictions**:\n```json\n{{\n    \"predictions\": {{\n        {predictions_json_template}\n    }},\n    \"confidence\": \"<high/medium/low>\",\n    \"reasoning\": \"<brief explanation>\"\n}}\n```",
        "reference_format": "**Reference Samples**:\n\nEach sample shows values for all {num_targets} target properties.\n\n{reference_samples}",
        "analysis_protocol": "**Required Analysis Protocol**:\n\n1. **Reference-Driven Baseline Establishment**:\n   - **Classification**: Classify the general family of all materials.\n   - **Primary Baseline Selection**: Identify the most analogous sample from references.\n   - **Sanity Check**: Use general knowledge of standard materials as secondary check.\n\n2. **Multi-Property Correlation Analysis**:\n   - Analyze relationships between target properties.\n   - Consider trade-offs and dependencies.\n\n3. **Final Predictions**:\n   - Provide numerical values for all target properties.\n   - Include confidence level and brief reasoning.",
        "test_sample": {
            "Al(at%)": 5.2,
            "Co(at%)": 20.0,
            "Cr(at%)": 25.0,
            "Fe(at%)": 25.0,
            "Ni(at%)": 24.8,
            "Processing_Description": "Vacuum arc melting + Homogenization at 1200°C for 24h + Cold rolling to 50% reduction + Annealing at 800°C for 2h"
        },
        "reference_samples": [
            {
                "composition": "Al 5.0, Co 20.0, Cr 25.0, Fe 25.0, Ni 25.0",
                "processing": "Vacuum arc melting + Homogenization at 1200°C for 24h",
                "UTS(MPa)": 850.0,
                "El(%)": 12.5
            }
        ],
        "composition_column": ["Al(at%)", "Co(at%)", "Cr(at%)", "Fe(at%)", "Ni(at%)"],
        "processing_column": "Processing_Description",
        "target_columns": ["UTS(MPa)", "El(%)"]
    }
    
    try:
        response = requests.post(
            'http://localhost:8000/api/prompt-templates/preview',
            headers={'Content-Type': 'application/json'},
            json=test_data,
            timeout=30
        )
        
        print(f"状态码: {response.status_code}")
        
        if response.status_code == 200:
            result = response.json()
            print(f"rendered_prompt 长度: {len(result.get('rendered_prompt', ''))}")
            print(f"template_variables 键: {list(result.get('template_variables', {}).keys())}")
            
            if result.get('rendered_prompt'):
                print("✅ 提示词预览功能正常")
                print("预览内容前200字符:")
                print(result['rendered_prompt'][:200] + "...")
            else:
                print("❌ 提示词预览返回空内容")
                print("完整响应:", json.dumps(result, indent=2, ensure_ascii=False))
        else:
            print(f"❌ 请求失败: {response.status_code}")
            print("错误内容:", response.text[:500])
            
    except Exception as e:
        print(f"❌ 测试异常: {e}")

def test_repredict_request_format():
    """测试重新预测请求格式"""
    print("\n=== 测试重新预测请求格式 ===")
    
    # 模拟从 task_config.json 加载的数据
    task_config = {
        "task_id": "test-task-id",
        "request_data": {
            "file_id": "test-file-id",
            "filename": "test.csv",
            "config": {
                "composition_column": ["Al(at%)", "Co(at%)"],
                "processing_column": "Processing_Description",
                "target_columns": ["UTS(MPa)", "El(%)"],
                "train_ratio": 0.8,
                "workers": 5,
                "force_restart": False
            }
        }
    }
    
    # 转换为重新预测请求格式
    request_data = task_config["request_data"]
    prediction_request = {
        "file_id": request_data["file_id"],
        "filename": request_data["filename"],
        "config": {
            **request_data["config"],
            "force_restart": True,
            "continue_from_task_id": None
        }
    }
    
    print("转换后的请求格式:")
    print(json.dumps(prediction_request, indent=2, ensure_ascii=False))
    print("✅ 请求格式转换正确")

if __name__ == "__main__":
    test_prompt_preview()
    test_repredict_request_format()
