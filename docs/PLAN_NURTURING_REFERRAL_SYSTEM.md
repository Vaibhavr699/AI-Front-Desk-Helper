# AI Customer Nurturing + Referral Capture System — Implementation Plan

This document maps the **AI Customer Nurturing + Referral Capture** product spec to the existing AI Front Desk codebase and outlines a phased implementation plan. The feature is **Elite-only by default**, with an **add-on** for Basic and Pro.

---

## 1. Current Codebase Summary

### 1.1 Data model (existing)

| Area | What exists |
|------|-------------|
| **Leads** | `leads` table: id, tenant_id, name, phone, email, address, project_type, notes, status (New Lead → Booked → Closed/Lost), metadata. Unique (tenant_id, phone). |
| **Messages** | `messages` table: lead_id, channel (sms, website, facebook), direction, body, metadata. Used for conversation history. |
| **Bookings** | `bookings` table: contact_*, address, city, scope, job_type, preferred_date, appointment_time, technician_id, status (Booked, Confirmed, Completed, Rescheduled, Cancelled), lead_id, call_id, revenue_cents. |
| **Follow-ups** | `follow_ups` table: booking_id, contact_phone, contact_name, follow_up_type (24h, 3d, 5d, 10d), due_at, sent_at, status, channel (default sms). Scheduled in `bookings.createBooking` when `tenant.follow_up_enabled`. **No cron found** that runs `followUpService.processDueFollowUps()` — needs adding. |
| **Estimate recovery** | `estimate_recoveries` + `recovery_touches`: multi-step SMS + AI call sequences for “estimate sent, not booked”; objection handling (thinking, price, spouse). Cron every 5 min. |
| **Sales engine** | Simpler estimate follow-up (stages 0,1,2…) via SMS. Cron every 10 min. |

### 1.2 Channels (existing)

- **SMS**: Twilio via `lib/twilio` (per-tenant or fallback). Inbound → `POST /twilio-sms` → `processSmsConversation()` → AI reply.
- **Email**: Resend in `services/email.js` (password reset, booking confirmation, technician assignment, contact form, chat).
- **Voice**: Twilio + WebSocket AI (inbound/outbound). Estimate recovery can trigger outbound AI calls via `/twilio/recovery-call`.

### 1.3 Plans (existing)

- **Basic / Pro**: No `followUpAutomation`, no `revenueRecoverySystem`.
- **Elite**: `followUpAutomation`, `aiFollowUpCalls`, `revenueRecoverySystem`, etc. No explicit “nurturing” or “referral” or “seasonal campaign” flags yet.

### 1.4 Dashboard (existing)

- **Metrics** (`GET /api/metrics`): period, today (calls, recovered, leads, booked), pipeline (open_estimates, jobs_scheduled, estimated_revenue), sales (leads_generated, estimates_sent, estimates_accepted, revenue_booked, close_rate), ai (calls_handled, appointments_booked, etc.), sources, trends. **No** campaign/referral/nurturing metrics.
- **Activity feed**: calls, bookings, recoveries, follow_ups (if any).

### 1.5 Gaps vs spec

- No **customers** table keyed by “service completed” (we have leads + bookings; “customer” = lead with at least one completed booking).
- No **interaction_history** beyond `messages` + `recovery_touches`; can be extended or a **campaign_log** added.
- No **referral_leads** table; no parsing of referral replies or “referral” lead source.
- No **post-service** lifecycle: 1-day follow-up, 5-day referral request, 6-month maintenance, 12-month re-engagement.
- No **seasonal / monthly campaign** calendar (e.g. painting 12-month calendar).
- No **campaign** entity (type, trigger, channel, template) or tenant-configurable “12-month nurturing” and “maintenance” campaigns.
- **Follow-up cron**: `followUpService.processDueFollowUps()` is never run by cron — should be added regardless of nurturing.

---

## 2. Required Database Changes

### 2.1 New tables (recommended)

```sql
-- Optional: canonical "customers" view or table derived from leads + last completed booking.
-- Alternatively: use leads + bookings with status = 'Completed' and last_service_date = max(completed_at).

-- Campaign log (every touch: email, sms, call)
CREATE TABLE campaign_log (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id),
  lead_id           UUID REFERENCES leads(id),
  booking_id        UUID REFERENCES bookings(id),
  campaign_type     TEXT NOT NULL,   -- post_service_followup, referral_request, seasonal_jan, ..., maintenance_6m, reengagement_12m
  channel           TEXT NOT NULL,   -- email, sms, phone
  direction         TEXT DEFAULT 'outbound',
  message_subject   TEXT,
  message_body      TEXT,
  sent_at           TIMESTAMPTZ DEFAULT now(),
  response_status   TEXT,           -- sent, delivered, opened, replied, failed
  metadata          JSONB DEFAULT '{}'
);

-- Referral leads (parsed from customer reply)
CREATE TABLE referral_leads (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID NOT NULL REFERENCES tenants(id),
  referring_lead_id       UUID REFERENCES leads(id),
  referring_booking_id    UUID REFERENCES bookings(id),
  referral_name           TEXT,
  referral_phone          TEXT NOT NULL,
  referral_email          TEXT,
  service_interest        TEXT,
  lead_status             TEXT DEFAULT 'new',  -- new, contacted, qualified, booked, closed
  lead_id                 UUID REFERENCES leads(id),  -- once we create/merge lead
  created_at              TIMESTAMPTZ DEFAULT now(),
  updated_at              TIMESTAMPTZ DEFAULT now()
);
```

### 2.2 Extend existing

- **Leads**: Add `last_service_date` (or derive from latest booking where status = 'Completed') and optionally `lead_source = 'referral'` for referral-sourced leads.
- **Bookings**: Already has `status` (e.g. Completed). Ensure “service completed” is clearly defined (e.g. status = 'Completed' and optionally a `completed_at` timestamp if not using `updated_at`).
- **Tenants**: Add flags and config for nurturing (e.g. `nurturing_enabled`, `referral_enabled`, `seasonal_campaigns_enabled`, `maintenance_reminder_months`). Optional JSON `nurturing_campaign_calendar` (month → campaign_type / template keys) for 12-month calendar.

---

## 3. Campaign Automations — Mapping to Implementation

### 3.1 Trigger model

- **Trigger**: event + delay (e.g. `booking.status = Completed` + 1 day; or `last_service_date` + 6 months).
- **Action**: send Email, then optionally SMS after 48h, then optionally AI call after 7 days no response. All replies route to existing **AI conversation engine** (SMS already does via `processSmsConversation`; email replies need a path — e.g. webhook or polling).

### 3.2 Campaign 1 — Post-service follow-up

- **Trigger**: Booking status → Completed (or “service completed” event) + **1 day**.
- **Existing**: `follow_ups` is tied to **booking creation** (24h, 3d, 5d, 10d), not “service completed.” So this is a **new** automation.
- **Implementation**: New “post_service_followup” campaign type. When a booking is marked Completed (or a dedicated “job completed” action), schedule a touch in 1 day: send **email** (template: “Quick follow up” + company name), then optionally **SMS** (template from spec). Log in `campaign_log`. If tenant has AI conversation for replies, ensure SMS/email reply path goes to same AI (SMS already does).

### 3.3 Campaign 2 — Referral request

- **Trigger**: Service completed + **5 days** (or 30 days per painting example).
- **Implementation**: Schedule “referral_request” touch: **email** (“Quick favor” + [service]) and **SMS**. Store in campaign_log. When customer **replies**, parse reply for name + phone (and optionally email): create row in **referral_leads**, set lead_source = 'referral', then **trigger AI referral outreach** (see below).

### 3.4 Referral lead capture logic

- **Input**: Inbound SMS or email reply to a referral campaign thread.
- **Parse**: Use regex / simple NLP to find “name” and “phone” (and email if present). Example: “My neighbor John needs painting. His number is 5551234567.”
- **Actions**: Insert into `referral_leads` (referring_lead_id, referral_name, referral_phone, etc.). Create or merge **lead** with same phone, set `lead_source = 'referral'`. Trigger **AI referral outreach** workflow.

### 3.5 AI referral outreach workflow

- **Steps**: (1) Create/find lead. (2) Send **SMS** to referral: “Hi [Referral], this is the assistant from [Company]. Your neighbor [Customer Name] mentioned you might need help with [service]. Would you like to schedule a quick estimate?” (3) Optionally email. (4) If no response, **AI phone call** (reuse existing outbound call flow, e.g. recovery-style). All replies (SMS/email/phone) route into **existing AI conversation engine**; AI handles booking as today.

### 3.6 Seasonal service campaigns

- **Trigger**: Calendar-based (e.g. January = “Interior Painting Refresh”, March = “Exterior Season Opening”). Per-tenant **12-month calendar** (e.g. painting template in spec).
- **Implementation**: New `seasonal_campaigns` or use `campaign_log.campaign_type` (e.g. `seasonal_jan`, `seasonal_mar`). Cron (e.g. daily): for each tenant with `seasonal_campaigns_enabled`, determine “this month” campaign, select **customers** (leads with last_service_date or completed booking in past N months), send **email** then **SMS** (templates from spec). Log in campaign_log. Replies → AI.

### 3.7 Maintenance reminder

- **Trigger**: `last_service_date` + **6 months** (configurable per tenant, e.g. `maintenance_reminder_months`).
- **Implementation**: Cron: find leads/customers where last_service_date + 6 months ≤ today and no open maintenance campaign touch this period. Send email “Maintenance reminder”, then SMS. Log campaign_log. Replies → AI.

### 3.8 Dormant re-engagement

- **Trigger**: last_service_date + **12 months**.
- **Implementation**: Same as maintenance but 12 months and different template (“Quick check in”). Replies → AI.

### 3.9 AI phone re-engagement

- **Trigger**: No response to email/SMS after **7 days** (for a given campaign touch).
- **Implementation**: When scheduling post-service / referral / seasonal / maintenance / re-engagement, optionally schedule a “no_response_phone” step 7 days later. When due, place **outbound AI call** (reuse `/twilio/recovery-call` style flow) with script: “We’re checking in to see if you need help with any upcoming [service]. Say ‘schedule’ or press 1.” Conversation routes to booking flow.

### 3.10 Conversation routing

- **SMS**: Already routed to `processSmsConversation` → AI. Ensure campaign-originated threads are associated with correct lead/booking.
- **Email**: Replies need to be ingested (e.g. Resend inbound webhook or polling) and either turned into an internal “reply” event that the AI can use, or a simple “notify + create task” and rely on SMS/phone for actual conversation. Full “email reply → AI” may require Resend inbound parsing and mapping to lead/phone.
- **Phone**: Inbound and outbound already go through existing voice pipeline; ensure outbound campaign calls link to lead/booking and same AI context.

---

## 4. Dashboard Metrics (new)

Add to **Metrics API** and dashboard UI (Elite + add-on only when feature is on):

- **Campaign / nurturing**: Emails sent, SMS sent, AI calls made (for nurturing campaigns).
- **Replies**: Customer replies (from campaign_log or messages where campaign_id/campaign_type set).
- **Appointments booked**: From campaign-originated flows (tag bookings or leads with campaign/referral source).
- **Referrals generated**: Count of `referral_leads` (or leads with lead_source = 'referral').
- **Estimated revenue**: From bookings linked to campaign/referral (or reuse existing pipeline revenue).

Example response addition:

```json
"nurturing": {
  "emails_sent": 210,
  "sms_sent": 102,
  "ai_calls_made": 14,
  "customer_replies": 56,
  "appointments_booked": 24,
  "referrals_generated": 9,
  "estimated_revenue": 72000
}
```

---

## 5. Plan Gating (Elite vs Add-on)

- **Elite**: Include full **AI Customer Nurturing + Referral** (all campaigns, referral capture, seasonal calendar, maintenance, re-engagement, AI phone follow-up). Gate in `lib/plans.js` with a feature flag, e.g. `customerNurturingReferral: true`.
- **Basic / Pro**: Offer as **add-on**. If purchased, same feature set as Elite for that tenant (e.g. stored in tenant plan overrides or add-on SKU in Stripe). Check: `hasFeature(planId, 'customerNurturingReferral') || tenant.addons?.customerNurturingReferral`.

---

## 6. 12-Month Campaign Calendar (e.g. painting)

- **Storage**: Tenant-level config: e.g. `tenant.nurturing_campaign_calendar` JSON: `{ "1": "interior_refresh", "2": "pre_spring_planning", ... }` with templates per key, or a separate `campaign_templates` table (tenant_id, month, campaign_type, email_subject, email_body, sms_body).
- **Execution**: Cron (daily): for each tenant with seasonal campaigns enabled, get “current month” campaign, get template, select target customers (e.g. leads with last_service_date in past 24 months), send email then schedule SMS 48h later. Log in campaign_log.
- **Painting example**: Implement the exact 12-month list (January–December) as default templates for a “painting” industry or as a template set tenants can clone and edit.

---

## 7. Phased Implementation Order

### Phase 1 — Foundation (no plan gate)

1. **Fix follow-up cron**: Add cron job to run `followUpService.processDueFollowUps()` (e.g. every 10 min) so existing 24h/3d/5d/10d SMS follow-ups actually send.
2. **DB migrations**: Add `campaign_log`, `referral_leads`; add `last_service_date` (or equivalent) and any tenant flags (`nurturing_enabled`, `referral_enabled`, etc.).
3. **“Service completed” trigger**: When booking status is set to `Completed`, set or update `last_service_date` on the linked lead (or derive in queries). Optionally emit an internal event for “service completed.”

### Phase 2 — Post-service + referral (Elite + add-on)

4. **Post-service follow-up campaign**: 1 day after service completed → send email + SMS (templates from spec). Log in campaign_log. Replies continue to use existing SMS/voice AI.
5. **Referral request campaign**: 5 or 30 days after service completed → send email + SMS. Log in campaign_log.
6. **Referral reply parsing**: In SMS (and email if inbound supported), detect referral campaign context; parse name/phone; create `referral_leads` row; create/update lead with source `referral`.
7. **AI referral outreach**: On new referral_lead, send intro SMS to referral phone; optionally email; optionally schedule AI call if no response. Wire into existing conversation/booking flow.

### Phase 3 — Seasonal + maintenance + re-engagement

8. **Maintenance reminder**: Cron; trigger at last_service_date + 6 months (configurable); email + SMS; 7-day no-response → AI call optional.
9. **Re-engagement (dormant)**: last_service_date + 12 months; same pattern.
10. **Seasonal campaigns**: Tenant 12-month calendar (e.g. painting); cron monthly; send email then SMS; no-response → AI call optional.
11. **No-response AI call**: For any campaign touch, optionally schedule “no response in 7 days” → outbound AI call (reuse recovery-call style).

### Phase 4 — Dashboard and polish

12. **Metrics API**: Add nurturing/referral metrics (emails sent, SMS sent, AI calls, replies, appointments booked, referrals generated, estimated revenue). Gate by feature.
13. **Dashboard UI**: New “Nurturing” or “Campaigns” section (Elite + add-on): show metrics, campaign log, referral leads list, and optionally campaign calendar config.
14. **Plan and add-on**: Add `customerNurturingReferral` to Elite; add Stripe add-on for Basic/Pro; gate all new APIs and cron logic by plan/add-on.

### Phase 5 — Tenant-configurable calendar

15. **Campaign calendar UI**: Let each location configure their 12-month nurturing calendar and maintenance interval (e.g. 6 months). Store in tenant settings or campaign_templates. AI sends/responds and books as today; no code change to AI booking flow, only trigger and template source.

---

## 8. File / Module Checklist

| Component | Existing | New / modified |
|-----------|----------|----------------|
| DB | leads, messages, bookings, follow_ups, estimate_recoveries | campaign_log, referral_leads; last_service_date; tenant flags |
| Cron | estimateRecovery (5 min), salesEngine (10 min) | followUp (10 min), nurturing campaign processor (daily), referral outreach |
| Email | services/email.js | New templates: post_service_followup, referral_request, seasonal_*, maintenance, reengagement |
| SMS | lib/twilio, server processSmsConversation | Same; campaign context passed so replies can be attributed and referral parsing triggered |
| Voice | Twilio + recovery-call | Reuse for “no response” campaign call |
| Plans | lib/plans.js | customerNurturingReferral (Elite + add-on) |
| Dashboard API | routes/dashboard.js /metrics | Nurturing metrics; GET campaign_log, referral_leads (optional) |
| Dashboard UI | Metrics page | Nurturing section; referral leads; campaign calendar config (Phase 5) |
| Bookings | services/bookings.js, PATCH in routes | On status → Completed: set last_service_date; optionally trigger “service completed” for Phase 2 |

---

## 9. Summary

- **Existing**: Leads, messages, bookings, follow_ups (no cron), estimate_recoveries, salesEngine, Resend email, Twilio SMS/voice, AI conversation for SMS and voice, dashboard metrics (no nurturing).
- **New**: campaign_log, referral_leads, last_service_date, tenant nurturing/referral flags and optional 12-month calendar; post-service, referral, seasonal, maintenance, re-engagement campaigns; referral reply parsing and AI referral outreach; no-response AI call; nurturing metrics and UI; Elite + add-on gating.
- **Order**: Fix follow-up cron and add DB → post-service + referral capture + AI referral outreach → maintenance + re-engagement + seasonal → dashboard metrics and UI → plan/add-on and tenant-configurable calendar.

This plan keeps the existing AI Front Desk, estimate recovery, and booking flows intact and layers the nurturing and referral system on top with clear triggers, logging, and plan gating.
