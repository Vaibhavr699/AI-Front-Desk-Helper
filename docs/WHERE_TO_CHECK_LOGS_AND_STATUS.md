# Where to Check Logs and Details (Is It Working?)

## 1. Application logs

### Local (PM2 or `node server.js`)
- **PM2:** `pm2 logs` or `pm2 logs 0` (or your app name). Scroll for recent lines.
- **Direct run:** Terminal where you ran `node server.js` or `npm start`.

### Render
- **Dashboard** → your **ai-front-desk-backend** service → **Logs**.
- Refresh and scroll to the bottom for the latest output.

---

## 2. What to look for in logs

| What you want to confirm | Log line to look for |
|--------------------------|----------------------|
| **Incoming call reached the backend** | `[voice] POST /twilio/voice CA... From: +1... To: +1...` |
| **Booking synced to Zapier** | `[CRM] booking <uuid> → webhook 200 OK` |
| **No webhook configured** | `[CRM] No webhook URL for tenant ...` |
| **Webhook failed (Zapier error)** | `[CRM] booking ... → webhook 4xx` or `5xx` + response snippet |
| **Tool/booking error** | `Tool execution error:` or `Tool args JSON parse failed:` |
| **Voice webhook error** | `Voice webhook error:` |
| **OpenAI/stream error** | `OpenAI error:` or `OpenAI socket error:` |

---

## 3. Booking and CRM status (details)

### In your app (database + dashboard)
- **Dashboard:** Open your app (e.g. `http://localhost:3089` or your deployed dashboard URL).
  - **Bookings** – List of appointments; confirm the new one appears.
  - **Calls** – List of calls; confirm the call and disposition (e.g. booked).
- **Script (no UI):**
  ```bash
  node scripts/check-booking-crm.js
  ```
  Shows latest bookings and whether each has **CRM synced at** set (i.e. sent to webhook).

### CRM webhook configuration
```bash
node scripts/check-crm-webhook.js
```
Shows which tenants have a CRM Webhook URL (or fallback from `ZAPIER_WEBHOOK_URL`).

### Zapier
- **Zapier** → your Zap → **Task History** (or **Zap History**).
- Check that the **Catch Hook** trigger fired for the booking and the **DripJobs** (or other) action step ran successfully.
- Inspect the payload: should include `event_type: "booking"`, `first_name`, `last_name`, `contact_phone`, `address`, etc.

### DripJobs
- Open the list/view where new leads or appointment requests appear.
- Confirm a new record with the same name/phone/date as the test booking or call.

---

## 4. Quick test (no real call)

1. **Send a test booking to Zapier:**
   ```bash
   node scripts/test-book-lead.js
   ```
2. Check **Zapier Task History** for the new task.
3. Check **DripJobs** for the new lead.

---

## 5. After a real call (test call script)

1. Run: `TEST_RING_NUMBER=+1xxxxxxxxxx node scripts/test-call-716-to-402.js`
2. Answer the call and complete a booking with the AI.
3. **Logs:** Look for `[voice] POST /twilio/voice` and then `[CRM] booking ... → webhook 200 OK`.
4. **Details:** Run `node scripts/check-booking-crm.js` and check Dashboard → Bookings, then Zapier and DripJobs.

### Why don’t my test-call bookings show up in Zapier/CRM?

The script only **starts** the call. The **backend** that Twilio calls (the URL from `BASE_URL`) is what creates the booking and sends it to Zapier. So:

- **Set `ZAPIER_WEBHOOK_URL` on the backend that serves the call.**  
  - If `BASE_URL` is your Render URL → set **ZAPIER_WEBHOOK_URL** in **Render → your service → Environment**.  
  - If `BASE_URL` is local (e.g. `http://localhost:3001`) → set **ZAPIER_WEBHOOK_URL** in that server’s **.env**.
- Or set the **CRM Webhook URL** in **Dashboard → Settings** for the tenant that owns the 402 number.

Then redeploy (or restart) so the backend has the webhook. After that, when you book during a test call, the booking and (after transcription) call details will sync to Zapier/CRM.
