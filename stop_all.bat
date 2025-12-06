@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

REM ============================================
REM 多目标优化预测系统 - Windows 停止脚本
REM ============================================

echo.
echo ========================================
echo 多目标优化预测系统 - 停止服务
echo ========================================
echo.

REM 查找并终止后端进程 (uvicorn)
echo 正在查找后端进程...
set "BACKEND_FOUND=0"

for /f "tokens=2" %%i in ('tasklist /fi "windowtitle eq 多目标预测系统-后端*" /fo list ^| find "PID:"') do (
    set "BACKEND_PID=%%i"
    set "BACKEND_FOUND=1"
    echo 找到后端进程 (PID: !BACKEND_PID!)
    taskkill /PID !BACKEND_PID! /F >nul 2>&1
    if !errorlevel! equ 0 (
        echo [✓] 后端服务已停止
    ) else (
        echo [!] 停止后端服务失败
    )
)

if !BACKEND_FOUND! equ 0 (
    REM 尝试通过进程名查找 (uv 或 python)
    echo 尝试通过端口查找后端进程...
    for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8000" ^| findstr "LISTENING"') do (
        set "PID=%%a"
        tasklist /fi "pid eq !PID!" | find "python.exe" >nul
        if !errorlevel! equ 0 (
            echo 找到后端进程 (PID: !PID!, 端口: 8000)
            taskkill /PID !PID! /F >nul 2>&1
            if !errorlevel! equ 0 (
                echo [✓] 后端服务已停止
                set "BACKEND_FOUND=1"
            )
        )
        tasklist /fi "pid eq !PID!" | find "uv.exe" >nul
        if !errorlevel! equ 0 (
            echo 找到后端进程 (PID: !PID!, 端口: 8000)
            taskkill /PID !PID! /F >nul 2>&1
            if !errorlevel! equ 0 (
                echo [✓] 后端服务已停止
                set "BACKEND_FOUND=1"
            )
        )
    )
)

if !BACKEND_FOUND! equ 0 (
    echo [!] 未找到运行中的后端服务
)

echo.

REM 查找并终止前端进程 (node)
echo 正在查找前端进程...
set "FRONTEND_FOUND=0"

for /f "tokens=2" %%i in ('tasklist /fi "windowtitle eq 多目标预测系统-前端*" /fo list ^| find "PID:"') do (
    set "FRONTEND_PID=%%i"
    set "FRONTEND_FOUND=1"
    echo 找到前端进程 (PID: !FRONTEND_PID!)
    taskkill /PID !FRONTEND_PID! /F >nul 2>&1
    if !errorlevel! equ 0 (
        echo [✓] 前端服务已停止
    ) else (
        echo [!] 停止前端服务失败
    )
)

if !FRONTEND_FOUND! equ 0 (
    REM 尝试通过端口查找
    echo 尝试通过端口查找前端进程...
    for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do (
        set "PID=%%a"
        tasklist /fi "pid eq !PID!" | find "node.exe" >nul
        if !errorlevel! equ 0 (
            echo 找到前端进程 (PID: !PID!, 端口: 3000)
            taskkill /PID !PID! /F >nul 2>&1
            if !errorlevel! equ 0 (
                echo [✓] 前端服务已停止
                set "FRONTEND_FOUND=1"
            )
        )
    )
)

if !FRONTEND_FOUND! equ 0 (
    echo [!] 未找到运行中的前端服务
)

echo.

REM 清理可能残留的 Node.js 进程
echo 检查是否有残留的 Next.js 进程...
tasklist | find "next" >nul
if !errorlevel! equ 0 (
    echo 发现 Next.js 进程，正在清理...
    taskkill /F /IM node.exe /FI "WINDOWTITLE eq next*" >nul 2>&1
)

echo.
echo ========================================
echo [✓] 服务停止完成
echo ========================================
echo.
echo 提示:
echo   - 如果服务未完全停止，请手动关闭相关窗口
echo   - 或使用任务管理器结束 uv.exe、python.exe 和 node.exe 进程
echo.

pause

