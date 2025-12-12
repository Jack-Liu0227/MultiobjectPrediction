# LLM 配置系统重构说明

## 概述

LLM 模型配置系统已从 JSON 文件迁移到 Python 模块，以提高安全性和可维护性。

## 主要变更

### 1. 配置文件格式变更

**旧方式** (`backend/config/llm_models.json`):
```json
{
  "models": [
    {
      "id": "deepseek-chat",
      "api_key": "${DEEPSEEK_API_KEY}",
      "base_url": "${DEEPSEEK_BASE_URL}",
      ...
    }
  ]
}
```

**新方式** (`backend/config/llm_models.py`):
```python
def get_llm_models_config() -> Dict[str, Any]:
    models = [
        {
            "id": "deepseek-chat",
            "api_key": os.getenv("DEEPSEEK_API_KEY", ""),
            "base_url": os.getenv("DEEPSEEK_BASE_URL", ""),
            ...
        }
    ]
    return {"models": models, "default_model": "deepseek-chat"}
```

### 2. 配置加载方式变更

**旧方式**:
- 读取 JSON 文件
- 使用正则表达式替换 `${VAR_NAME}` 占位符
- 需要手动处理环境变量

**新方式**:
- 直接从 Python 模块导入
- 使用 `os.getenv()` 直接读取环境变量
- 自动处理，无需占位符

### 3. 受影响的文件

#### 已更新的文件

1. **backend/config/llm_models.py** (新建)
   - 新的 Python 配置模块
   - 包含 `get_llm_models_config()` 函数

2. **backend/config/__init__.py** (新建)
   - 使 config 成为 Python 包
   - 导出常用路径常量

3. **backend/services/llm_config_loader.py** (重构)
   - 简化配置加载逻辑
   - 移除环境变量替换代码
   - 直接导入 Python 配置模块

4. **backend/llm_test.py** (更新)
   - 移除手动环境变量加载
   - 使用新的配置加载方式

5. **README.md** (更新)
   - 更新配置说明
   - 反映新的配置方式

6. **.env.example** (更新)
   - 更新使用说明
   - 指向新的配置文件

#### 保留的文件

- **backend/config/llm_models.json** (保留但不再使用)
  - 可以删除或作为参考保留
  - 系统不再读取此文件

### 4. 环境变量配置

环境变量配置方式**保持不变**，仍然在 `backend/.env` 文件中配置：

```bash
# backend/.env
DEEPSEEK_API_KEY=sk-your-key-here
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1

GEMINI_API_KEY=sk-your-key-here
GEMINI_BASE_URL=https://your-gemini-endpoint.com/v1
```

## 迁移步骤

### 对于现有用户

1. **无需任何操作**
   - 环境变量配置保持不变
   - 系统会自动使用新的配置模块

2. **可选：删除旧配置文件**
   ```bash
   rm backend/config/llm_models.json
   ```

### 添加新模型

编辑 `backend/config/llm_models.py`，在 `models` 列表中添加：

```python
{
    "id": "your-model-id",
    "name": "Your Model Name",
    "provider": "your-provider",
    "api_key": os.getenv("YOUR_API_KEY", ""),
    "base_url": os.getenv("YOUR_BASE_URL", ""),
    "model": "openai/your-model-name",
    "description": "模型描述",
    "temperature_range": [0.0, 2.0],
    "default_temperature": 0.0,
    "enabled": True
}
```

然后在 `backend/.env` 中添加对应的环境变量：

```bash
YOUR_API_KEY=your-key-here
YOUR_BASE_URL=https://your-endpoint.com/v1
```

## 优势

1. **更安全**
   - 不再需要占位符替换
   - 直接从环境变量读取，减少泄露风险

2. **更简洁**
   - 移除了复杂的正则表达式替换逻辑
   - 代码更易读和维护

3. **更灵活**
   - 可以在 Python 中添加逻辑（如条件启用）
   - 支持动态配置

4. **类型安全**
   - Python 类型提示
   - IDE 自动补全支持

## 测试

运行测试脚本验证配置：

```bash
python backend/test_config.py
```

预期输出：
```
✓ 成功加载配置
  - 模型数量: 6
  - 默认模型: deepseek-chat
```

## 兼容性

- **后端 API**: 完全兼容，无需修改
- **前端**: 无需修改，通过 API 获取配置
- **环境变量**: 完全兼容，配置方式不变

## 常见问题

### Q: 旧的 JSON 配置文件还能用吗？

A: 不能。系统现在只读取 Python 配置模块。但环境变量配置保持不变。

### Q: 如何验证配置是否正确？

A: 运行 `python backend/test_config.py` 查看所有模型的配置状态。

### Q: 环境变量未设置会怎样？

A: 模型会被标记为禁用，但不会导致系统崩溃。

## 相关文件

- `backend/config/llm_models.py` - 新的配置模块
- `backend/services/llm_config_loader.py` - 配置加载器
- `backend/test_config.py` - 配置测试脚本
- `backend/.env` - 环境变量配置

