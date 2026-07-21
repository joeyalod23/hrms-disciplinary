# HRMS Auto-Deploy Guide

## How It Works

```
You code locally --> git push --> GitHub --> webhook --> this PC --> auto-pull + restart
                                                                         |
                                                                  Cloudflare Tunnel
                                                                         |
                                                                    Internet access
```

## One-Time Setup (run as Administrator)

```powershell
# In the project folder:
powershell -ExecutionPolicy Bypass -File deploy\setup-server.ps1
```

This installs:
- **pm2** - process manager (auto-restart, survives crashes, starts on boot)
- **cloudflared** - free secure tunnel (no port forwarding needed)
- Starts HRMS on port 3000
- Starts webhook server on port 9000

## Get Your Public URL

```powershell
pm2 logs hrms-tunnel --lines 30
```

Look for a line like:
```
https://abc-xyz-123.trycloudflare.com
```

That's your public HRMS URL. Share it with anyone.

**Note:** The URL changes each time the tunnel restarts. For a permanent URL,
see "Custom Domain" below.

## Auto-Deploy Flow

### Step 1: Push your code to GitHub

```bash
git init
git add .
git commit -m "initial"
git remote add origin https://github.com/YOUR_USER/YOUR_REPO.git
git push -u origin main
```

### Step 2: Add webhook on GitHub

1. Go to your repo → Settings → Webhooks → Add webhook
2. **Payload URL:** `http://YOUR_PUBLIC_IP:9000/deploy`
   (or use the Cloudflare tunnel URL: `https://xxxxx.trycloudflare.com/deploy`)
3. **Content type:** `application/json`
4. **Secret:** `change-this-to-a-random-secret-string`
5. Events: select "Just the push event"
6. Click "Add webhook"

### Step 3: Update webhook secret

Set the same secret as an environment variable or edit `deploy/webhook-server.js`:

```powershell
# Option A: Set env var
[Environment]::SetEnvironmentVariable("WEBHOOK_SECRET", "your-secret", "User")

# Option B: Edit the file directly (line 10 of webhook-server.js)
```

### Now Every Push Auto-Deploys

```bash
# Just push your changes:
git add .
git commit -m "new feature"
git push
# Server auto-pulls and restarts within seconds!
```

## Useful Commands

| Command | What it does |
|---|---|
| `pm2 status` | See all running processes |
| `pm2 logs hrms` | View HRMS server logs |
| `pm2 logs hrms-tunnel` | Get your public URL |
| `pm2 logs hrms-webhook` | See webhook/deploy activity |
| `pm2 restart hrms` | Manual restart |
| `pm2 stop hrms` | Stop HRMS |
| `pm2 startup` | Configure auto-start on Windows boot |
| `pm2 save` | Save current process list |

## Permanent Public URL (Custom Domain)

The free Cloudflare tunnel URL changes on restart. For a fixed URL:

### Option 1: Cloudflare (free)
1. Buy a domain (~$10/year) or use one you own
2. Add it to Cloudflare (free account)
3. Run: `cloudflared tunnel --url http://localhost:3000 --hostname yourdomain.com`

### Option 2: ngrok (paid for custom domain)
```powershell
ngrok http 3000 --domain=yourdomain.com
```

### Option 3: Port forwarding (free, needs router access)
1. Forward router port 80 → your PC's local IP port 3000
2. Use your public IP: `http://YOUR_PUBLIC_IP`
3. For HTTPS: use nginx + Let's Encrypt

## Security Notes

- Change the default admin passwords immediately
- The Cloudflare tunnel provides HTTPS automatically
- If using port forwarding, add HTTPS (nginx + certbot)
- Set a strong WEBHOOK_SECRET to prevent unauthorized deploys
- Keep your GitHub repo PRIVATE (contains HR data references)
