# Multi-Objective Prediction System - PowerShell Stop Script

Write-Host ""
Write-Host "========================================"
Write-Host "Multi-Objective Prediction System - Stop"
Write-Host "========================================"
Write-Host ""

# Find and stop backend process (uv run uvicorn on port 8000)
Write-Host "Finding backend process..."
$backendStopped = $false

# Method 1: Find by port
try {
    $connections = Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue
    if ($connections) {
        foreach ($conn in $connections) {
            $process = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
            if ($process -and ($process.ProcessName -eq "python" -or $process.ProcessName -eq "uv")) {
                Write-Host "Found backend process (PID: $($process.Id), Port: 8000)"
                Stop-Process -Id $process.Id -Force
                Write-Host "[OK] Backend service stopped" -ForegroundColor Green
                $backendStopped = $true
            }
        }
    }
} catch {
    # If Get-NetTCPConnection not available, use netstat
    $netstatOutput = netstat -ano | Select-String ":8000.*LISTENING"
    if ($netstatOutput) {
        foreach ($line in $netstatOutput) {
            $pid = ($line -split '\s+')[-1]
            $process = Get-Process -Id $pid -ErrorAction SilentlyContinue
            if ($process -and ($process.ProcessName -eq "python" -or $process.ProcessName -eq "uv")) {
                Write-Host "Found backend process (PID: $pid, Port: 8000)"
                Stop-Process -Id $pid -Force
                Write-Host "[OK] Backend service stopped" -ForegroundColor Green
                $backendStopped = $true
            }
        }
    }
}

# Method 2: Find all uvicorn processes (both uv and python)
if (-not $backendStopped) {
    # Check uv processes
    $uvProcesses = Get-Process uv -ErrorAction SilentlyContinue
    foreach ($proc in $uvProcesses) {
        $cmdLine = (Get-WmiObject Win32_Process -Filter "ProcessId = $($proc.Id)").CommandLine
        if ($cmdLine -like "*uvicorn*main:app*") {
            Write-Host "Found backend process (PID: $($proc.Id))"
            Stop-Process -Id $proc.Id -Force
            Write-Host "[OK] Backend service stopped" -ForegroundColor Green
            $backendStopped = $true
        }
    }

    # Check python processes
    $pythonProcesses = Get-Process python -ErrorAction SilentlyContinue
    foreach ($proc in $pythonProcesses) {
        $cmdLine = (Get-WmiObject Win32_Process -Filter "ProcessId = $($proc.Id)").CommandLine
        if ($cmdLine -like "*uvicorn*main:app*") {
            Write-Host "Found backend process (PID: $($proc.Id))"
            Stop-Process -Id $proc.Id -Force
            Write-Host "[OK] Backend service stopped" -ForegroundColor Green
            $backendStopped = $true
        }
    }
}

if (-not $backendStopped) {
    Write-Host "[WARN] No running backend service found" -ForegroundColor Yellow
}

Write-Host ""

# Find and stop frontend process (Node.js on port 3000)
Write-Host "Finding frontend process..."
$frontendStopped = $false

# Method 1: Find by port
try {
    $connections = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
    if ($connections) {
        foreach ($conn in $connections) {
            $process = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
            if ($process -and $process.ProcessName -eq "node") {
                Write-Host "Found frontend process (PID: $($process.Id), Port: 3000)"
                Stop-Process -Id $process.Id -Force
                Write-Host "[OK] Frontend service stopped" -ForegroundColor Green
                $frontendStopped = $true
            }
        }
    }
} catch {
    # If Get-NetTCPConnection not available, use netstat
    $netstatOutput = netstat -ano | Select-String ":3000.*LISTENING"
    if ($netstatOutput) {
        foreach ($line in $netstatOutput) {
            $pid = ($line -split '\s+')[-1]
            $process = Get-Process -Id $pid -ErrorAction SilentlyContinue
            if ($process -and $process.ProcessName -eq "node") {
                Write-Host "Found frontend process (PID: $pid, Port: 3000)"
                Stop-Process -Id $pid -Force
                Write-Host "[OK] Frontend service stopped" -ForegroundColor Green
                $frontendStopped = $true
            }
        }
    }
}

# Method 2: Find all Next.js processes
if (-not $frontendStopped) {
    $nodeProcesses = Get-Process node -ErrorAction SilentlyContinue
    foreach ($proc in $nodeProcesses) {
        $cmdLine = (Get-WmiObject Win32_Process -Filter "ProcessId = $($proc.Id)").CommandLine
        if ($cmdLine -like "*next*dev*" -or $cmdLine -like "*npm*run*dev*") {
            Write-Host "Found frontend process (PID: $($proc.Id))"
            Stop-Process -Id $proc.Id -Force
            Write-Host "[OK] Frontend service stopped" -ForegroundColor Green
            $frontendStopped = $true
        }
    }
}

if (-not $frontendStopped) {
    Write-Host "[WARN] No running frontend service found" -ForegroundColor Yellow
}

Write-Host ""

# Clean up residual processes
Write-Host "Checking for residual processes..."
$cleaned = $false

# Clean up possible Next.js child processes
$nextProcesses = Get-Process | Where-Object { $_.ProcessName -eq "node" -and $_.MainWindowTitle -like "*next*" }
if ($nextProcesses) {
    foreach ($proc in $nextProcesses) {
        Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
        $cleaned = $true
    }
}

if ($cleaned) {
    Write-Host "[OK] Cleaned residual processes" -ForegroundColor Green
} else {
    Write-Host "[OK] No residual processes" -ForegroundColor Green
}

Write-Host ""
Write-Host "========================================"
Write-Host "[OK] Service stop complete" -ForegroundColor Green
Write-Host "========================================"
Write-Host ""
Write-Host "Tips:" -ForegroundColor Cyan
Write-Host "  - If services not fully stopped, use Task Manager"
Write-Host "  - Related processes: uv.exe, python.exe, node.exe"
Write-Host ""

Read-Host "Press Enter to exit"
