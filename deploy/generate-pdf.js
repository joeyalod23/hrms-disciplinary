const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const doc = new PDFDocument({ size: 'A4', margins: { top: 50, bottom: 50, left: 50, right: 50 } });
const filePath = path.join(__dirname, 'Cloud Deployment Options - HRMS.pdf');
doc.pipe(fs.createWriteStream(filePath));

const font = 'Helvetica';
const bold = 'Helvetica-Bold';

function title(text) {
  doc.font(bold).fontSize(20).fillColor('#1a1a2e').text(text, { align: 'left' });
  doc.moveDown(0.5);
}
function subtitle(text) {
  doc.font(bold).fontSize(13).fillColor('#16213e').text(text);
  doc.moveDown(0.3);
}
function body(text) {
  doc.font(font).fontSize(10).fillColor('#333').text(text, { width: 495, align: 'justify' });
  doc.moveDown(0.3);
}
function bullet(text) {
  doc.font(font).fontSize(10).fillColor('#333').text('  \u2022  ' + text, { width: 475, align: 'justify', indent: 20 });
  doc.moveDown(0.15);
}
function divider() {
  doc.strokeColor('#ccc').lineWidth(1).moveTo(50, doc.y).lineTo(545, doc.y).stroke();
  doc.moveDown(0.8);
}
function proHeader() {
  doc.font(bold).fontSize(10).fillColor('#0f6c3f').text('PROS'); doc.moveDown(0.3);
}
function conHeader() {
  doc.font(bold).fontSize(10).fillColor('#a13d2f').text('CONS'); doc.moveDown(0.3);
}
function cost(text) {
  doc.font(bold).fontSize(10).fillColor('#1a1a2e').text('Estimated Monthly Cost: ' + text);
  doc.moveDown(1);
}

title('Cloud Deployment Options');
doc.font(font).fontSize(11).fillColor('#555').text('HRMS - SiteVigil Disciplinary Monitoring System');
doc.text('Multi-Branch Architecture Guide');
doc.moveDown(1.5);

// --- VPS ---
subtitle('1. VPS (Virtual Private Server) - DigitalOcean / Linode / Vultr');
body("How it works: You rent a virtual machine (Linux/Ubuntu) from a cloud provider. You install Node.js, PostgreSQL, and PM2 process manager. Upload your application code, point a custom domain, and secure it with free SSL via Let's Encrypt. Branch employees access the system via https://yourdomain.com.");
divider();
proHeader();
bullet('Full control - complete root access to the server');
bullet('Fixed pricing - predictable monthly cost, no surprise bills');
bullet('Scalable - upgrade RAM/CPU/storage anytime');
bullet('Can host multiple apps on one server');
divider();
conHeader();
bullet('Requires Linux/server administration skills (SSH, firewall, nginx)');
bullet('Manual setup - you configure everything from scratch');
bullet('You handle backups, security patches, and uptime monitoring');
bullet('No graphical interface - all command-line based');
cost('$5 - $12 / month');

// --- PaaS ---
subtitle('2. PaaS (Platform as a Service) - Render / Railway');
body('How it works: Connect your GitHub repository to Render or Railway. They automatically detect your Node.js app, build it, and deploy it. They provide a public URL (e.g., yourapp.onrender.com), handle SSL certificates automatically, and offer built-in PostgreSQL. No server management needed.');
divider();
proHeader();
bullet('Zero server management - just git push to deploy');
bullet('Auto HTTPS/SSL - secure connection out of the box');
bullet('Free tier available - enough for demo and small teams');
bullet('Built-in PostgreSQL, logging, and monitoring dashboards');
bullet('Automatic scaling when traffic increases');
divider();
conHeader();
bullet('Free tier sleeps after inactivity (slow restart on first visit)');
bullet('Vendor lock-in - harder to migrate to another platform');
bullet('Free tier has CPU/month and bandwidth limits');
bullet('Becomes expensive at scale ($20+/mo for decent resources)');
cost('$0 (free tier) - $7 (starter)');

// --- Supabase ---
subtitle('3. Supabase (Backend-as-a-Service)');
body('How it works: Supabase is an open-source Firebase alternative. It provides hosted PostgreSQL, built-in authentication, file storage, and auto-generated REST API. You rewrite your app to call Supabase APIs instead of SQLite. Frontend can be hosted for free on Vercel or Netlify.');
divider();
proHeader();
bullet('Very generous free tier (500MB database, 2GB storage, 50k rows)');
bullet('Built-in authentication - email, Google, Facebook, etc.');
bullet('Real-time subscriptions - data updates push to UI automatically');
bullet('Auto backups, graphical dashboard, SQL editor in browser');
bullet('Open-source - you can self-host if needed later');
divider();
conHeader();
bullet('Requires code rewrite - replace SQLite with Supabase API calls');
bullet('Free tier row limit (50,000 rows across all tables)');
bullet('API rate limits and bandwidth caps on free plan');
bullet('Your data resides on their cloud infrastructure');
cost('$0 (free tier) - $25 (pro)');

// --- Recommendation ---
doc.addPage();
subtitle('RECOMMENDATION: PaaS (Render or Railway)');
body('For your current stage (system proposal period), Render or Railway is the best choice because:');
doc.moveDown(0.3);
bullet('No server knowledge needed - just git push and it deploys');
bullet('Free tier works immediately for client demos and presentations');
bullet('Professional HTTPS URL instills client confidence');
bullet('Easy to upgrade later as the system grows');
bullet('Minimal code changes needed (SQLite to PostgreSQL migration only)');
doc.moveDown(1);

// --- Migration Path ---
subtitle('Migration Path: SQLite to PostgreSQL');
body('The current system uses better-sqlite3 (local file-based database). To deploy on cloud, we migrate to PostgreSQL:');
doc.moveDown(0.3);
bullet('Replace better-sqlite3 with pg (node-postgres) driver');
bullet('Convert SQLite-specific queries to PostgreSQL-compatible syntax');
bullet('Set up connection pooling for performance');
bullet('Use environment variables for database credentials');
bullet('Deploy and test with a staging environment first');
doc.moveDown(1.5);

// --- Architecture ---
subtitle('Proposed Cloud Architecture');
doc.font(font).fontSize(10).fillColor('#333');
let archY = doc.y;
doc.font(font).fontSize(9).fillColor('#333');
archY = body('  [Branch PC 1]     [Branch PC 2]     [Branch PC 3]', archY);
archY = body('  (Browser)         (Browser)         (Browser)', archY);
archY = body('        \\               |               /        ', archY + 2);
archY = body('         \\              |              /         ', archY);
archY = body('          \\             |             /          ', archY);
archY = body('           \\            |            /           ', archY);
archY = body('         [ Cloud Server - Render/Railway ]       ', archY + 4);
archY = body('         [ HTTPS + Custom Domain          ]       ', archY);
archY = body('                      |                           ', archY + 4);
archY = body('                  [ PostgreSQL DB ]                ', archY);
archY = body('                  [ Centralized    ]                ', archY);
doc.font(font).fontSize(10).fillColor('#333');

doc.moveDown(3);
subtitle('Branch Isolation Strategy');
bullet('Each branch has a branch_id field in all major tables');
bullet('Middleware automatically filters data by branch on every query');
bullet('Branch admins only see their own branch data');
bullet('Main office (admin role) sees all branches');
bullet('No VPN or networking needed - just internet access');

doc.moveDown(2);
subtitle('Next Steps When Ready');
doc.moveDown(0.3);
bullet('I will migrate the database from SQLite to PostgreSQL');
bullet('Set up environment variables for security (database credentials, JWT secret, SMTP)');
bullet('Deploy to Render/Railway free tier in under 30 minutes');
bullet('You get a live HTTPS URL to share with your client');
bullet('Configure automatic daily backups and uptime monitoring');

doc.moveDown(3);
doc.fontSize(8).fillColor('#999').text('Generated ' + new Date().toLocaleDateString('en-PH') + ' | HRMS - SiteVigil Disciplinary Monitoring System', { align: 'center' });

doc.end();
console.log('PDF generated: ' + filePath);
