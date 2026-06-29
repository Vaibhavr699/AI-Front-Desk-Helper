-- 105_dashboard_user_full_name.sql
-- Adds a display name for dashboard users so rep-facing surfaces (manager
-- coaching comments shown in the mobile app) can attribute feedback to a
-- person ("Drew") instead of a raw email. Nullable; callers fall back to the
-- email's local-part when unset.

ALTER TABLE dashboard_users
  ADD COLUMN IF NOT EXISTS full_name TEXT;

COMMENT ON COLUMN dashboard_users.full_name IS
  'Optional display name for the user; shown above manager coaching comments in the rep app. Falls back to email local-part when null.';
