#!/bin/bash

# 停止所有服务脚本 - Linux/Mac 版本

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
echo "多目标优化预测系统 - 停止服务"
echo "========================================"
echo ""

# 临时文件目录
TEMP_DIR="${SCRIPT_DIR}/.temp"
BACKEND_PID_FILE="$TEMP_DIR/backend.pid"
FRONTEND_PID_FILE="$TEMP_DIR/frontend.pid"

# 停止后端
if [ -f "$BACKEND_PID_FILE" ]; then
    BACKEND_PID=$(cat "$BACKEND_PID_FILE")
    if ps -p $BACKEND_PID > /dev/null 2>&1; then
        echo -e "${YELLOW}停止后端服务 (PID: $BACKEND_PID)...${NC}"
        kill $BACKEND_PID 2>/dev/null || true
        sleep 2
        # 如果还在运行，强制杀死
        if ps -p $BACKEND_PID > /dev/null 2>&1; then
            echo -e "${YELLOW}强制停止后端服务...${NC}"
            kill -9 $BACKEND_PID 2>/dev/null || true
        fi
        echo -e "${GREEN}✓ 后端服务已停止${NC}"
    else
        echo -e "${BLUE}后端服务未运行${NC}"
    fi
    rm -f "$BACKEND_PID_FILE"
else
    echo -e "${BLUE}未找到后端 PID 文件${NC}"
fi

# 停止前端
if [ -f "$FRONTEND_PID_FILE" ]; then
    FRONTEND_PID=$(cat "$FRONTEND_PID_FILE")
    if ps -p $FRONTEND_PID > /dev/null 2>&1; then
        echo -e "${YELLOW}停止前端服务 (PID: $FRONTEND_PID)...${NC}"
        kill $FRONTEND_PID 2>/dev/null || true
        sleep 2
        # 如果还在运行，强制杀死
        if ps -p $FRONTEND_PID > /dev/null 2>&1; then
            echo -e "${YELLOW}强制停止前端服务...${NC}"
            kill -9 $FRONTEND_PID 2>/dev/null || true
        fi
        echo -e "${GREEN}✓ 前端服务已停止${NC}"
    else
        echo -e "${BLUE}前端服务未运行${NC}"
    fi
    rm -f "$FRONTEND_PID_FILE"
else
    echo -e "${BLUE}未找到前端 PID 文件${NC}"
fi

# 额外检查：通过端口查找并停止进程
echo ""
echo -e "${YELLOW}检查端口占用...${NC}"

# 检查并停止占用 8000 端口的进程（后端）
if lsof -Pi :8000 -sTCP:LISTEN -t >/dev/null 2>&1 ; then
    BACKEND_PORT_PID=$(lsof -Pi :8000 -sTCP:LISTEN -t)
    echo -e "${YELLOW}发现占用端口 8000 的进程 (PID: $BACKEND_PORT_PID)${NC}"
    kill $BACKEND_PORT_PID 2>/dev/null || true
    sleep 1
    if lsof -Pi :8000 -sTCP:LISTEN -t >/dev/null 2>&1 ; then
        kill -9 $BACKEND_PORT_PID 2>/dev/null || true
    fi
    echo -e "${GREEN}✓ 端口 8000 已释放${NC}"
fi

# 检查并停止占用 3000 端口的进程（前端）
if lsof -Pi :3000 -sTCP:LISTEN -t >/dev/null 2>&1 ; then
    FRONTEND_PORT_PID=$(lsof -Pi :3000 -sTCP:LISTEN -t)
    echo -e "${YELLOW}发现占用端口 3000 的进程 (PID: $FRONTEND_PORT_PID)${NC}"
    kill $FRONTEND_PORT_PID 2>/dev/null || true
    sleep 1
    if lsof -Pi :3000 -sTCP:LISTEN -t >/dev/null 2>&1 ; then
        kill -9 $FRONTEND_PORT_PID 2>/dev/null || true
    fi
    echo -e "${GREEN}✓ 端口 3000 已释放${NC}"
fi

echo ""
echo -e "${GREEN}所有服务已停止${NC}"
echo ""

