param(
    [switch]$SkipCloudflare,
    [switch]$SkipFirewall
)

$ErrorActionPreference = "Stop"
$ProjectDir = Split-Path -Parent $PSScriptRoot

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "   HRMS - Server Setup for Internet" -ForegroundColor Cyan
Write-Host "   Auto-deploy + Cloudflare Tunnel" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# ── [1/6] Check Node.js ──────────────────────────────────────────
Write-Host "[1/6] Checking Node.js..." -ForegroundColor Yellow
$nodeVersion = node --version 2>$null
if (-not $nodeVersion) {
    Write-Host "  Node.js not found. Install from https://nodejs.org" -ForegroundColor Red
    exit 1
}
Write-Host "  $nodeVersion detected" -ForegroundColor Green

# ── [2/6] Install global packages ────────────────────────────────
Write-Host "[2/6] Installing global packages (pm2, cloudflared)..." -ForegroundColor Yellow

# PM2 - process manager
Write-Host "  Installing pm2..." -ForegroundColor DarkGray
npm install -g pm2 2>&1 | Out-Null
pm2 install pm2-windows-startup 2>&1 | Out-Null
pm2-startup install 2>&1 | Out-Null
Write-Host "  pm2 installed + auto-start on boot configured" -ForegroundColor Green

# Cloudflare Tunnel - free secure tunnel (no port forwarding needed)
if (-not $SkipCloudflare) {
    Write-Host "  Checking cloudflared..." -ForegroundColor DarkGray
    $cloudflared = Get-Command cloudflared -ErrorAction SilentlyContinue
    if (-not $cloudflared) {
        Write-Host "  Downloading cloudflared..." -ForegroundColor Yellow
        $cfUrl = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"
        $cfPath = Join-Path $env:USERPROFILE "cloudflared.exe"
        try {
            Invoke-WebRequest -Uri $cfUrl -OutFile $cfPath -UseBasicParsing
            # Add to PATH for current session
            $env:Path = "$env:USERPROFILE;$env:Path"
            Write-Host "  cloudflared downloaded to $cfPath" -ForegroundColor Green
        } catch {
            Write-Host "  Failed to download cloudflared. Install manually from:" -ForegroundColor Yellow
            Write-Host "  https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/" -ForegroundColor Yellow
            $SkipCloudflare = $true
        }
    } else {
        Write-Host "  cloudflared found" -ForegroundColor Green
    }
}

# ── [3/6] Install project dependencies ───────────────────────────
Write-Host "[3/6] Installing project dependencies..." -ForegroundColor Yellow
Set-Location $ProjectDir
npm install --production 2>&1 | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
Write-Host "  Dependencies installed" -ForegroundColor Green

# ── [4/6] Create logs directory ──────────────────────────────────
Write-Host "[4/6] Creating directories..." -ForegroundColor Yellow
$logDir = Join-Path $ProjectDir "logs"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
Write-Host "  Ready" -ForegroundColor Green

# ── [5/6] Start HRMS with pm2 ───────────────────────────────────
Write-Host "[5/6] Starting HRMS with pm2..." -ForegroundColor Yellow
$ecosystemPath = Join-Path $ProjectDir "ecosystem.config.js"
pm2 delete hrms 2>&1 | Out-Null
pm2 start $ecosystemPath 2>&1 | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
pm2 save 2>&1 | Out-Null
Write-Host "  HRMS started on port 3000" -ForegroundColor Green

# ── [6/6] Start webhook server ───────────────────────────────────
Write-Host "[6/6] Starting webhook server..." -ForegroundColor Yellow
$webhookPath = Join-Path $ProjectDir "deploy\webhook-server.js"
pm2 delete hrms-webhook 2>&1 | Out-Null
pm2 start $webhookPath --name hrms-webhook --cwd $ProjectDir 2>&1 | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
pm2 save 2>&1 | Out-Null
Write-Host "  Webhook server started on port 9000" -ForegroundColor Green

# ── Firewall rule ────────────────────────────────────────────────
if (-not $SkipFirewall) {
    Write-Host ""
    Write-Host "Configuring Windows Firewall..." -ForegroundColor Yellow
    try {
        New-NetFirewallRule -DisplayName "HRMS - HTTP" -Direction Inbound -LocalPort 3000 -Protocol TCP -Action Allow -ErrorAction SilentlyContinue | Out-Null
        New-NetFirewallRule -DisplayName "HRMS - Webhook" -Direction Inbound -LocalPort 9000 -Protocol TCP -Action Allow -ErrorAction SilentlyContinue | Out-Null
        Write-Host "  Firewall rules added (ports 3000, 9000)" -ForegroundColor Green
    } catch {
        Write-Host "  Could not add firewall rules (run as Administrator)" -ForegroundColor Yellow
    }
}

# ── Start Cloudflare Tunnel ──────────────────────────────────────
if (-not $SkipCloudflare) {
    Write-Host ""
    Write-Host "Starting Cloudflare Tunnel (free internet access)..." -ForegroundColor Yellow
    Write-Host "  This gives you a public URL like: https://random-name.trycloudflare.com" -ForegroundColor DarkGray
    Write-Host "  No port forwarding or domain needed!" -ForegroundColor DarkGray

    # Start tunnel as pm2 process (auto-restart)
    pm2 delete hrms-tunnel 2>&1 | Out-Null
    pm2 start cloudflared --name hrms-tunnel -- tunnel --url http://localhost:3000 2>&1 | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
    pm2 save 2>&1 | Out-Null

    Write-Host "  Tunnel starting... URL will appear in logs." -ForegroundColor Green
    Write-Host "  Check URL with: pm2 logs hrms-tunnel" -ForegroundColor Cyan
}

# ── Summary ──────────────────────────────────────────────────────
Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "   SERVER SETUP COMPLETE!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "  HRMS:           http://localhost:3000" -ForegroundColor White
Write-Host "  Webhook:        http://localhost:9000/deploy" -ForegroundColor White
Write-Host ""
Write-Host "  Process manager: pm2 (auto-restart + boot)" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Commands:" -ForegroundColor Yellow
Write-Host "    pm2 status              - check running processes" -ForegroundColor White
Write-Host "    pm2 logs hrms           - view HRMS logs" -ForegroundColor White
Write-Host "    pm2 logs hrms-tunnel    - get your public URL" -ForegroundColor White
Write-Host "    pm2 logs hrms-webhook   - view webhook activity" -ForegroundColor White
Write-Host "    pm2 restart hrms        - restart HRMS" -ForegroundColor White
Write-Host ""
if (-not $SkipCloudflare) {
    Write-Host "  To get your public URL, run:" -ForegroundColor Cyan
    Write-Host "    pm2 logs hrms-tunnel --lines 20" -ForegroundColor White
    Write-Host "  Look for: https://xxxxx.trycloudflare.com" -ForegroundColor White
}
Write-Host ""
Write-Host "  NEXT STEP: Set up GitHub (see DEPLOY-GUIDE.md)" -ForegroundColor Yellow
Write-Host ""
