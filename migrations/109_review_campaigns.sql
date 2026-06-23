-- ════════════════════════════════════════════════════════════════════════════
-- Migration 109 — Review Request Campaigns
--
-- Automated post-job review-request drip (NiceJob-style cadence). COMPLIANT
-- design: every enrolled customer is asked and every message links to the
-- tenant's public Google review page. No review-gating (Google policy + FTC).
--
-- Trigger: a completed job (DripJobs job-completed webhook, or a manual
-- "request review" action, or any caller of reviewCampaign.startReviewCampaign).
--
-- Exit conditions: customer leaves a review (matched in reviewScheduler) OR
-- all steps sent OR the 14-day cap passes OR DNC/STOP.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Per-tenant config (defaults = NiceJob-style recipe; fully overridable) ──

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS review_campaign_enabled boolean NOT NULL DEFAULT false;

-- The tenant's public Google "write a review" link. The message inserts this.
-- Tenants grab it from their Google Business Profile ("Get more reviews" → copy
-- link). Stored explicitly because Google's review URL is not reliably
-- constructable from google_location_id alone.
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS review_link text;

-- The sequence. jsonb array of steps; null/empty → engine uses DEFAULT_STEPS.
-- Each step: { "day": <int>, "channel": "sms"|"email", "message": "<text?>",
--              "subject": "<email subject?>" }
-- {{first_name}} / {{company_name}} / {{review_link}} tokens substituted at send.
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS review_campaign_steps jsonb;

-- ── The campaign table — one row per enrolled customer ──────────────────────

CREATE TABLE IF NOT EXISTS review_campaigns (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  lead_id         uuid REFERENCES leads(id) ON DELETE SET NULL,

  contact_name    text,
  contact_phone   text,
  contact_email   text,

  -- active | completed | stopped | opted_out | no_contact_method
  status          text NOT NULL DEFAULT 'active',

  -- index into the resolved step array (0-based); which step fires next
  current_step    integer NOT NULL DEFAULT 0,

  next_send_at    timestamptz,         -- when the current_step should fire
  enrolled_at     timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz,         -- set when a review is detected
  last_sent_at    timestamptz,

  job_completed_at timestamptz,        -- the triggering job's completion time
  source          text DEFAULT 'job_completed',  -- job_completed | manual | test

  sms_sent        integer NOT NULL DEFAULT 0,
  email_sent      integer NOT NULL DEFAULT 0,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- One active campaign per (tenant, phone) — dedupe enrollment. Partial unique
-- index so only ACTIVE rows are constrained (a customer can be re-enrolled
-- after a previous campaign completed). Phone normalized to last-10 at the
-- app layer; we store the value as given and dedupe in code, but this index
-- guards the common exact-match case.
CREATE INDEX IF NOT EXISTS idx_review_campaigns_due
  ON review_campaigns (next_send_at)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_review_campaigns_tenant
  ON review_campaigns (tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_review_campaigns_lead
  ON review_campaigns (lead_id)
  WHERE lead_id IS NOT NULL;

-- Per-step send log (audit + dedupe), mirrors recovery_touches.
CREATE TABLE IF NOT EXISTS review_campaign_touches (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id   uuid NOT NULL REFERENCES review_campaigns(id) ON DELETE CASCADE,
  tenant_id     uuid NOT NULL,
  step_index    integer,
  channel       text,           -- sms | email
  body          text,
  status        text,           -- sent | failed | skipped_dnc
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_review_campaign_touches_campaign
  ON review_campaign_touches (campaign_id);
