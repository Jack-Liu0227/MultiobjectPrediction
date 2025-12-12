# 迭代预测功能开发文档 - 第12部分：部署和配置

## 12. 部署和配置

### 12.1 环境要求

#### 12.1.1 系统要求

| 组件 | 版本 | 说明 |
|------|------|------|
| Python | >= 3.10 | 后端运行环境 |
| Node.js | >= 18.0 | 前端构建环境 |
| PostgreSQL | >= 13.0 | 数据库 |
| Redis | >= 6.0 | 缓存（可选） |

#### 12.1.2 Python 依赖

```txt
# requirements.txt

# 核心框架
fastapi>=0.100.0
uvicorn>=0.23.0
sqlalchemy>=2.0.0
pydantic>=2.0.0

# LLM 和 RAG
langchain>=0.1.0
langgraph>=1.0.0
litellm>=1.0.0

# 数据处理
pandas>=2.0.0
numpy>=1.24.0

# 数据库
alembic>=1.12.0
psycopg2-binary>=2.9.0

# 工具
python-dotenv>=1.0.0
tenacity>=8.2.0
pydantic-settings>=2.0.0

# 日志
python-json-logger>=2.0.0

# 测试
pytest>=7.0.0
pytest-cov>=4.0.0
pytest-asyncio>=0.21.0
httpx>=0.24.0
```

### 12.2 本地开发环境配置

#### 12.2.1 后端环境配置

**步骤1：创建虚拟环境**
```bash
# 创建虚拟环境
python -m venv venv

# 激活虚拟环境（Linux/Mac）
source venv/bin/activate

# 激活虚拟环境（Windows）
venv\Scripts\activate
```

**步骤2：安装依赖**
```bash
# 使用 uv 安装依赖（推荐）
uv pip install -r requirements.txt

# 或使用 pip
pip install -r requirements.txt
```

**步骤3：配置环境变量**
```bash
# 创建 .env 文件
cat > .env << EOF
# 数据库配置
DATABASE_URL=postgresql://user:password@localhost:5432/iterative_prediction

# LLM 配置
GEMINI_API_KEY=your_gemini_api_key
OPENAI_API_KEY=your_openai_api_key

# 应用配置
DEBUG=True
LOG_LEVEL=INFO
EOF
```

**步骤4：初始化数据库**
```bash
# 运行迁移
alembic upgrade head

# 验证迁移成功
psql -U user -d iterative_prediction -c "\dt"
```

**步骤5：启动后端服务**
```bash
# 开发模式（自动重载）
uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000

# 生产模式
gunicorn -w 4 -k uvicorn.workers.UvicornWorker backend.main:app
```

#### 12.2.2 前端环境配置

**步骤1：安装依赖**
```bash
# 使用 npm
npm install

# 或使用 yarn
yarn install

# 或使用 pnpm
pnpm install
```

**步骤2：配置环境变量**
```bash
# 创建 .env.local 文件
cat > .env.local << EOF
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_LOG_LEVEL=debug
EOF
```

**步骤3：启动前端开发服务器**
```bash
# 开发模式
npm run dev

# 访问 http://localhost:3000
```

### 12.3 Docker 部署

#### 12.3.1 后端 Dockerfile

```dockerfile
# Dockerfile.backend

FROM python:3.11-slim

WORKDIR /app

# 安装系统依赖
RUN apt-get update && apt-get install -y \
    postgresql-client \
    && rm -rf /var/lib/apt/lists/*

# 复制依赖文件
COPY requirements.txt .

# 安装 Python 依赖
RUN pip install --no-cache-dir -r requirements.txt

# 复制应用代码
COPY backend/ ./backend/
COPY .env .

# 暴露端口
EXPOSE 8000

# 启动应用
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

#### 12.3.2 前端 Dockerfile

```dockerfile
# Dockerfile.frontend

FROM node:18-alpine AS builder

WORKDIR /app

# 复制依赖文件
COPY package*.json ./

# 安装依赖
RUN npm ci

# 复制应用代码
COPY frontend/ ./

# 构建应用
RUN npm run build

# 生产镜像
FROM node:18-alpine

WORKDIR /app

# 复制构建结果
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/public ./public

# 暴露端口
EXPOSE 3000

# 启动应用
CMD ["npm", "start"]
```

### 12.4 常见问题和解决方案

#### 12.4.1 数据库连接问题

**问题**：`psycopg2.OperationalError: could not connect to server`

**解决方案**：
```bash
# 1. 检查 PostgreSQL 是否运行
psql -U postgres -h localhost

# 2. 检查 DATABASE_URL 配置
echo $DATABASE_URL

# 3. 检查数据库是否存在
psql -U postgres -l | grep iterative_prediction

# 4. 创建数据库
createdb -U postgres iterative_prediction

# 5. 运行迁移
alembic upgrade head
```

#### 12.4.2 LLM API 错误

**问题**：`Invalid API key` 或 `Rate limit exceeded`

**解决方案**：
```bash
# 1. 检查 API 密钥
echo $GEMINI_API_KEY
echo $OPENAI_API_KEY

# 2. 验证 API 密钥有效性
curl -H "Authorization: Bearer $GEMINI_API_KEY" \
  https://generativelanguage.googleapis.com/v1beta/models/list

# 3. 检查速率限制
# 查看 LLM 提供商的配额和限制

# 4. 配置重试策略
# 在 .env 中添加
RETRY_MAX_ATTEMPTS=3
RETRY_BACKOFF_FACTOR=2
```

#### 12.4.3 前端构建失败

**问题**：`npm ERR! code ERESOLVE`

**解决方案**：
```bash
# 1. 清除缓存
npm cache clean --force

# 2. 删除 node_modules 和 package-lock.json
rm -rf node_modules package-lock.json

# 3. 重新安装依赖
npm install

# 4. 如果仍然失败，使用 legacy peer deps
npm install --legacy-peer-deps
```

#### 12.4.4 内存溢出

**问题**：`JavaScript heap out of memory` 或 `MemoryError`

**解决方案**：
```bash
# 后端：增加 Python 内存限制
export PYTHONUNBUFFERED=1
python -X dev backend/main.py

# 前端：增加 Node.js 内存限制
NODE_OPTIONS=--max-old-space-size=4096 npm run build

# Docker：增加容器内存限制
docker run -m 2g iterative-prediction-backend:latest
```

### 12.5 监控和日志

#### 12.5.1 日志配置

```python
# backend/config/logging.py

import logging
import json
from pythonjsonlogger import jsonlogger

def setup_logging():
    """配置日志"""

    # 创建日志处理器
    console_handler = logging.StreamHandler()
    file_handler = logging.FileHandler('logs/app.log')

    # 设置日志格式
    json_formatter = jsonlogger.JsonFormatter()
    console_handler.setFormatter(json_formatter)
    file_handler.setFormatter(json_formatter)

    # 配置根日志记录器
    root_logger = logging.getLogger()
    root_logger.setLevel(logging.INFO)
    root_logger.addHandler(console_handler)
    root_logger.addHandler(file_handler)

    return root_logger

# 在应用启动时调用
logger = setup_logging()
```

### 12.6 备份和恢复

#### 12.6.1 数据库备份

```bash
#!/bin/bash
# backup-database.sh

BACKUP_DIR="./backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/iterative_prediction_$TIMESTAMP.sql"

# 创建备份目录
mkdir -p $BACKUP_DIR

# 备份数据库
pg_dump -U postgres iterative_prediction > $BACKUP_FILE

# 压缩备份
gzip $BACKUP_FILE

echo "数据库备份完成: $BACKUP_FILE.gz"

# 删除7天前的备份
find $BACKUP_DIR -name "*.sql.gz" -mtime +7 -delete
```

#### 12.6.2 数据库恢复

```bash
#!/bin/bash
# restore-database.sh

BACKUP_FILE=$1

if [ -z "$BACKUP_FILE" ]; then
    echo "用法: $0 <backup_file>"
    exit 1
fi

# 解压备份
gunzip -c $BACKUP_FILE | psql -U postgres iterative_prediction

echo "数据库恢复完成"
```

### 12.7 性能优化建议

**1. 数据库优化**：
- 为 `task_id`, `status` 等常用字段添加索引
- 定期运行 `VACUUM` 和 `ANALYZE`
- 使用连接池（pgBouncer）

**2. 缓存优化**：
- 使用 Redis 缓存 LLM 响应
- 缓存参考样本的 embedding
- 设置合理的缓存过期时间

**3. 并发优化**：
- 调整 `max_workers` 参数（推荐 5-10）
- 使用异步 I/O 处理 API 调用
- 实现请求队列和优先级

**4. 前端优化**：
- 使用代码分割和懒加载
- 优化图表渲染性能
- 实现虚拟滚动处理大数据集

### 12.8 安全建议

**1. API 安全**：
- 实现 API 认证（JWT）
- 添加速率限制
- 验证所有输入

**2. 数据安全**：
- 加密敏感数据（API 密钥）
- 使用 HTTPS
- 定期备份

**3. 访问控制**：
- 实现基于角色的访问控制（RBAC）
- 审计日志记录
- 定期安全审查

---

## 文档总结

本开发文档共12个部分，总计约7600行，涵盖了迭代预测功能的完整设计和实现指南：

1. **功能概述** - 用户故事、使用场景、功能边界
2. **架构设计** - 系统架构、数据流、模块交互
3. **数据模型设计** - 数据库表结构、JSON 格式、迁移脚本
4. **Prompt 模板设计** - 统一模板、条件渲染、完整示例
5. **LangGraph 工作流设计** - 状态定义、节点实现、工作流执行
6. **API 接口设计** - 5 个 API 端点的完整文档
7. **前端界面设计** - 组件结构、状态管理、交互流程
8. **失败处理机制** - 失败分类、处理策略、重试机制
9. **收敛判断算法** - 数学公式、实现代码、测试用例
10. **开发任务分解** - 详细子任务、时间估算、依赖关系
11. **测试计划** - 单元测试、集成测试、E2E 测试
12. **部署和配置** - 环境要求、本地配置、Docker 部署、常见问题

所有代码示例都基于最新的 LangGraph 1.0.4 API，完整可运行，包含详细注释和多个场景示例。


