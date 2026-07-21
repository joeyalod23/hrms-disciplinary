param(
    [string]$InstallPath = (Join-Path $env:USERPROFILE "HRMS"),
    [switch]$NoNodeCheck,
    [switch]$NoNpmInstall,
    [switch]$NoMigrate
)

$ErrorActionPreference = "Stop"
$Host.UI.RawUI.WindowTitle = "HRMS - System Setup"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "   HRMS - Human Resource Management System" -ForegroundColor Cyan
Write-Host "   Setup Script v2.1.0" -ForegroundColor Cyan
Write-Host "   Leave Management | Contracts | Monitoring" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# ── [1/5] Check Node.js ──────────────────────────────────────────
if (-not $NoNodeCheck) {
    Write-Host "[1/5] Checking prerequisites..." -ForegroundColor Yellow
    $nodeVersion = node --version 2>$null
    if (-not $nodeVersion) {
        Write-Host "  Node.js is not installed. Downloading..." -ForegroundColor Yellow
        $nodeUrl = "https://nodejs.org/dist/v22.14.0/node-v22.14.0-x64.msi"
        $msiPath = "$env:TEMP\node-install.msi"
        try {
            Invoke-WebRequest -Uri $nodeUrl -OutFile $msiPath -UseBasicParsing
            Write-Host "  Running Node.js installer (silent)..." -ForegroundColor Yellow
            Start-Process msiexec.exe -Wait -ArgumentList "/i `"$msiPath`" /quiet"
            Remove-Item $msiPath -Force
            $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
        } catch {
            Write-Host "  Failed to download/install Node.js." -ForegroundColor Red
            Write-Host "  Please install manually from https://nodejs.org" -ForegroundColor Red
            exit 1
        }
    }
    $nodeVersion = node --version
    Write-Host "  Node.js $nodeVersion detected" -ForegroundColor Green
} else {
    Write-Host "[1/5] Skipping Node.js check (-NoNodeCheck)" -ForegroundColor DarkGray
}

# ── [2/5] Copy files ─────────────────────────────────────────────
$sourceDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$targetDir = $InstallPath

Write-Host "[2/5] Copying system files to: $targetDir" -ForegroundColor Yellow
if (-not (Test-Path $targetDir)) { New-Item -ItemType Directory -Path $targetDir -Force | Out-Null }

$exclude = @('node_modules', '*.db', '*.db-shm', '*.db-wal', 'deploy', '.git', 'stderr.txt', 'stdout.txt', 'cookies.txt', '*.bat', 'package-lock.json')
Get-ChildItem -Path $sourceDir -Exclude $exclude | ForEach-Object {
    Copy-Item -Path $_.FullName -Destination $targetDir -Recurse -Force
}
Write-Host "  Files copied" -ForegroundColor Green

# ── [3/5] Create directories ─────────────────────────────────────
Write-Host "[3/5] Creating required directories..." -ForegroundColor Yellow
$dirs = @(
    (Join-Path $targetDir "uploads"),
    (Join-Path $targetDir "uploads\leave_docs"),
    (Join-Path $targetDir "public\uploads"),
    (Join-Path $targetDir "public\uploads\leave_docs"),
    (Join-Path $targetDir "backups"),
    (Join-Path $targetDir "db")
)
foreach ($d in $dirs) {
    if (-not (Test-Path $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }
}
Write-Host "  Directories created" -ForegroundColor Green

# ── [4/5] Install dependencies ───────────────────────────────────
if (-not $NoNpmInstall) {
    Write-Host "[4/5] Installing dependencies (npm install)..." -ForegroundColor Yellow
    Set-Location $targetDir
    npm install --production 2>&1 | ForEach-Object { Write-Host "  $_" }
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  npm install failed. Try manually: cd `"$targetDir`" && npm install" -ForegroundColor Red
        exit 1
    }
    Write-Host "  Dependencies installed" -ForegroundColor Green
} else {
    Write-Host "[4/5] Skipping npm install (-NoNpmInstall)" -ForegroundColor DarkGray
}

# ── [5/5] Migrate database ───────────────────────────────────────
if (-not $NoMigrate) {
    Write-Host "[5/5] Migrating database (seeding default data)..." -ForegroundColor Yellow
    Set-Location $targetDir
    $migrateScript = @"
const { getDB, initializeDatabase } = require('./db/schema');
const db = getDB();
initializeDatabase();
// Update VL to unlimited (days_per_year = 0)
db.prepare("UPDATE leave_types SET days_per_year = 0 WHERE code = 'VL'").run();
// Initialize leave balances for all active employees
const year = new Date().getFullYear();
const types = db.prepare('SELECT id, days_per_year FROM leave_types WHERE is_active = 1').all();
const employees = db.prepare("SELECT id FROM employees WHERE status = 'Active'").all();
let created = 0;
const tx = db.transaction(() => {
  for (const emp of employees) {
    for (const lt of types) {
      if (lt.days_per_year > 0) {
        const r = db.prepare('INSERT INTO leave_balances (employee_id, leave_type_id, year, total_days, used_days, pending_days) VALUES (?, ?, ?, ?, 0, 0) ON CONFLICT(employee_id, leave_type_id, year) DO NOTHING').run(emp.id, lt.id, year, lt.days_per_year);
        created += r.changes;
      }
    }
  }
});
tx();
console.log('Migration complete: ' + created + ' leave balance records created');
console.log('Tables: ' + db.prepare("SELECT COUNT(*) as c FROM sqlite_master WHERE type='table'").get().c);
console.log('Leave types: ' + db.prepare('SELECT COUNT(*) as c FROM leave_types').get().c);
console.log('Employees: ' + db.prepare("SELECT COUNT(*) as c FROM employees WHERE status = 'Active'").get().c);
"@
    $migrateScript | node - 2>&1 | ForEach-Object { Write-Host "  $_" }
    Write-Host "  Database migrated" -ForegroundColor Green
} else {
    Write-Host "[5/5] Skipping migration (-NoMigrate)" -ForegroundColor DarkGray
}

# ── Create start.bat ─────────────────────────────────────────────
$startBat = Join-Path $targetDir "start.bat"
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
echo Press Ctrl+C to stop the server.
echo.
node server.js
pause
"@ | Set-Content -Path $startBat -Encoding ASCII

# ── Create desktop shortcut ──────────────────────────────────────
Write-Host ""
Write-Host "Creating desktop shortcut..." -ForegroundColor Yellow
$shortcutPath = "$env:USERPROFILE\Desktop\HRMS.lnk"
try {
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = $startBat
    $shortcut.WorkingDirectory = $targetDir
    $shortcut.Description = "HRMS v2.1.0 - Human Resource Management System"
    $shortcut.IconLocation = "shell32.dll,1"
    $shortcut.Save()
    Write-Host "  Desktop shortcut created" -ForegroundColor Green
} catch {
    Write-Host "  Could not create shortcut (non-critical)" -ForegroundColor DarkGray
}

# ── Summary ──────────────────────────────────────────────────────
Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "   SETUP COMPLETE!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Version:           v2.1.0" -ForegroundColor White
Write-Host "  Installation path: $targetDir" -ForegroundColor White
Write-Host "  Start script:      $startBat" -ForegroundColor White
Write-Host ""
Write-Host "  Features included:" -ForegroundColor Cyan
Write-Host "    - Employee Management (97+ employees)" -ForegroundColor Cyan
Write-Host "    - Attendance Records (biometric import, manual, CSV export)" -ForegroundColor Cyan
Write-Host "    - Leave Management (VL/SL/EL/BL/SIL, approvals, balances)" -ForegroundColor Cyan
Write-Host "    - VL is unlimited (no day cap)" -ForegroundColor Cyan
Write-Host "    - Contract Monitoring (auto-create, expiry, Provisionary)" -ForegroundColor Cyan
Write-Host "    - Disciplinary Cases (NTE, Investigation, Appeals)" -ForegroundColor Cyan
Write-Host "    - SIL Monitoring (accrual, grant, bulk process)" -ForegroundColor Cyan
Write-Host "    - AWOL Detection (3-day consecutive absence flagging)" -ForegroundColor Cyan
Write-Host "    - Leave Reporting (type breakdown, monthly stats)" -ForegroundColor Cyan
Write-Host "    - Manpower Loading & Undertime Calculator" -ForegroundColor Cyan
Write-Host "    - Recruitment & Document Vault" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Default login credentials:" -ForegroundColor Cyan
Write-Host "    Admin : admin   / admin123" -ForegroundColor Cyan
Write-Host "    HR    : hrd     / hrd123" -ForegroundColor Cyan
Write-Host "    Audit : auditor / audit123" -ForegroundColor Cyan
Write-Host ""
Write-Host "  To launch:" -ForegroundColor White
Write-Host "    Double-click 'HRMS' on your Desktop" -ForegroundColor White
Write-Host "    OR run: start.bat" -ForegroundColor White
Write-Host ""
pause
