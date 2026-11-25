@echo off
chcp 65001 >nul
title EGY-SCOUT Pro Studio Launcher
echo ====================================================================
echo   EGY-SCOUT Pro Studio - One-Click Launcher
echo   Starting API (Port 8080) + Tactical Studio UI (Port 3000)
echo ====================================================================
echo.

cd /d "%~dp0"
set "EGY_SCOUT_DATA_DIR=D:\egy-scout-data"
set "HF_HOME=%~dp0.cache\hf"
set "NEXT_PUBLIC_API_URL=http://127.0.0.1:8080"

REM 1. Locate or bootstrap Python virtualenv
set "PY_EXE=%~dp0egy-tactical-scout\backend\venv\Scripts\python.exe"
if exist "%PY_EXE%" goto :py_ready

set "PY_EXE=%~dp0.venv\Scripts\python.exe"
if exist "%PY_EXE%" goto :py_ready

echo [INFO] Creating local Python virtual environment (.venv)...
where py >nul 2>&1
if %errorlevel%==0 (
    py -3 -m venv "%~dp0.venv"
) else (
    where python >nul 2>&1
    if %errorlevel% neq 0 (
        echo [ERROR] Python 3 not found. Please install Python 3.11+ from https://www.python.org/downloads/
        pause
        exit /b 1
    )
    python -m venv "%~dp0.venv"
)
if %errorlevel% neq 0 (
    echo [ERROR] Failed to create Python virtual environment.
    pause
    exit /b 1
)
echo [INFO] Installing backend requirements...
"%PY_EXE%" -m pip install -r "%~dp0apps\api\requirements.txt"
if %errorlevel% neq 0 (
    echo [ERROR] Failed to install Python dependencies.
    pause
    exit /b 1
)

:py_ready
REM 2. Check Node.js availability
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js not found. Please install Node.js LTS from https://nodejs.org/
    pause
    exit /b 1
)

REM 3. Ensure frontend dependencies exist
if not exist "%~dp0apps\web\node_modules" (
    echo [INFO] Installing frontend dependencies (npm install)...
    pushd "%~dp0apps\web"
    call npm install
    if %errorlevel% neq 0 (
        popd
        echo [ERROR] npm install failed.
        pause
        exit /b 1
    )
    popd
)

REM 4. Build frontend if BUILD_ID is missing or any source file in src/ is newer than BUILD_ID
powershell -NoProfile -Command "$bid='%~dp0apps\web\.next\BUILD_ID'; $src='%~dp0apps\web\src'; if(-not (Test-Path $bid)){ exit 1 }; $bt=(Get-Item $bid).LastWriteTimeUtc; $newer=Get-ChildItem $src -Recurse -File | Where-Object { $_.LastWriteTimeUtc -gt $bt } | Select-Object -First 1; if($newer){ exit 1 }; exit 0"
if %errorlevel% neq 0 (
    echo [INFO] Building frontend production bundle...
    pushd "%~dp0apps\web"
    call npm run build
    if %errorlevel% neq 0 (
        popd
        echo [ERROR] Frontend build failed.
        pause
        exit /b 1
    )
    popd
)

REM 5. Free ports 8080 and 3000 if held by stale node/python processes
powershell -NoProfile -Command "foreach($p in @(8080,3000)){ Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue | ForEach-Object { $proc=Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue; if($proc -and ($proc.ProcessName -match '^(node|python|python3|uvicorn)$')){ Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue } } }"

echo [1/3] Launching FastAPI Backend on http://127.0.0.1:8080 ...
start "EGY-SCOUT Backend (8080)" /min cmd /k "cd /d %~dp0 && set EGY_SCOUT_DATA_DIR=D:\egy-scout-data && "%PY_EXE%" -m uvicorn apps.api.main:app --host 127.0.0.1 --port 8080"

echo [2/3] Launching Next.js Tactical Studio on http://127.0.0.1:3000 ...
start "EGY-SCOUT Frontend (3000)" /min cmd /k "cd /d %~dp0apps\web && set NEXT_PUBLIC_API_URL=http://127.0.0.1:8080 && npm run start -- -p 3000 -H 127.0.0.1"

echo [3/3] Waiting for /api/health to become ready (up to 60s)...
powershell -NoProfile -Command "$ok=$false; for($i=0;$i -lt 60;$i++){ try { $r=Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8080/api/health' -TimeoutSec 2; if($r.StatusCode -eq 200){ $ok=$true; break } } catch {}; Start-Sleep -Seconds 1 }; if($ok){ Write-Host 'Backend is ONLINE!' -ForegroundColor Green } else { Write-Host 'Backend still starting...' -ForegroundColor Yellow }"

start "" "http://127.0.0.1:3000"
echo.
echo EGY-SCOUT Pro Studio opened at http://127.0.0.1:3000
echo Keep the two minimized terminal windows open while using the app.
pause
