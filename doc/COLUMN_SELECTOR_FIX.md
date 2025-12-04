# 列选择器和热更新修复报告

## 修复日期
2025-12-02

## 修复内容

### 问题 1：前端 Webpack 热更新 404 错误

#### 问题描述
```
GET /_next/static/webpack/0013231b1d156079.webpack.hot-update.json 404 in 1454ms
```

#### 根本原因
Next.js 开发服务器的热更新功能在某些情况下会尝试加载不存在的 webpack 热更新文件，导致 404 错误。

#### 修复方案
修改 `frontend/next.config.js`，添加以下配置：

1. **忽略 node_modules 的监听**：
   ```javascript
   config.watchOptions = {
     poll: 1000,
     aggregateTimeout: 300,
     ignored: /node_modules/,
   };
   ```

2. **降低日志级别**：
   ```javascript
   config.infrastructureLogging = {
     level: 'error',
   };
   ```

3. **禁用实验性功能**：
   ```javascript
   experimental: {
     webpackBuildWorker: false,
   },
   ```

#### 预期效果
- 减少不必要的文件监听
- 隐藏非关键的热更新错误
- 提高开发服务器稳定性

---

### 问题 2：文件上传后的列选择和 RAG 预测配置

#### 功能需求

##### 1. 元素组成列的自动识别
- **识别规则**（按优先级）：
  1. 包含 `wt%` 或 `wt %` 的列（不区分大小写）
  2. 包含 `at%` 或 `at %` 的列
  3. 包含 `(wt%` 或 `(at%` 的列（如 `Al(wt%)`）
  4. 包含 `composition` 的列

- **实现位置**：`frontend/components/ColumnSelector.tsx` 的 `detectCompositionColumn()` 函数

##### 2. 工艺文本列的自动识别
- **识别规则**（按优先级）：
  1. 精确匹配 `Processing_Description`
  2. 同时包含 `processing` 和 `description` 的列
  3. 包含 `processing` 的列
  4. 包含 `treatment` 的列
  5. 包含 `description` 的列

- **实现位置**：`frontend/components/ColumnSelector.tsx` 的 `detectProcessingColumn()` 函数

##### 3. 目标性质列的自动识别
- **识别规则**：
  1. 优先选择 `UTS(MPa)` 和 `El(%)`（精确匹配）
  2. 查找包含单位符号的列：`MPa`, `GPa`, `%`, `HV`, `HRC`, `HB`, `J`, `W`, `K`, `Pa`, `N`
  3. 查找包含括号的列（如 `Hardness(HV)`）
  4. **排除规则**：
     - 不包含组成列（包含 `wt%` 或 `at%` 的列）
     - 不包含工艺列（包含 `processing` 的列）

- **用户约束**：
  - 必须选择 2-5 个目标列
  - 最多选择 5 个目标列

- **实现位置**：`frontend/components/ColumnSelector.tsx` 的 `detectTargetColumns()` 函数

##### 4. RAG 检索样本数配置
- **默认值**：20 个样本
- **可配置范围**：5-50 个样本
- **UI 组件**：数字输入框，带范围提示
- **后端验证**：`backend/models/schemas.py` 中的 `PredictionConfig.max_retrieved_samples` 字段

#### 修改的文件

1. **frontend/next.config.js**
   - 添加 webpack 配置优化
   - 禁用不必要的热更新功能

2. **frontend/components/ColumnSelector.tsx**
   - 优化 `detectCompositionColumn()` 函数，支持更多格式
   - 优化 `detectProcessingColumn()` 函数，支持多种关键词
   - 优化 `detectTargetColumns()` 函数，排除组成列和工艺列
   - 优化 `potentialTargetColumns` 过滤逻辑
   - 改进自动检测的 useEffect，避免重复执行
   - 添加控制台日志，方便调试

3. **backend/models/schemas.py**
   - 已正确配置 `max_retrieved_samples` 字段（无需修改）

#### 数据流验证

```
用户上传 CSV 文件
  ↓
前端接收文件和列名列表
  ↓
ColumnSelector 自动识别列
  ├─ 元素组成列（如 Al(wt%)）
  ├─ 工艺描述列（如 Processing_Description）
  ├─ 目标列（如 UTS(MPa), El(%)）
  └─ RAG 检索样本数（默认 20）
  ↓
用户确认或修改选择
  ↓
点击"开始预测"按钮
  ↓
前端发送 PredictionRequest 到后端
  {
    file_id: "...",
    config: {
      composition_column: "Al(wt%)",
      processing_column: "Processing_Description",
      target_columns: ["UTS(MPa)", "El(%)"],
      max_retrieved_samples: 20,
      ...
    }
  }
  ↓
后端验证配置（Pydantic schema）
  ↓
RAG 引擎检索相似样本
  ↓
执行预测
```

---

## 测试步骤

### 1. 测试热更新修复

```bash
# 1. 重启前端开发服务器
cd frontend
npm run dev

# 2. 观察控制台输出
# 预期：不再出现 webpack.hot-update.json 404 错误

# 3. 修改任意前端文件并保存
# 预期：热更新正常工作，页面自动刷新
```

### 2. 测试列自动识别

#### 测试文件
使用项目根目录下的 `test_column_detection.csv`：

```csv
Al(wt%),Ti(wt%),Fe(wt%),Processing_Description,UTS(MPa),El(%),Hardness(HV)
5.0,2.0,0.5,Solution treatment at 500C for 2h + aging at 180C for 8h,450,12.5,120
...
```

#### 测试步骤

1. **启动系统**：
   ```bash
   bash start_all.sh
   ```

2. **访问预测页面**：
   ```
   http://localhost:3000/prediction
   ```

3. **上传测试文件**：
   - 拖拽或选择 `test_column_detection.csv`
   - 等待上传完成

4. **验证自动识别**：
   - ✅ 元素组成列应自动选择：`Al(wt%)`
   - ✅ 工艺描述列应自动选择：`Processing_Description`
   - ✅ 目标列应自动勾选：`UTS(MPa)` 和 `El(%)`
   - ✅ RAG 检索样本数应显示：`20`

5. **验证用户可修改**：
   - 从下拉列表中重新选择元素组成列
   - 从下拉列表中重新选择工艺描述列
   - 勾选/取消勾选目标列（测试 2-5 个限制）
   - 修改 RAG 检索样本数（测试 5-50 范围）

6. **验证错误处理**：
   - 取消所有目标列的勾选
   - 预期：显示警告提示，"开始预测"按钮禁用
   - 重新勾选至少 2 个目标列
   - 预期：显示"配置完成"提示，"开始预测"按钮启用

7. **验证数据传递**：
   - 点击"开始预测"按钮
   - 打开浏览器开发者工具 → Network 标签
   - 查看发送到 `/api/prediction/start` 的请求体
   - 预期包含：
     ```json
     {
       "file_id": "...",
       "config": {
         "composition_column": "Al(wt%)",
         "processing_column": "Processing_Description",
         "target_columns": ["UTS(MPa)", "El(%)"],
         "max_retrieved_samples": 20,
         ...
       }
     }
     ```

### 3. 测试控制台日志

打开浏览器开发者工具 → Console 标签，上传文件后应看到：

```
✓ 自动识别元素组成列: Al(wt%)
✓ 自动识别工艺描述列: Processing_Description
✓ 自动识别目标列: ["UTS(MPa)", "El(%)"]
```

---

## 预期结果

### 修复后的行为

1. ✅ 前端热更新 404 错误不再出现或被隐藏
2. ✅ 上传 CSV 文件后自动识别元素组成列
3. ✅ 自动识别工艺描述列
4. ✅ 自动勾选 2 个目标列（优先 UTS 和 El）
5. ✅ RAG 检索样本数默认为 20，用户可修改
6. ✅ 用户可以重新选择任何列
7. ✅ 目标列限制为 2-5 个
8. ✅ 配置正确传递到后端
9. ✅ 后端验证配置并执行预测

### 错误处理

- 如果无法自动识别某列，显示黄色警告提示
- 如果用户未选择必需的列，禁用"开始预测"按钮
- 如果用户选择超过 5 个目标列，显示提示并阻止

---

## 后续建议

1. **添加更多测试用例**：
   - 测试不同格式的列名（如 `Al wt%`, `Al_wt%`）
   - 测试缺少某些列的 CSV 文件
   - 测试包含特殊字符的列名

2. **改进用户体验**：
   - 在列选择器中高亮显示自动识别的列
   - 添加"重置为自动识别"按钮
   - 添加列预览功能

3. **性能优化**：
   - 缓存自动识别结果
   - 优化大文件的列识别速度

---

## 相关文件

- `frontend/next.config.js` - Next.js 配置
- `frontend/components/ColumnSelector.tsx` - 列选择器组件
- `backend/models/schemas.py` - 数据模型定义
- `test_column_detection.csv` - 测试数据文件

