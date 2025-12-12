# 迭代预测功能开发文档 - 第8部分：失败处理机制

## 8. 失败处理机制

### 8.1 失败场景分类

#### 8.1.1 LLM API 错误

**场景1：API 超时**
```
错误信息: "Request timeout after 30 seconds"
原因: LLM API 响应缓慢或网络延迟
影响: 单个样本预测失败，不影响其他样本
```

**场景2：速率限制**
```
错误信息: "Rate limit exceeded: 429 Too Many Requests"
原因: 并发请求过多，超过 API 限制
影响: 可能导致整轮迭代部分样本失败
```

**场景3：认证失败**
```
错误信息: "Invalid API key"
原因: API 密钥过期或配置错误
影响: 整个任务失败
```

#### 8.1.2 数据解析错误

**场景4：LLM 响应格式错误**
```
错误信息: "Failed to parse JSON from LLM response"
原因: LLM 返回的响应不符合预期的 JSON 格式
影响: 单个样本预测失败
```

**场景5：缺少必需字段**
```
错误信息: "Missing required field 'predictions' in LLM response"
原因: LLM 响应中缺少预测值
影响: 单个样本预测失败
```

#### 8.1.3 数据验证错误

**场景6：预测值类型错误**
```
错误信息: "Expected numeric value for 'UTS(MPa)', got 'string'"
原因: LLM 返回的预测值不是数字
影响: 单个样本预测失败
```

**场景7：预测值范围错误**
```
错误信息: "Predicted value 999999 is outside reasonable range for UTS(MPa)"
原因: LLM 预测的值不符合物理常识
影响: 单个样本预测失败
```

### 8.2 失败处理策略

#### 8.2.1 策略B：记录失败，继续处理

**设计原则**：
- 单个样本失败不影响其他样本的预测
- 记录详细的失败信息，便于后续分析和重试
- 支持失败样本的增量重预测

**实现流程**：

```
┌─────────────────────────────────────────────────────────────────┐
│                    预测单个样本                                   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │ 调用 LLM 预测    │
                    └─────────────────┘
                      │              │
                   成功 │              │ 失败
                      ▼              ▼
        ┌──────────────────────┐  ┌──────────────────────┐
        │ 解析 LLM 响应        │  │ 捕获异常             │
        │ - 提取 JSON          │  │ - 记录错误信息       │
        │ - 验证字段           │  │ - 记录样本索引       │
        │ - 验证数值范围       │  │ - 记录迭代轮数       │
        └──────────────────────┘  └──────────────────────┘
                      │                      │
                   成功 │                      │ 失败
                      ▼                      ▼
        ┌──────────────────────┐  ┌──────────────────────┐
        │ 更新迭代历史         │  │ 更新失败样本列表     │
        │ - 添加预测值         │  │ - failed_samples[i]  │
        │ - 计算收敛状态       │  │ - 标记为失败         │
        └──────────────────────┘  └──────────────────────┘
                      │                      │
                      └──────────┬───────────┘
                                 │
                                 ▼
                    ┌─────────────────────┐
                    │ 继续处理下一个样本   │
                    └─────────────────────┘
```

#### 8.2.2 失败信息记录

```python
# backend/services/iterative_prediction_service.py

class IterativePredictionService:
    """迭代预测服务"""
    
    def _node_predict_iteration(self, state: IterationState) -> IterationState:
        """预测节点：执行一轮迭代预测"""
        
        current_iter = state["current_iteration"] + 1
        
        # 确定本轮需要预测的样本
        samples_to_predict = [
            i for i in range(len(state["test_samples"]))
            if i not in state["converged_samples"]
        ]
        
        # 并行预测
        with ThreadPoolExecutor(max_workers=state["max_workers"]) as executor:
            futures = {}
            
            for sample_idx in samples_to_predict:
                future = executor.submit(
                    self._predict_single_sample,
                    state,
                    sample_idx,
                    current_iter
                )
                futures[future] = sample_idx
            
            # 收集结果
            for future in as_completed(futures):
                sample_idx = futures[future]
                try:
                    result = future.result()
                    
                    # 成功：更新迭代历史
                    for prop in state["target_properties"]:
                        state["iteration_history"][f"sample_{sample_idx}"]["targets"][prop].append(
                            result["predictions"][prop]
                        )
                    
                    logger.info(
                        f"[Task {state['task_id']}] 样本 {sample_idx} 第 {current_iter} 轮预测成功"
                    )
                
                except Exception as e:
                    # 失败：记录错误信息
                    error_message = str(e)
                    
                    # 记录到 failed_samples
                    state["failed_samples"][sample_idx] = {
                        "error": error_message,
                        "iteration": current_iter,
                        "timestamp": datetime.utcnow().isoformat(),
                        "error_type": self._classify_error(e)
                    }
                    
                    # 标记该样本在该轮失败
                    state["iteration_history"][f"sample_{sample_idx}"]["failed_iterations"].append(
                        current_iter
                    )
                    
                    logger.error(
                        f"[Task {state['task_id']}] 样本 {sample_idx} 第 {current_iter} 轮预测失败: {error_message}"
                    )
        
        state["current_iteration"] = current_iter
        return state
    
    def _classify_error(self, error: Exception) -> str:
        """分类错误类型"""
        
        error_message = str(error).lower()
        
        if "timeout" in error_message:
            return "api_timeout"
        elif "rate limit" in error_message or "429" in error_message:
            return "rate_limit"
        elif "invalid api key" in error_message or "401" in error_message:
            return "auth_error"
        elif "json" in error_message:
            return "parse_error"
        elif "missing" in error_message or "required" in error_message:
            return "missing_field"
        elif "type" in error_message:
            return "type_error"
        elif "range" in error_message:
            return "range_error"
        else:
            return "unknown_error"
```

#### 8.2.3 失败信息保存到数据库和文件

```python
# backend/services/iterative_prediction_service.py

class IterativePredictionService:
    """迭代预测服务"""
    
    def _node_save_results(self, state: IterationState) -> IterationState:
        """保存结果节点"""
        
        logger.info(f"[Task {state['task_id']}] 保存迭代预测结果")
        
        # 构建最终的迭代历史 JSON
        final_history = self._build_final_history(state)
        
        # 保存到文件系统
        self._save_to_file(state["task_id"], final_history)
        
        # 保存到数据库
        self._save_to_database(state["task_id"], final_history, state["failed_samples"])
        
        logger.info(f"[Task {state['task_id']}] 迭代预测完成")
        
        return state
    
    def _build_final_history(self, state: IterationState) -> Dict[str, Any]:
        """构建最终的迭代历史"""
        
        # 计算统计信息
        total_samples = len(state["test_samples"])
        converged_samples = len(state["converged_samples"])
        failed_samples = len(state["failed_samples"])
        
        # 确定提前停止原因
        if state["current_iteration"] >= state["max_iterations"]:
            early_stop_reason = "max_iterations_reached"
        else:
            early_stop_reason = "all_samples_converged"
        
        return {
            "global_info": {
                "task_id": state["task_id"],
                "total_iterations": state["current_iteration"],
                "max_iterations": state["max_iterations"],
                "convergence_threshold": state["convergence_threshold"],
                "early_stopped": state["current_iteration"] < state["max_iterations"],
                "early_stop_reason": early_stop_reason,
                "total_samples": total_samples,
                "converged_samples": converged_samples,
                "failed_samples": failed_samples,
                "created_at": state["start_time"].isoformat(),
                "completed_at": datetime.utcnow().isoformat(),
                "total_duration_seconds": (
                    datetime.utcnow() - state["start_time"]
                ).total_seconds()
            },
            "samples": state["iteration_history"],
            "iteration_summaries": self._build_iteration_summaries(state),
            "failed_samples_detail": state["failed_samples"]  # 新增：失败样本详情
        }
    
    def _save_to_database(
        self,
        task_id: int,
        history: Dict[str, Any],
        failed_samples: Dict[int, Dict[str, Any]]
    ) -> None:
        """保存到数据库"""
        
        from backend.database.models import Task
        from backend.database.session import SessionLocal
        
        db = SessionLocal()
        task = db.query(Task).filter(Task.id == task_id).first()
        
        if task:
            task.iteration_history = history
            task.current_iteration = history["global_info"]["total_iterations"]
            task.status = "completed"
            
            # 保存失败样本信息
            if failed_samples:
                task.failed_samples = [
                    {
                        "sample_index": idx,
                        "error": info.get("error"),
                        "iteration": info.get("iteration"),
                        "error_type": info.get("error_type")
                    }
                    for idx, info in failed_samples.items()
                ]
            
            db.commit()
        
        db.close()
```

### 8.3 失败样本的增量重预测

#### 8.3.1 重试机制实现

```python
# backend/api/iterative_prediction.py

@router.post("/retry-failed")
async def retry_failed_samples(
    task_id: int,
    sample_indices: Optional[List[int]] = None,
    background_tasks: BackgroundTasks = None
):
    """重试失败样本"""
    
    db = SessionLocal()
    original_task = db.query(Task).filter(Task.id == task_id).first()
    db.close()
    
    if not original_task:
        raise HTTPException(status_code=404, detail="Original task not found")
    
    if not original_task.failed_samples:
        raise HTTPException(status_code=400, detail="No failed samples to retry")
    
    # 如果未指定样本索引，重试所有失败的样本
    if sample_indices is None:
        sample_indices = [s["sample_index"] for s in original_task.failed_samples]
    
    # 创建新任务（增量预测）
    db = SessionLocal()
    new_task = Task(
        task_name=f"{original_task.task_name} (重试失败样本)",
        task_description=f"重试原任务 {task_id} 的失败样本: {sample_indices}",
        status="running",
        enable_iteration=original_task.enable_iteration,
        max_iterations=original_task.max_iterations,
        convergence_threshold=original_task.convergence_threshold,
        early_stop=original_task.early_stop,
        max_workers=original_task.max_workers,
        continue_from_task_id=task_id  # 关键：指向原始任务
    )
    db.add(new_task)
    db.commit()
    db.refresh(new_task)
    db.close()
    
    # 后台启动重试
    background_tasks.add_task(
        _retry_failed_samples_task,
        original_task_id=task_id,
        new_task_id=new_task.id,
        sample_indices=sample_indices
    )
    
    return {
        "new_task_id": new_task.id,
        "original_task_id": task_id,
        "retrying_samples": sample_indices,
        "message": "失败样本重试任务已启动"
    }

async def _retry_failed_samples_task(
    original_task_id: int,
    new_task_id: int,
    sample_indices: List[int]
):
    """后台运行失败样本重试"""
    
    try:
        # 加载原始任务的数据
        db = SessionLocal()
        original_task = db.query(Task).filter(Task.id == original_task_id).first()
        db.close()
        
        if not original_task or not original_task.iteration_history:
            raise ValueError("Original task or iteration history not found")
        
        # 提取失败样本的数据
        test_samples = load_csv(original_task.test_file_path)
        reference_samples = load_csv(original_task.reference_file_path)
        
        # 仅保留失败的样本
        failed_test_samples = [
            test_samples[i] for i in sample_indices
            if i < len(test_samples)
        ]
        
        # 初始化服务
        service = IterativePredictionService()
        
        # 准备状态（从原始任务的最后一轮开始）
        original_history = original_task.iteration_history
        last_iteration = original_history["global_info"]["total_iterations"]
        
        state = {
            "task_id": new_task_id,
            "test_samples": failed_test_samples,
            "reference_samples": reference_samples,
            "target_properties": original_task.target_properties,
            "max_iterations": original_task.max_iterations,
            "convergence_threshold": original_task.convergence_threshold,
            "early_stop": original_task.early_stop,
            "max_workers": original_task.max_workers,
            "llm_provider": original_task.llm_provider,
            "llm_model": original_task.llm_model,
            "temperature": original_task.temperature,
            "current_iteration": last_iteration,  # 从上一轮继续
            # ... 其他字段
        }
        
        # 运行工作流
        result_state = service.run(state)
        
        logger.info(f"Retry task {new_task_id} completed")
    
    except Exception as e:
        logger.error(f"Retry task {new_task_id} failed: {str(e)}")
        
        # 更新任务状态为失败
        db = SessionLocal()
        task = db.query(Task).filter(Task.id == new_task_id).first()
        if task:
            task.status = "failed"
            db.commit()
        db.close()
```

#### 8.3.2 前端重试按钮

```typescript
// frontend/components/iterative-prediction/ProgressPanel.tsx

import React, { useState } from 'react';
import {
  Alert,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  List,
  ListItem,
  ListItemText,
  Checkbox,
} from '@mui/material';

interface ProgressPanelProps {
  task: IterativePredictionTask;
  onRetryFailed: () => void;
}

export default function ProgressPanel({
  task,
  onRetryFailed,
}: ProgressPanelProps) {
  const [retryDialogOpen, setRetryDialogOpen] = useState(false);
  const [selectedSamples, setSelectedSamples] = useState<Set<number>>(new Set());

  const handleRetryClick = () => {
    setRetryDialogOpen(true);
  };

  const handleRetryConfirm = async () => {
    try {
      const response = await fetch('/api/iterative-prediction/retry-failed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task_id: task.task_id,
          sample_indices: Array.from(selectedSamples),
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to start retry');
      }

      const data = await response.json();
      
      // 跳转到新任务的进度页面
      window.location.href = `/iterative-prediction?task_id=${data.new_task_id}`;
    } catch (error) {
      console.error('Error retrying failed samples:', error);
    }

    setRetryDialogOpen(false);
  };

  const handleSampleToggle = (sampleIndex: number) => {
    const newSelected = new Set(selectedSamples);
    if (newSelected.has(sampleIndex)) {
      newSelected.delete(sampleIndex);
    } else {
      newSelected.add(sampleIndex);
    }
    setSelectedSamples(newSelected);
  };

  return (
    <Box sx={{ p: 3 }}>
      {/* ... 其他内容 ... */}

      {/* 失败样本提示 */}
      {task.failed_samples > 0 && (
        <>
          <Alert severity="warning">
            有 {task.failed_samples} 个样本预测失败。
            <Button
              size="small"
              onClick={handleRetryClick}
              sx={{ ml: 2 }}
            >
              重试失败样本
            </Button>
          </Alert>

          {/* 重试对话框 */}
          <Dialog
            open={retryDialogOpen}
            onClose={() => setRetryDialogOpen(false)}
            maxWidth="sm"
            fullWidth
          >
            <DialogTitle>选择要重试的样本</DialogTitle>
            <DialogContent>
              <List>
                {task.failed_samples_detail?.map((sample) => (
                  <ListItem key={sample.sample_index}>
                    <Checkbox
                      checked={selectedSamples.has(sample.sample_index)}
                      onChange={() =>
                        handleSampleToggle(sample.sample_index)
                      }
                    />
                    <ListItemText
                      primary={`样本 ${sample.sample_index}`}
                      secondary={`错误: ${sample.error}`}
                    />
                  </ListItem>
                ))}
              </List>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setRetryDialogOpen(false)}>
                取消
              </Button>
              <Button
                onClick={handleRetryConfirm}
                variant="contained"
                disabled={selectedSamples.size === 0}
              >
                重试选中的样本
              </Button>
            </DialogActions>
          </Dialog>
        </>
      )}
    </Box>
  );
}
```

### 8.4 失败处理流程图

```
┌─────────────────────────────────────────────────────────────────┐
│                    迭代预测任务开始                               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │ 第1轮迭代        │
                    │ (并行预测)       │
                    └─────────────────┘
                      │              │
                   成功 │              │ 部分失败
                      ▼              ▼
        ┌──────────────────────┐  ┌──────────────────────┐
        │ 更新迭代历史         │  │ 记录失败样本         │
        │ - 添加预测值         │  │ - failed_samples[i]  │
        │ - 计算收敛状态       │  │ - 错误信息           │
        └──────────────────────┘  └──────────────────────┘
                      │                      │
                      └──────────┬───────────┘
                                 │
                                 ▼
                    ┌─────────────────────┐
                    │ 检查收敛状态        │
                    │ (仅检查成功的样本)  │
                    └─────────────────────┘
                                 │
                                 ▼
                    ┌─────────────────────┐
                    │ 是否继续迭代？      │
                    └─────────────────────┘
                      │                    │
                   是 │                    │ 否
                      ▼                    ▼
        ┌──────────────────────┐  ┌──────────────────────┐
        │ 第2轮迭代            │  │ 保存结果             │
        │ (仅未收敛的样本)     │  │ - iteration_history  │
        │ (跳过失败的样本)     │  │ - failed_samples     │
        └──────────────────────┘  └──────────────────────┘
                      │                      │
                      └──────────┬───────────┘
                                 │
                                 ▼
                    ┌─────────────────────┐
                    │ 任务完成            │
                    │ (包含失败样本信息)  │
                    └─────────────────────┘
                                 │
                                 ▼
                    ┌─────────────────────┐
                    │ 用户查看结果        │
                    │ - 迭代历史          │
                    │ - 失败样本列表      │
                    └─────────────────────┘
                                 │
                                 ▼
                    ┌─────────────────────┐
                    │ 用户选择重试        │
                    │ (可选)              │
                    └─────────────────────┘
                                 │
                                 ▼
                    ┌─────────────────────┐
                    │ 创建新任务          │
                    │ (continue_from_task_id)
                    │ 仅重预测失败的样本  │
                    └─────────────────────┘
                                 │
                                 ▼
                    ┌─────────────────────┐
                    │ 从第N轮继续迭代     │
                    │ (N = 原任务的最后轮)│
                    └─────────────────────┘
```

### 8.5 错误恢复最佳实践

**1. 重试策略**：
- 对于 API 超时和速率限制，自动重试（最多3次）
- 对于认证错误，立即失败（无法自动恢复）
- 对于数据解析错误，记录并继续

**2. 日志记录**：
- 记录每个失败的详细信息（错误类型、时间戳、样本索引）
- 便于事后分析和调试

**3. 用户通知**：
- 在前端显示失败样本数量和错误类型
- 提供"重试失败样本"按钮
- 显示重试的进度和结果

**4. 数据一致性**：
- 失败的样本不更新迭代历史
- 保留原始的预测值（如果有的话）
- 支持增量重预测（从上一轮继续）

