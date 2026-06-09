-- 094_lead_rep_owner.sql
-- Gives leads an explicit rep owner so manually-added customers are visible in
-- the rep app's "my customers" list. Until now "mine" was derived only from
-- bookings.technician_id / coaching_conversations.rep_user_id, so a lead a rep
-- typed in by hand (no booking, no recording) matched neither and vanished.
--   created_by_rep_user_id — the rep (dashboard_users) who added the lead via
--                            the app; NULL for inbound/webhook/system leads.

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS created_by_rep_user_id UUID REFERENCES dashboard_users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_leads_created_by_rep
  ON leads (created_by_rep_user_id);
