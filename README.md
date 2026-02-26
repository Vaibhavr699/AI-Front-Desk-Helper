# AI Front Desk – Multi-Tenant Voice Platform

Production-ready AI-powered call system for home service companies. One Twilio account, one backend, one OpenAI account; add clients by adding a Twilio number and tenant config in the database.

## Features

- **Real-time AI voice agent** – Twilio Media Streams + OpenAI Realtime API, full-duplex
- **Multi-tenant** – Route by called number; tenant-specific instructions and transfer numbers
- **Call recording** – Every call recorded via Twilio; optional S3 copy; transcription via Whisper
- **Live transfer** – Triggered by AI (commercial, >$10k, frustrated, VIP); SMS pre-brief; call stays recorded
- **Appointment booking** – AI books via tools; CRM webhook (e.g. DripJobs/Zapier); confirmation SMS
- **Follow-ups** – Auto SMS at 24h, 3d, 5d, 10d after quote/booking
- **Dashboard API** – Calls, recordings, transcripts, bookings, metrics

## Requirements

- Node.js 18+ (20+ recommended for AWS SDK)
- PostgreSQL
- Twilio account (Voice, one or more numbers)
- OpenAI API key
- Optional: AWS S3 for recording storage

## Setup

### 1. Environment

Copy `.env.example` to `.env` and set:

```bash
# Required
PORT=3000
BASE_URL=https://your-app.onrender.com   # Must be HTTPS in production
DATABASE_URL=postgresql://user:pass@host:5432/dbname
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
OPENAI_API_KEY=sk-...

# Optional – recording copy + transcription
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_REGION=us-east-1
AWS_S3_BUCKET_RECORDINGS=

# Optional – default “from” for SMS (else uses tenant’s primary number)
TWILIO_PHONE_NUMBER=+1...
```

### 2. Database

```bash
npm run db:migrate
npm run db:seed   # Creates Gladiators Painting + phone 402-773-8795
```

### 3. Twilio

- In [Twilio Console → Phone Numbers](https://console.twilio.com/us1/develop/phone-numbers/manage/incoming): select your number.
- **Voice & Fax**: A call comes in → Webhook: `https://YOUR_BASE_URL/twilio/voice`, HTTP POST (use your `BASE_URL` from `.env`, e.g. `http://YOUR_SERVER_IP:3001`).
- (Optional) **Status callback**: `https://YOUR_BASE_URL/twilio/status` for call completion.

### 4. Tenant config (e.g. Gladiators)

- **Transfer number**: Set `transfer_numbers` for live transfer target (or in dashboard **Settings**), e.g.  
  `UPDATE tenants SET transfer_numbers = '["+14025551234"]'::jsonb WHERE slug = 'gladiators-painting';`
- **Live transfer**: Triggered when the AI detects any of—commercial job, project over $10k, frustrated/confused caller, or VIP/repeat customer. Pre-brief is sent via **SMS** to the transfer number (custom template in Settings or default) and optionally via **email** to `TRANSFER_NOTIFICATION_EMAIL` (dashboard notification). The **call remains recorded** (AI leg + transfer leg).
- **CRM (DripJobs)**: Set webhook URL so leads/bookings are sent there.  
  `UPDATE tenants SET crm_webhook_url = 'https://hooks.zapier.com/...', crm_type = 'webhook' WHERE slug = 'gladiators-painting';`  
  Or use the dashboard **Settings** page to set **CRM Webhook URL**.  
  You can also set `ZAPIER_WEBHOOK_URL` in `.env` as a **fallback** when a tenant has no `crm_webhook_url`; payloads include `tenant_id`, `tenant_name`, `company_name` so you can route in Zapier.

### 5. Zapier / DripJobs flow

The backend POSTs to a webhook in two cases:

1. **Booking created** (`event_type: "booking"`) – when the AI books an appointment. Payload: `contact_name`, `contact_phone`, `contact_email`, `address`, `city`, `scope`, `job_type`, `preferred_date`, `notes`, `booking_id`, plus `tenant_id`, `tenant_name`, `company_name`.
2. **Call details** (`event_type: "call_details"`) – after the call is transcribed. Payload: `call_id`, `from_number`, `to_number`, `transcript`, `recording_url`, `duration_sec`, `disposition`, `transferred`, `booking_id`, `booking_contact`, plus `tenant_id`, `tenant_name`, `company_name`.

**To complete the flow with DripJobs:** In Zapier, create a Zap with trigger “Webhooks by Zapier” → Catch Hook. Use that hook URL as the tenant’s **CRM Webhook URL** (Settings) or set it as `ZAPIER_WEBHOOK_URL` in `.env`. In the Zap, filter or route by `event_type` and optionally by `tenant_id`, then send the data to DripJobs (e.g. create job/lead) using the payload fields above.

### 6. Run

```bash
npm start
```

## Adding a new client (no code change)

1. Buy or assign a Twilio number.
2. Point that number’s “A call comes in” webhook to the same backend: `https://YOUR_BASE_URL/twilio/voice`.
3. In DB: create a row in `tenants`, then insert into `phone_numbers` with that number and `tenant_id`.  
   Optionally run a small script or use an admin API to do this.

## API (dashboard)

All under `/api`. Use query `tenant_id` or header `X-Tenant-Id` (tenant UUID).

- `GET /api/calls?tenant_id=...` – List calls
- `GET /api/calls/:id` – Call detail + recordings
- `GET /api/recordings/:id` – Recording + transcript
- `GET /api/bookings?tenant_id=...` – Bookings
- `GET /api/metrics?tenant_id=...` – 30-day metrics (total calls, % booked, % transferred, revenue)
- `GET /api/tenants` – List tenants (id, name, slug, phones)

## Project layout

- `server.js` – Express, WebSocket for Twilio Media ↔ OpenAI Realtime, cron for follow-ups
- `lib/` – db, tenant lookup, Twilio client
- `services/` – calls, recording, transfer, CRM, bookings, follow-up, S3, transcription
- `routes/` – Twilio webhooks, dashboard API
- `migrations/` – SQL schema
- `scripts/` – run-migrations, seed-gladiators

## Deploy on this server (PM2)

- `.env` is loaded automatically (via `dotenv`). Set `BASE_URL` to your server URL (e.g. `http://YOUR_SERVER_IP:3001`).
- Build dashboard: `npm run build:dashboard`.
- Start: `pm2 start server.js --name ai-front-desk --cwd /home/nbuck/ai-front-desk-backend` (or `pm2 start ecosystem.config.cjs`).
- Save and restore on reboot: `pm2 save` then run the command PM2 prints for `pm2 startup`.

**Twilio webhook:** Set your number’s “A call comes in” to `http://YOUR_SERVER_IP:3001/twilio/voice` (or your `BASE_URL` + `/twilio/voice`).

## Dashboard

- Build: `npm run build:dashboard` (output in `dashboard/dist`). The server serves it at `/dashboard`.
- Create a dashboard user: `DASHBOARD_USER_EMAIL=you@example.com DASHBOARD_USER_PASSWORD=yourpassword node scripts/create-dashboard-user.js` (or `npm run create-user` with env set).
- Open `https://YOUR_BASE_URL/dashboard` and sign in. Select a tenant to view calls, recordings, transcripts, and metrics.

## Security

- Keep `.env` out of git (use `.gitignore`). Set `JWT_SECRET` to a long random string in production.
- Use strong DB credentials and restrict DB access.
- In production use HTTPS and restrict dashboard API (e.g. auth or IP) as needed.
