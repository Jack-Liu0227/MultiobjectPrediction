# 测试指南

**更新时间**: 2025-12-02

本文档提供完整的测试流程，验证多目标材料性能预测系统的所有功能。

---

## 📋 测试清单

### ✅ 后端测试

#### 1. 单元测试
运行后端单元测试脚本：

```bash
python test_backend.py
```

**测试内容**:
- ✅ 任务管理器（创建、更新、查询任务）
- ✅ Pareto 分析器（非支配排序、质量指标计算）
- ✅ 预测配置模型（验证规则）

**预期结果**: 所有测试通过，无错误

---

#### 2. API 测试

**启动后端服务**:
```bash
cd backend
uvicorn main:app --reload --port 8000
```

**测试端点**:

1. **文件上传** - `POST /api/upload/file`
   ```bash
   curl -X POST http://localhost:8000/api/upload/file \
     -F "file=@data/example.csv"
   ```

2. **启动预测** - `POST /api/prediction/start`
   ```bash
   curl -X POST http://localhost:8000/api/prediction/start \
     -H "Content-Type: application/json" \
     -d '{
       "file_id": "your-file-id",
       "config": {
         "composition_column": "composition",
         "processing_column": "Processing_Description",
         "target_columns": ["UTS(MPa)", "El(%)"],
         "train_ratio": 0.8,
         "max_retrieved_samples": 10,
         "similarity_threshold": 0.3,
         "model_provider": "gemini",
         "model_name": "gemini-2.5-flash",
         "temperature": 1.0
       }
     }'
   ```

3. **查询任务状态** - `GET /api/prediction/status/{task_id}`
   ```bash
   curl http://localhost:8000/api/prediction/status/your-task-id
   ```

4. **获取结果** - `GET /api/results/{result_id}`
   ```bash
   curl http://localhost:8000/api/results/your-result-id
   ```

5. **Pareto 分析** - `GET /api/results/{result_id}/pareto`
   ```bash
   curl http://localhost:8000/api/results/your-result-id/pareto
   ```

---

### ✅ 前端测试

#### 1. 启动前端服务

```bash
cd frontend
npm install  # 首次运行
npm run dev
```

访问: http://localhost:3000

---

#### 2. 端到端测试流程

**测试场景 1: 多目标预测完整流程**

1. **访问预测页面**
   - 打开 http://localhost:3000/prediction
   - 验证页面正常加载

2. **步骤 1: 上传数据**
   - 点击或拖拽上传 CSV 文件
   - 验证文件解析成功
   - 验证列信息正确显示

3. **步骤 2: 配置参数**
   - **列选择**:
     - 选择元素组成列（如 `composition`）
     - 选择热处理列（如 `Processing_Description`）
     - 选择 2-5 个目标列（如 `UTS(MPa)`, `El(%)`）
   - **预测配置**:
     - 调整训练集比例（50%-90%）
     - 设置最大检索样本数（1-50）
     - 设置相似度阈值（0.0-1.0）
     - 选择模型提供商和模型名称
     - 调整 Temperature（0.0-2.0）
   - 验证配置完成提示显示

4. **步骤 3: 执行预测**
   - 点击"开始预测"按钮
   - 验证任务启动成功
   - 观察进度条和状态消息更新
   - 等待预测完成（可能需要几分钟）

5. **步骤 4: 查看结果**
   - 自动跳转到结果页面
   - 验证结果 ID 显示

6. **结果页面验证**
   - **预测结果标签页**:
     - 验证表格显示真实值和预测值
     - 验证误差百分比计算正确
     - 验证数据行数正确
   - **评估指标标签页**:
     - 验证每个目标的 R²、RMSE、MAE、MAPE 显示
     - 验证指标值合理（R² 接近 1，误差较小）
   - **Pareto 前沿标签页**:
     - 验证 Pareto 统计信息显示
     - 验证质量指标（Hypervolume、Spacing、Spread）
     - 验证 Pareto 最优解列表显示

7. **下载结果**
   - 点击"下载结果"按钮
   - 验证 CSV 文件下载成功
   - 打开 CSV 验证数据完整性

---

**测试场景 2: 失败组分重试流程**

1. **访问主页**
   - 打开 http://localhost:3000
   - 点击"失败组分重试"按钮

2. **上传包含失败预测的文件**
   - 上传已有预测结果的 CSV 文件

3. **检测失败组分**
   - 选择目标列
   - 点击"检测失败组分"
   - 验证失败统计信息显示

4. **重新预测**
   - 配置重试参数
   - 生成重试命令
   - 执行重试（可选）

---

## 🧪 测试数据准备

### 示例 CSV 格式

```csv
composition,Processing_Description,UTS(MPa),El(%)
Ti-6Al-4V,Solution treated at 950°C for 1h + aged at 550°C for 4h,1050,12.5
Ti-6Al-4V,Solution treated at 980°C for 2h + aged at 600°C for 6h,1100,10.8
...
```

**要求**:
- 至少包含 1 个组成列
- 至少包含 1 个热处理描述列
- 至少包含 2 个目标列（数值型）
- 建议至少 50 行数据用于训练

---

## ✅ 验收标准

### 功能验收
- ✅ 文件上传成功，列信息正确解析
- ✅ 配置界面所有参数可调整
- ✅ 预测任务成功启动并执行
- ✅ 任务状态实时更新
- ✅ 预测结果正确返回
- ✅ 评估指标计算正确
- ✅ Pareto 前沿分析正确
- ✅ 结果下载功能正常

### 性能验收
- ✅ 文件上传响应时间 < 5 秒
- ✅ 任务状态查询响应时间 < 1 秒
- ✅ 结果页面加载时间 < 3 秒
- ✅ 支持至少 1000 行数据的预测

### 错误处理验收
- ✅ 文件格式错误时显示友好提示
- ✅ 配置不完整时禁用提交按钮
- ✅ 预测失败时显示错误信息
- ✅ 网络错误时显示重试选项

---

## 🐛 已知问题

无重大已知问题。

---

## 📞 问题反馈

如遇到问题，请检查：
1. 后端服务是否正常运行（http://localhost:8000/docs）
2. 前端服务是否正常运行（http://localhost:3000）
3. 环境变量是否正确配置（API keys 等）
4. 依赖包是否完整安装

