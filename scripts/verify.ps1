$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot

$VenvPy = Join-Path $RepoRoot "egy-tactical-scout\backend\venv\Scripts\python.exe"
$AltPy = Join-Path $RepoRoot ".venv\Scripts\python.exe"
if (Test-Path $VenvPy) {
    $PythonExe = $VenvPy
} elseif (Test-Path $AltPy) {
    $PythonExe = $AltPy
} else {
    throw "Python virtualenv not found at $VenvPy or $AltPy"
}

Write-Host "[1/4] Python compileall..." -ForegroundColor Cyan
& $PythonExe -m compileall -q packages services tools apps/api tests
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "[2/4] Python unit & integration tests..." -ForegroundColor Cyan
& $PythonExe -m unittest discover -s tests -p "test_*.py" -v
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$WebDir = Join-Path $RepoRoot "apps\web"
Set-Location $WebDir

Write-Host "[3/4] TypeScript typecheck (tsc --noEmit)..." -ForegroundColor Cyan
& npx.cmd tsc --noEmit
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "[4/4] Next.js production build (npm run build)..." -ForegroundColor Cyan
$env:NEXT_PUBLIC_API_URL = "http://127.0.0.1:8080"
& npm.cmd run build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "ALL CHECKS PASSED." -ForegroundColor Green
exit 0
