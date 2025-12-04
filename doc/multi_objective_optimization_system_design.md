# 多目标优化预测系统完整技术方案

## 文档版本
- **版本**: v1.0
- **日期**: 2025-12-02
- **作者**: AI Assistant

---

## 1. 项目概述

### 1.1 项目目标
开发一个基于 React + Next.js 的前后端集成应用，实现材料性能的多目标预测功能，支持同时预测多个材料性能指标（如 UTS、El 等），并提供 Pareto 前沿分析。

### 1.2 核心功能
- **数据上传与配置**: 用户上传 CSV 数据文件，选择元素组成列、热处理文本列和多个目标预测列
- **多目标预测**: 使用 RAG（检索增强生成）技术同时预测多个材料性能指标
- **Pareto 前沿分析**: 找出多目标优化的 Pareto 最优解集
- **结果可视化**: 交互式展示预测结果和 Pareto 前沿图

### 1.3 技术栈
- **前端**: React 18+ + Next.js 14+ (App Router)
- **后端**: Python 3.10+ + FastAPI
- **LLM 调用**: LiteLLM (统一多模型接口)
- **包管理**: uv (Python 依赖管理)
- **多目标优化**: pymoo (Python 多目标优化库)
- **数据处理**: pandas, numpy, scikit-learn
- **可视化**: Plotly (后端) + Recharts/D3.js (前端)

---

## 2. 系统架构设计

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                         前端层 (Next.js)                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ 数据上传组件  │  │ 配置选择组件  │  │ 结果展示组件  │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
│         │                  │                  │                  │
└─────────┼──────────────────┼──────────────────┼──────────────────┘
          │                  │                  │
          ▼                  ▼                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                      API 层 (FastAPI)                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ 文件上传 API  │  │ 预测任务 API  │  │ 结果查询 API  │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
└─────────────────────────────────────────────────────────────────┘
          │                  │                  │
          ▼                  ▼                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                      业务逻辑层 (Python)                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ 数据处理模块  │  │ RAG预测模块   │  │ Pareto分析模块│          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
└─────────────────────────────────────────────────────────────────┘
          │                  │                  │
          ▼                  ▼                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                      基础设施层                                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ LiteLLM      │  │ 向量数据库    │  │ 文件存储      │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 数据流转设计

```
用户上传CSV文件
    │
    ▼
前端解析并展示列信息
    │
    ▼
用户选择配置
  - composition列
  - Processing_Description列
  - 多个目标列 (UTS, El, ...)
    │
    ▼
提交到后端API
    │
    ▼
数据预处理
  - 数据清洗
  - 训练/测试集划分 (8:2)
  - 格式化为RAG输入
    │
    ▼
RAG多目标预测
  - 为每个目标列独立预测
  - 使用向量检索相似样本
  - LLM生成预测值
    │
    ▼
Pareto前沿分析
  - 计算非支配解集
  - 生成Pareto前沿
  - 计算优化指标
    │
    ▼
结果可视化
  - 预测值对比图
  - Pareto前沿图
  - 性能指标表
    │
    ▼
返回前端展示
```

---

## 3. 模块设计

### 3.1 前端模块设计

#### 3.1.1 目录结构
```
frontend/
├── app/
│   ├── page.tsx                    # 主页面
│   ├── layout.tsx                  # 布局
│   └── api/
│       └── proxy/                  # API代理（可选）
├── components/
│   ├── DataUpload.tsx              # 数据上传组件
│   ├── ColumnSelector.tsx          # 列选择组件
│   ├── PredictionConfig.tsx        # 预测配置组件
│   ├── ResultsVisualization.tsx    # 结果可视化组件
│   └── ParetoFrontChart.tsx        # Pareto前沿图表组件
├── lib/
│   ├── api.ts                      # API调用封装
│   └── types.ts                    # TypeScript类型定义
└── public/
    └── examples/                   # 示例数据文件
```

#### 3.1.2 核心组件设计

##### DataUpload 组件
```typescript
// components/DataUpload.tsx
interface DataUploadProps {
  onFileUpload: (file: File, columns: string[]) => void;
}

功能:
- 支持拖拽上传和点击上传
- CSV文件解析和预览
- 自动识别列名
- 文件大小限制 (最大 50MB)
```

##### ColumnSelector 组件
```typescript
// components/ColumnSelector.tsx
interface ColumnSelectorProps {
  columns: string[];
  onConfigChange: (config: PredictionConfig) => void;
}

interface PredictionConfig {
  compositionColumn: string;           // 元素组成列
  processingColumn: string;            // 热处理文本列
  targetColumns: string[];             // 多个目标预测列
  trainRatio: number;                  // 训练集比例 (默认0.8)
}

功能:
- 下拉选择composition列
- 下拉选择Processing_Description列
- 多选目标预测列 (支持2-5个目标)
- 训练/测试比例调整
```

##### ResultsVisualization 组件
```typescript
// components/ResultsVisualization.tsx
interface ResultsVisualizationProps {
  predictions: PredictionResult[];
  paretoFront: ParetoPoint[];
}

功能:
- 预测值 vs 真实值散点图
- 多目标预测对比表格
- 性能指标展示 (R², RMSE, MAE)
- 可下载结果CSV
```

##### ParetoFrontChart 组件
```typescript
// components/ParetoFrontChart.tsx
interface ParetoFrontChartProps {
  data: ParetoPoint[];
  objectives: string[];
}

功能:
- 2D Pareto前沿图 (2个目标)
- 3D Pareto前沿图 (3个目标)
- 交互式点选查看详情
- 支持目标轴切换
```

### 3.2 后端模块设计

#### 3.2.1 目录结构
```
backend/
├── main.py                         # FastAPI主入口
├── api/
│   ├── __init__.py
│   ├── upload.py                   # 文件上传API
│   ├── prediction.py               # 预测任务API
│   └── results.py                  # 结果查询API
├── services/
│   ├── __init__.py
│   ├── data_processor.py           # 数据处理服务
│   ├── rag_predictor.py            # RAG预测服务
│   ├── pareto_analyzer.py          # Pareto分析服务
│   └── litellm_client.py           # LiteLLM客户端
├── models/
│   ├── __init__.py
│   ├── schemas.py                  # Pydantic数据模型
│   └── config.py                   # 配置管理
├── utils/
│   ├── __init__.py
│   ├── file_handler.py             # 文件处理工具
│   └── validators.py               # 数据验证工具
└── storage/
    ├── uploads/                    # 上传文件存储
    ├── results/                    # 结果文件存储
    └── cache/                      # 缓存目录
```

#### 3.2.2 核心服务设计

##### DataProcessor 服务
```python
# services/data_processor.py
class DataProcessor:
    """数据处理服务"""

    def process_uploaded_file(
        self,
        file_path: str,
        config: PredictionConfig
    ) -> ProcessedData:
        """
        处理上传的CSV文件

        功能:
        1. 读取CSV文件
        2. 验证列存在性
        3. 数据清洗 (去除NaN)
        4. 训练/测试集划分
        5. 格式化为RAG输入格式

        返回:
        - train_df: 训练集DataFrame
        - test_df: 测试集DataFrame
        - formatted_samples: 格式化的训练样本文本
        """
        pass

    def format_sample_for_rag(
        self,
        row: pd.Series,
        composition_col: str,
        processing_col: str,
        target_cols: List[str]
    ) -> str:
        """
        格式化单个样本为RAG输入格式

        输出格式:
        composition (wt%): Al 87.072, Zn 8.39, Mg 2.34, Cu 1.96
        Heat treatment method: Solution treatment at 450℃ for 1h...
        UTS (MPa): 592.0
        El(%): 10.0
        """
        pass
```

##### RAGPredictor 服务
```python
# services/rag_predictor.py
class MultiObjectiveRAGPredictor:
    """多目标RAG预测服务"""

    def __init__(
        self,
        litellm_client: LiteLLMClient,
        embedding_provider: str = "sentence-transformers",
        embedding_model: str = "all-MiniLM-L6-v2"
    ):
        self.llm_client = litellm_client
        self.rag_manager = SimpleRAGDataManager(
            embedding_provider=embedding_provider,
            embedding_model=embedding_model
        )

    def predict_multi_objectives(
        self,
        train_samples: List[str],
        test_df: pd.DataFrame,
        target_columns: List[str],
        max_retrieved_samples: int = 10,
        similarity_threshold: float = 0.3
    ) -> pd.DataFrame:
        """
        多目标预测

        流程:
        1. 加载训练样本到向量库
        2. 对每个测试样本:
           a. 检索相似训练样本
           b. 构建Few-Shot提示词
           c. 调用LLM同时预测所有目标
           d. 解析响应并存储
        3. 返回包含预测值的DataFrame

        返回列:
        - 原始列
        - {target}_predicted (每个目标的预测值)
        """
        pass

    def _build_multi_objective_prompt(
        self,
        similar_samples: List[str],
        test_sample: str,
        target_columns: List[str]
    ) -> str:
        """
        构建多目标预测提示词

        提示词结构:
        - 任务说明
        - Few-Shot示例 (相似样本)
        - 测试样本
        - 要求预测的目标列表
        - 输出格式要求
        """
        pass
```

##### ParetoAnalyzer 服务
```python
# services/pareto_analyzer.py
from pymoo.indicators.hv import HV
from pymoo.indicators.igd import IGD
import numpy as np

class ParetoAnalyzer:
    """Pareto前沿分析服务"""

    def __init__(self):
        self.hv_indicator = HV(ref_point=np.array([1.0, 1.0]))  # 参考点

    def compute_pareto_front(
        self,
        predictions_df: pd.DataFrame,
        objective_columns: List[str],
        maximize: List[bool] = None
    ) -> ParetoFrontResult:
        """
        计算Pareto前沿

        参数:
        - predictions_df: 包含预测值的DataFrame
        - objective_columns: 目标列名列表
        - maximize: 每个目标是否最大化 (默认都是最大化)

        算法:
        1. 提取目标值矩阵
        2. 标准化目标值 (0-1范围)
        3. 使用非支配排序找出Pareto前沿
        4. 计算性能指标 (HV, IGD, Spacing)

        返回:
        - pareto_points: Pareto最优解集
        - pareto_indices: 最优解在原DataFrame中的索引
        - hypervolume: 超体积指标
        - metrics: 其他性能指标
        """
        pass

    def non_dominated_sort(
        self,
        objectives: np.ndarray
    ) -> List[int]:
        """
        非支配排序算法

        实现NSGA-II的快速非支配排序
        返回第一前沿 (rank=0) 的解索引
        """
        n = len(objectives)
        domination_count = np.zeros(n, dtype=int)
        dominated_solutions = [[] for _ in range(n)]

        for i in range(n):
            for j in range(i + 1, n):
                if self._dominates(objectives[i], objectives[j]):
                    dominated_solutions[i].append(j)
                    domination_count[j] += 1
                elif self._dominates(objectives[j], objectives[i]):
                    dominated_solutions[j].append(i)
                    domination_count[i] += 1

        # 第一前沿: domination_count == 0
        front = [i for i in range(n) if domination_count[i] == 0]
        return front

    def _dominates(self, obj1: np.ndarray, obj2: np.ndarray) -> bool:
        """
        判断obj1是否支配obj2
        支配条件: obj1在所有目标上不差于obj2，且至少在一个目标上更好
        """
        return np.all(obj1 >= obj2) and np.any(obj1 > obj2)

    def visualize_pareto_front(
        self,
        pareto_points: np.ndarray,
        all_points: np.ndarray,
        objective_names: List[str],
        output_path: str
    ) -> str:
        """
        可视化Pareto前沿

        支持:
        - 2D图 (2个目标)
        - 3D图 (3个目标)
        - 平行坐标图 (>3个目标)

        使用Plotly生成交互式图表
        """
        pass
```

##### LiteLLMClient 服务
```python
# services/litellm_client.py
from litellm import completion
import litellm

class LiteLLMClient:
    """LiteLLM统一客户端"""

    def __init__(
        self,
        model: str = "gemini/gemini-2.5-flash",
        temperature: float = 1.0,
        api_base: str = None
    ):
        self.model = model
        self.temperature = temperature

        # 配置LiteLLM
        if api_base:
            litellm.api_base = api_base

    def predict(
        self,
        prompt: str,
        max_tokens: int = 1000,
        timeout: int = 60
    ) -> str:
        """
        调用LLM进行预测

        支持的模型:
        - gemini/gemini-2.5-flash
        - gemini/gemini-2.5-pro
        - openai/gpt-4
        - anthropic/claude-3-opus
        - deepseek/deepseek-chat

        返回: LLM生成的文本
        """
        try:
            response = completion(
                model=self.model,
                messages=[{"role": "user", "content": prompt}],
                temperature=self.temperature,
                max_tokens=max_tokens,
                timeout=timeout
            )
            return response.choices[0].message.content
        except Exception as e:
            raise LLMPredictionError(f"LLM prediction failed: {e}")
```

#### 3.2.3 API接口设计

##### 文件上传API
```python
# api/upload.py
from fastapi import APIRouter, UploadFile, File
from fastapi.responses import JSONResponse

router = APIRouter(prefix="/api/upload", tags=["upload"])

@router.post("/file")
async def upload_file(file: UploadFile = File(...)):
    """
    上传CSV文件

    请求:
    - file: CSV文件 (multipart/form-data)

    响应:
    {
        "file_id": "uuid",
        "filename": "data.csv",
        "columns": ["Al(wt%)", "Ti(wt%)", "UTS(MPa)", ...],
        "row_count": 1000,
        "preview": [...] // 前5行数据
    }
    """
    pass

@router.get("/columns/{file_id}")
async def get_columns(file_id: str):
    """
    获取文件列信息

    响应:
    {
        "columns": ["col1", "col2", ...],
        "dtypes": {"col1": "float64", "col2": "object", ...}
    }
    """
    pass
```

##### 预测任务API
```python
# api/prediction.py
from fastapi import APIRouter, BackgroundTasks
from pydantic import BaseModel

router = APIRouter(prefix="/api/prediction", tags=["prediction"])

class PredictionRequest(BaseModel):
    file_id: str
    composition_column: str
    processing_column: str
    target_columns: List[str]
    train_ratio: float = 0.8
    max_retrieved_samples: int = 10
    similarity_threshold: float = 0.3
    model: str = "gemini/gemini-2.5-flash"
    temperature: float = 1.0

@router.post("/start")
async def start_prediction(
    request: PredictionRequest,
    background_tasks: BackgroundTasks
):
    """
    启动预测任务

    响应:
    {
        "task_id": "uuid",
        "status": "pending",
        "message": "Prediction task started"
    }
    """
    # 创建任务
    task_id = create_prediction_task(request)

    # 后台执行预测
    background_tasks.add_task(
        run_prediction_task,
        task_id,
        request
    )

    return {"task_id": task_id, "status": "pending"}

@router.get("/status/{task_id}")
async def get_task_status(task_id: str):
    """
    查询任务状态

    响应:
    {
        "task_id": "uuid",
        "status": "running" | "completed" | "failed",
        "progress": 0.75,  // 0-1
        "message": "Predicting sample 75/100",
        "result_id": "uuid"  // 完成时返回
    }
    """
    pass
```

##### 结果查询API
```python
# api/results.py
from fastapi import APIRouter
from fastapi.responses import FileResponse

router = APIRouter(prefix="/api/results", tags=["results"])

@router.get("/{result_id}")
async def get_results(result_id: str):
    """
    获取预测结果

    响应:
    {
        "result_id": "uuid",
        "predictions": [
            {
                "id": 1,
                "composition": "Al 87.072, Zn 8.39, ...",
                "processing": "Solution treatment...",
                "UTS_actual": 592.0,
                "UTS_predicted": 585.3,
                "El_actual": 10.0,
                "El_predicted": 9.8
            },
            ...
        ],
        "metrics": {
            "UTS": {"r2": 0.92, "rmse": 15.3, "mae": 12.1},
            "El": {"r2": 0.88, "rmse": 1.2, "mae": 0.9}
        },
        "pareto_front": {
            "points": [...],
            "hypervolume": 0.85,
            "count": 25
        }
    }
    """
    pass

@router.get("/{result_id}/download")
async def download_results(result_id: str):
    """
    下载结果CSV文件

    返回: CSV文件
    """
    file_path = get_result_file_path(result_id)
    return FileResponse(
        file_path,
        media_type="text/csv",
        filename=f"predictions_{result_id}.csv"
    )

@router.get("/{result_id}/pareto-chart")
async def get_pareto_chart(result_id: str):
    """
    获取Pareto前沿图表数据

    响应:
    {
        "chart_type": "2d" | "3d" | "parallel",
        "data": {
            "pareto_points": [...],
            "all_points": [...],
            "objectives": ["UTS", "El"]
        },
        "plotly_json": {...}  // Plotly图表JSON
    }
    """
    pass
```

---

## 4. 多目标优化方案

### 4.1 Pareto前沿算法选型

#### 4.1.1 算法对比

| 算法 | 适用场景 | 优点 | 缺点 | 推荐度 |
|------|---------|------|------|--------|
| **NSGA-II** | 2-3个目标 | 成熟稳定、易实现 | 多目标性能下降 | ⭐⭐⭐⭐⭐ |
| **NSGA-III** | 4+个目标 | 多目标性能好 | 参数调优复杂 | ⭐⭐⭐⭐ |
| **MOEA/D** | 复杂问题 | 分解策略高效 | 权重设置困难 | ⭐⭐⭐ |
| **简单非支配排序** | 后处理分析 | 实现简单、快速 | 无优化能力 | ⭐⭐⭐⭐⭐ |

#### 4.1.2 推荐方案

**方案一: 简单非支配排序 (推荐用于结果分析)**
- **适用**: 对已有预测结果进行Pareto分析
- **实现**: 自定义非支配排序算法
- **优点**: 轻量级、无额外依赖、易于理解
- **使用场景**: 本项目的主要场景

**方案二: pymoo库 (推荐用于优化搜索)**
- **适用**: 需要主动搜索Pareto最优解
- **实现**: 使用pymoo的NSGA-II/NSGA-III
- **优点**: 功能完整、文档丰富、社区活跃
- **使用场景**: 未来扩展材料设计优化

### 4.2 Pareto前沿实现方案

#### 4.2.1 核心算法实现

```python
# services/pareto_analyzer.py (详细实现)

class ParetoAnalyzer:
    """Pareto前沿分析器"""

    def compute_pareto_front(
        self,
        df: pd.DataFrame,
        objective_cols: List[str],
        maximize: List[bool] = None
    ) -> Dict:
        """
        计算Pareto前沿

        步骤:
        1. 数据预处理和标准化
        2. 非支配排序
        3. 计算性能指标
        4. 生成可视化数据
        """
        # 1. 提取目标值
        objectives = df[objective_cols].values
        n_objectives = len(objective_cols)

        # 2. 处理最大化/最小化
        if maximize is None:
            maximize = [True] * n_objectives

        # 转换为最大化问题
        objectives_normalized = objectives.copy()
        for i, is_max in enumerate(maximize):
            if not is_max:
                objectives_normalized[:, i] = -objectives_normalized[:, i]

        # 3. 非支配排序
        pareto_indices = self.fast_non_dominated_sort(objectives_normalized)

        # 4. 计算性能指标
        metrics = self.compute_metrics(
            objectives_normalized,
            pareto_indices
        )

        # 5. 准备返回数据
        return {
            "pareto_indices": pareto_indices,
            "pareto_points": objectives[pareto_indices],
            "pareto_data": df.iloc[pareto_indices],
            "metrics": metrics,
            "n_pareto_solutions": len(pareto_indices),
            "pareto_ratio": len(pareto_indices) / len(df)
        }

    def fast_non_dominated_sort(
        self,
        objectives: np.ndarray
    ) -> np.ndarray:
        """
        快速非支配排序 (NSGA-II算法)

        时间复杂度: O(MN²)
        M: 目标数量, N: 解的数量
        """
        n = len(objectives)
        domination_count = np.zeros(n, dtype=int)
        dominated_solutions = [[] for _ in range(n)]

        # 计算支配关系
        for i in range(n):
            for j in range(i + 1, n):
                dominance = self.check_dominance(
                    objectives[i],
                    objectives[j]
                )
                if dominance == 1:  # i支配j
                    dominated_solutions[i].append(j)
                    domination_count[j] += 1
                elif dominance == -1:  # j支配i
                    dominated_solutions[j].append(i)
                    domination_count[i] += 1

        # 第一前沿 (Pareto最优解)
        front = np.where(domination_count == 0)[0]
        return front

    def check_dominance(
        self,
        obj1: np.ndarray,
        obj2: np.ndarray
    ) -> int:
        """
        检查支配关系

        返回:
        1: obj1支配obj2
        -1: obj2支配obj1
        0: 互不支配
        """
        better = np.sum(obj1 > obj2)
        worse = np.sum(obj1 < obj2)

        if better > 0 and worse == 0:
            return 1
        elif worse > 0 and better == 0:
            return -1
        else:
            return 0

    def compute_metrics(
        self,
        objectives: np.ndarray,
        pareto_indices: np.ndarray
    ) -> Dict:
        """
        计算Pareto前沿性能指标

        指标:
        - Hypervolume (HV): 超体积
        - Spacing: 解的分布均匀性
        - Spread: 解的扩展范围
        """
        pareto_points = objectives[pareto_indices]

        # 标准化到[0,1]
        min_vals = objectives.min(axis=0)
        max_vals = objectives.max(axis=0)
        range_vals = max_vals - min_vals
        range_vals[range_vals == 0] = 1  # 避免除零

        normalized = (objectives - min_vals) / range_vals
        pareto_normalized = normalized[pareto_indices]

        # 计算Hypervolume (参考点为[0,0,...])
        hv = self.compute_hypervolume(pareto_normalized)

        # 计算Spacing
        spacing = self.compute_spacing(pareto_normalized)

        # 计算Spread
        spread = self.compute_spread(pareto_normalized)

        return {
            "hypervolume": float(hv),
            "spacing": float(spacing),
            "spread": float(spread)
        }

    def compute_hypervolume(
        self,
        pareto_points: np.ndarray,
        ref_point: np.ndarray = None
    ) -> float:
        """
        计算超体积指标

        对于2D: 计算Pareto前沿下方的面积
        对于3D+: 使用WFG算法
        """
        if ref_point is None:
            ref_point = np.zeros(pareto_points.shape[1])

        # 简化实现: 2D情况
        if pareto_points.shape[1] == 2:
            # 按第一个目标排序
            sorted_indices = np.argsort(pareto_points[:, 0])
            sorted_points = pareto_points[sorted_indices]

            hv = 0.0
            for i in range(len(sorted_points)):
                if i == 0:
                    width = sorted_points[i, 0] - ref_point[0]
                else:
                    width = sorted_points[i, 0] - sorted_points[i-1, 0]
                height = sorted_points[i, 1] - ref_point[1]
                hv += width * height

            return hv
        else:
            # 3D+: 使用pymoo库
            try:
                from pymoo.indicators.hv import HV
                hv_indicator = HV(ref_point=ref_point)
                return hv_indicator.do(pareto_points)
            except ImportError:
                return 0.0  # 如果pymoo未安装

    def compute_spacing(self, pareto_points: np.ndarray) -> float:
        """
        计算Spacing指标 (解的均匀性)

        Spacing越小，解分布越均匀
        """
        if len(pareto_points) < 2:
            return 0.0

        # 计算每个点到最近邻的距离
        distances = []
        for i in range(len(pareto_points)):
            min_dist = float('inf')
            for j in range(len(pareto_points)):
                if i != j:
                    dist = np.linalg.norm(
                        pareto_points[i] - pareto_points[j]
                    )
                    min_dist = min(min_dist, dist)
            distances.append(min_dist)

        # Spacing = 标准差
        return float(np.std(distances))

    def compute_spread(self, pareto_points: np.ndarray) -> float:
        """
        计算Spread指标 (解的扩展范围)

        Spread越大，解覆盖的目标空间越广
        """
        if len(pareto_points) < 2:
            return 0.0

        # 计算每个维度的范围
        ranges = pareto_points.max(axis=0) - pareto_points.min(axis=0)

        # 平均范围
        return float(np.mean(ranges))
```

#### 4.2.2 可视化实现

```python
# services/pareto_analyzer.py (可视化部分)

def visualize_pareto_front_2d(
    self,
    all_points: np.ndarray,
    pareto_indices: np.ndarray,
    objective_names: List[str],
    output_path: str = None
) -> Dict:
    """
    2D Pareto前沿可视化

    使用Plotly生成交互式图表
    """
    import plotly.graph_objects as go

    # 分离Pareto点和非Pareto点
    pareto_points = all_points[pareto_indices]
    non_pareto_mask = np.ones(len(all_points), dtype=bool)
    non_pareto_mask[pareto_indices] = False
    non_pareto_points = all_points[non_pareto_mask]

    # 创建图表
    fig = go.Figure()

    # 非Pareto点
    fig.add_trace(go.Scatter(
        x=non_pareto_points[:, 0],
        y=non_pareto_points[:, 1],
        mode='markers',
        name='Non-Pareto Solutions',
        marker=dict(
            size=8,
            color='lightblue',
            opacity=0.6
        )
    ))

    # Pareto点
    fig.add_trace(go.Scatter(
        x=pareto_points[:, 0],
        y=pareto_points[:, 1],
        mode='markers+lines',
        name='Pareto Front',
        marker=dict(
            size=12,
            color='red',
            symbol='star'
        ),
        line=dict(
            color='red',
            width=2,
            dash='dash'
        )
    ))

    # 布局
    fig.update_layout(
        title='Pareto Front Visualization',
        xaxis_title=objective_names[0],
        yaxis_title=objective_names[1],
        hovermode='closest',
        width=800,
        height=600
    )

    # 保存
    if output_path:
        fig.write_html(output_path)

    return {
        "plotly_json": fig.to_json(),
        "chart_type": "2d"
    }

def visualize_pareto_front_3d(
    self,
    all_points: np.ndarray,
    pareto_indices: np.ndarray,
    objective_names: List[str],
    output_path: str = None
) -> Dict:
    """
    3D Pareto前沿可视化
    """
    import plotly.graph_objects as go

    pareto_points = all_points[pareto_indices]
    non_pareto_mask = np.ones(len(all_points), dtype=bool)
    non_pareto_mask[pareto_indices] = False
    non_pareto_points = all_points[non_pareto_mask]

    fig = go.Figure()

    # 非Pareto点
    fig.add_trace(go.Scatter3d(
        x=non_pareto_points[:, 0],
        y=non_pareto_points[:, 1],
        z=non_pareto_points[:, 2],
        mode='markers',
        name='Non-Pareto Solutions',
        marker=dict(
            size=5,
            color='lightblue',
            opacity=0.5
        )
    ))

    # Pareto点
    fig.add_trace(go.Scatter3d(
        x=pareto_points[:, 0],
        y=pareto_points[:, 1],
        z=pareto_points[:, 2],
        mode='markers',
        name='Pareto Front',
        marker=dict(
            size=8,
            color='red',
            symbol='diamond'
        )
    ))

    fig.update_layout(
        title='3D Pareto Front',
        scene=dict(
            xaxis_title=objective_names[0],
            yaxis_title=objective_names[1],
            zaxis_title=objective_names[2]
        ),
        width=900,
        height=700
    )

    if output_path:
        fig.write_html(output_path)

    return {
        "plotly_json": fig.to_json(),
        "chart_type": "3d"
    }
```

### 4.3 多目标预测模型设计

#### 4.3.1 预测策略

**策略一: 独立预测 (推荐)**
- 为每个目标列独立调用LLM
- 优点: 简单、稳定、易于调试
- 缺点: API调用次数多

**策略二: 联合预测**
- 一次LLM调用预测所有目标
- 优点: API调用少、可能捕获目标间关系
- 缺点: 解析复杂、容错性差

**推荐方案**: 策略二 (联合预测)
- 在提示词中明确要求输出所有目标
- 使用结构化输出格式 (JSON)
- 实现robust的解析和错误处理

#### 4.3.2 提示词设计

```python
# services/rag_predictor.py (提示词模板)

MULTI_OBJECTIVE_PROMPT_TEMPLATE = """
You are a materials science expert. Based on the following examples, predict the material properties for the test sample.

# Training Examples (Similar Materials):
{similar_samples}

# Test Sample:
{test_sample}

# Task:
Predict the following properties for the test sample:
{target_list}

# Output Format:
Provide your predictions in the following JSON format:
{{
    "{target_1}": <predicted_value>,
    "{target_2}": <predicted_value>,
    ...
}}

# Requirements:
1. Analyze the composition and processing conditions carefully
2. Consider the patterns from similar examples
3. Provide numerical predictions only (no units in values)
4. Ensure predictions are physically reasonable

Your prediction:
"""

def build_multi_objective_prompt(
    similar_samples: List[str],
    test_sample_dict: Dict,
    target_columns: List[str]
) -> str:
    """构建多目标预测提示词"""

    # 格式化相似样本
    similar_samples_text = "\n\n".join([
        f"Example {i+1}:\n{sample}"
        for i, sample in enumerate(similar_samples)
    ])

    # 格式化测试样本
    test_sample_text = f"""composition (wt%): {test_sample_dict['composition']}
Heat treatment method: {test_sample_dict['processing']}"""

    # 目标列表
    target_list = "\n".join([
        f"- {col}" for col in target_columns
    ])

    # 填充模板
    prompt = MULTI_OBJECTIVE_PROMPT_TEMPLATE.format(
        similar_samples=similar_samples_text,
        test_sample=test_sample_text,
        target_list=target_list,
        target_1=target_columns[0],
        target_2=target_columns[1] if len(target_columns) > 1 else "target_2"
    )

    return prompt
```

---

## 5. 技术实现细节

### 5.1 前端实现

#### 5.1.1 数据上传流程

```typescript
// lib/api.ts
export async function uploadFile(file: File): Promise<UploadResponse> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch('/api/upload/file', {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    throw new Error('File upload failed');
  }

  return response.json();
}

// components/DataUpload.tsx
export function DataUpload({ onFileUpload }: DataUploadProps) {
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<any[]>([]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const result = await uploadFile(file);
      setPreview(result.preview);
      onFileUpload(result.file_id, result.columns);
    } catch (error) {
      console.error('Upload failed:', error);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="upload-container">
      <input
        type="file"
        accept=".csv"
        onChange={handleFileChange}
        disabled={uploading}
      />
      {preview.length > 0 && (
        <DataPreviewTable data={preview} />
      )}
    </div>
  );
}
```

#### 5.1.2 预测配置与执行

```typescript
// components/PredictionConfig.tsx
export function PredictionConfig({
  columns,
  fileId,
  onPredictionStart
}: PredictionConfigProps) {
  const [config, setConfig] = useState<PredictionConfig>({
    compositionColumn: '',
    processingColumn: '',
    targetColumns: [],
    trainRatio: 0.8,
  });

  const handleSubmit = async () => {
    const response = await fetch('/api/prediction/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        file_id: fileId,
        ...config,
      }),
    });

    const result = await response.json();
    onPredictionStart(result.task_id);
  };

  return (
    <form onSubmit={handleSubmit}>
      <Select
        label="Composition Column"
        options={columns}
        value={config.compositionColumn}
        onChange={(val) => setConfig({...config, compositionColumn: val})}
      />

      <Select
        label="Processing Column"
        options={columns}
        value={config.processingColumn}
        onChange={(val) => setConfig({...config, processingColumn: val})}
      />

      <MultiSelect
        label="Target Columns (2-5)"
        options={columns}
        value={config.targetColumns}
        onChange={(val) => setConfig({...config, targetColumns: val})}
        min={2}
        max={5}
      />

      <Slider
        label="Train/Test Split"
        value={config.trainRatio}
        onChange={(val) => setConfig({...config, trainRatio: val})}
        min={0.5}
        max={0.9}
        step={0.05}
      />

      <Button type="submit">Start Prediction</Button>
    </form>
  );
}
```

#### 5.1.3 结果可视化

```typescript
// components/ParetoFrontChart.tsx
import { Scatter } from 'react-chartjs-2';
import Plot from 'react-plotly.js';

export function ParetoFrontChart({
  paretoData,
  allData,
  objectives
}: ParetoFrontChartProps) {

  // 2D图表
  if (objectives.length === 2) {
    return (
      <Plot
        data={[
          {
            x: allData.map(d => d[objectives[0]]),
            y: allData.map(d => d[objectives[1]]),
            mode: 'markers',
            type: 'scatter',
            name: 'All Solutions',
            marker: { color: 'lightblue', size: 8 },
          },
          {
            x: paretoData.map(d => d[objectives[0]]),
            y: paretoData.map(d => d[objectives[1]]),
            mode: 'markers+lines',
            type: 'scatter',
            name: 'Pareto Front',
            marker: { color: 'red', size: 12, symbol: 'star' },
            line: { color: 'red', dash: 'dash' },
          },
        ]}
        layout={{
          title: 'Pareto Front',
          xaxis: { title: objectives[0] },
          yaxis: { title: objectives[1] },
          hovermode: 'closest',
        }}
      />
    );
  }

  // 3D图表
  if (objectives.length === 3) {
    return (
      <Plot
        data={[
          {
            x: allData.map(d => d[objectives[0]]),
            y: allData.map(d => d[objectives[1]]),
            z: allData.map(d => d[objectives[2]]),
            mode: 'markers',
            type: 'scatter3d',
            name: 'All Solutions',
            marker: { color: 'lightblue', size: 5 },
          },
          {
            x: paretoData.map(d => d[objectives[0]]),
            y: paretoData.map(d => d[objectives[1]]),
            z: paretoData.map(d => d[objectives[2]]),
            mode: 'markers',
            type: 'scatter3d',
            name: 'Pareto Front',
            marker: { color: 'red', size: 8, symbol: 'diamond' },
          },
        ]}
        layout={{
          title: '3D Pareto Front',
          scene: {
            xaxis: { title: objectives[0] },
            yaxis: { title: objectives[1] },
            zaxis: { title: objectives[2] },
          },
        }}
      />
    );
  }

  // 4+目标: 平行坐标图
  return <ParallelCoordinatesChart data={paretoData} objectives={objectives} />;
}
```

### 5.2 后端实现

#### 5.2.1 FastAPI主入口

```python
# main.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from api import upload, prediction, results

app = FastAPI(
    title="Multi-Objective Prediction API",
    version="1.0.0"
)

# CORS配置
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],  # Next.js开发服务器
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 注册路由
app.include_router(upload.router)
app.include_router(prediction.router)
app.include_router(results.router)

@app.get("/")
async def root():
    return {
        "message": "Multi-Objective Prediction API",
        "version": "1.0.0"
    }

@app.get("/health")
async def health_check():
    return {"status": "healthy"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
```

#### 5.2.2 数据模型定义

```python
# models/schemas.py
from pydantic import BaseModel, Field, validator
from typing import List, Dict, Optional
from enum import Enum

class TaskStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"

class UploadResponse(BaseModel):
    file_id: str
    filename: str
    columns: List[str]
    row_count: int
    preview: List[Dict]

class PredictionRequest(BaseModel):
    file_id: str
    composition_column: str
    processing_column: str
    target_columns: List[str] = Field(..., min_items=2, max_items=5)
    train_ratio: float = Field(default=0.8, ge=0.5, le=0.9)
    max_retrieved_samples: int = Field(default=10, ge=1, le=50)
    similarity_threshold: float = Field(default=0.3, ge=0.0, le=1.0)
    model: str = "gemini/gemini-2.5-flash"
    temperature: float = Field(default=1.0, ge=0.0, le=2.0)

    @validator('target_columns')
    def validate_target_columns(cls, v):
        if len(v) < 2:
            raise ValueError('At least 2 target columns required')
        if len(v) > 5:
            raise ValueError('Maximum 5 target columns allowed')
        return v

class PredictionResponse(BaseModel):
    task_id: str
    status: TaskStatus
    message: str

class TaskStatusResponse(BaseModel):
    task_id: str
    status: TaskStatus
    progress: float = Field(ge=0.0, le=1.0)
    message: str
    result_id: Optional[str] = None
    error: Optional[str] = None

class PredictionMetrics(BaseModel):
    r2: float
    rmse: float
    mae: float
    mape: float

class ParetoFrontResult(BaseModel):
    points: List[Dict]
    hypervolume: float
    spacing: float
    spread: float
    count: int
    ratio: float

class ResultsResponse(BaseModel):
    result_id: str
    predictions: List[Dict]
    metrics: Dict[str, PredictionMetrics]
    pareto_front: ParetoFrontResult
    execution_time: float
```

#### 5.2.3 任务管理

```python
# services/task_manager.py
import uuid
from typing import Dict
from datetime import datetime
import json
import os

class TaskManager:
    """任务管理器"""

    def __init__(self, storage_dir: str = "storage/tasks"):
        self.storage_dir = storage_dir
        os.makedirs(storage_dir, exist_ok=True)
        self.tasks: Dict[str, Dict] = {}

    def create_task(self, request: PredictionRequest) -> str:
        """创建新任务"""
        task_id = str(uuid.uuid4())

        task = {
            "task_id": task_id,
            "status": "pending",
            "progress": 0.0,
            "message": "Task created",
            "request": request.dict(),
            "created_at": datetime.now().isoformat(),
            "updated_at": datetime.now().isoformat(),
        }

        self.tasks[task_id] = task
        self._save_task(task_id)

        return task_id

    def update_task(
        self,
        task_id: str,
        status: str = None,
        progress: float = None,
        message: str = None,
        result_id: str = None,
        error: str = None
    ):
        """更新任务状态"""
        if task_id not in self.tasks:
            raise ValueError(f"Task {task_id} not found")

        task = self.tasks[task_id]

        if status:
            task["status"] = status
        if progress is not None:
            task["progress"] = progress
        if message:
            task["message"] = message
        if result_id:
            task["result_id"] = result_id
        if error:
            task["error"] = error

        task["updated_at"] = datetime.now().isoformat()

        self._save_task(task_id)

    def get_task(self, task_id: str) -> Dict:
        """获取任务信息"""
        if task_id not in self.tasks:
            # 尝试从磁盘加载
            self._load_task(task_id)

        return self.tasks.get(task_id)

    def _save_task(self, task_id: str):
        """保存任务到磁盘"""
        task_file = os.path.join(self.storage_dir, f"{task_id}.json")
        with open(task_file, 'w') as f:
            json.dump(self.tasks[task_id], f, indent=2)

    def _load_task(self, task_id: str):
        """从磁盘加载任务"""
        task_file = os.path.join(self.storage_dir, f"{task_id}.json")
        if os.path.exists(task_file):
            with open(task_file, 'r') as f:
                self.tasks[task_id] = json.load(f)

# 全局任务管理器实例
task_manager = TaskManager()
```

### 5.3 LiteLLM集成方案

#### 5.3.1 LiteLLM配置

```python
# services/litellm_client.py
import litellm
from litellm import completion
import os
from typing import Optional

class LiteLLMClient:
    """LiteLLM统一客户端"""

    def __init__(
        self,
        model: str = "gemini/gemini-2.5-flash",
        temperature: float = 1.0,
        api_base: Optional[str] = None,
        api_key: Optional[str] = None
    ):
        self.model = model
        self.temperature = temperature

        # 配置API
        if api_base:
            litellm.api_base = api_base

        # 配置API Key
        if api_key:
            os.environ["GEMINI_API_KEY"] = api_key

        # 启用日志
        litellm.set_verbose = True

    def predict(
        self,
        prompt: str,
        max_tokens: int = 1000,
        timeout: int = 60,
        response_format: Optional[dict] = None
    ) -> str:
        """
        调用LLM进行预测

        支持的模型格式:
        - gemini/gemini-2.5-flash
        - gemini/gemini-2.5-pro
        - openai/gpt-4
        - anthropic/claude-3-opus
        - deepseek/deepseek-chat
        """
        try:
            response = completion(
                model=self.model,
                messages=[{
                    "role": "user",
                    "content": prompt
                }],
                temperature=self.temperature,
                max_tokens=max_tokens,
                timeout=timeout,
                response_format=response_format
            )

            return response.choices[0].message.content

        except Exception as e:
            raise LLMPredictionError(f"LLM prediction failed: {str(e)}")

    def predict_json(
        self,
        prompt: str,
        max_tokens: int = 1000,
        timeout: int = 60
    ) -> dict:
        """
        调用LLM并返回JSON格式响应
        """
        response_text = self.predict(
            prompt=prompt,
            max_tokens=max_tokens,
            timeout=timeout,
            response_format={"type": "json_object"}
        )

        # 解析JSON
        import json
        try:
            return json.loads(response_text)
        except json.JSONDecodeError:
            # 尝试提取JSON
            import re
            json_match = re.search(r'\{.*\}', response_text, re.DOTALL)
            if json_match:
                return json.loads(json_match.group())
            else:
                raise ValueError("Failed to parse JSON response")

class LLMPredictionError(Exception):
    """LLM预测错误"""
    pass
```

#### 5.3.2 环境配置

```bash
# .env
# LiteLLM配置
GEMINI_API_KEY=your_gemini_api_key
OPENAI_API_KEY=your_openai_api_key
ANTHROPIC_API_KEY=your_anthropic_api_key

# OneAPI配置 (可选)
ONEAPI_BASE_URL=http://localhost:3000/v1
ONEAPI_API_KEY=your_oneapi_key

# 应用配置
UPLOAD_DIR=storage/uploads
RESULTS_DIR=storage/results
MAX_FILE_SIZE=52428800  # 50MB

# 数据库配置 (可选)
DATABASE_URL=sqlite:///./storage/app.db
```

### 5.4 数据预处理流程

#### 5.4.1 数据清洗

```python
# services/data_processor.py (详细实现)

class DataProcessor:
    """数据处理服务"""

    def __init__(self, column_config: ColumnConfig = None):
        self.column_config = column_config or ColumnConfig()

    def process_uploaded_file(
        self,
        file_path: str,
        config: PredictionConfig
    ) -> ProcessedData:
        """
        处理上传的CSV文件
        """
        # 1. 读取CSV
        df = pd.read_csv(file_path)

        # 2. 验证列存在性
        self._validate_columns(df, config)

        # 3. 数据清洗
        df_clean = self._clean_data(df, config)

        # 4. 训练/测试集划分
        train_df, test_df = self._split_data(
            df_clean,
            config.target_columns,
            config.train_ratio
        )

        # 5. 格式化训练样本
        formatted_samples = self._format_training_samples(
            train_df,
            config
        )

        return ProcessedData(
            train_df=train_df,
            test_df=test_df,
            formatted_samples=formatted_samples,
            config=config
        )

    def _validate_columns(
        self,
        df: pd.DataFrame,
        config: PredictionConfig
    ):
        """验证列存在性"""
        required_cols = [
            config.composition_column,
            config.processing_column
        ] + config.target_columns

        missing_cols = [col for col in required_cols if col not in df.columns]

        if missing_cols:
            raise ValueError(f"Missing columns: {missing_cols}")

    def _clean_data(
        self,
        df: pd.DataFrame,
        config: PredictionConfig
    ) -> pd.DataFrame:
        """
        数据清洗

        步骤:
        1. 去除目标列的NaN值
        2. 去除composition列的NaN值
        3. 去除processing列的NaN值
        4. 去除重复行
        """
        df_clean = df.copy()

        # 去除NaN
        required_cols = [
            config.composition_column,
            config.processing_column
        ] + config.target_columns

        df_clean = df_clean.dropna(subset=required_cols)

        # 去除重复
        df_clean = df_clean.drop_duplicates()

        # 重置索引
        df_clean = df_clean.reset_index(drop=True)

        return df_clean

    def _split_data(
        self,
        df: pd.DataFrame,
        target_columns: List[str],
        train_ratio: float
    ) -> Tuple[pd.DataFrame, pd.DataFrame]:
        """
        训练/测试集划分

        使用sklearn的train_test_split
        固定random_state保证可重复性
        """
        from sklearn.model_selection import train_test_split

        train_df, test_df = train_test_split(
            df,
            test_size=1 - train_ratio,
            random_state=42
        )

        return train_df, test_df

    def _format_training_samples(
        self,
        train_df: pd.DataFrame,
        config: PredictionConfig
    ) -> Dict[str, List[str]]:
        """
        格式化训练样本

        为每个目标列创建独立的训练样本列表
        """
        formatted_samples = {}

        for target_col in config.target_columns:
            # 过滤该目标的有效样本
            valid_samples = train_df.dropna(subset=[target_col])

            # 格式化每个样本
            samples = []
            for _, row in valid_samples.iterrows():
                sample_text = self._format_single_sample(
                    row,
                    config.composition_column,
                    config.processing_column,
                    [target_col]
                )
                samples.append(sample_text)

            formatted_samples[target_col] = samples

        return formatted_samples

    def _format_single_sample(
        self,
        row: pd.Series,
        composition_col: str,
        processing_col: str,
        target_cols: List[str]
    ) -> str:
        """
        格式化单个样本

        输出格式:
        composition (wt%): Al 87.072, Zn 8.39, Mg 2.34
        Heat treatment method: Solution treatment at 450℃ for 1h
        UTS (MPa): 592.0
        El(%): 10.0
        """
        lines = []

        # Composition
        composition = row[composition_col]
        lines.append(f"composition (wt%): {composition}")

        # Processing
        processing = row[processing_col]
        lines.append(f"Heat treatment method: {processing}")

        # Targets
        for target_col in target_cols:
            if pd.notna(row[target_col]):
                lines.append(f"{target_col}: {row[target_col]}")

        return "\n".join(lines)
```

---

## 6. 开发计划

### 6.1 阶段划分

#### 阶段一: 基础架构搭建 (1-2周)

**后端任务:**
- [ ] 搭建FastAPI项目结构
- [ ] 实现文件上传API
- [ ] 实现数据处理服务 (DataProcessor)
- [ ] 集成LiteLLM客户端
- [ ] 实现基础的RAG预测服务

**前端任务:**
- [ ] 搭建Next.js项目结构
- [ ] 实现数据上传组件
- [ ] 实现列选择组件
- [ ] 实现基础的API调用封装

**验收标准:**
- 能够上传CSV文件并解析列信息
- 能够选择配置并提交到后端
- 后端能够处理数据并返回基础响应

#### 阶段二: 单目标预测实现 (1-2周)

**后端任务:**
- [ ] 完善RAG预测流程
- [ ] 实现向量检索功能
- [ ] 实现LLM调用和响应解析
- [ ] 实现结果存储和查询

**前端任务:**
- [ ] 实现任务状态轮询
- [ ] 实现预测结果展示
- [ ] 实现基础图表可视化

**验收标准:**
- 能够完成单个目标的预测
- 预测结果准确率达到基准水平
- 前端能够实时显示预测进度

#### 阶段三: 多目标预测实现 (1-2周)

**后端任务:**
- [ ] 实现多目标联合预测
- [ ] 优化提示词模板
- [ ] 实现多目标结果解析
- [ ] 添加错误处理和重试机制

**前端任务:**
- [ ] 支持多目标列选择
- [ ] 实现多目标结果对比展示
- [ ] 优化UI交互体验

**验收标准:**
- 能够同时预测2-5个目标
- 多目标预测准确率达标
- 系统稳定性良好

#### 阶段四: Pareto前沿分析 (1-2周)

**后端任务:**
- [ ] 实现ParetoAnalyzer服务
- [ ] 实现非支配排序算法
- [ ] 实现性能指标计算
- [ ] 实现Pareto前沿可视化

**前端任务:**
- [ ] 实现ParetoFrontChart组件
- [ ] 支持2D/3D交互式图表
- [ ] 实现Pareto点详情查看
- [ ] 添加图表导出功能

**验收标准:**
- Pareto前沿计算正确
- 可视化效果良好
- 支持交互式探索

#### 阶段五: 优化与测试 (1周)

**任务:**
- [ ] 性能优化 (并发、缓存)
- [ ] 错误处理完善
- [ ] 单元测试编写
- [ ] 集成测试
- [ ] 文档完善
- [ ] 部署准备

**验收标准:**
- 系统响应时间 < 5s (单次预测)
- 错误率 < 1%
- 测试覆盖率 > 80%
- 文档完整

### 6.2 技术难点与解决方案

#### 难点1: LLM响应解析不稳定

**问题描述:**
- LLM可能返回非标准格式
- JSON解析失败
- 数值提取错误

**解决方案:**
1. 使用结构化输出 (JSON mode)
2. 实现robust的解析器 (正则表达式 + 多种fallback策略)
3. 添加响应验证和重试机制
4. 记录失败案例用于优化提示词

```python
def parse_llm_response(response: str, target_cols: List[str]) -> Dict:
    """
    Robust LLM响应解析

    策略:
    1. 尝试JSON解析
    2. 尝试正则表达式提取
    3. 尝试逐行解析
    4. 返回None表示失败
    """
    # 策略1: JSON解析
    try:
        import json
        data = json.loads(response)
        if all(col in data for col in target_cols):
            return data
    except:
        pass

    # 策略2: 正则表达式
    import re
    result = {}
    for col in target_cols:
        pattern = rf'"{col}":\s*([0-9.]+)'
        match = re.search(pattern, response)
        if match:
            result[col] = float(match.group(1))

    if len(result) == len(target_cols):
        return result

    # 策略3: 逐行解析
    for line in response.split('\n'):
        for col in target_cols:
            if col in line:
                numbers = re.findall(r'[0-9.]+', line)
                if numbers:
                    result[col] = float(numbers[0])

    if len(result) == len(target_cols):
        return result

    return None
```

#### 难点2: 大规模数据处理性能

**问题描述:**
- 数据量大时处理慢
- 向量检索耗时
- LLM调用并发限制

**解决方案:**
1. 使用批处理和并发
2. 实现embedding缓存
3. 使用异步任务队列
4. 添加进度反馈

```python
async def predict_batch(
    test_samples: List[Dict],
    batch_size: int = 10,
    max_workers: int = 5
) -> List[Dict]:
    """
    批量预测

    使用asyncio实现并发
    """
    import asyncio
    from concurrent.futures import ThreadPoolExecutor

    results = []

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = []

        for i in range(0, len(test_samples), batch_size):
            batch = test_samples[i:i+batch_size]
            future = executor.submit(predict_single_batch, batch)
            futures.append(future)

        for future in as_completed(futures):
            batch_results = future.result()
            results.extend(batch_results)

    return results
```

#### 难点3: Pareto前沿计算复杂度

**问题描述:**
- 非支配排序时间复杂度 O(MN²)
- 大数据集计算慢

**解决方案:**
1. 使用高效算法 (NSGA-II快速非支配排序)
2. 预先过滤明显劣解
3. 使用numpy向量化计算
4. 考虑使用pymoo库的优化实现

```python
def fast_non_dominated_sort_optimized(objectives: np.ndarray) -> np.ndarray:
    """
    优化的非支配排序

    使用向量化计算加速
    """
    n = len(objectives)

    # 向量化比较
    # objectives[i] > objectives[j] for all i, j
    dominance_matrix = np.zeros((n, n), dtype=int)

    for i in range(n):
        # 比较i和所有其他解
        better = objectives[i] > objectives
        worse = objectives[i] < objectives

        # i支配j: better且不worse
        dominates = np.all(better | ~worse, axis=1) & np.any(better, axis=1)
        dominance_matrix[i] = dominates

    # 计算被支配次数
    domination_count = np.sum(dominance_matrix, axis=0)

    # 第一前沿
    front = np.where(domination_count == 0)[0]

    return front
```

### 6.3 依赖安装

#### Python依赖 (使用uv)

```bash
# 创建虚拟环境
uv venv

# 激活环境
source .venv/bin/activate  # Linux/Mac
.venv\Scripts\activate     # Windows

# 安装依赖
uv pip install fastapi uvicorn
uv pip install pandas numpy scikit-learn
uv pip install litellm
uv pip install plotly
uv pip install pymoo  # 可选
uv pip install sentence-transformers  # embedding
uv pip install python-multipart  # 文件上传
uv pip install aiofiles  # 异步文件操作
```

#### 前端依赖

```bash
# 创建Next.js项目
npx create-next-app@latest frontend --typescript --tailwind --app

cd frontend

# 安装依赖
npm install axios
npm install react-plotly.js plotly.js
npm install @types/plotly.js
npm install react-dropzone  # 文件上传
npm install recharts  # 备选图表库
```

---

## 7. 总结

### 7.1 系统特点

1. **模块化设计**: 前后端分离，各模块职责清晰
2. **可扩展性**: 易于添加新的目标、新的模型、新的算法
3. **用户友好**: 直观的UI，实时反馈，交互式可视化
4. **技术先进**: 使用RAG技术、LiteLLM统一接口、Pareto前沿分析

### 7.2 创新点

1. **多目标RAG预测**: 将RAG技术应用于多目标材料性能预测
2. **联合预测策略**: 一次LLM调用预测多个目标，提高效率
3. **交互式Pareto分析**: 实时计算和可视化Pareto前沿
4. **灵活的模型选择**: 通过LiteLLM支持多种LLM模型

### 7.3 未来扩展方向

1. **主动学习**: 根据预测结果主动选择新样本进行实验
2. **材料设计优化**: 使用NSGA-II/NSGA-III主动搜索最优材料配方
3. **不确定性量化**: 提供预测的置信区间
4. **多模态输入**: 支持图像、光谱等多模态数据
5. **知识图谱集成**: 整合材料科学知识图谱提升预测准确性

---

## 附录

### A. 参考资料

1. **多目标优化**:
   - Deb, K. (2001). Multi-objective optimization using evolutionary algorithms.
   - pymoo文档: https://pymoo.org/

2. **RAG技术**:
   - Lewis, P. et al. (2020). Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks.

3. **材料科学应用**:
   - Multi-objective optimization in materials science (Nature Scientific Reports, 2018)
   - Machine learning assisted multi-objective optimization for materials design (2020)

### B. 示例数据格式

```csv
ID,Al(wt%),Zn(wt%),Mg(wt%),Cu(wt%),Processing_Description,UTS(MPa),El(%)
1,87.072,8.39,2.34,1.96,"Solution treatment at 450℃ for 1h, then aging at 130℃ for 24h",592.0,10.0
2,88.5,7.5,2.0,2.0,"Solution treatment at 470℃ for 1h, then aging at 120℃ for 20h",580.0,12.0
...
```

### C. API调用示例

```bash
# 1. 上传文件
curl -X POST http://localhost:8000/api/upload/file \
  -F "file=@data.csv"

# 2. 启动预测
curl -X POST http://localhost:8000/api/prediction/start \
  -H "Content-Type: application/json" \
  -d '{
    "file_id": "uuid",
    "composition_column": "composition",
    "processing_column": "Processing_Description",
    "target_columns": ["UTS(MPa)", "El(%)"],
    "train_ratio": 0.8
  }'

# 3. 查询状态
curl http://localhost:8000/api/prediction/status/task_id

# 4. 获取结果
curl http://localhost:8000/api/results/result_id
```

---

**文档结束**

