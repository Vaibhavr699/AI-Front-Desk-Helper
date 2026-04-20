-- Migration: 036_stripe_sync_status.sql
-- Apr 20, 2026 — Track the Stripe sync status of parent_pays child locations
-- so the UI can surface failures and offer a retry button without inferring
-- from the absence of parent_location_stripe_item_id (which also returns
-- false for locations that were never synced for legitimate reasons).
--
-- Values:
--   'synced'  — Stripe subscription item exists and matches our billing math
--   'failed'  — last sync attempt threw. stripe_sync_error has the message.
--   'pending' — never synced yet (new location before first sync attempt,
--               or self_pays locations that don't live on parent's sub)
--
-- Backfill strategy:
--   - Rows with parent_location_stripe_item_id set  → 'synced'
--   - All others                                    → 'pending'
--   (We don't backfill 'failed' because we can't distinguish
--    "never tried" from "tried and failed" retroactively.)

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS stripe_sync_status TEXT DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS stripe_sync_error TEXT,
  ADD COLUMN IF NOT EXISTS stripe_sync_last_attempted_at TIMESTAMPTZ;

-- Backfill existing rows
UPDATE tenants
   SET stripe_sync_status = 'synced',
       stripe_sync_last_attempted_at = COALESCE(updated_at, created_at)
 WHERE parent_location_stripe_item_id IS NOT NULL
   AND stripe_sync_status = 'pending';

-- Constrain to known values (matches the app's expectations)
ALTER TABLE tenants
  DROP CONSTRAINT IF EXISTS tenants_stripe_sync_status_check;
ALTER TABLE tenants
  ADD CONSTRAINT tenants_stripe_sync_status_check
  CHECK (stripe_sync_status IN ('synced', 'failed', 'pending'));

-- Partial index so "show me all locations with failed syncs" is fast
-- regardless of how many rows the table has.
CREATE INDEX IF NOT EXISTS idx_tenants_stripe_sync_failed
  ON tenants (parent_id, stripe_sync_status)
  WHERE stripe_sync_status = 'failed';
