# How SMS and Email Replies Are Captured and Shown

## SMS reply flow (current)

1. **We send an outbound SMS**  
   Any outbound SMS (nurturing, follow-up, recovery, etc.) is sent via Twilio from your tenant’s number.

2. **User replies**  
   The reply goes to that same Twilio number. Twilio sends an **HTTP webhook** to your backend.

3. **Webhook endpoint**  
   - **URL:** `POST /twilio-sms` (configured per number in Twilio; see `lib/twilio.js` and scripts like `fix-all-twilio-webhooks.js`).  
   - **Body:** Twilio form params including `From`, `To`, `Body`.

4. **Backend processing**  
   - `server.js` receives the request, normalizes `From` and `Body`.  
   - Resolves **tenant** by the number that received the message: `getTenantByPhone(toNum)` (the `To` is your AI number).  
   - Calls **`processSmsConversation(from, body, tenant)`** which:
     - Gets or creates a **lead** by phone: `leadsService.getOrCreateLead(tenant.id, phone)`.
     - **Saves the inbound message:** `messagesService.saveMessage(tenant.id, lead.id, "sms", "inbound", incomingText)` → row in `messages` with `channel = 'sms'`, `direction = 'inbound'`.
     - Optionally runs referral parsing (if it was a reply to a referral campaign).  
     - Runs the **SMS AI orchestrator** to generate a reply.  
     - If the AI decides to book, runs **`handleLeadBooking`** (creates/updates booking).  
     - **Saves the outbound reply:** `messagesService.saveMessage(tenant.id, lead.id, "sms", "outbound", replyText)`.  
   - Response to Twilio is TwiML with the reply so Twilio sends that SMS back to the user.

5. **Where it appears in the UI**  
   - **Conversations list:** `GET /api/conversations?tenant_id=...` aggregates the latest activity per lead from `messages` (and `calls`). So any lead that has this SMS thread shows up with the latest message.  
   - **Timeline (per lead):** `GET /api/conversations/:id/timeline` returns all rows from `messages` for that `lead_id` plus voice calls, ordered by time. So the inbound reply and the outbound AI reply both appear in **Dashboard → AI Conversations → select the lead → timeline**.  
   - **“Job” / booking:** If the AI books an appointment, `handleLeadBooking` creates/updates a row in `bookings` linked to that `lead_id`. So the “job” is the booking; the SMS thread is attached to the **lead**, and the lead is linked to the booking. You see the conversation on the lead’s timeline; the job is visible under **Bookings** (and in CRM if you use it).

**Summary:** SMS reply → Twilio webhook → `processSmsConversation` → lead resolved by phone → inbound + outbound saved to `messages` → same lead’s timeline and conversations list show everything; booking is created if the AI books.

---

## Email reply flow (after you enable Resend “receive”)

Right now we **only send** email via Resend. We do **not** receive or process replies. When you turn on **Resend Inbound (Receive)**:

1. **Resend receives the reply**  
   You configure a domain/address that receives mail (e.g. `replies@yourdomain.com` or a Resend-managed address).

2. **Resend calls your webhook**  
   For each received email, Resend sends `POST` to a URL you configure, with event type **`email.received`**.  
   - Docs: https://resend.com/docs/webhooks/emails/received  
   - Payload includes metadata (from, to, subject, message_id, etc.). Full body may require a separate “Receiving API” call depending on Resend’s current API.

3. **What we need in the backend**  
   - A **webhook route** that accepts Resend’s `POST` (e.g. `POST /webhooks/resend/inbound`).  
   - **Identify the lead:** e.g. by matching reply “To” address to a known pattern, or “From” email to `leads.email` for that tenant.  
   - **Store the reply** in the same place as SMS: `messages` with `channel = 'email'`, `direction = 'inbound'`, `lead_id`, `body` = text/HTML of the reply.  
   - Optionally: trigger an AI or internal “email reply” flow (e.g. create a task, or send an auto-reply). For now the minimum is: **save to messages and show on timeline**.

4. **Showing it in the UI and “in the job”**  
   - **Timeline:** The conversations timeline already loads all `messages` for a lead regardless of `channel`. So once we insert an email reply as a message with `lead_id`, it will show up in **Dashboard → AI Conversations → [that lead] → timeline** like SMS.  
   - **Conversations list:** Same as SMS: the list is driven by latest activity per lead, so the lead will appear with the latest email reply as the last activity.  
   - **“Add it in the job”:** If by “job” you mean the **lead’s activity**, it’s the same as above (timeline + list). If you mean a specific **booking/job**, we can optionally link the message to a booking (e.g. `metadata.booking_id`) or show “related booking” in the UI; that would be a small extension once we have the lead and message stored.

**Summary:** Email reply → Resend receives it → Resend calls your webhook → we find lead (e.g. by from-email), save one row in `messages` with `channel = 'email'` → it appears on that lead’s timeline and in the conversations list; we can later link it to a booking if needed.

---

## Implementation checklist for email replies (when Resend receive is on)

- [x] **Webhook:** `POST /webhooks/resend/inbound` in `server.js`. Configure in Resend Dashboard → Webhooks → event **email.received** → URL `https://your-backend.com/webhooks/resend/inbound`.
- [x] Parse Resend payload (`type`, `data.from`, `data.to`, `data.subject`, `data.email_id`). Note: webhook does not include body; use [Resend Received API](https://resend.com/docs/webhooks/emails/received) to fetch full content if needed.
- [x] Find lead by sender email: `SELECT FROM leads WHERE email = $1` (first match by `updated_at DESC`). Tenant comes from that lead’s `tenant_id`.
- [x] Insert into `messages`: `tenant_id`, `lead_id`, `channel = 'email'`, `direction = 'inbound'`, `body` (currently subject + placeholder; can be replaced with fetched body later), `metadata` (e.g. `resend_email_id`, `from`, `to`).
- [ ] Optional: call Resend’s retrieve-received-email API with `email_id` to store full body in `body`.
- [ ] Optional: trigger AI reply or internal notification.
- [x] UI: timeline and list show all `messages`; **ConversationViewer** has an icon for `channel === 'email'` (Mail icon).
