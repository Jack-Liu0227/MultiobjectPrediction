# Multi-Objective Prediction System - PowerShell Startup Script

Write-Host ""
Write-Host "========================================"
Write-Host "Multi-Objective Prediction System"
Write-Host "========================================"
Write-Host ""

# Get script directory
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

# Step 0: Initialize directories
Write-Host "[0/6] Initializing directories..." -ForegroundColor Yellow
Write-Host ""

if (-not (Test-Path "Logs")) {
    New-Item -ItemType Directory -Path "Logs" | Out-Null
    Write-Host "[OK] Created: Logs\" -ForegroundColor Green
} else {
    Write-Host "[OK] Exists: Logs\" -ForegroundColor Green
}

$dirs = @("storage", "storage\uploads", "storage\results", "storage\cache", "storage\tasks", "storage\logs", "storage\database", "storage\prompt_templates")
foreach ($dir in $dirs) {
    if (-not (Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir | Out-Null
        Write-Host "[OK] Created: $dir" -ForegroundColor Green
    }
}

Write-Host "[OK] Directories initialized" -ForegroundColor Green
Write-Host ""

# Check directories
if (-not (Test-Path "backend")) {
    Write-Host "[ERROR] Backend directory not found" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

if (-not (Test-Path "frontend")) {
    Write-Host "[ERROR] Frontend directory not found" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

# Step 1: Check dependencies
Write-Host "[1/6] Checking dependencies..." -ForegroundColor Yellow
Write-Host ""

try {
    $uvVer = uv --version 2>&1
    Write-Host "[OK] uv: $uvVer" -ForegroundColor Green
} catch {
    Write-Host "[ERROR] uv not found" -ForegroundColor Red
    Write-Host "Install: pip install uv"
    Write-Host "Or visit: https://github.com/astral-sh/uv"
    Read-Host "Press Enter to exit"
    exit 1
}

try {
    $nodeVer = node --version 2>&1
    Write-Host "[OK] Node.js: $nodeVer" -ForegroundColor Green
} catch {
    Write-Host "[ERROR] Node.js not found" -ForegroundColor Red
    Write-Host "Download: https://nodejs.org/"
    Read-Host "Press Enter to exit"
    exit 1
}

try {
    $npmVer = npm --version 2>&1
    Write-Host "[OK] npm: v$npmVer" -ForegroundColor Green
} catch {
    Write-Host "[ERROR] npm not found" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host ""

# Step 2: Check RAG model
Write-Host "[2/6] Checking RAG model..." -ForegroundColor Yellow
Write-Host ""

if (-not (Test-Path "all-MiniLM-L6-v2")) {
    Write-Host "[ERROR] Model directory not found: all-MiniLM-L6-v2" -ForegroundColor Red
    Write-Host ""
    Write-Host "Please download the model:"
    Write-Host "1. Visit: https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2"
    Write-Host "2. Download all files to all-MiniLM-L6-v2 folder"
    Write-Host ""
    Read-Host "Press Enter to exit"
    exit 1
}

$modelFiles = @("config.json", "model.safetensors", "tokenizer.json", "modules.json")
$missing = @()
foreach ($file in $modelFiles) {
    if (-not (Test-Path "all-MiniLM-L6-v2\$file")) {
        $missing += $file
    }
}

if ($missing.Count -gt 0) {
    Write-Host "[ERROR] Model files incomplete:" -ForegroundColor Red
    foreach ($file in $missing) {
        Write-Host "  - $file"
    }
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host "[OK] RAG model complete" -ForegroundColor Green

if (Test-Path "backend\services\simple_rag_engine.py") {
    Write-Host "[OK] RAG engine exists" -ForegroundColor Green
} else {
    Write-Host "[ERROR] RAG engine not found" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host ""

# Step 3: Check backend dependencies
Write-Host "[3/6] Checking backend dependencies..." -ForegroundColor Yellow
Write-Host ""

Set-Location backend

if (-not (Test-Path "requirements.txt")) {
    Write-Host "[ERROR] requirements.txt not found" -ForegroundColor Red
    Set-Location ..
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host "Syncing backend dependencies with uv..."
uv pip install -r requirements.txt --quiet
if ($LASTEXITCODE -ne 0) {
    Write-Host "[WARN] uv pip install may have issues, trying verbose..." -ForegroundColor Yellow
    uv pip install -r requirements.txt
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[ERROR] Backend dependencies installation failed" -ForegroundColor Red
        Set-Location ..
        Read-Host "Press Enter to exit"
        exit 1
    }
}

Write-Host "[OK] Backend dependencies ready" -ForegroundColor Green
Set-Location ..
Write-Host ""

# Step 4: Check frontend dependencies
Write-Host "[4/6] Checking frontend dependencies..." -ForegroundColor Yellow
Write-Host ""

Set-Location frontend

if (-not (Test-Path "package.json")) {
    Write-Host "[ERROR] package.json not found" -ForegroundColor Red
    Set-Location ..
    Read-Host "Press Enter to exit"
    exit 1
}

if (-not (Test-Path "node_modules")) {
    Write-Host "First run, installing frontend dependencies..."
    npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[ERROR] Frontend dependencies installation failed" -ForegroundColor Red
        Set-Location ..
        Read-Host "Press Enter to exit"
        exit 1
    }
} else {
    Write-Host "[OK] Frontend dependencies exist" -ForegroundColor Green
}

Write-Host "[OK] Frontend dependencies ready" -ForegroundColor Green
Set-Location ..
Write-Host ""

# Step 5: System integrity check
Write-Host "[5/6] System integrity check..." -ForegroundColor Yellow
Write-Host ""

if (Test-Path "backend\services\rag_prediction_service.py") {
    Write-Host "[OK] RAG prediction service exists" -ForegroundColor Green
} else {
    Write-Host "[ERROR] RAG prediction service missing" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

if (Test-Path "backend\services\pareto_analyzer.py") {
    Write-Host "[OK] Pareto analyzer exists" -ForegroundColor Green
} else {
    Write-Host "[WARN] Pareto analyzer missing (optional)" -ForegroundColor Yellow
}

if (Test-Path "frontend\lib\api.ts") {
    Write-Host "[OK] Frontend API client exists" -ForegroundColor Green
} else {
    Write-Host "[ERROR] Frontend API client missing" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

if (Test-Path "backend\main.py") {
    Write-Host "[OK] Backend entry point exists" -ForegroundColor Green
} else {
    Write-Host "[ERROR] Backend entry point missing" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

if (Test-Path ".env") {
    Write-Host "[OK] Environment file configured" -ForegroundColor Green
} else {
    Write-Host "[WARN] .env file not found" -ForegroundColor Yellow
    Write-Host "  Suggestion: Copy .env.example to .env and configure API keys"
    Write-Host "  Command: Copy-Item .env.example .env"
}

Write-Host "[OK] System integrity check passed" -ForegroundColor Green
Write-Host ""

# Step 6: Start services
Write-Host "[6/6] Starting services..." -ForegroundColor Yellow
Write-Host ""

# Set environment variables
$env:SENTENCE_TRANSFORMERS_HOME = "$ScriptDir\all-MiniLM-L6-v2"
$env:TRANSFORMERS_OFFLINE = "1"
$env:HF_DATASETS_OFFLINE = "1"

# Start backend
Write-Host "Starting backend service (http://localhost:8000)..."
Set-Location backend

$backendJob = Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "uv run uvicorn main:app --reload --port 8000 > ..\Logs\backend.log 2>&1" -WindowStyle Minimized -PassThru

Write-Host "[OK] Backend started (PID: $($backendJob.Id))" -ForegroundColor Green
Write-Host "  Log file: Logs\backend.log" -ForegroundColor Cyan
Set-Location ..

# Wait for backend
Write-Host "Waiting for backend to start..."
Start-Sleep -Seconds 5

# Start frontend
Write-Host ""
Write-Host "Starting frontend service (http://localhost:3000)..."
Set-Location frontend

$frontendJob = Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "npm run dev > ..\Logs\frontend.log 2>&1" -WindowStyle Minimized -PassThru

Write-Host "[OK] Frontend started (PID: $($frontendJob.Id))" -ForegroundColor Green
Write-Host "  Log file: Logs\frontend.log" -ForegroundColor Cyan
Set-Location ..

# Wait for frontend
Start-Sleep -Seconds 3

Write-Host ""
Write-Host "========================================"
Write-Host "[OK] All services started successfully" -ForegroundColor Green
Write-Host "========================================"
Write-Host ""
Write-Host "Access URLs:" -ForegroundColor Cyan
Write-Host "  Backend API:  http://localhost:8000"
Write-Host "  API Docs:     http://localhost:8000/docs"
Write-Host "  Frontend App: http://localhost:3000"
Write-Host ""
Write-Host "Log files:" -ForegroundColor Cyan
Write-Host "  Backend:  Logs\backend.log"
Write-Host "  Frontend: Logs\frontend.log"
Write-Host ""
Write-Host "Storage:" -ForegroundColor Cyan
Write-Host "  Uploads:  storage\uploads\"
Write-Host "  Results:  storage\results\"
Write-Host "  Logs:     storage\logs\"
Write-Host ""
Write-Host "RAG Model:" -ForegroundColor Cyan
Write-Host "  Path:     all-MiniLM-L6-v2\"
Write-Host "  Mode:     Local (offline)"
Write-Host ""
Write-Host "========================================"
Write-Host "Tips:" -ForegroundColor Cyan
Write-Host "  - Services running in background (minimized)"
Write-Host "  - To stop: Run .\stop_all.ps1"
Write-Host "  - Or use Task Manager to end processes"
Write-Host "  - Backend PID: $($backendJob.Id)"
Write-Host "  - Frontend PID: $($frontendJob.Id)"
Write-Host "========================================"
Write-Host ""

$openBrowser = Read-Host "Open in browser? (Y/N)"
if ($openBrowser -eq "Y" -or $openBrowser -eq "y") {
    Write-Host "Opening browser..."
    Start-Sleep -Seconds 2
    Start-Process "http://localhost:3000"
}

Write-Host ""
Write-Host "Press Enter to exit (services will continue running)..."
Read-Host
