@echo off
chcp 65001 >nul
title EGY-SCOUT Coach Pro Launcher
echo ====================================================================
echo   EGY-SCOUT Coach Pro - Head Coach, Training, Director & Admin
echo   Starting Backend API (Port 8080) + Coach Pro UI (Port 3000/coach)
echo ====================================================================
echo.

cd /d "%~dp0"
set "EGY_SCOUT_DATA_DIR=D:\egy-scout-data"
set "NEXT_PUBLIC_API_URL=http://127.0.0.1:8080"

set "PY_EXE=%~dp0egy-tactical-scout\backend\venv\Scripts\python.exe"
if exist "%PY_EXE%" goto :py_ready
set "PY_EXE=%~dp0.venv\Scripts\python.exe"
if exist "%PY_EXE%" goto :py_ready

echo [ERROR] Python virtualenv not found. Run start_egy_scout.bat once to bootstrap.
pause
exit /b 1

:py_ready
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

powershell -NoProfile -Command "foreach($p in @(8080,3000)){ Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue | ForEach-Object { $proc=Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue; if($proc -and ($proc.ProcessName -match '^(node|python|python3|uvicorn)$')){ Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue } } }"

echo [1/3] Launching EGY-SCOUT Coach Pro API on http://127.0.0.1:8080 ...
start "EGY-SCOUT Coach Pro API (8080)" /min cmd /k "cd /d %~dp0 && set EGY_SCOUT_DATA_DIR=D:\egy-scout-data && "%PY_EXE%" -m uvicorn apps.coach_api.main:app --host 127.0.0.1 --port 8080"

echo [2/3] Launching Coach Pro Web UI on http://127.0.0.1:3000/coach ...
start "EGY-SCOUT Coach Pro UI (3000)" /min cmd /k "cd /d %~dp0\apps\web && set NEXT_PUBLIC_API_URL=http://127.0.0.1:8080 && npm run start -- -p 3000 -H 127.0.0.1"

echo [3/3] Waiting for servers...
timeout /t 4 /nobreak >nul
start http://127.0.0.1:3000/coach
echo Coach Pro opened at http://127.0.0.1:3000/coach
exit /b 0
