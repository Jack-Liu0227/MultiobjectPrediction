# 问题修复总结

## 已完成的修复

### ✅ 问题 1：数据集上传功能

**修改文件**：
- `frontend/pages/datasets.tsx`

**实现内容**：
1. 添加上传状态管理：`uploadFile`, `uploadDescription`, `uploadTags`, `uploading`
2. 实现 `handleUpload()` 函数：
   - 创建 FormData 对象
   - 调用 `/api/datasets/upload` 端点
   - 处理上传成功/失败
   - 刷新数据集列表
3. 添加上传模态框 UI：
   - 文件选择器（仅接受 .csv）
   - 描述输入框
   - 标签输入框（逗号分隔）
   - 上传/取消按钮

**测试方法**：
1. 访问 http://localhost:3000/datasets
2. 点击"上传新数据集"按钮
3. 选择 CSV 文件
4. 填写描述和标签（可选）
5. 点击"上传"按钮
6. 验证文件保存到 `backend/data/uploads/` 目录
7. 验证数据集信息保存到数据库

---

### ✅ 问题 2：文件引用错误

**修改文件**：
- `backend/models/schemas.py`
- `backend/api/prediction.py`
- `frontend/pages/prediction.tsx`

**实现内容**：

#### 1. 后端 Schema 更新
```python
class PredictionRequest(BaseModel):
    file_id: Optional[str] = None  # 直接上传文件时使用
    dataset_id: Optional[str] = None  # 引用已有数据集时使用
    config: PredictionConfig
    
    @validator('dataset_id', always=True)
    def check_file_or_dataset(cls, v, values):
        if not v and not values.get('file_id'):
            raise ValueError('必须提供 file_id 或 dataset_id')
        return v
```

#### 2. 预测 API 更新
- 支持两种文件来源：
  - `dataset_id`: 从数据库查询数据集，获取 `file_path`
  - `file_id`: 从上传目录查找文件（兼容旧逻辑）
- 使用数据集时自动增加使用次数
- 统一使用 `actual_file_path` 传递给预测服务

#### 3. 前端更新
```typescript
const response = await startPrediction({
  file_id: selectedDatasetId ? undefined : uploadedFile.file_id,
  dataset_id: selectedDatasetId || undefined,
  // ... config
});
```

**测试方法**：
1. 在数据集管理页面上传数据集
2. 点击"使用"按钮跳转到预测页面
3. 配置预测参数
4. 点击"开始预测"
5. 验证后端日志显示：`Using existing dataset: {dataset_id}`
6. 验证不再出现"文件不存在"错误

---

### 🔄 问题 3：RAG+LLM 预测过程可视化（进行中）

**已完成**：
1. ✅ 数据库模型添加 `process_details` 字段（JSON 类型）
2. ✅ 创建前端组件 `PredictionProcessViewer.tsx`

**待完成**：
1. ⏳ 修改 `rag_prediction_service.py`，在预测过程中记录详细信息：
   - 数据处理阶段：训练集/测试集划分、列信息、数据预览
   - RAG 检索阶段：每个测试样本的检索结果（Top-K 相似样本、相似度分数）
   - LLM 预测阶段：发送的 prompt、LLM 响应、解析后的预测值

2. ⏳ 将过程详情保存到任务的 `process_details` 字段

3. ⏳ 在结果页面或预测页面添加"详细过程"标签页，集成 `PredictionProcessViewer` 组件

**数据结构设计**：
```typescript
interface ProcessDetails {
  data_processing: {
    total_rows: number;
    train_rows: number;
    test_rows: number;
    sampled_test_rows: number;
    composition_column: string;
    processing_column: string;
    target_columns: string[];
    train_preview?: any[];  // 前5行
    test_preview?: any[];   // 前5行
  };
  rag_retrieval: Array<{
    test_sample_index: number;
    test_sample: any;
    retrieved_samples: Array<{
      index: number;
      similarity: number;
      composition: string;
      processing: string;
      targets: Record<string, number>;
    }>;
  }>;
  llm_prediction: Array<{
    test_sample_index: number;
    prompt: string;
    llm_response: string;
    parsed_predictions: Record<string, number>;
    error?: string;
  }>;
}
```

---

## 下一步操作

### 1. 完成问题 3 的剩余工作

修改 `backend/services/rag_prediction_service.py`：

```python
def run_prediction(self, task_id: str, file_path: str, config: PredictionConfig):
    process_details = {
        "data_processing": {},
        "rag_retrieval": [],
        "llm_prediction": []
    }
    
    try:
        # 1. 数据处理阶段
        train_df, test_df = self._prepare_data(file_path, config)
        process_details["data_processing"] = {
            "total_rows": len(train_df) + len(test_df),
            "train_rows": len(train_df),
            "test_rows": len(test_df),
            "sampled_test_rows": config.sample_size,
            "composition_column": config.composition_column,
            "processing_column": config.processing_column,
            "target_columns": config.target_columns,
            "train_preview": train_df.head(5).to_dict('records'),
            "test_preview": test_df.head(5).to_dict('records'),
        }
        
        # 2. RAG 检索阶段
        for idx, test_row in test_df.iterrows():
            retrieved = self.rag_engine.retrieve(...)
            process_details["rag_retrieval"].append({
                "test_sample_index": idx,
                "test_sample": test_row.to_dict(),
                "retrieved_samples": [
                    {
                        "index": r["index"],
                        "similarity": r["similarity"],
                        "composition": r["composition"],
                        "processing": r["processing"],
                        "targets": r["targets"]
                    }
                    for r in retrieved
                ]
            })
        
        # 3. LLM 预测阶段
        for idx, test_row in test_df.iterrows():
            prompt = self.prompt_builder.build_prompt(...)
            llm_response = self._call_llm(prompt, config)
            predictions = self._parse_predictions(llm_response, ...)
            
            process_details["llm_prediction"].append({
                "test_sample_index": idx,
                "prompt": prompt,
                "llm_response": llm_response,
                "parsed_predictions": predictions
            })
        
        # 保存过程详情
        self.task_manager.update_task_status(
            task_id,
            status="completed",
            progress=1.0,
            process_details=process_details
        )
        
    except Exception as e:
        logger.error(f"Prediction failed: {e}")
```

### 2. 集成到前端

在 `frontend/pages/results/[id].tsx` 或预测页面添加：

```typescript
import PredictionProcessViewer from '@/components/PredictionProcessViewer';

// 在标签页中添加
<Tab label="详细过程">
  <PredictionProcessViewer processDetails={task.process_details} />
</Tab>
```

---

## 测试清单

- [ ] 数据集上传功能正常
- [ ] 上传的文件保存到正确位置
- [ ] 数据集信息正确保存到数据库
- [ ] 数据集列表正确显示
- [ ] 使用已有数据集进行预测不报错
- [ ] 预测过程详情正确记录
- [ ] 前端正确显示过程详情
- [ ] RAG 检索结果正确显示
- [ ] LLM prompt 和响应正确显示

