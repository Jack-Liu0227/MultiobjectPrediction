#!/bin/bash

# 一键启动脚本 - Linux/Mac 版本
# 启动后端和前端服务，包含完整的系统检查和日志管理

set -e

# 颜色定义
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 获取脚本所在目录
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

echo ""
echo "========================================"
echo "多目标优化预测系统 - 一键启动"
echo "========================================"
echo ""

# ============================================
# 第0步：创建必要的目录结构
# ============================================
echo -e "${YELLOW}[0/6] 初始化目录结构...${NC}"

# 创建日志目录
if [ ! -d "Logs" ]; then
    mkdir -p Logs
    echo -e "${GREEN}✓ 创建日志目录: Logs/${NC}"
else
    echo -e "${GREEN}✓ 日志目录已存在: Logs/${NC}"
fi

# 创建存储目录
STORAGE_DIRS=("storage" "storage/uploads" "storage/results" "storage/cache" "storage/tasks" "storage/logs")
for dir in "${STORAGE_DIRS[@]}"; do
    if [ ! -d "$dir" ]; then
        mkdir -p "$dir"
        echo -e "${GREEN}✓ 创建目录: $dir${NC}"
    fi
done

# 设置目录权限（确保可写）
chmod -R 755 Logs storage 2>/dev/null || true

echo -e "${GREEN}✓ 目录结构初始化完成${NC}"
echo ""

# 检查后端目录
if [ ! -d "backend" ]; then
    echo -e "${RED}错误: 找不到 backend 目录${NC}"
    exit 1
fi

# 检查前端目录
if [ ! -d "frontend" ]; then
    echo -e "${RED}错误: 找不到 frontend 目录${NC}"
    exit 1
fi

# ============================================
# 第1步：检查系统依赖
# ============================================
echo -e "${YELLOW}[1/6] 检查系统依赖...${NC}"

# 检查 Python
if ! command -v python3 &> /dev/null && ! command -v python &> /dev/null; then
    echo -e "${RED}错误: 未找到 Python，请先安装 Python${NC}"
    exit 1
fi
PYTHON_VERSION=$(python3 --version 2>&1 || python --version 2>&1)
echo -e "${GREEN}✓ Python 已安装: $PYTHON_VERSION${NC}"

# 检查 uv
if ! command -v uv &> /dev/null; then
    echo -e "${YELLOW}警告: 未找到 uv，将尝试安装...${NC}"
    if command -v pip &> /dev/null || command -v pip3 &> /dev/null; then
        pip install uv || pip3 install uv || {
            echo -e "${RED}错误: uv 安装失败，请手动安装: pip install uv${NC}"
            exit 1
        }
    else
        echo -e "${RED}错误: 未找到 pip，无法安装 uv${NC}"
        echo "请访问 https://github.com/astral-sh/uv 安装 uv"
        exit 1
    fi
fi
UV_VERSION=$(uv --version 2>&1)
echo -e "${GREEN}✓ uv 已安装: $UV_VERSION${NC}"

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo -e "${RED}错误: 未找到 Node.js，请先安装 Node.js${NC}"
    exit 1
fi
NODE_VERSION=$(node --version 2>&1)
echo -e "${GREEN}✓ Node.js 已安装: $NODE_VERSION${NC}"

# 检查 npm
if ! command -v npm &> /dev/null; then
    echo -e "${RED}错误: 未找到 npm，请先安装 npm${NC}"
    exit 1
fi
NPM_VERSION=$(npm --version 2>&1)
echo -e "${GREEN}✓ npm 已安装: $NPM_VERSION${NC}"

echo ""
# ============================================
# 第2步：检查 RAG 模型配置
# ============================================
echo -e "${YELLOW}[2/6] 检查 RAG 模型配置...${NC}"

# 检查 all-MiniLM-L6-v2 模型目录
if [ ! -d "all-MiniLM-L6-v2" ]; then
    echo -e "${RED}错误: 未找到 all-MiniLM-L6-v2 模型目录${NC}"
    echo -e "${YELLOW}请确保模型已下载到项目根目录${NC}"
    exit 1
fi

# 检查模型文件
MODEL_FILES=("config.json" "model.safetensors" "tokenizer.json" "modules.json")
MISSING_FILES=()
for file in "${MODEL_FILES[@]}"; do
    if [ ! -f "all-MiniLM-L6-v2/$file" ]; then
        MISSING_FILES+=("$file")
    fi
done

if [ ${#MISSING_FILES[@]} -gt 0 ]; then
    echo -e "${RED}错误: 模型文件不完整，缺少以下文件:${NC}"
    for file in "${MISSING_FILES[@]}"; do
        echo -e "${RED}  - $file${NC}"
    done
    exit 1
fi

echo -e "${GREEN}✓ RAG 模型文件完整${NC}"

# 检查后端 RAG 引擎配置
if [ -f "backend/services/simple_rag_engine.py" ]; then
    echo -e "${GREEN}✓ RAG 引擎模块存在${NC}"
else
    echo -e "${RED}错误: 未找到 RAG 引擎模块${NC}"
    exit 1
fi

echo ""
# ============================================
# 第3步：检查后端依赖
# ============================================
echo -e "${YELLOW}[3/6] 检查后端依赖...${NC}"
cd backend

# 检测操作系统
if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "win32" ]]; then
    IS_WINDOWS=true
    PYTHON_CMD="python"
else
    IS_WINDOWS=false
    PYTHON_CMD="python3"
fi

# 使用 uv 同步依赖
echo "使用 uv 同步后端依赖..."
if [ -f "pyproject.toml" ]; then
    # 如果有 pyproject.toml，使用 uv sync
    uv sync || {
        echo -e "${RED}uv sync 失败，尝试使用 uv pip install${NC}"
        uv pip install -r requirements.txt || {
            echo -e "${RED}后端依赖安装失败${NC}"
            exit 1
        }
    }
elif [ -f "requirements.txt" ]; then
    # 如果只有 requirements.txt，使用 uv pip install
    uv pip install -r requirements.txt || {
        echo -e "${RED}后端依赖安装失败${NC}"
        exit 1
    }
else
    # 如果没有依赖文件，安装基础依赖
    echo "未找到依赖文件，安装基础依赖..."
    uv pip install fastapi uvicorn pandas numpy scikit-learn pydantic sentence-transformers litellm plotly || {
        echo -e "${RED}后端依赖安装失败${NC}"
        exit 1
    }
fi

# 检查关键模块
echo "检查关键 Python 模块..."
REQUIRED_MODULES=("fastapi" "uvicorn" "pandas" "numpy" "sentence_transformers" "litellm")
for module in "${REQUIRED_MODULES[@]}"; do
    if $PYTHON_CMD -c "import $module" 2>/dev/null; then
        echo -e "${GREEN}✓ $module 已安装${NC}"
    else
        echo -e "${RED}✗ $module 未安装${NC}"
        exit 1
    fi
done

echo -e "${GREEN}✓ 后端依赖已就绪${NC}"
cd ..

echo ""
# ============================================
# 第4步：检查前端依赖
# ============================================
echo -e "${YELLOW}[4/6] 检查前端依赖...${NC}"
cd frontend

# 检查前端依赖
if [ ! -d "node_modules" ]; then
    echo "安装前端依赖..."
    npm install || {
        echo -e "${RED}前端依赖安装失败${NC}"
        exit 1
    }
fi

# 检查关键前端模块
if [ -f "package.json" ]; then
    echo -e "${GREEN}✓ package.json 存在${NC}"
fi

echo -e "${GREEN}✓ 前端依赖已就绪${NC}"
cd ..

echo ""
# ============================================
# 第5步：系统完整性检查
# ============================================
echo -e "${YELLOW}[5/6] 系统完整性检查...${NC}"

# 检查预测模块
echo -e "${BLUE}检查预测模块...${NC}"
if [ -f "backend/services/rag_prediction_service.py" ]; then
    echo -e "${GREEN}✓ RAG 预测服务模块存在${NC}"
else
    echo -e "${RED}✗ RAG 预测服务模块缺失${NC}"
    exit 1
fi

# 检查绘制模块
echo -e "${BLUE}检查可视化模块...${NC}"
if [ -f "backend/services/pareto_analyzer.py" ]; then
    echo -e "${GREEN}✓ Pareto 分析和可视化模块存在${NC}"
else
    echo -e "${YELLOW}⚠ Pareto 分析模块不存在（可选功能）${NC}"
fi

# 检查前后端通信配置
echo -e "${BLUE}检查前后端配置...${NC}"
if [ -f "frontend/lib/api.ts" ]; then
    echo -e "${GREEN}✓ 前端 API 客户端存在${NC}"
else
    echo -e "${RED}✗ 前端 API 客户端缺失${NC}"
    exit 1
fi

if [ -f "backend/main.py" ]; then
    echo -e "${GREEN}✓ 后端主入口存在${NC}"
else
    echo -e "${RED}✗ 后端主入口缺失${NC}"
    exit 1
fi

# 检查 CORS 配置
if grep -q "CORSMiddleware" backend/main.py; then
    echo -e "${GREEN}✓ CORS 中间件已配置${NC}"
else
    echo -e "${YELLOW}⚠ 未检测到 CORS 配置${NC}"
fi

echo -e "${GREEN}✓ 系统完整性检查通过${NC}"

echo ""
# ============================================
# 第6步：启动服务
# ============================================
echo -e "${YELLOW}[6/6] 启动服务...${NC}"
echo ""

# 创建临时目录存储 PID
TEMP_DIR=$(mktemp -d)
BACKEND_PID_FILE="$TEMP_DIR/backend.pid"
FRONTEND_PID_FILE="$TEMP_DIR/frontend.pid"

# 启动后端
echo -e "${GREEN}启动后端服务 (http://localhost:8000)...${NC}"
cd backend

# 设置环境变量，确保使用本地模型
export SENTENCE_TRANSFORMERS_HOME="$SCRIPT_DIR/all-MiniLM-L6-v2"
export TRANSFORMERS_OFFLINE=1

# 使用 uv run 启动后端服务，日志输出到 Logs 目录
uv run uvicorn main:app --reload --port 8000 > "$SCRIPT_DIR/Logs/backend.log" 2>&1 &

BACKEND_PID=$!
echo $BACKEND_PID > "$BACKEND_PID_FILE"
echo -e "${GREEN}✓ 后端已启动 (PID: $BACKEND_PID)${NC}"
echo -e "${BLUE}  日志文件: Logs/backend.log${NC}"
cd ..

# 等待后端启动
echo "等待后端启动..."
sleep 3

# 检查后端是否成功启动
if ps -p $BACKEND_PID > /dev/null; then
    echo -e "${GREEN}✓ 后端进程运行正常${NC}"

    # 尝试访问健康检查端点
    sleep 2
    if command -v curl &> /dev/null; then
        if curl -s http://localhost:8000/health > /dev/null 2>&1; then
            echo -e "${GREEN}✓ 后端 API 响应正常${NC}"
        else
            echo -e "${YELLOW}⚠ 后端 API 尚未就绪，请稍候...${NC}"
        fi
    fi
else
    echo -e "${RED}✗ 后端启动失败，请查看日志: Logs/backend.log${NC}"
    exit 1
fi

# 启动前端
echo ""
echo -e "${GREEN}启动前端服务 (http://localhost:3000)...${NC}"
cd frontend
npm run dev > "$SCRIPT_DIR/Logs/frontend.log" 2>&1 &
FRONTEND_PID=$!
echo $FRONTEND_PID > "$FRONTEND_PID_FILE"
echo -e "${GREEN}✓ 前端已启动 (PID: $FRONTEND_PID)${NC}"
echo -e "${BLUE}  日志文件: Logs/frontend.log${NC}"
cd ..

# 等待前端启动
sleep 2
if ps -p $FRONTEND_PID > /dev/null; then
    echo -e "${GREEN}✓ 前端进程运行正常${NC}"
else
    echo -e "${RED}✗ 前端启动失败，请查看日志: Logs/frontend.log${NC}"
    kill $BACKEND_PID 2>/dev/null || true
    exit 1
fi

echo ""
echo "========================================"
echo -e "${GREEN}✓ 所有服务已成功启动${NC}"
echo "========================================"
echo ""
echo -e "${BLUE}访问地址:${NC}"
echo "  后端 API:  http://localhost:8000"
echo "  API 文档:  http://localhost:8000/docs"
echo "  前端应用:  http://localhost:3000"
echo ""
echo -e "${BLUE}日志文件:${NC}"
echo "  后端日志:  Logs/backend.log"
echo "  前端日志:  Logs/frontend.log"
echo ""
echo -e "${BLUE}存储目录:${NC}"
echo "  上传文件:  storage/uploads/"
echo "  预测结果:  storage/results/"
echo "  系统日志:  storage/logs/"
echo ""
echo -e "${BLUE}RAG 模型:${NC}"
echo "  模型路径:  all-MiniLM-L6-v2/"
echo "  加载方式:  本地加载（离线模式）"
echo ""
echo -e "${YELLOW}停止服务: 按 Ctrl+C${NC}"
echo ""

# ============================================
# 信号处理和清理
# ============================================
cleanup() {
    echo ''
    echo -e "${YELLOW}正在停止服务...${NC}"

    # 停止后端
    if [ -f "$BACKEND_PID_FILE" ]; then
        BACKEND_PID=$(cat "$BACKEND_PID_FILE")
        if ps -p $BACKEND_PID > /dev/null 2>&1; then
            kill $BACKEND_PID 2>/dev/null || true
            echo -e "${GREEN}✓ 后端服务已停止${NC}"
        fi
    fi

    # 停止前端
    if [ -f "$FRONTEND_PID_FILE" ]; then
        FRONTEND_PID=$(cat "$FRONTEND_PID_FILE")
        if ps -p $FRONTEND_PID > /dev/null 2>&1; then
            kill $FRONTEND_PID 2>/dev/null || true
            echo -e "${GREEN}✓ 前端服务已停止${NC}"
        fi
    fi

    # 清理临时文件
    rm -rf "$TEMP_DIR" 2>/dev/null || true

    echo -e "${GREEN}服务已全部停止${NC}"
    exit 0
}

# 注册信号处理
trap cleanup SIGINT SIGTERM

# 保持脚本运行
echo -e "${BLUE}服务正在运行中...${NC}"
echo -e "${BLUE}实时查看日志:${NC}"
echo "  tail -f Logs/backend.log"
echo "  tail -f Logs/frontend.log"
echo ""

wait

