#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
GCLI2API 模型测试脚本
测试通过 GCLI2API 本地代理访问 Gemini 模型
"""

import sys
from pathlib import Path
import requests

# 添加 backend 目录到 Python 路径
BACKEND_DIR = Path(__file__).parent
sys.path.insert(0, str(BACKEND_DIR))

from services.llm_config_loader import load_llm_config, get_model_config

print("=" * 80)
print("GCLI2API 模型测试")
print("=" * 80)
print()

# 加载配置
config = load_llm_config()
models = config.get("models", [])

# 筛选 GCLI2API 模型
gcli2api_models = [m for m in models if m.get("provider") == "GCLI2API"]

if not gcli2api_models:
    print("❌ 未找到 GCLI2API 模型配置")
    sys.exit(1)

print(f"找到 {len(gcli2api_models)} 个 GCLI2API 模型")
print()

# 测试每个模型
for model in gcli2api_models:
    model_id = model.get("id")
    model_name = model.get("name")
    model_path = model.get("model")
    base_url = model.get("base_url")
    api_key = model.get("api_key")
    
    print(f"测试模型: {model_name}")
    print(f"  ID: {model_id}")
    print(f"  模型路径: {model_path}")
    print(f"  Base URL: {base_url}")
    print(f"  API Key: {'***' if api_key else '未设置'}")
    print()
    
    # 1. 测试模型列表接口
    print("  [1] 测试模型列表接口...")
    try:
        models_url = base_url.rstrip('/') + '/models'
        headers = {'Authorization': f'Bearer {api_key}'} if api_key else {}
        
        response = requests.get(models_url, headers=headers, timeout=10)
        
        if response.status_code == 200:
            data = response.json()
            available_models = [m['id'] for m in data.get('data', [])]
            
            if model_path in available_models:
                print(f"      ✓ 模型 '{model_path}' 在可用列表中")
            else:
                print(f"      ⚠ 模型 '{model_path}' 不在可用列表中")
                print(f"      可用的模型: {', '.join(available_models[:5])}...")
        else:
            print(f"      ✗ 接口返回错误: {response.status_code}")
            
    except Exception as e:
        print(f"      ✗ 请求失败: {e}")
    
    print()
    
    # 2. 测试聊天补全接口
    print("  [2] 测试聊天补全接口...")
    try:
        chat_url = base_url.rstrip('/') + '/chat/completions'
        headers = {
            'Content-Type': 'application/json',
        }
        if api_key:
            headers['Authorization'] = f'Bearer {api_key}'
        
        payload = {
            "model": model_path,
            "messages": [
                {"role": "user", "content": "请回复'OK'"}
            ],
            "temperature": 0.0,
            "max_tokens": 10
        }
        
        response = requests.post(chat_url, json=payload, headers=headers, timeout=30)
        
        if response.status_code == 200:
            data = response.json()
            content = data.get('choices', [{}])[0].get('message', {}).get('content', '')
            print(f"      ✓ 调用成功")
            print(f"      响应: {content}")
        else:
            print(f"      ✗ 调用失败: {response.status_code}")
            print(f"      错误: {response.text[:200]}")
            
    except requests.exceptions.Timeout:
        print(f"      ✗ 请求超时（可能是模型加载较慢）")
    except Exception as e:
        print(f"      ✗ 请求失败: {e}")
    
    print()
    print("-" * 80)
    print()

print("=" * 80)
print("测试完成")
print("=" * 80)

