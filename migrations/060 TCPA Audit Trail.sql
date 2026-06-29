-- Migration 060: TCPA audit trail enhancement
-- Adds dnc_trigger_source column to audit_logs so every DNC flip is
-- attributed to its source: sms_keyword, sms_intent, voice_intent,
-- owner_dashboard, compliance_email.
--
-- TCPA reporting wants WHO + WHEN + WHAT TRIGGERED. The existing
-- audit_logs.created_at + user_email captures WHO + WHEN; this column
-- adds the trigger half.

ALTER TABLE audit_logs
  ADD COLUMN IF NOT EXISTS dnc_trigger_source text;

-- Partial index — most audit rows are NOT DNC events, partial keeps it tiny.
CREATE INDEX IF NOT EXISTS idx_audit_logs_dnc_trigger
  ON audit_logs (tenant_id, dnc_trigger_source, created_at DESC)
  WHERE dnc_trigger_source IS NOT NULL;

-- Backfill existing DNC entries from Migration 059 — only path to set
-- DNC before today was the dashboard, so attribute them retroactively.
UPDATE audit_logs
   SET dnc_trigger_source = 'owner_dashboard'
 WHERE action IN ('lead_dnc_enabled', 'lead_dnc_disabled')
   AND dnc_trigger_source IS NULL;
