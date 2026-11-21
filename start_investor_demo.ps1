# One-click local offline Investor Demo launcher (EGY-SCOUT V8 Wave 0)
$ErrorActionPreference = "Stop"

$RepoRoot = if ($PSScriptRoot) { $PSScriptRoot } else { "D:\manger" }
$VenvPython = Join-Path $RepoRoot "egy-tactical-scout\backend\venv\Scripts\python.exe"
if (Test-Path $VenvPython) {
    $PythonExe = $VenvPython
} elseif (Get-Command python -ErrorAction SilentlyContinue) {
    $PythonExe = (Get-Command python).Source
} else {
    throw "Python interpreter not found. Expected venv at $VenvPython or 'python' in PATH."
}

$ApiPort = if ($env:EGY_SCOUT_API_PORT) { [int]$env:EGY_SCOUT_API_PORT } else { 8080 }
$WebPort = if ($env:EGY_SCOUT_WEB_PORT) { [int]$env:EGY_SCOUT_WEB_PORT } else { 3000 }

function Test-PortInUse([int]$Port) {
    $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    return $null -ne $conn
}

if (-not $env:EGY_SCOUT_DATA_DIR) {
    $env:EGY_SCOUT_DATA_DIR = "D:\egy-scout-data"
}

if (Test-PortInUse $ApiPort) {
    Write-Host "[INFO] Port $ApiPort is already listening (reusing existing API server)." -ForegroundColor Yellow
} else {
    Write-Host "[EGY-SCOUT V8] Starting FastAPI Control Plane on http://127.0.0.1:$ApiPort ..." -ForegroundColor Green
    Start-Process -FilePath $PythonExe `
        -ArgumentList "-m", "uvicorn", "apps.api.main:app", "--host", "127.0.0.1", "--port", "$ApiPort" `
        -WorkingDirectory $RepoRoot
}

# Wait up to 15s for API health check
$healthy = $false
for ($i = 0; $i -lt 30; $i++) {
    try {
        $resp = Invoke-RestMethod -Uri "http://127.0.0.1:$ApiPort/api/health" -TimeoutSec 2
        if ($resp.status -eq "ok") { $healthy = $true; break }
    } catch {
        Start-Sleep -Milliseconds 500
    }
}
if (-not $healthy) {
    Write-Warning "API did not respond to /api/health within 15s; continuing startup."
}

$WebDir = Join-Path $RepoRoot "apps\web"
if (-not (Test-Path (Join-Path $WebDir ".next\BUILD_ID"))) {
    Write-Host "[EGY-SCOUT V8] Building Next.js production bundle first..." -ForegroundColor Cyan
    Push-Location $WebDir
    & npm.cmd run build
    Pop-Location
}

if (Test-PortInUse $WebPort) {
    Write-Host "[INFO] Port $WebPort is already listening (reusing existing Web server)." -ForegroundColor Yellow
} else {
    Write-Host "[EGY-SCOUT V8] Starting Next.js Investor Studio on http://127.0.0.1:$WebPort ..." -ForegroundColor Cyan
    $env:NEXT_PUBLIC_API_URL = "http://127.0.0.1:$ApiPort"
    Start-Process -FilePath "npm.cmd" `
        -ArgumentList "run", "start", "--", "-p", "$WebPort", "-H", "127.0.0.1" `
        -WorkingDirectory $WebDir
    Start-Sleep -Seconds 3
}

Start-Process "http://127.0.0.1:$WebPort"
Write-Host "[READY] Investor MVP is live at http://127.0.0.1:$WebPort (API Docs: http://127.0.0.1:$ApiPort/docs)" -ForegroundColor Yellow
