@echo off
chcp 65001 >nul
title EGY-SCOUT V9.0 Pro Studio Launcher
echo ====================================================================
echo   EGY-SCOUT V9.0 Pro Studio — One-Click Launcher
echo   Starting AI Backend (Port 8080) + Tactical Studio UI (Port 3000)
echo ====================================================================
echo.

cd /d "%~dp0"
set "EGY_SCOUT_DATA_DIR=D:\egy-scout-data"
set "HF_HOME=%~dp0.cache\hf"
set "NEXT_PUBLIC_API_URL=http://127.0.0.1:8080"

echo [1/3] Launching FastAPI Backend on http://127.0.0.1:8080 ...
start "EGY-SCOUT Backend (8080)" cmd /k "cd /d %~dp0 && set EGY_SCOUT_DATA_DIR=D:\egy-scout-data && D:\manger\egy-tactical-scout\backend\venv\Scripts\python.exe -m uvicorn apps.api.main:app --host 127.0.0.1 --port 8080"

echo [2/3] Launching Next.js Tactical Studio on http://127.0.0.1:3000 ...
start "EGY-SCOUT Frontend (3000)" cmd /k "cd /d %~dp0apps\web && set NEXT_PUBLIC_API_URL=http://127.0.0.1:8080 && npm run start -- -p 3000 -H 127.0.0.1"

echo [3/3] Waiting for /api/health to become ready ...
powershell -NoProfile -Command "$ok=$false; for($i=0;$i -lt 30;$i++){ try { $r=Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8080/api/health' -TimeoutSec 2; if($r.StatusCode -eq 200){ $ok=$true; break } } catch {}; Start-Sleep -Milliseconds 700 }; if($ok){ Write-Host 'Backend is ONLINE!' -ForegroundColor Green } else { Write-Host 'Still warming up...' -ForegroundColor Yellow }"

timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:3000"
echo.
echo EGY-SCOUT V9.0 Pro Studio opened in your browser at http://127.0.0.1:3000
echo Keep the two background windows open while using the app.
pause
