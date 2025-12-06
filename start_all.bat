@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

REM ============================================
REM 多目标优化预测系统 - Windows 一键启动脚本
REM ============================================

echo.
echo ========================================
echo 多目标优化预测系统 - 一键启动
echo ========================================
echo.

REM 获取脚本所在目录
set "SCRIPT_DIR=%~dp0"
cd /d "%SCRIPT_DIR%"

REM ============================================
REM 第0步：创建必要的目录结构
REM ============================================
echo [0/6] 初始化目录结构...
echo.

REM 创建日志目录
if not exist "Logs" (
    mkdir "Logs"
    echo [✓] 创建日志目录: Logs\
) else (
    echo [✓] 日志目录已存在: Logs\
)

REM 创建存储目录
set "STORAGE_DIRS=storage storage\uploads storage\results storage\cache storage\tasks storage\logs storage\database storage\prompt_templates"
for %%d in (%STORAGE_DIRS%) do (
    if not exist "%%d" (
        mkdir "%%d"
        echo [✓] 创建目录: %%d
    )
)

echo [✓] 目录结构初始化完成
echo.

REM 检查后端目录
if not exist "backend" (
    echo [✗] 错误: 找不到 backend 目录
    pause
    exit /b 1
)

REM 检查前端目录
if not exist "frontend" (
    echo [✗] 错误: 找不到 frontend 目录
    pause
    exit /b 1
)

REM ============================================
REM 第1步：检查系统依赖
REM ============================================
echo [1/6] 检查系统依赖...
echo.

REM 检查 uv
where uv >nul 2>&1
if errorlevel 1 (
    echo [✗] 错误: 未找到 uv，请先安装 uv
    echo     安装命令: pip install uv
    echo     或访问: https://github.com/astral-sh/uv
    pause
    exit /b 1
)
for /f "tokens=*" %%i in ('uv --version 2^>^&1') do set UV_VERSION=%%i
echo [✓] uv 已安装: !UV_VERSION!

REM 检查 Node.js
where node >nul 2>&1
if errorlevel 1 (
    echo [✗] 错误: 未找到 Node.js，请先安装 Node.js 16+
    echo     下载地址: https://nodejs.org/
    pause
    exit /b 1
)
for /f "tokens=*" %%i in ('node --version 2^>^&1') do set NODE_VERSION=%%i
echo [✓] Node.js 已安装: !NODE_VERSION!

REM 检查 npm
where npm >nul 2>&1
if errorlevel 1 (
    echo [✗] 错误: 未找到 npm
    pause
    exit /b 1
)
for /f "tokens=*" %%i in ('npm --version 2^>^&1') do set NPM_VERSION=%%i
echo [✓] npm 已安装: !NPM_VERSION!

echo.

REM ============================================
REM 第2步：检查 RAG 模型配置
REM ============================================
echo [2/6] 检查 RAG 模型配置...
echo.

REM 检查 all-MiniLM-L6-v2 模型目录
if not exist "all-MiniLM-L6-v2" (
    echo [✗] 错误: 未找到 all-MiniLM-L6-v2 模型目录
    echo.
    echo 请按照以下步骤下载模型:
    echo 1. 访问: https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2
    echo 2. 下载所有文件到项目根目录的 all-MiniLM-L6-v2 文件夹
    echo 3. 或运行: python download_model.py
    echo.
    pause
    exit /b 1
)

REM 检查模型文件
set "MODEL_FILES=config.json model.safetensors tokenizer.json modules.json"
set "MISSING_FILES="
for %%f in (%MODEL_FILES%) do (
    if not exist "all-MiniLM-L6-v2\%%f" (
        set "MISSING_FILES=!MISSING_FILES! %%f"
    )
)

if not "!MISSING_FILES!"=="" (
    echo [✗] 错误: 模型文件不完整，缺少以下文件:
    for %%f in (!MISSING_FILES!) do echo     - %%f
    pause
    exit /b 1
)

echo [✓] RAG 模型文件完整

REM 检查后端 RAG 引擎
if exist "backend\services\simple_rag_engine.py" (
    echo [✓] RAG 引擎模块存在
) else (
    echo [✗] 错误: 未找到 RAG 引擎模块
    pause
    exit /b 1
)

echo.

REM ============================================
REM 第3步：检查后端依赖
REM ============================================
echo [3/6] 检查后端依赖...
echo.

cd backend

REM 检查 requirements.txt
if not exist "requirements.txt" (
    echo [✗] 错误: 未找到 requirements.txt
    cd ..
    pause
    exit /b 1
)

echo 使用 uv 同步后端依赖...
uv pip install -r requirements.txt >nul 2>&1
if errorlevel 1 (
    echo [!] uv pip 安装可能遇到问题，尝试详细输出...
    uv pip install -r requirements.txt
    if errorlevel 1 (
        echo [✗] 后端依赖安装失败
        cd ..
        pause
        exit /b 1
    )
)

echo [✓] 后端依赖已就绪
cd ..

echo.

REM ============================================
REM 第4步：检查前端依赖
REM ============================================
echo [4/6] 检查前端依赖...
echo.

cd frontend

REM 检查 package.json
if not exist "package.json" (
    echo [✗] 错误: 未找到 package.json
    cd ..
    pause
    exit /b 1
)

REM 检查 node_modules
if not exist "node_modules" (
    echo 首次运行，安装前端依赖...
    call npm install
    if errorlevel 1 (
        echo [✗] 前端依赖安装失败
        cd ..
        pause
        exit /b 1
    )
) else (
    echo [✓] 前端依赖已存在
)

echo [✓] 前端依赖已就绪
cd ..

echo.

REM ============================================
REM 第5步：系统完整性检查
REM ============================================
echo [5/6] 系统完整性检查...
echo.

REM 检查预测模块
if exist "backend\services\rag_prediction_service.py" (
    echo [✓] RAG 预测服务模块存在
) else (
    echo [✗] RAG 预测服务模块缺失
    pause
    exit /b 1
)

REM 检查可视化模块
if exist "backend\services\pareto_analyzer.py" (
    echo [✓] Pareto 分析和可视化模块存在
) else (
    echo [!] Pareto 分析模块不存在 (可选功能)
)

REM 检查前端 API 客户端
if exist "frontend\lib\api.ts" (
    echo [✓] 前端 API 客户端存在
) else (
    echo [✗] 前端 API 客户端缺失
    pause
    exit /b 1
)

REM 检查后端主入口
if exist "backend\main.py" (
    echo [✓] 后端主入口存在
) else (
    echo [✗] 后端主入口缺失
    pause
    exit /b 1
)

REM 检查环境变量文件
if exist ".env" (
    echo [✓] 环境变量文件已配置
) else (
    echo [!] 未找到 .env 文件
    echo     建议: 复制 .env.example 为 .env 并配置 API 密钥
    echo     命令: copy .env.example .env
)

echo [✓] 系统完整性检查通过

echo.

REM ============================================
REM 第6步：启动服务
REM ============================================
echo [6/6] 启动服务...
echo.

REM 设置环境变量
set "SENTENCE_TRANSFORMERS_HOME=%SCRIPT_DIR%all-MiniLM-L6-v2"
set "TRANSFORMERS_OFFLINE=1"
set "HF_DATASETS_OFFLINE=1"

REM 启动后端
echo 启动后端服务 (http://localhost:8000)...
cd backend
start "多目标预测系统-后端" /min cmd /c "uv run uvicorn main:app --reload --port 8000 > ..\Logs\backend.log 2>&1"
echo [✓] 后端已启动
echo     日志文件: Logs\backend.log
cd ..

REM 等待后端启动
echo 等待后端启动...
timeout /t 5 /nobreak >nul

REM 启动前端
echo.
echo 启动前端服务 (http://localhost:3000)...
cd frontend
start "多目标预测系统-前端" /min cmd /c "npm run dev > ..\Logs\frontend.log 2>&1"
echo [✓] 前端已启动
echo     日志文件: Logs\frontend.log
cd ..

REM 等待前端启动
timeout /t 3 /nobreak >nul

echo.
echo ========================================
echo [✓] 所有服务已成功启动
echo ========================================
echo.
echo 访问地址:
echo   后端 API:  http://localhost:8000
echo   API 文档:  http://localhost:8000/docs
echo   前端应用:  http://localhost:3000
echo.
echo 日志文件:
echo   后端日志:  Logs\backend.log
echo   前端日志:  Logs\frontend.log
echo.
echo 存储目录:
echo   上传文件:  storage\uploads\
echo   预测结果:  storage\results\
echo   系统日志:  storage\logs\
echo.
echo RAG 模型:
echo   模型路径:  all-MiniLM-L6-v2\
echo   加载方式:  本地加载 (离线模式)
echo.
echo ========================================
echo 提示:
echo   - 服务在后台运行，窗口已最小化
echo   - 要停止服务，请运行: stop_all.bat
echo   - 或关闭后端和前端的命令行窗口
echo ========================================
echo.

REM 询问是否打开浏览器
set /p OPEN_BROWSER="是否在浏览器中打开应用? (Y/N): "
if /i "!OPEN_BROWSER!"=="Y" (
    echo 正在打开浏览器...
    timeout /t 2 /nobreak >nul
    start http://localhost:3000
)

echo.
echo 按任意键退出此窗口 (服务将继续在后台运行)...
pause >nul
