-- ============================================================================
-- Migration 085 — Rep account sharing risk score (Phase 6C anti-sharing v0)
-- Date: May 22, 2026
--
-- Adds three columns to dashboard_users so the daily anti-sharing scorer
-- (services/repSharingScorer.js) can flag accounts that look like they're
-- being shared between people.
--
-- Why this matters: rep seats are $119–$249/mo. If a rep shares their login
-- with a coworker, that's lost seat revenue. The scorer reads rep_app_events
-- (which already captures device_fingerprint, ip_address, biometric_type
-- per event) and computes a transparent risk score per user. Flagged
-- accounts surface in the team-management dashboard for owner review —
-- nothing is auto-revoked, since false positives (e.g. a rep using both
-- their phone and tablet) are common.
--
-- sharing_risk_score:     integer, 0 = no signal, higher = more suspicious
-- sharing_risk_signals:   jsonb, detail breakdown so the owner can see WHY
--                         { distinct_fingerprints_7d, distinct_ip_blocks_24h,
--                           distinct_biometric_types_7d, reasons: [...] }
-- sharing_risk_computed_at: when the score was last refreshed
--
-- Threshold for "flagged" is enforced in the scorer (>= 4 for v0), not in
-- the schema, so we can re-tune without a migration.
-- ============================================================================

BEGIN;

ALTER TABLE dashboard_users
  ADD COLUMN IF NOT EXISTS sharing_risk_score       INTEGER,
  ADD COLUMN IF NOT EXISTS sharing_risk_signals     JSONB,
  ADD COLUMN IF NOT EXISTS sharing_risk_computed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_dashboard_users_sharing_risk
  ON dashboard_users (tenant_id, sharing_risk_score DESC)
  WHERE sharing_risk_score IS NOT NULL AND sharing_risk_score > 0;

COMMIT;
