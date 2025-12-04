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

## 📋 手动启动

如果自动启动脚本遇到问题，可以手动启动：

### 启动后端

```bash
cd backend
python -m venv venv  # 首次运行需要创建虚拟环境

# Windows
venv\Scripts\activate
# Linux/Mac
source venv/bin/activate

pip install fastapi uvicorn pandas numpy scikit-learn pydantic
python -m uvicorn main:app --reload --port 8000
```

### 启动前端

```bash
cd frontend
npm install  # 首次运行需要安装依赖
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

## 📦 环境要求

### 必需
- **Python**: 3.10 或更高版本
- **Node.js**: 16 或更高版本
- **npm**: 随 Node.js 安装

### Python 依赖
- fastapi
- uvicorn
- pandas
- numpy
- scikit-learn
- pydantic
- sentence-transformers（用于向量嵌入）

### Node.js 依赖
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

### 2. Pareto 前沿分析
- 自动识别 Pareto 最优解
- 计算多目标优化质量指标（Hypervolume, Spacing, Spread）
- 可视化 Pareto 前沿统计

### 3. 灵活配置
- 可调整训练/测试集比例（50%-90%）
- 可配置 RAG 检索参数
- 支持多种模型和参数

### 4. 完整工作流
- 数据上传 → 配置 → 预测 → 结果展示
- 实时任务状态跟踪
- 结果下载和导出

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

### 4. 执行预测

点击"开始预测"，等待预测完成（进度实时显示）。

### 5. 查看结果

- 查看预测结果表格（真实值 vs 预测值）
- 查看评估指标（R²、RMSE、MAE、MAPE）
- 查看 Pareto 前沿分析
- 下载结果 CSV

---

## 🔧 配置

### 环境变量

创建 `.env` 文件（项目根目录）：

```env
# API Keys（根据使用的模型提供商配置）
GEMINI_API_KEY=your-gemini-api-key
DEEPSEEK_API_KEY=your-deepseek-api-key
OPENROUTER_API_KEY=your-openrouter-api-key

# OneAPI 配置（可选）
ONEAPI_BASE_URL=http://your-oneapi-server
ONEAPI_API_KEY=your-oneapi-key
```

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
**A**: 确保已安装 Python 3.10+ 并添加到系统 PATH。

### Q: 前端依赖安装失败
**A**: 尝试删除 `frontend/node_modules` 目录后重新运行 `npm install`。

### Q: 后端启动失败
**A**: 检查端口 8000 是否被占用，或查看后端日志文件。

### Q: 预测任务一直卡在 "pending" 状态
**A**: 检查 API key 配置是否正确，或查看后端日志。

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

