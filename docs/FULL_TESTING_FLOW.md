# Full flow for testing (call → booking → Zapier → DripJobs)

## Prerequisites (one-time)

### 1. Render backend
- Service deployed at e.g. `https://ai-front-desk-backend.onrender.com`
- **Environment** on Render set:
  - `BASE_URL` = `https://ai-front-desk-backend.onrender.com`
  - `DATABASE_URL` = your Postgres (e.g. Supabase pooler URL)
  - `OPENAI_API_KEY` = your OpenAI key
  - `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` = your Twilio credentials
  - **`ZAPIER_WEBHOOK_URL`** = your Zapier Catch Hook URL (e.g. `https://hooks.zapier.com/hooks/catch/.../.../`)

### 2. Twilio
- 402 number (+14027738795) configured:
  - **Voice** → A call comes in → **Webhook** → `https://ai-front-desk-backend.onrender.com/twilio/voice` (POST)

### 3. Database
- At least one **tenant** in the DB
- That tenant has the **402 number** in `phone_numbers` (e.g. run `node scripts/seed-gladiators.js` once)

### 4. Zapier
- **Zap** is **On**
- **Trigger:** Webhooks by Zapier → Catch Hook (use that URL as `ZAPIER_WEBHOOK_URL`)
- **Action:** DripJobs → e.g. Create Lead / Create Appointment Request
- Map fields: `first_name`, `last_name`, `contact_phone`, `contact_email`, `address`, etc. from the webhook payload

---

## Full test flow (step by step)

### Step 1: Check backend and webhook config

```bash
# From the project root (uses your .env for DB)
node scripts/check-crm-webhook.js
```

- Confirm at least one tenant exists and either has a CRM Webhook URL or you see “ZAPIER_WEBHOOK_URL in .env: Set”.
- **Note:** This checks your **local** .env. For Render, the important thing is that **Render** has `ZAPIER_WEBHOOK_URL` set (you did that in Render → Environment).

---

### Step 2: Place a test call (your phone rings)

In `.env` (or in the shell) set the number that should **ring** (e.g. your mobile):

```bash
# In .env:
# BASE_URL=https://ai-front-desk-backend.onrender.com
# TEST_RING_NUMBER=+1xxxxxxxxxx

node scripts/test-call-716-to-402.js
```

- Twilio will call **your** number (402 → you).
- **Answer** the call. You should hear the AI.

---

### Step 3: Complete a booking on the call

- Say you want to schedule an estimate.
- When the AI asks, give: **name**, **phone number**, **address** (or city).
- Wait for the AI to confirm something like: “You’re all set, your estimate is scheduled…”
- Then hang up or say goodbye.

---

### Step 4: Check that the booking was saved and synced

**A. Your app (database + dashboard)**

- **Dashboard:** Open your app → **Bookings**. The new appointment should appear.
- **Script (no UI):**
  ```bash
  node scripts/check-booking-crm.js
  ```
  Look for the latest booking and **CRM synced at** set (means it was sent to the webhook).

**B. Render logs**

- Render → your service → **Logs**.
- Look for:
  - `[voice] POST /twilio/voice` (call reached backend)
  - `[CRM] booking ... → webhook 200 OK` (booking sent to Zapier)

**C. Zapier**

- Zapier → your Zap → **Task History**.
- Find the run for the time of your call. Trigger (Catch Hook) should show the payload with `event_type: "booking"` and the lead fields. DripJobs step should show **Success**.

**D. DripJobs**

- Open the list/view where new leads or appointments appear. The new lead/job with the name and phone you gave should be there.

---

### Step 5 (optional): Test without a real call

To test only “booking → Zapier → DripJobs” (no call):

```bash
node scripts/test-book-lead.js
```

- Uses `ZAPIER_WEBHOOK_URL` from your **local** .env (or tenant CRM URL).  
- For a test that matches **Render**, either:
  - Run this script with `DATABASE_URL` and `ZAPIER_WEBHOOK_URL` pointing to the same DB and Zapier URL that Render uses, or  
  - Rely on the real call test (steps 2–4) with Render’s env.

---

## Quick checklist

| Step | What to do | What to check |
|------|------------|----------------|
| 1 | Set `ZAPIER_WEBHOOK_URL` on **Render** → Environment | Redeploy; then run test call |
| 2 | Run `node scripts/test-call-716-to-402.js` (with `TEST_RING_NUMBER` set) | Your phone rings |
| 3 | Answer and give name, phone, address; complete booking | AI says you’re scheduled |
| 4a | Run `node scripts/check-booking-crm.js` | Latest booking has “CRM synced at” |
| 4b | Render → Logs | `[CRM] booking ... → webhook 200 OK` |
| 4c | Zapier → Task History | New task with booking payload; DripJobs step success |
| 4d | DripJobs | New lead/appointment with your test data |

---

## If something doesn’t work

- **No call / wrong number:** Check Twilio credentials and that 402 is in `phone_numbers` for a tenant. Check `BASE_URL` and Twilio webhook URL.
- **Booking not in DB:** Check Render logs for “Tool execution error” or “Voice webhook error”. Ensure 402 number is linked to a tenant.
- **No “[CRM] booking ... → webhook 200 OK”:** Render has no webhook URL. Set `ZAPIER_WEBHOOK_URL` in Render → Environment and redeploy.
- **Zapier gets payload but DripJobs doesn’t:** Check Zap is On, DripJobs step is set up and mapped, and Zapier Task History for the DripJobs step error.
