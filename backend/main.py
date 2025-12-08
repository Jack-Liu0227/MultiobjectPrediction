"""
多目标优化预测系统 - 后端主入口

支持失败组分重新预测的FastAPI应用
"""

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
import os

# HTTP 缓存中间件
class CacheControlMiddleware(BaseHTTPMiddleware):
    """
    添加 HTTP 缓存控制头

    根据不同的 API 路径设置不同的缓存策略：
    - 列表查询（tasks/list, datasets/list）：缓存 30 秒
    - 结果详情（results/{id}）：缓存 60 秒（结果是静态的）
    - 其他 GET 请求：缓存 10 秒
    - POST/PUT/DELETE 请求：不缓存
    """
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)

        # 只对成功的 GET 请求添加缓存头
        if request.method == "GET" and response.status_code == 200:
            path = request.url.path

            # 列表查询：缓存 30 秒
            if "/list" in path:
                response.headers["Cache-Control"] = "public, max-age=30"
            # 结果详情：缓存 60 秒
            elif "/results/" in path:
                response.headers["Cache-Control"] = "public, max-age=60"
            # 其他 GET 请求：缓存 10 秒
            else:
                response.headers["Cache-Control"] = "public, max-age=10"
        else:
            # POST/PUT/DELETE 请求不缓存
            response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"

        return response


# 创建FastAPI应用
app = FastAPI(
    title="多目标优化预测系统 API",
    description="支持失败组分重新预测的材料性能预测系统",
    version="1.0.0"
)

# 添加缓存控制中间件
app.add_middleware(CacheControlMiddleware)

# CORS配置
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3001"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Cache-Control"],  # 允许前端访问 Cache-Control 头
)

# 导入路由
from api.upload import router as upload_router
from api.prediction import router as prediction_router
from api.results import router as results_router
from api.tasks import router as tasks_router
from api.dataset_split import router as dataset_split_router
from api.llm_config import router as llm_config_router
from api.prompt_templates import router as prompt_templates_router
from api.task_comparison import router as task_comparison_router
from routers.datasets import router as datasets_router

# 注册路由
app.include_router(upload_router, prefix="/api/upload", tags=["upload"])
app.include_router(prediction_router, prefix="/api/prediction", tags=["prediction"])
app.include_router(results_router, prefix="/api/results", tags=["results"])
app.include_router(tasks_router, prefix="/api/tasks", tags=["tasks"])
app.include_router(dataset_split_router, prefix="/api/dataset-split", tags=["dataset-split"])
app.include_router(llm_config_router, prefix="/api/llm", tags=["llm"])
app.include_router(prompt_templates_router, prefix="/api/prompt-templates", tags=["prompt-templates"])
app.include_router(task_comparison_router, prefix="/api/task-comparison", tags=["task-comparison"])
app.include_router(datasets_router)


@app.get("/")
async def root():
    """根路由"""
    return {
        "message": "多目标优化预测系统 API",
        "version": "1.0.0",
        "docs": "/docs"
    }


@app.get("/health")
async def health_check():
    """健康检查"""
    return {"status": "healthy"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=8000,
        reload=True,
        access_log=False  # 禁用访问日志，减少日志噪音
    )

