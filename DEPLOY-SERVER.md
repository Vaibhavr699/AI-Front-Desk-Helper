# Deployment on this server (SSH machine)

## Current deployment

- **App:** Running under **pm2** as `ai-front-desk` (port **3001**).
- **BASE_URL:** `http://116.202.210.102:3001` (set in `.env`).
- **Endpoints:**
  - Health: http://116.202.210.102:3001/health
  - Dashboard: http://116.202.210.102:3001/dashboard
  - Twilio voice webhook: http://116.202.210.102:3001/twilio/voice

## Useful commands

```bash
cd /home/nbuck/ai-front-desk-backend

# Restart app after code or .env changes
pm2 restart ai-front-desk

# Logs
pm2 logs ai-front-desk

# Status
pm2 status
```

## Start on server reboot (optional)

Run once (with your user):

```bash
sudo env PATH=$PATH:/usr/bin /usr/local/lib/node_modules/pm2/bin/pm2 startup systemd -u nbuck --hp /home/nbuck
```

Then `pm2 save` is already done; after reboot, pm2 will bring `ai-front-desk` back up.

## Twilio

In Twilio Console → Phone Numbers → your number (402-773-8795):

- **A call comes in:** Webhook `http://116.202.210.102:3001/twilio/voice`, HTTP POST.

## After pulling code

```bash
cd /home/nbuck/ai-front-desk-backend
npm install
node scripts/run-migrations.js   # if there are new migrations
npm run build:dashboard
pm2 restart ai-front-desk
```
