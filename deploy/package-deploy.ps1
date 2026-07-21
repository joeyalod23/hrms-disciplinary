param(
    [string]$OutputPath = (Join-Path $PSScriptRoot "HRMS-Package.zip")
)

$ErrorActionPreference = "Stop"
$Host.UI.RawUI.WindowTitle = "HRMS - Package Builder"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "   HRMS Deployment Package Builder" -ForegroundColor Cyan
Write-Host "   v2.1.0 - Leave | Contracts | Monitoring" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$sourceDir = Split-Path -Parent $PSScriptRoot
$excludePatterns = @(
    'node_modules', '*.db-shm', '*.db-wal', 'disciplinary.db*',
    '.git', 'deploy', 'stderr.txt', 'stdout.txt',
    'cookies.txt', 'DTR Summary.xls', '*.bat',
    'eng.traineddata', 'lv logo.jpg', 'lv-logo.svg',
    'BY2Y212660153_attlog.dat', 'check-smtp.js',
    'package-lock.json', 'HRMS-Package.zip'
)

$excludePaths = @(
    'public\uploads\vault',
    'public\uploads\leave_docs',
    'scripts\.edge-profile',
    'db\sitevigil.db-shm',
    'db\sitevigil.db-wal',
    'db\disciplinary.db-shm',
    'db\disciplinary.db-wal'
)

Write-Host "Source: $sourceDir" -ForegroundColor Yellow
Write-Host ""

$tempDir = Join-Path $env:TEMP "hrms-deploy-temp"
if (Test-Path $tempDir) { Remove-Item -Path $tempDir -Recurse -Force }
New-Item -ItemType Directory -Path $tempDir -Force | Out-Null

Write-Host "Copying project files (excluding node_modules, .db, etc.)..." -ForegroundColor Yellow

Get-ChildItem -Path $sourceDir -Exclude $excludePatterns | ForEach-Object {
    $dest = Join-Path $tempDir $_.Name
    Copy-Item -Path $_.FullName -Destination $dest -Recurse -Force -ErrorAction SilentlyContinue
    $excludePaths | ForEach-Object {
        $toRemove = Join-Path $tempDir $_
        if (Test-Path $toRemove) { Remove-Item -Path $toRemove -Recurse -Force }
    }
}

# Create required upload directories
$dirs = @(
    (Join-Path $tempDir "uploads"),
    (Join-Path $tempDir "uploads\leave_docs"),
    (Join-Path $tempDir "public\uploads"),
    (Join-Path $tempDir "public\uploads\leave_docs"),
    (Join-Path $tempDir "backups")
)
foreach ($d in $dirs) {
    if (-not (Test-Path $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }
}

$startBat = Join-Path $tempDir "start.bat"
@"
@echo off
title HRMS System - v2.1.0
echo ========================================
echo    HRMS - Human Resource Management System
echo    Version 2.1.0 - Leave | Contracts | Monitoring
echo ========================================
echo.
cd /d "%~dp0"
echo Starting server on http://localhost:3000
echo.
node server.js
pause
"@ | Set-Content -Path $startBat -Encoding ASCII

$setupPs1 = Join-Path $tempDir "setup.ps1"
Copy-Item -Path (Join-Path $PSScriptRoot "setup.ps1") -Destination $setupPs1 -Force

Write-Host "Creating zip package..." -ForegroundColor Yellow

if (Test-Path $OutputPath) { Remove-Item -Path $OutputPath -Force }

Add-Type -AssemblyName System.IO.Compression.FileSystem
$compressionLevel = [System.IO.Compression.CompressionLevel]::Optimal
[System.IO.Compression.ZipFile]::CreateFromDirectory($tempDir, $OutputPath, $compressionLevel, $false)

Remove-Item -Path $tempDir -Recurse -Force

$size = (Get-Item $OutputPath).Length / 1MB
Write-Host ""
Write-Host "Package created successfully!" -ForegroundColor Green
Write-Host "  File: $OutputPath" -ForegroundColor White
Write-Host "  Size: $([Math]::Round($size, 2)) MB" -ForegroundColor White
Write-Host ""
Write-Host "To deploy on another PC:" -ForegroundColor Cyan
Write-Host "  1. Copy HRMS-Package.zip to the target PC" -ForegroundColor Cyan
Write-Host "  2. Extract the zip file" -ForegroundColor Cyan
Write-Host "  3. Right-click setup.ps1 and select 'Run with PowerShell'" -ForegroundColor Cyan
Write-Host "     OR run: powershell -ExecutionPolicy Bypass -File setup.ps1" -ForegroundColor Cyan
Write-Host "  4. Double-click the desktop shortcut or start.bat to launch" -ForegroundColor Cyan
Write-Host ""
Write-Host "Features in this package:" -ForegroundColor Yellow
Write-Host "  - Employee Management (auto-contract creation, Provisionary)" -ForegroundColor Yellow
Write-Host "  - Attendance (biometric import, manual, CSV export, daily trend)" -ForegroundColor Yellow
Write-Host "  - Leave Management (VL unlimited, SL, EL, BL, SIL)" -ForegroundColor Yellow
Write-Host "  - Leave Balances (auto-initialized for all employees)" -ForegroundColor Yellow
Write-Host "  - Contract Monitoring (auto-expire, expiring alerts, clickable cards)" -ForegroundColor Yellow
Write-Host "  - Disciplinary Cases (NTE, Investigation, Appeals, Verdict)" -ForegroundColor Yellow
Write-Host "  - SIL Monitoring (accrual, grant, bulk process)" -ForegroundColor Yellow
Write-Host "  - AWOL Detection (3-day consecutive absence)" -ForegroundColor Yellow
Write-Host "  - Leave Reporting (type breakdown, monthly stats)" -ForegroundColor Yellow
Write-Host "  - Manpower Loading & Undertime Calculator" -ForegroundColor Yellow
Write-Host "  - Recruitment & Document Vault" -ForegroundColor Yellow
Write-Host ""
Write-Host "NOTE: The target PC must have Node.js v18+ installed." -ForegroundColor Yellow
Write-Host "      The setup script auto-installs Node.js if you have internet." -ForegroundColor Yellow
Write-Host ""
pause
