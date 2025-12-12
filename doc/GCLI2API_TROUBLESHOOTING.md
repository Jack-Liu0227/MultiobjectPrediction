# GCLI2API 连接问题排查与解决方案

## 问题描述

**错误现象**：
- GCLI2API 模型连接失败
- 错误日志显示 403 权限错误和连接重置错误
- 测试脚本报告"网络错误：无法连接到服务器"

**错误日志**：
```
Google API returned status 403 (STREAMING)
PERMISSION_DENIED: Gemini for Google Cloud API has not been used in project...
ConnectionResetError: [WinError 10054] 远程主机强迫关闭了一个现有的连接
```

## 根本原因

### 1. Base URL 配置错误
**问题**: `.env` 文件中的 Base URL 末尾多了斜杠
```bash
# 错误配置
GCLI2API_BASE_URL=http://127.0.0.1:7861/

# 正确配置
GCLI2API_BASE_URL=http://127.0.0.1:7861/v1
```

**影响**: URL 拼接错误，导致请求发送到错误的端点

### 2. 模型路径配置错误
**问题**: 模型路径使用了错误的前缀
```python
# 错误配置
"model": "openai/gemini-2.5-pro"  # 或 "gemini/gemini-2.5-pro"

# 正确配置
"model": "gemini-2.5-pro"  # GCLI2API 不需要前缀
```

**影响**: GCLI2API 无法识别模型名称

### 3. 403 权限错误的真实原因
**误导性错误**: 错误日志显示 Google Cloud API 权限问题，但实际上是：
- GCLI2API 代理服务尝试调用 Google API 时遇到问题
- 这是 GCLI2API 内部的配置问题，不是我们的配置问题
- 当 Base URL 和模型路径正确后，这个错误会消失

## 解决方案

### 步骤 1: 修复 Base URL

编辑 `backend/.env` 文件：
```bash
GCLI2API_API_KEY=pwd
GCLI2API_BASE_URL=http://127.0.0.1:7861/v1  # 添加 /v1 后缀
```

### 步骤 2: 修复模型路径

编辑 `backend/config/llm_models.py`：
```python
{
    "id": "gemini-2.5-pro-gcli2api",
    "name": "Gemini 2.5 Pro (GCLI2API)",
    "provider": "GCLI2API",
    "api_key": os.getenv("GCLI2API_API_KEY", ""),
    "base_url": os.getenv("GCLI2API_BASE_URL", ""),
    "model": "gemini-2.5-pro",  # 移除前缀
    "description": "Gemini Pro 模型，通过 GCLI2API 本地代理访问",
    "temperature_range": [0.0, 2.0],
    "default_temperature": 0.0,
    "enabled": True
}
```

### 步骤 3: 验证修复

运行诊断脚本：
```bash
python backend/diagnose_gcli2api.py
```

**预期输出**：
```
✓ 端口 7861 开放
✓ API 正常工作
可用模型数量: 54
  - gemini-2.5-pro
  - gemini-2.5-flash
```

运行测试脚本：
```bash
python backend/test_gcli2api.py
```

**预期输出**：
```
✓ 模型 'gemini-2.5-pro' 在可用列表中
✓ 调用成功
```

## 诊断工具

### 1. GCLI2API 服务诊断
```bash
python backend/diagnose_gcli2api.py
```

**功能**：
- 检查环境变量配置
- 测试端口连接
- 测试 HTTP 接口
- 列出可用模型

### 2. GCLI2API 模型测试
```bash
python backend/test_gcli2api.py
```

**功能**：
- 测试模型列表接口
- 测试聊天补全接口
- 验证模型路径正确性

### 3. 完整 LLM 测试
```bash
python backend/llm_test.py
```

**功能**：
- 测试所有配置的 LLM 模型
- 包括 GCLI2API 模型

## 验证结果

### ✅ 修复后的状态

**配置验证**：
```
✓ 成功加载配置
  - 模型数量: 5
  - GCLI2API 模型: 2 个
```

**服务诊断**：
```
✓ 端口 7861 开放
✓ API 正常工作
✓ 可用模型数量: 54
```

**模型测试**：
```
✓ gemini-2.5-pro 在可用列表中
✓ gemini-2.5-flash 在可用列表中
✓ 聊天补全接口正常
```

## 常见问题

### Q1: 为什么 GCLI2API 需要 `/v1` 后缀？
A: GCLI2API 实现了 OpenAI 兼容的 API，标准路径是 `/v1/chat/completions`，所以 Base URL 需要包含 `/v1`。

### Q2: 为什么模型路径不需要 `openai/` 前缀？
A: GCLI2API 直接使用 Google 的模型名称（如 `gemini-2.5-pro`），不需要 LiteLLM 的提供商前缀。

### Q3: 如何查看 GCLI2API 支持的所有模型？
A: 访问 `http://127.0.0.1:7861/v1/models` 或运行诊断脚本。

### Q4: GCLI2API 服务如何启动？
A: 这取决于你的 GCLI2API 安装方式，通常是：
```bash
# 如果是 Python 包
gcli2api --port 7861

# 如果是可执行文件
./gcli2api.exe
```

### Q5: 为什么有时会出现 403 错误？
A: 可能的原因：
1. GCLI2API 的 Google API 凭证配置问题
2. Google Cloud 项目未启用 Gemini API
3. API 配额已用完
4. 网络连接问题

**解决方案**：检查 GCLI2API 的配置文件和日志。

## 最佳实践

### 1. 配置规范
```bash
# .env 文件
GCLI2API_API_KEY=pwd  # 或其他密钥
GCLI2API_BASE_URL=http://127.0.0.1:7861/v1  # 必须包含 /v1
```

### 2. 模型命名规范
```python
# llm_models.py
{
    "id": "gemini-2.5-pro-gcli2api",  # 唯一标识符
    "model": "gemini-2.5-pro",  # GCLI2API 的模型名称
    "provider": "GCLI2API",  # 提供商标识
}
```

### 3. 定期检查
```bash
# 每次启动项目前检查 GCLI2API 服务
python backend/diagnose_gcli2api.py
```

## 总结

**问题根源**：
- Base URL 配置错误（缺少 `/v1`）
- 模型路径配置错误（使用了错误的前缀）

**解决方案**：
- 修复 Base URL 为 `http://127.0.0.1:7861/v1`
- 修复模型路径为 `gemini-2.5-pro`（不带前缀）

**验证工具**：
- `diagnose_gcli2api.py` - 服务诊断
- `test_gcli2api.py` - 模型测试
- `llm_test.py` - 完整测试

**当前状态**：✅ 问题已解决，GCLI2API 模型正常工作

