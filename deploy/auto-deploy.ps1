param(
    [string]$ProjectPath = (Split-Path -Parent $PSScriptRoot),
    [switch]$SkipInstall
)

$ErrorActionPreference = "Stop"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "   HRMS - Auto Deploy" -ForegroundColor Cyan
Write-Host "   $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

Set-Location $ProjectPath
Write-Host "Project: $ProjectPath" -ForegroundColor Yellow
Write-Host ""

# Step 1: Pull latest from git
Write-Host "[1/4] Pulling latest changes from git..." -ForegroundColor Yellow
$pullOutput = git pull 2>&1
Write-Host "  $pullOutput" -ForegroundColor DarkGray
if ($LASTEXITCODE -ne 0) {
    Write-Host "  git pull failed!" -ForegroundColor Red
    exit 1
}
Write-Host "  Code updated" -ForegroundColor Green

# Step 2: Install dependencies
if (-not $SkipInstall) {
    Write-Host "[2/4] Installing dependencies..." -ForegroundColor Yellow
    npm install --production 2>&1 | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  npm install failed!" -ForegroundColor Red
        exit 1
    }
    Write-Host "  Dependencies installed" -ForegroundColor Green
} else {
    Write-Host "[2/4] Skipping npm install" -ForegroundColor DarkGray
}

# Step 3: Create logs directory
$logDir = Join-Path $ProjectPath "logs"
if (-not (Test-Path $logDir)) {
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
}

# Step 4: Restart with pm2
Write-Host "[3/4] Restarting HRMS with pm2..." -ForegroundColor Yellow
$ecosystemPath = Join-Path $ProjectPath "ecosystem.config.js"
pm2 restart hrms --update-env 2>&1 | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
if ($LASTEXITCODE -ne 0) {
    Write-Host "  pm2 restart failed, trying start..." -ForegroundColor Yellow
    pm2 start $ecosystemPath 2>&1 | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
    pm2 save 2>&1 | Out-Null
}
Write-Host "  HRMS restarted" -ForegroundColor Green

# Step 5: Verify
Write-Host "[4/4] Verifying server is running..." -ForegroundColor Yellow
Start-Sleep -Seconds 3
try {
    $response = Invoke-WebRequest -Uri "http://localhost:3000" -TimeoutSec 5 -UseBasicParsing -ErrorAction Stop
    Write-Host "  Server responding: HTTP $($response.StatusCode)" -ForegroundColor Green
} catch {
    Write-Host "  Server may still be starting... check http://localhost:3000" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "   DEPLOY COMPLETE!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
