-- Migration 059: Add do_not_contact flag to leads
--
-- Lets dashboard users permanently silence a lead from all outbound
-- automation (SMS follow-ups, estimate recoveries, nurturing campaigns).
-- Flipping ON cascades: cancels any active recoveries/nurtures in the
-- same call. Frontend exposes this as a "Stop All Communication" toggle
-- on the lead row in the Bookings table.
--
-- Companion code:
--   services/leads.js          → setDoNotContact()
--   routes/leads.js            → PATCH /:id/do-not-contact
--   services/estimateRecovery.js → suppression filter in processDueRecoveries
--   services/nurturing.js      → suppression filter in processDueNurturing
--   services/sms.js            → send-time guard
--   server.js runSmsFollowUps  → in-memory thread suppression

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS do_not_contact boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS do_not_contact_set_at timestamptz,
  ADD COLUMN IF NOT EXISTS do_not_contact_set_by uuid REFERENCES dashboard_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS do_not_contact_reason text;

-- Partial index — only indexes leads currently flagged. Used by the
-- suppression JOINs in cron processors. Keeps the index tiny.
CREATE INDEX IF NOT EXISTS idx_leads_do_not_contact
  ON leads(tenant_id, do_not_contact)
  WHERE do_not_contact = true;

-- While we're here: missing updated_at on nurturing_schedule (bit us in
-- the Bob Prange emergency cleanup, May 8 2026). Defaulting to now() so
-- existing rows get a sensible timestamp. Future writes should set
-- updated_at = now() explicitly.
ALTER TABLE nurturing_schedule
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
