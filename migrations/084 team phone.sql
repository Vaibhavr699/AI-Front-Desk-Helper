-- ════════════════════════════════════════════════════════════════════════
-- Migration 084 — Team member phone numbers (May 20, 2026)
-- ════════════════════════════════════════════════════════════════════════
--
-- Adds a `phone` column to dashboard_users so team members (estimators /
-- technicians) can have a cell number on file. This unlocks per-technician
-- routing of the Phase 8B pre-visit briefing SMS.
--
-- Why this is also a bug fix:
--   preVisitBriefing.js resolveRecipientPhone() Path 2 already queries
--   `SELECT phone FROM dashboard_users ... role = 'owner'`. That column
--   never existed, so Path 2 has been silently throwing and returning null
--   on every call. After this migration Path 2 works as designed, and the
--   new Path 0 (assigned-technician routing) becomes possible.
--
-- The column is nullable — existing users have no phone, and the briefing
-- resolver degrades gracefully (tech phone → tenant phone → owner phone).
-- ════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE dashboard_users
  ADD COLUMN IF NOT EXISTS phone text;

COMMIT;
