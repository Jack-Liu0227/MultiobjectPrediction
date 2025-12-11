# 迭代预测功能 - 快速开发指南

**版本**: v1.0  
**最后更新**: 2025-12-09

---

## 🎯 5 分钟快速了解

### 什么是迭代预测？
在多目标预测的基础上，通过多轮迭代来逐步改进预测结果，直到收敛。

### 核心流程
1. **第1轮**: 基于初始数据进行预测
2. **第2-N轮**: 基于前一轮的预测结果和历史数据进行改进预测
3. **收敛判断**: 当相对变化率 < 阈值时停止迭代

### 关键技术
- **LangGraph**: 工作流编排
- **RAG**: 检索增强生成
- **LLM**: 大语言模型预测

---

## 📂 文档导航

### 快速查找
| 角色 | 推荐阅读 |
|------|---------|
| 后端开发 | Part 3, 5, 6, 8, 9 |
| 前端开发 | Part 6, 7 |
| 全栈开发 | Part 1, 2, 3, 5, 6, 7 |
| 测试工程师 | Part 11 |
| 运维/DevOps | Part 12 |

### 文档位置
```
doc/
├── iterative_prediction_development_guide_index.md    # 完整索引
├── iterative_prediction_guide_part1.md                # 功能概述
├── iterative_prediction_guide_part2.md                # 架构设计
├── iterative_prediction_guide_part3.md                # 数据模型
├── iterative_prediction_guide_part4.md                # Prompt 模板
├── iterative_prediction_guide_part5.md                # LangGraph 工作流
├── iterative_prediction_guide_part6.md                # API 接口
├── iterative_prediction_guide_part7.md                # 前端界面
├── iterative_prediction_guide_part8.md                # 失败处理
├── iterative_prediction_guide_part9.md                # 收敛算法
├── iterative_prediction_guide_part10.md               # 任务分解
├── iterative_prediction_guide_part11.md               # 测试计划
└── iterative_prediction_guide_part12.md               # 部署配置
```

---

## 💻 开发环境准备

### 1. 切换分支
```bash
git checkout iterative-prediction-feature
```

### 2. 安装依赖（使用 uv）
```bash
cd backend
uv pip install -r requirements.txt
cd ..
```

### 3. 启动开发环境
```bash
# 后端
cd backend
python -m uvicorn main:app --reload --port 8000

# 前端（新终端）
cd frontend
npm run dev
```

---

## 🏗️ 代码规范速查

### 后端命名
- 文件: `snake_case` (task_manager.py)
- 类: `PascalCase` (TaskManager)
- 函数: `snake_case` (create_task)
- 常量: `UPPER_SNAKE_CASE` (MAX_SIZE)

### 前端命名
- 文件: `PascalCase` (FileUpload.tsx)
- 组件: `PascalCase` (FileUpload)
- 函数: `camelCase` (handleUpload)
- 常量: `UPPER_SNAKE_CASE` (MAX_SIZE)

### 架构层次
```
API 层 (api/*.py)
  ↓
服务层 (services/*.py)
  ↓
数据访问层 (database/*.py)
```

---

## 🔑 关键文件位置

### 后端
- 配置: `backend/config.py`
- 数据模型: `backend/models/schemas.py`
- 任务管理: `backend/services/task_manager.py`
- RAG 服务: `backend/services/rag_prediction_service.py`
- API 路由: `backend/api/prediction.py`

### 前端
- 预测页面: `frontend/pages/prediction.tsx`
- 文件上传: `frontend/components/FileUpload.tsx`
- API 调用: `frontend/lib/api.ts`
- 类型定义: `frontend/lib/types.ts`

---

## 📋 开发检查清单

开始开发前：
- [ ] 已切换到 `iterative-prediction-feature` 分支
- [ ] 已安装所有依赖
- [ ] 已阅读相关的 Part 文档
- [ ] 已理解代码规范文档

提交代码前：
- [ ] 遵循分层架构
- [ ] 使用 `uv` 管理依赖
- [ ] 命名规范一致
- [ ] 有清晰的文档字符串
- [ ] 没有硬编码配置
- [ ] 错误处理完善

---

## 🆘 常见问题

### Q: 如何添加新的 Python 依赖？
A: 使用 `uv pip install <package>` 然后更新 `requirements.txt`

### Q: 如何运行测试？
A: 参考 `iterative_prediction_guide_part11.md` 的测试计划

### Q: 如何部署到生产环境？
A: 参考 `iterative_prediction_guide_part12.md` 的部署步骤

### Q: 代码规范有疑问？
A: 查看 `.augment/rules/code_control.md`

---

**需要帮助？** 查看完整文档或联系技术负责人

