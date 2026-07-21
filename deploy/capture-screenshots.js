const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const screenshotDir = path.join(__dirname, 'screenshots');
if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const baseUrl = 'http://localhost:3000';
const loginCreds = { username: 'admin', password: 'admin123' };

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const server = spawn('node', [path.join(__dirname, '..', 'server.js')], {
    stdio: 'pipe',
    env: { ...process.env, PORT: '3000' }
  });
  server.stdout.on('data', d => process.stdout.write('[server] ' + d));
  server.stderr.on('data', d => process.stderr.write('[server-err] ' + d));

  await sleep(3000);

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1366, height: 768 });

  async function screenshot(name) {
    await sleep(1000);
    await page.screenshot({ path: path.join(screenshotDir, `${name}.png`), fullPage: false });
    console.log(`  Captured: ${name}.png`);
  }

  async function login() {
    await page.goto(baseUrl + '/login', { waitUntil: 'networkidle0' });
    await page.type('input[name="username"]', loginCreds.username);
    await page.type('input[name="password"]', loginCreds.password);
    await page.click('button[type="submit"]');
    await sleep(2000);
  }

  try {
    console.log('Logging in...');
    await login();
    console.log('Capturing screenshots...');

    // Dashboard
    await page.goto(baseUrl + '/', { waitUntil: 'networkidle0' });
    await screenshot('01-dashboard');

    // Employees
    await page.goto(baseUrl + '/employees', { waitUntil: 'networkidle0' });
    await screenshot('02-employees-list');

    // Employee Form
    await page.goto(baseUrl + '/employees/add', { waitUntil: 'networkidle0' });
    await screenshot('03-employee-form');

    // Incidents
    await page.goto(baseUrl + '/incidents', { waitUntil: 'networkidle0' });
    await screenshot('04-incidents-list');

    // Incident Form
    await page.goto(baseUrl + '/incidents/add', { waitUntil: 'networkidle0' });
    await screenshot('05-incident-form');

    // NoV
    await page.goto(baseUrl + '/nov', { waitUntil: 'networkidle0' });
    await screenshot('06-nov-list');

    // Cases
    await page.goto(baseUrl + '/cases', { waitUntil: 'networkidle0' });
    await screenshot('07-cases-list');

    // Case Form
    await page.goto(baseUrl + '/cases/add', { waitUntil: 'networkidle0' });
    await screenshot('08-case-form');

    // Hearings
    await page.goto(baseUrl + '/hearings', { waitUntil: 'networkidle0' });
    await screenshot('09-hearings');

    // Attendance
    await page.goto(baseUrl + '/attendance', { waitUntil: 'networkidle0' });
    await screenshot('10-attendance');

    // Contracts
    await page.goto(baseUrl + '/contracts', { waitUntil: 'networkidle0' });
    await screenshot('11-contracts');

    // Recruitment
    await page.goto(baseUrl + '/recruitment', { waitUntil: 'networkidle0' });
    await screenshot('12-recruitment');

    // Reports
    await page.goto(baseUrl + '/reports', { waitUntil: 'networkidle0' });
    await screenshot('13-reports');

    console.log('\nAll screenshots captured!');
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await browser.close();
    server.kill();
  }
}

main();
