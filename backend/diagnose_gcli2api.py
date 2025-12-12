#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
GCLI2API 服务诊断脚本
检查本地 GCLI2API 服务是否正常运行
"""

import requests
import socket
from pathlib import Path
from dotenv import load_dotenv
import os

# 加载环境变量
BACKEND_DIR = Path(__file__).parent
ENV_FILE = BACKEND_DIR / ".env"
load_dotenv(ENV_FILE, override=True)

GCLI2API_BASE_URL = os.getenv("GCLI2API_BASE_URL", "")
GCLI2API_API_KEY = os.getenv("GCLI2API_API_KEY", "")

print("=" * 80)
print("GCLI2API 服务诊断")
print("=" * 80)
print()

# 1. 检查环境变量
print("1. 环境变量检查")
print("-" * 80)
print(f"   GCLI2API_BASE_URL: {GCLI2API_BASE_URL}")
print(f"   GCLI2API_API_KEY: {'***' if GCLI2API_API_KEY else '未设置'}")
print()

if not GCLI2API_BASE_URL:
    print("❌ 错误: GCLI2API_BASE_URL 未设置")
    exit(1)

# 2. 解析 URL
print("2. URL 解析")
print("-" * 80)
try:
    from urllib.parse import urlparse
    parsed = urlparse(GCLI2API_BASE_URL)
    host = parsed.hostname or "127.0.0.1"
    port = parsed.port or 7861
    print(f"   主机: {host}")
    print(f"   端口: {port}")
    print(f"   路径: {parsed.path}")
    print()
except Exception as e:
    print(f"❌ URL 解析失败: {e}")
    exit(1)

# 3. 检查端口是否开放
print("3. 端口连接测试")
print("-" * 80)
try:
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(3)
    result = sock.connect_ex((host, port))
    sock.close()
    
    if result == 0:
        print(f"✓ 端口 {port} 开放")
    else:
        print(f"❌ 端口 {port} 未开放或无法连接")
        print(f"   错误代码: {result}")
        print()
        print("可能的原因:")
        print("  1. GCLI2API 服务未启动")
        print("  2. 端口号配置错误")
        print("  3. 防火墙阻止连接")
        print()
        print("解决方案:")
        print("  - 启动 GCLI2API 服务")
        print("  - 检查服务是否监听在正确的端口")
        exit(1)
except Exception as e:
    print(f"❌ 连接测试失败: {e}")
    exit(1)

print()

# 4. 测试 HTTP 连接
print("4. HTTP 连接测试")
print("-" * 80)

# 测试根路径
test_urls = [
    GCLI2API_BASE_URL,
    GCLI2API_BASE_URL.rstrip('/'),
    f"http://{host}:{port}/",
    f"http://{host}:{port}/v1",
    f"http://{host}:{port}/v1/models",
]

for url in test_urls:
    try:
        print(f"   测试: {url}")
        response = requests.get(url, timeout=5)
        print(f"   ✓ 状态码: {response.status_code}")
        if response.status_code == 200:
            print(f"   ✓ 响应: {response.text[:100]}")
            break
    except requests.exceptions.ConnectionError:
        print(f"   ❌ 连接被拒绝")
    except requests.exceptions.Timeout:
        print(f"   ❌ 连接超时")
    except Exception as e:
        print(f"   ❌ 错误: {e}")
    print()

print()

# 5. 测试 OpenAI 兼容接口
print("5. OpenAI 兼容接口测试")
print("-" * 80)

models_url = GCLI2API_BASE_URL.rstrip('/') + '/models'
print(f"   测试 URL: {models_url}")

try:
    headers = {}
    if GCLI2API_API_KEY:
        headers['Authorization'] = f'Bearer {GCLI2API_API_KEY}'
    
    response = requests.get(models_url, headers=headers, timeout=10)
    print(f"   状态码: {response.status_code}")
    
    if response.status_code == 200:
        print(f"   ✓ API 正常工作")
        try:
            data = response.json()
            if 'data' in data:
                print(f"   可用模型数量: {len(data['data'])}")
                for model in data['data'][:3]:
                    print(f"     - {model.get('id', 'unknown')}")
        except:
            print(f"   响应: {response.text[:200]}")
    else:
        print(f"   ❌ API 返回错误")
        print(f"   响应: {response.text[:500]}")
        
except requests.exceptions.ConnectionError as e:
    print(f"   ❌ 连接失败: {e}")
    print()
    print("诊断结果:")
    print("  GCLI2API 服务未运行或配置错误")
    print()
    print("解决方案:")
    print("  1. 启动 GCLI2API 服务")
    print("  2. 确认服务监听在 127.0.0.1:7861")
    print("  3. 检查服务日志查看错误信息")
    
except Exception as e:
    print(f"   ❌ 测试失败: {e}")

print()
print("=" * 80)
print("诊断完成")
print("=" * 80)

