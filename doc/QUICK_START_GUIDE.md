# 快速启动指南

**更新时间**: 2025-12-02

本指南帮助您快速启动和使用多目标材料性能预测系统。

---

## 📦 环境要求

### 后端
- Python 3.10+
- FastAPI
- pandas, numpy, scikit-learn
- sentence-transformers（用于向量嵌入）
- LiteLLM（用于多模型支持）

### 前端
- Node.js 16+
- Next.js 14
- React 18
- TypeScript

---

## 🚀 快速启动

### 1. 安装依赖

**后端依赖**:
```bash
# 使用 uv（推荐）
uv pip install -r requirements.txt

# 或使用 pip
pip install -r requirements.txt
```

**前端依赖**:
```bash
cd frontend
npm install
```

---

### 2. 配置环境变量

创建 `.env` 文件（项目根目录）:

```env
# API Keys（根据使用的模型提供商配置）
GEMINI_API_KEY=your-gemini-api-key
DEEPSEEK_API_KEY=your-deepseek-api-key
OPENROUTER_API_KEY=your-openrouter-api-key

# OneAPI 配置（可选）
ONEAPI_BASE_URL=http://your-oneapi-server
ONEAPI_API_KEY=your-oneapi-key

# 数据库配置（可选）
DATABASE_URL=sqlite:///./storage/app.db

# 调试模式
DEBUG=False
```

---

### 3. 启动服务

**启动后端**:
```bash
cd backend
uvicorn main:app --reload --port 8000
```

访问 API 文档: http://localhost:8000/docs

**启动前端**:
```bash
cd frontend
npm run dev
```

访问应用: http://localhost:3000

---

## 📖 使用流程

### 方式 1: 多目标预测（推荐）

1. **访问预测页面**
   - 打开 http://localhost:3000/prediction

2. **上传数据**
   - 准备 CSV 文件（包含组成、热处理、目标列）
   - 拖拽或点击上传

3. **配置参数**
   - 选择元素组成列
   - 选择热处理描述列
   - 选择 2-5 个目标列
   - 调整训练比例和 RAG 参数
   - 选择模型提供商和模型

4. **执行预测**
   - 点击"开始预测"
   - 等待预测完成（进度实时显示）

5. **查看结果**
   - 查看预测结果表格
   - 查看评估指标（R²、RMSE、MAE、MAPE）
   - 查看 Pareto 前沿分析
   - 下载结果 CSV

---

### 方式 2: 失败组分重试

1. **访问主页**
   - 打开 http://localhost:3000

2. **上传已有预测结果**
   - 上传包含预测值的 CSV 文件

3. **检测失败组分**
   - 选择目标列
   - 点击"检测失败组分"

4. **重新预测**
   - 配置重试参数
   - 生成并执行重试命令

---

## 📊 示例数据格式

### 输入 CSV 格式

```csv
composition,Processing_Description,UTS(MPa),El(%)
Ti-6Al-4V,Solution treated at 950°C for 1h + aged at 550°C for 4h,1050,12.5
Ti-6Al-4V,Solution treated at 980°C for 2h + aged at 600°C for 6h,1100,10.8
Ti-5Al-2.5Sn,Annealed at 700°C for 2h,900,15.2
```

**列说明**:
- `composition`: 材料组成（必需）
- `Processing_Description`: 热处理工艺描述（必需）
- `UTS(MPa)`, `El(%)`: 目标性能指标（至少 2 个）

---

## 🎯 配置建议

### 训练集比例
- **推荐**: 80%（默认）
- **小数据集**: 70%
- **大数据集**: 85%

### RAG 检索参数
- **最大检索样本数**:
  - 小数据集（<100）: 5-10
  - 中等数据集（100-500）: 10-20
  - 大数据集（>500）: 20-50
- **相似度阈值**:
  - 严格检索: 0.5-0.7
  - 平衡检索: 0.3-0.5（推荐）
  - 宽松检索: 0.0-0.3

### 模型选择
- **快速测试**: Gemini 2.5 Flash
- **高精度**: Gemini 2.5 Pro
- **成本优化**: DeepSeek Chat
- **本地部署**: Ollama（需要本地模型）

### Temperature 设置
- **确定性输出**: 0.0-0.5
- **平衡输出**: 0.5-1.0（推荐）
- **创造性输出**: 1.0-2.0

---

## 🔧 常见问题

### Q1: 预测任务一直卡在"pending"状态
**A**: 检查后端日志，可能是 API key 配置错误或模型服务不可用。

### Q2: 预测结果不准确
**A**: 尝试以下方法：
- 增加训练数据量
- 调整 RAG 检索参数
- 更换更强大的模型
- 调整 Temperature

### Q3: Pareto 前沿点数过少
**A**: 这是正常现象，Pareto 最优解通常只占总样本的 5-20%。

### Q4: 文件上传失败
**A**: 检查：
- 文件格式是否为 CSV
- 文件大小是否超过 50MB
- 文件编码是否为 UTF-8

---

## 📚 更多文档

- [项目状态](PROJECT_STATUS.md) - 查看项目完成情况
- [系统设计](multi_objective_optimization_system_design.md) - 详细的架构设计
- [测试指南](TESTING_GUIDE.md) - 完整的测试流程

---

## 🎉 开始使用

现在您已经准备好使用系统了！

1. 启动后端和前端服务
2. 访问 http://localhost:3000/prediction
3. 上传您的数据并开始预测

祝您使用愉快！🚀

