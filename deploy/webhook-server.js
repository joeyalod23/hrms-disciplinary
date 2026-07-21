const http = require('http');
const { exec } = require('child_process');
const crypto = require('crypto');
const path = require('path');

const PORT = process.env.WEBHOOK_PORT || 9000;
const SECRET = process.env.WEBHOOK_SECRET || 'change-this-to-a-random-secret-string';
const PROJECT_DIR = path.resolve(__dirname, '..');

const DEPLOY_CMD = `powershell -ExecutionPolicy Bypass -File "${path.join(PROJECT_DIR, 'deploy', 'auto-deploy.ps1')}"`;

function verifySignature(payload, signature) {
  if (!signature) return false;
  const hmac = crypto.createHmac('sha256', SECRET);
  hmac.update(payload);
  const digest = 'sha256=' + hmac.digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest));
}

function runDeploy() {
  console.log(`[${new Date().toISOString()}] Starting deployment...`);
  exec(DEPLOY_CMD, { cwd: PROJECT_DIR, timeout: 120000 }, (error, stdout, stderr) => {
    if (error) {
      console.error(`[${new Date().toISOString()}] Deploy failed:`, error.message);
    } else {
      console.log(`[${new Date().toISOString()}] Deploy complete`);
      if (stdout) console.log(stdout);
    }
    if (stderr) console.error(stderr);
  });
}

const server = http.createServer((req, res) => {
  // Health check endpoint
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }));
    return;
  }

  // Only accept POST to /deploy
  if (req.method !== 'POST' || req.url !== '/deploy') {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  let body = '';
  req.on('data', chunk => { body += chunk; });

  req.on('end', () => {
    const signature = req.headers['x-hub-signature-256'] || req.headers['x-webhook-signature'];

    // Verify signature if SECRET is set
    if (SECRET !== 'change-this-to-a-random-secret-string') {
      if (!verifySignature(body, signature)) {
        console.warn(`[${new Date().toISOString()}] Invalid signature - rejected`);
        res.writeHead(403);
        res.end('Invalid signature');
        return;
      }
    }

    // Parse the payload
    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      res.writeHead(400);
      res.end('Invalid JSON');
      return;
    }

    // Check if it's a push event (GitHub/Gitea/Bitbucket)
    const event = req.headers['x-github-event'] || req.headers['x-gitea-event'] || 'push';
    const branch = payload.ref ? payload.ref.replace('refs/heads/', '') : '';

    console.log(`[${new Date().toISOString()}] Received event: ${event}, branch: ${branch}`);

    // Only deploy on push to main/master
    if (branch && branch !== 'main' && branch !== 'master') {
      console.log(`[${new Date().toISOString()}] Ignoring push to branch: ${branch}`);
      res.writeHead(200);
      res.end('Ignored - not main/master branch');
      return;
    }

    res.writeHead(200);
    res.end('Deploy triggered');

    // Run deployment asynchronously
    runDeploy();
  });
});

server.listen(PORT, () => {
  console.log(`Webhook server running on port ${PORT}`);
  console.log(`Endpoint: POST http://localhost:${PORT}/deploy`);
  console.log(`Health:   GET  http://localhost:${PORT}/health`);
  console.log(`Project:  ${PROJECT_DIR}`);
  console.log('');
  console.log('Set WEBHOOK_SECRET env var for security (GitHub webhook secret)');
});
