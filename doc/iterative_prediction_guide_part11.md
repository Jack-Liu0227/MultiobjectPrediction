# 迭代预测功能开发文档 - 第11部分：测试计划

## 11. 测试计划

### 11.1 测试策略

#### 11.1.1 测试金字塔

```
                    ▲
                   /│\
                  / │ \
                 /  │  \  E2E 测试 (10%)
                /   │   \
               /    │    \
              /     │     \
             /      │      \
            /───────┼───────\
           /        │        \
          /         │         \ 集成测试 (30%)
         /          │          \
        /───────────┼───────────\
       /            │            \
      /             │             \
     /              │              \ 单元测试 (60%)
    /───────────────┼───────────────\
   /________________│________________\
```

**单元测试 (60%)**：
- 测试单个函数和方法
- 使用 Mock 和 Stub
- 快速执行，易于调试

**集成测试 (30%)**：
- 测试多个组件的交互
- 测试 API 端点
- 测试数据库操作

**E2E 测试 (10%)**：
- 测试完整的用户流程
- 测试前后端交互
- 测试真实场景

### 11.2 后端测试计划

#### 11.2.1 单元测试

**测试1：ConvergenceChecker 单元测试**

```python
# backend/tests/test_convergence_checker.py

import pytest
from backend.services.iterative_prediction_service import ConvergenceChecker

class TestConvergenceChecker:
    """收敛检查器单元测试"""
    
    @pytest.fixture
    def checker(self):
        """创建检查器实例"""
        return ConvergenceChecker(convergence_threshold=0.01, min_value=0.1)
    
    # 测试相对变化率计算
    def test_calculate_relative_change_normal(self, checker):
        """测试正常情况"""
        assert abs(checker.calculate_relative_change(100, 105) - 0.05) < 1e-6
    
    def test_calculate_relative_change_small_value(self, checker):
        """测试小值情况"""
        assert abs(checker.calculate_relative_change(0.05, 0.06) - 0.1) < 1e-6
    
    def test_calculate_relative_change_zero(self, checker):
        """测试零值情况"""
        assert abs(checker.calculate_relative_change(0, 0.1) - 1.0) < 1e-6
    
    # 测试收敛判断
    def test_is_converged_true(self, checker):
        """测试已收敛"""
        assert checker.is_converged(100, 100.5) is True
    
    def test_is_converged_false(self, checker):
        """测试未收敛"""
        assert checker.is_converged(100, 105) is False
    
    # 测试样本收敛检查
    def test_check_sample_convergence_all_converged(self, checker):
        """测试所有属性都收敛"""
        target_properties = ["UTS(MPa)", "El(%)"]
        iteration_data = {
            "UTS(MPa)": [850, 855, 857],
            "El(%)": [15.0, 14.8, 14.7]
        }
        
        all_converged, prop_conv, rel_changes = (
            checker.check_sample_convergence(target_properties, iteration_data)
        )
        
        assert all_converged is True
        assert prop_conv["UTS(MPa)"] is True
        assert prop_conv["El(%)"] is True
    
    def test_check_sample_convergence_partial(self, checker):
        """测试部分属性收敛"""
        target_properties = ["UTS(MPa)", "El(%)"]
        iteration_data = {
            "UTS(MPa)": [850, 855, 857],
            "El(%)": [15.0, 14.8, 13.0]
        }
        
        all_converged, prop_conv, rel_changes = (
            checker.check_sample_convergence(target_properties, iteration_data)
        )
        
        assert all_converged is False
        assert prop_conv["UTS(MPa)"] is True
        assert prop_conv["El(%)"] is False
```

**测试2：PromptBuilder 单元测试**

```python
# backend/tests/test_prompt_builder.py

import pytest
from backend.services.prompt_builder import PromptBuilder

class TestPromptBuilder:
    """Prompt 构建器单元测试"""
    
    @pytest.fixture
    def builder(self):
        """创建构建器实例"""
        return PromptBuilder()
    
    def test_build_prompt_iteration_1(self, builder):
        """测试第1轮迭代的 Prompt"""
        prompt = builder.build_prompt(
            iteration=1,
            test_sample={"ID": "Sample_001", "C": 0.5},
            reference_samples=[],
            target_properties=["UTS(MPa)"],
            iteration_history=None
        )
        
        # 验证 Prompt 包含必要的部分
        assert "Sample_001" in prompt
        assert "UTS(MPa)" in prompt
        assert "Previous Iteration Results" not in prompt  # 第1轮不应包含历史
    
    def test_build_prompt_iteration_2(self, builder):
        """测试第2轮迭代的 Prompt"""
        iteration_history = {
            "UTS(MPa)": [850]
        }
        
        prompt = builder.build_prompt(
            iteration=2,
            test_sample={"ID": "Sample_001", "C": 0.5},
            reference_samples=[],
            target_properties=["UTS(MPa)"],
            iteration_history=iteration_history
        )
        
        # 验证 Prompt 包含历史信息
        assert "Previous Iteration Results" in prompt
        assert "850" in prompt
    
    def test_format_iteration_history(self, builder):
        """测试迭代历史格式化"""
        iteration_history = {
            "UTS(MPa)": [850, 855, 857],
            "El(%)": [15.0, 14.8, 14.7]
        }
        
        formatted = builder.format_iteration_history(iteration_history)
        
        # 验证格式化结果
        assert "| Iteration |" in formatted
        assert "| 1 |" in formatted
        assert "| 850" in formatted
```

**测试3：错误分类单元测试**

```python
# backend/tests/test_error_classification.py

import pytest
from backend.services.iterative_prediction_service import IterativePredictionService

class TestErrorClassification:
    """错误分类单元测试"""
    
    @pytest.fixture
    def service(self):
        """创建服务实例"""
        return IterativePredictionService()
    
    def test_classify_timeout_error(self, service):
        """测试超时错误分类"""
        error = TimeoutError("Request timeout after 30 seconds")
        error_type = service._classify_error(error)
        assert error_type == "api_timeout"
    
    def test_classify_rate_limit_error(self, service):
        """测试速率限制错误分类"""
        error = Exception("Rate limit exceeded: 429 Too Many Requests")
        error_type = service._classify_error(error)
        assert error_type == "rate_limit"
    
    def test_classify_auth_error(self, service):
        """测试认证错误分类"""
        error = Exception("Invalid API key")
        error_type = service._classify_error(error)
        assert error_type == "auth_error"
    
    def test_classify_parse_error(self, service):
        """测试解析错误分类"""
        error = Exception("Failed to parse JSON from LLM response")
        error_type = service._classify_error(error)
        assert error_type == "parse_error"
```

#### 11.2.2 集成测试

**测试4：LangGraph 工作流集成测试**

```python
# backend/tests/test_iterative_prediction_workflow.py

import pytest
from backend.services.iterative_prediction_service import IterativePredictionService, IterationState
from datetime import datetime

class TestIterativePredictionWorkflow:
    """LangGraph 工作流集成测试"""
    
    @pytest.fixture
    def service(self):
        """创建服务实例"""
        return IterativePredictionService()
    
    @pytest.fixture
    def sample_state(self):
        """创建示例状态"""
        return {
            "task_id": 1,
            "test_samples": [
                {"ID": "Sample_001", "C": 0.5},
                {"ID": "Sample_002", "C": 0.6},
            ],
            "reference_samples": [],
            "target_properties": ["UTS(MPa)"],
            "max_iterations": 5,
            "convergence_threshold": 0.01,
            "early_stop": True,
            "max_workers": 5,
            "current_iteration": 0,
            "iteration_history": {},
            "converged_samples": set(),
            "failed_samples": {},
            "llm_provider": "gemini",
            "llm_model": "gemini-2.0-flash",
            "temperature": 0.7,
            "start_time": datetime.utcnow(),
            "iteration_start_times": {}
        }
    
    def test_workflow_initialization(self, service, sample_state):
        """测试工作流初始化"""
        result_state = service._node_initialize(sample_state)
        
        assert result_state["current_iteration"] == 0
        assert len(result_state["iteration_history"]) == 2
        assert result_state["converged_samples"] == set()
    
    def test_workflow_convergence_check(self, service, sample_state):
        """测试收敛检查"""
        # 模拟已收敛的状态
        sample_state["iteration_history"] = {
            "sample_0": {
                "sample_index": 0,
                "targets": {
                    "UTS(MPa)": {
                        "iterations": [850, 855, 857]
                    }
                }
            }
        }
        sample_state["current_iteration"] = 2
        
        result_state = service._node_check_convergence(sample_state)
        
        assert 0 in result_state["converged_samples"]
    
    def test_workflow_should_continue(self, service, sample_state):
        """测试是否应该继续迭代"""
        # 测试所有样本都已收敛
        sample_state["converged_samples"] = {0, 1}
        sample_state["current_iteration"] = 2
        sample_state["early_stop"] = True
        
        should_continue = service._should_continue_iteration(sample_state)
        assert should_continue == "finish"
        
        # 测试未达到最大迭代次数
        sample_state["converged_samples"] = {0}
        should_continue = service._should_continue_iteration(sample_state)
        assert should_continue == "continue"
```

**测试5：API 端点集成测试**

```python
# backend/tests/test_api_iterative_prediction.py

import pytest
from fastapi.testclient import TestClient
from backend.main import app

@pytest.fixture
def client():
    """创建测试客户端"""
    return TestClient(app)

class TestIterativePredictionAPI:
    """API 端点集成测试"""
    
    def test_start_iterative_prediction(self, client):
        """测试启动迭代预测"""
        response = client.post(
            "/api/iterative-prediction/start",
            json={
                "task_name": "Test Task",
                "task_description": "Test Description",
                "test_file_path": "test.csv",
                "reference_file_path": "reference.csv",
                "target_properties": ["UTS(MPa)"],
                "llm_provider": "gemini",
                "llm_model": "gemini-2.0-flash",
                "temperature": 0.7,
                "enable_iteration": True,
                "max_iterations": 5,
                "convergence_threshold": 0.01,
                "early_stop": True,
                "max_workers": 5
            }
        )
        
        assert response.status_code == 200
        data = response.json()
        assert "task_id" in data
        assert data["status"] == "running"
    
    def test_get_task_status(self, client):
        """测试获取任务状态"""
        # 先创建任务
        create_response = client.post(
            "/api/iterative-prediction/start",
            json={...}
        )
        task_id = create_response.json()["task_id"]
        
        # 获取任务状态
        response = client.get(f"/api/tasks/{task_id}")
        
        assert response.status_code == 200
        data = response.json()
        assert data["task_id"] == task_id
        assert "current_iteration" in data
    
    def test_get_iteration_history(self, client):
        """测试获取迭代历史"""
        # 创建并完成任务
        task_id = 1  # 假设任务已完成
        
        response = client.get(f"/api/results/{task_id}/iterations")
        
        assert response.status_code == 200
        data = response.json()
        assert "global_info" in data
        assert "samples" in data
        assert "iteration_summaries" in data
    
    def test_retry_failed_samples(self, client):
        """测试重试失败样本"""
        response = client.post(
            "/api/iterative-prediction/retry-failed",
            json={
                "task_id": 1,
                "sample_indices": [0, 1]
            }
        )
        
        assert response.status_code == 200
        data = response.json()
        assert "new_task_id" in data
        assert data["original_task_id"] == 1
```

### 11.3 前端测试计划

#### 11.3.1 组件单元测试

```typescript
// frontend/__tests__/components/iterative-prediction/ConfigurationPanel.test.tsx

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import ConfigurationPanel from '@/components/iterative-prediction/ConfigurationPanel';

describe('ConfigurationPanel', () => {
  it('should render all form fields', () => {
    const mockOnStart = jest.fn();
    render(
      <ConfigurationPanel
        onStartPrediction={mockOnStart}
        loading={false}
      />
    );
    
    expect(screen.getByLabelText(/任务名称/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/任务描述/i)).toBeInTheDocument();
    expect(screen.getByText(/最大迭代次数/i)).toBeInTheDocument();
  });
  
  it('should call onStartPrediction when submit button is clicked', () => {
    const mockOnStart = jest.fn();
    render(
      <ConfigurationPanel
        onStartPrediction={mockOnStart}
        loading={false}
      />
    );
    
    const submitButton = screen.getByRole('button', { name: /启动迭代预测/i });
    fireEvent.click(submitButton);
    
    expect(mockOnStart).toHaveBeenCalled();
  });
  
  it('should disable submit button when loading', () => {
    const mockOnStart = jest.fn();
    render(
      <ConfigurationPanel
        onStartPrediction={mockOnStart}
        loading={true}
      />
    );
    
    const submitButton = screen.getByRole('button', { name: /启动中/i });
    expect(submitButton).toBeDisabled();
  });
});
```

#### 11.3.2 Hook 单元测试

```typescript
// frontend/__tests__/hooks/useIterativePrediction.test.ts

import { renderHook, act, waitFor } from '@testing-library/react';
import { useIterativePrediction } from '@/hooks/useIterativePrediction';

describe('useIterativePrediction', () => {
  it('should initialize with default values', () => {
    const { result } = renderHook(() => useIterativePrediction());
    
    expect(result.current.taskId).toBeNull();
    expect(result.current.task).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });
  
  it('should start prediction and set taskId', async () => {
    const { result } = renderHook(() => useIterativePrediction());
    
    await act(async () => {
      await result.current.startPrediction({
        task_name: 'Test',
        // ... 其他配置
      });
    });
    
    await waitFor(() => {
      expect(result.current.taskId).not.toBeNull();
    });
  });
  
  it('should fetch task status', async () => {
    const { result } = renderHook(() => useIterativePrediction());
    
    await act(async () => {
      await result.current.fetchTask(1);
    });
    
    await waitFor(() => {
      expect(result.current.task).not.toBeNull();
    });
  });
});
```

### 11.4 E2E 测试

```typescript
// frontend/__tests__/e2e/iterative-prediction.e2e.test.ts

import { test, expect } from '@playwright/test';

test.describe('Iterative Prediction E2E', () => {
  test('should complete full iterative prediction workflow', async ({ page }) => {
    // 1. 导航到迭代预测页面
    await page.goto('/iterative-prediction');
    
    // 2. 填写配置表单
    await page.fill('input[name="task_name"]', 'E2E Test Task');
    await page.fill('input[name="task_description"]', 'E2E Test Description');
    
    // 3. 上传文件
    await page.setInputFiles('input[type="file"]', 'test_data.csv');
    
    // 4. 配置迭代参数
    await page.fill('input[name="max_iterations"]', '5');
    
    // 5. 启动预测
    await page.click('button:has-text("启动迭代预测")');
    
    // 6. 等待进度页面出现
    await expect(page.locator('text=进度')).toBeVisible();
    
    // 7. 等待任务完成
    await page.waitForSelector('text=任务完成', { timeout: 60000 });
    
    // 8. 验证结果页面
    await page.click('text=结果');
    await expect(page.locator('text=迭代趋势图')).toBeVisible();
  });
});
```

### 11.5 测试覆盖率目标

| 模块 | 目标覆盖率 | 说明 |
|------|----------|------|
| ConvergenceChecker | >95% | 核心算法，需要高覆盖率 |
| PromptBuilder | >90% | 关键业务逻辑 |
| IterativePredictionService | >85% | 复杂工作流，难以完全覆盖 |
| API 端点 | >80% | 包含外部依赖 |
| 前端组件 | >80% | UI 组件，难以完全覆盖 |
| **总体** | **>80%** | 整个项目 |

### 11.6 测试执行计划

**本地开发阶段**：
```bash
# 运行所有后端测试
pytest backend/tests/ -v --cov=backend --cov-report=html

# 运行所有前端测试
npm run test -- --coverage

# 运行 E2E 测试
npx playwright test
```

**CI/CD 流程**：
```yaml
# .github/workflows/test.yml
name: Test
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Run backend tests
        run: pytest backend/tests/ --cov=backend
      - name: Run frontend tests
        run: npm run test -- --coverage
      - name: Upload coverage
        uses: codecov/codecov-action@v3
```

### 11.7 验收标准

**功能验收**：
- [ ] 所有 API 端点正常工作
- [ ] 迭代预测能够正确执行
- [ ] 收敛检查算法正确
- [ ] 失败处理机制有效
- [ ] 前端界面美观易用

**性能验收**：
- [ ] 单轮迭代耗时 < 30 秒（100 个样本）
- [ ] 前端响应时间 < 1 秒
- [ ] 内存占用 < 500 MB

**质量验收**：
- [ ] 代码覆盖率 > 80%
- [ ] 所有测试通过
- [ ] 无 critical 级别的 bug
- [ ] 代码风格符合规范

