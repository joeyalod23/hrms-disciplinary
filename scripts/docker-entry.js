const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const dataDir = '/app/data';
const dbDir = path.join(dataDir, 'db');
const uploadsDir = path.join(dataDir, 'uploads');
const dbPath = path.join(dbDir, 'sitevigil.db');
const seedPath = '/app/seed/sitevigil.db';
const shmPath = dbPath + '-shm';
const walPath = dbPath + '-wal';

fs.mkdirSync(dbDir, { recursive: true });
fs.mkdirSync(uploadsDir, { recursive: true });

if (!fs.existsSync(dbPath)) {
  fs.copyFileSync(seedPath, dbPath);
  console.log('Seed DB copied: no existing DB found');
} else {
  const stat = fs.statSync(dbPath);
  if (stat.size < 10000) {
    fs.copyFileSync(seedPath, dbPath);
    console.log('Seed DB copied: existing DB too small, likely corrupt');
  } else {
    console.log('Existing DB found, keeping it');
  }
}

try { fs.chmodSync(dbPath, 0o666); } catch {}
try { fs.chownSync(dbPath, 1000, 1000); } catch {}
try { if (fs.existsSync(shmPath)) { fs.chmodSync(shmPath, 0o666); fs.chownSync(shmPath, 1000, 1000); } } catch {}
try { if (fs.existsSync(walPath)) { fs.chmodSync(walPath, 0o666); fs.chownSync(walPath, 1000, 1000); } } catch {}

try {
  const files = fs.readdirSync(dataDir);
  for (const f of files) {
    try { fs.chownSync(path.join(dataDir, f), 1000, 1000); } catch {}
  }
} catch {}

process.env.NODE_ENV = 'production';
process.env.DB_PATH = dbPath;
process.env.UPLOADS_DIR = uploadsDir;

const { spawn } = require('child_process');
const child = spawn('node', ['server.js'], {
  stdio: 'inherit',
  env: process.env
});
child.on('exit', (code) => process.exit(code));
