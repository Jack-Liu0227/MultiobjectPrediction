# 多目标材料性能预测系统

基于 RAG（检索增强生成）的多目标优化预测系统，支持同时预测多个材料性能指标并进行 Pareto 前沿分析。

---

## 🚀 快速启动

### Windows 用户

**方式 1: 使用批处理文件（推荐）**
```bash
# 双击运行或在命令行执行
start_all.bat
```

**方式 2: 使用 PowerShell**
```powershell
# 在 PowerShell 中执行
.\start_all.ps1
```

**停止服务**
```bash
stop_all.bat
```

### Linux/Mac 用户

```bash
# 添加执行权限
chmod +x start_all.sh

# 启动服务
./start_all.sh

# 停止服务：按 Ctrl+C
```

---

## 📦 完整安装指南（从零开始）

### 前置要求

在开始之前，请确保您的系统已安装以下软件：

1. **Python 3.10+**
   - 下载地址：https://www.python.org/downloads/
   - 安装时勾选 "Add Python to PATH"
   - 验证安装：`python --version`

2. **Node.js 16+**
   - 下载地址：https://nodejs.org/
   - 推荐安装 LTS 版本
   - 验证安装：`node --version` 和 `npm --version`

3. **Git**（可选，用于克隆项目）
   - 下载地址：https://git-scm.com/

### 第一步：下载 all-MiniLM-L6-v2 模型

本项目使用 `all-MiniLM-L6-v2` 模型进行向量嵌入，需要手动下载到项目根目录。

**方法 1：从 Hugging Face 下载（推荐）**

1. 访问模型页面：https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2
2. 点击 "Files and versions" 标签
3. 下载以下必需文件到项目根目录的 `all-MiniLM-L6-v2` 文件夹：
   - `config.json`
   - `model.safetensors`
   - `tokenizer.json`
   - `tokenizer_config.json`
   - `vocab.txt`
   - `modules.json`
   - `config_sentence_transformers.json`
   - `sentence_bert_config.json`
   - `special_tokens_map.json`
   - `1_Pooling/config.json`（在 `1_Pooling` 子目录中）
   - `2_Normalize/config.json`（在 `2_Normalize` 子目录中）

**方法 2：使用 Python 脚本自动下载**

在项目根目录创建并运行以下脚本：

```python
# download_model.py
from sentence_transformers import SentenceTransformer
import os

# 设置下载目录为项目根目录
model_name = "all-MiniLM-L6-v2"
save_path = os.path.join(os.getcwd(), model_name)

print(f"正在下载模型到: {save_path}")
model = SentenceTransformer('sentence-transformers/all-MiniLM-L6-v2')
model.save(save_path)
print("模型下载完成！")
```

运行脚本：
```bash
pip install sentence-transformers
python download_model.py
```

**验证模型文件**

确保项目根目录下的 `all-MiniLM-L6-v2` 文件夹包含以下结构：
```
all-MiniLM-L6-v2/
├── 1_Pooling/
│   └── config.json
├── 2_Normalize/
│   └── config.json
├── config.json
├── config_sentence_transformers.json
├── model.safetensors
├── modules.json
├── sentence_bert_config.json
├── special_tokens_map.json
├── tokenizer.json
├── tokenizer_config.json
└── vocab.txt
```

### 第二步：配置环境变量

在项目根目录创建 `.env` 文件，配置 LLM API 密钥：

```env
# DeepSeek API（推荐，性价比高）
DEEPSEEK_API_KEY=your-deepseek-api-key-here
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1

# Gemini API（可选）
GEMINI_API_KEY=your-gemini-api-key-here
GEMINI_BASE_URL=https://your-gemini-proxy-url/v1

# 其他可选配置
# OPENROUTER_API_KEY=your-openrouter-api-key
# ONEAPI_BASE_URL=http://your-oneapi-server
# ONEAPI_API_KEY=your-oneapi-key
```

**获取 API 密钥：**
- **DeepSeek**: 访问 https://platform.deepseek.com/ 注册并获取 API Key
- **Gemini**: 访问 https://ai.google.dev/ 获取 API Key（或使用代理服务）

### 第三步：安装项目依赖

**后端依赖**

```bash
cd backend
pip install -r requirements.txt
cd ..
```

**前端依赖**

```bash
cd frontend
npm install
cd ..
```

### 第四步：启动项目

**使用自动启动脚本（推荐）**

Windows:
```bash
start_all.bat
```

Linux/Mac:
```bash
chmod +x start_all.sh
./start_all.sh
```

**手动启动**

如果自动启动脚本遇到问题，可以手动启动：

1. 启动后端：
```bash
cd backend
python -m uvicorn main:app --reload --port 8000
```

2. 启动前端（新开一个终端）：
```bash
cd frontend
npm run dev
```

---

## 🌐 访问应用

启动成功后，访问以下地址：

- **前端应用**: http://localhost:3000
- **多目标预测**: http://localhost:3000/prediction
- **后端 API**: http://localhost:8000
- **API 文档**: http://localhost:8000/docs

---

## 📦 系统要求

### 硬件要求
- **内存**: 至少 4GB RAM（推荐 8GB+）
- **存储**: 至少 5GB 可用空间（包括模型文件）
- **处理器**: 支持 AVX 指令集的现代 CPU

### 软件要求
- **Python**: 3.10 或更高版本
- **Node.js**: 16 或更高版本
- **npm**: 随 Node.js 安装
- **操作系统**: Windows 10+, macOS 10.15+, 或 Linux

### 主要依赖包

**Python 依赖**（详见 `backend/requirements.txt`）
- fastapi >= 0.104.0
- uvicorn[standard] >= 0.24.0
- pandas >= 2.0.0
- numpy >= 1.24.0
- sentence-transformers >= 2.2.0（RAG 向量嵌入）
- litellm >= 1.0.0（LLM 调用）
- scikit-learn >= 1.3.0
- torch >= 2.0.0
- plotly >= 5.17.0（可视化）
- python-dotenv >= 1.0.0（环境变量）

**Node.js 依赖**（详见 `frontend/package.json`）
- next
- react
- typescript
- tailwindcss
- axios

---

## 🎯 核心功能

### 1. 多目标预测
- 同时预测 2-5 个材料性能指标
- 基于 RAG 的检索增强生成
- 支持多种 LLM 模型（Gemini, DeepSeek, OpenRouter, Ollama）

### 2. 迭代预测（新功能）
- 基于 LangGraph 的智能迭代预测工作流
- 自动收敛检测和迭代优化
- 支持增量预测和断点续传
- 完整的迭代历史追踪和可视化
- 自适应迭代次数（1-10轮可配置）

### 3. Pareto 前沿分析
- 自动识别 Pareto 最优解
- 计算多目标优化质量指标（Hypervolume, Spacing, Spread）
- 可视化 Pareto 前沿统计

### 4. 灵活配置
- 可调整训练/测试集比例（50%-90%）
- 可配置 RAG 检索参数
- 支持多种模型和参数
- 收敛阈值和迭代策略可定制

### 5. 完整工作流
- 数据上传 → 配置 → 预测 → 结果展示
- 实时任务状态跟踪
- 结果下载和导出
- 详细的预测过程追踪

---

## 📖 使用流程

### 1. 准备数据

准备 CSV 格式的数据文件，包含以下列：
- **组成列**: 材料元素组成（如 `composition`）
- **热处理列**: 热处理工艺描述（如 `Processing_Description`）
- **目标列**: 至少 2 个性能指标（如 `UTS(MPa)`, `El(%)`）

示例：
```csv
composition,Processing_Description,UTS(MPa),El(%)
Ti-6Al-4V,Solution treated at 950°C for 1h + aged at 550°C for 4h,1050,12.5
Ti-6Al-4V,Solution treated at 980°C for 2h + aged at 600°C for 6h,1100,10.8
```

### 2. 上传数据

访问 http://localhost:3000/prediction，上传 CSV 文件。

### 3. 配置参数

- 选择元素组成列、热处理列和目标列
- 调整训练比例和 RAG 参数
- 选择模型提供商和模型
- **选择预测模式**：
  - **标准模式**：单次预测，快速获取结果
  - **迭代模式**（推荐）：多轮迭代优化，提高预测精度
    - 配置最大迭代次数（1-10轮）
    - 设置收敛阈值（默认5%）
    - 支持断点续传

### 4. 执行预测

点击"开始预测"，等待预测完成（进度实时显示）。

**迭代模式特点**：
- 系统自动进行多轮预测优化
- 实时显示每轮迭代进度
- 自动检测收敛并停止
- 可查看每个样本的完整迭代历史

### 5. 查看结果

- 查看预测结果表格（真实值 vs 预测值）
- 查看评估指标（R²、RMSE、MAE、MAPE）
- 查看 Pareto 前沿分析
- **迭代模式额外功能**：
  - 查看迭代预测轨迹图
  - 分析每个样本的收敛过程
  - 查看每轮迭代的提示词和响应
- 下载结果 CSV

---

## 🔧 高级配置

### 环境变量配置

项目支持通过 `.env` 文件配置 LLM API 密钥和服务地址。在项目根目录创建 `.env` 文件：

```env
# DeepSeek API 配置
DEEPSEEK_API_KEY=sk-your-deepseek-api-key
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1

# Gemini API 配置
GEMINI_API_KEY=your-gemini-api-key
GEMINI_BASE_URL=https://generativelanguage.googleapis.com/v1

# OpenRouter API 配置（可选）
OPENROUTER_API_KEY=your-openrouter-api-key
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1

# OneAPI 配置（可选，用于统一 API 管理）
ONEAPI_BASE_URL=http://your-oneapi-server
ONEAPI_API_KEY=your-oneapi-key
```

**注意**：
- 所有 API 密钥和 URL 都从 `.env` 文件中读取
- 不要在配置文件中硬编码任何敏感信息
- `.env` 文件已在 `.gitignore` 中，不会被提交到版本控制

### LLM 模型配置

LLM 模型配置现在使用 Python 模块 `backend/config/llm_models.py`，该模块会自动从 `.env` 文件读取环境变量。

如需添加新模型，编辑 `backend/config/llm_models.py`：

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

**配置说明**：
- `id`: 模型的唯一标识符
- `provider`: 模型提供商（如 gemini, deepseek, openai）
- `model`: 实际调用的模型名称（格式：`provider/model-name`）
- `temperature_range`: 允许的温度参数范围
- `default_temperature`: 默认温度参数
- `enabled`: 是否启用该模型
- API 密钥和 URL 会自动从 `.env` 文件中读取对应的环境变量

---

## 📚 文档

- [项目状态](doc/PROJECT_STATUS.md) - 查看项目完成情况
- [快速启动指南](doc/QUICK_START_GUIDE.md) - 详细的启动说明
- [测试指南](doc/TESTING_GUIDE.md) - 完整的测试流程
- [系统设计](doc/multi_objective_optimization_system_design.md) - 详细的架构设计
- [实现完成报告](doc/IMPLEMENTATION_COMPLETE.md) - 开发总结

---

## 🐛 常见问题

### Q: 启动脚本报错 "找不到 Python"
**A**:
1. 确保已安装 Python 3.10+
2. 验证安装：`python --version` 或 `python3 --version`
3. Windows 用户：确保安装时勾选了 "Add Python to PATH"
4. 手动添加到 PATH：系统环境变量 → Path → 添加 Python 安装目录

### Q: 找不到 all-MiniLM-L6-v2 模型
**A**:
1. 确保已按照"第一步：下载 all-MiniLM-L6-v2 模型"完成模型下载
2. 验证模型目录结构：项目根目录下应有 `all-MiniLM-L6-v2` 文件夹
3. 检查必需文件是否完整（config.json, model.safetensors 等）
4. 运行 `python backend/check_system.py` 检查系统配置

### Q: 前端依赖安装失败
**A**:
1. 删除 `frontend/node_modules` 和 `frontend/package-lock.json`
2. 重新运行 `npm install`
3. 如果仍然失败，尝试使用 `npm install --legacy-peer-deps`
4. 检查 Node.js 版本是否 >= 16

### Q: 后端启动失败
**A**:
1. 检查端口 8000 是否被占用：`netstat -ano | findstr :8000`（Windows）或 `lsof -i :8000`（Linux/Mac）
2. 查看后端日志：`Logs/backend.log`
3. 确保所有 Python 依赖已安装：`pip install -r backend/requirements.txt`
4. 检查 `.env` 文件是否正确配置

### Q: 预测任务一直卡在 "pending" 状态
**A**:
1. 检查 `.env` 文件中的 API key 是否正确配置
2. 查看后端日志：`Logs/backend.log` 查找错误信息
3. 验证 API key 是否有效（访问对应平台检查）
4. 检查网络连接是否正常
5. 尝试切换到其他 LLM 模型

### Q: 模型下载速度慢或失败
**A**:
1. 使用国内镜像：设置环境变量 `HF_ENDPOINT=https://hf-mirror.com`
2. 使用代理下载
3. 手动从 Hugging Face 下载文件后放到 `all-MiniLM-L6-v2` 目录
4. 使用提供的 Python 脚本自动下载

### Q: 内存不足错误
**A**:
1. 减少 `workers` 参数（默认 5，可降至 1-2）
2. 减少 `sample_size` 参数
3. 关闭其他占用内存的程序
4. 升级系统内存（推荐 8GB+）

### Q: CORS 错误
**A**:
1. 确保前端和后端都已启动
2. 检查前端访问的 API 地址是否正确（应为 http://localhost:8000）
3. 查看 `backend/main.py` 中的 CORS 配置
4. 清除浏览器缓存后重试

---

## 📞 技术支持

如遇到问题，请检查：
1. Python 和 Node.js 版本是否符合要求
2. 依赖包是否完整安装
3. 环境变量是否正确配置
4. 端口 8000 和 3000 是否被占用

---

## 📄 许可证

本项目仅供学习和研究使用。

---

## 🎉 开始使用

现在您已经准备好使用系统了！

1. 运行 `start_all.bat`（Windows）或 `./start_all.sh`（Linux/Mac）
2. 访问 http://localhost:3000/prediction
3. 上传您的数据并开始预测

祝您使用愉快！🚀

---

**版本**: v2.0 (迭代预测功能)  
**最后更新**: 2025-12-14

