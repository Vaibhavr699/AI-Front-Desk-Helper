-- Rep Coach two-frontend account model (Step 1 of the signup/billing flow).
-- Adds the fields that drive in-app capability (seat_type) and billing/trial
-- (account_type, trial_ends_at). See docs/superpowers/specs/2026-06-18-rep-coach-*.
--
-- Note: dashboard_users gets `rep_coach_account_type` (NOT `account_type`) to
-- avoid collision with tenants.account_type, which is org-level (parent_hq/customer)
-- and a different concept from the per-user standalone/manager_provisioned axis.

ALTER TABLE dashboard_users
  ADD COLUMN IF NOT EXISTS seat_type TEXT
    CHECK (seat_type IS NULL OR seat_type IN ('rep', 'manager')),
  ADD COLUMN IF NOT EXISTS rep_coach_account_type TEXT
    CHECK (rep_coach_account_type IS NULL OR rep_coach_account_type IN ('standalone', 'manager_provisioned')),
  ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ;

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS manager_seats_free INTEGER NOT NULL DEFAULT 3
    CHECK (manager_seats_free >= 0);

-- Backfill existing Rep Coach users: anyone with an active rep seat today is a
-- 'rep' seat provisioned by an existing AIFDH tenant (no standalone trial path
-- existed before this). Non-rep users are left NULL — they are not Rep Coach
-- accounts and must not be implicitly granted a seat_type.
UPDATE dashboard_users
SET seat_type = 'rep',
    rep_coach_account_type = 'manager_provisioned'
WHERE rep_seat_active = true
  AND seat_type IS NULL;
