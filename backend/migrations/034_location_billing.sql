-- ═══════════════════════════════════════════════════════════════════════════
-- 034_location_billing.sql
-- Apr 19, 2026 — Multi-location billing system
--
-- Adds support for two parent modes (operating_hq, rollup_only) with per-
-- location billing flags (parent_pays, self_pays). Includes superadmin
-- pricing overrides at every level (parent monthly/annual, location
-- monthly/annual), 30-day data retention on removal, and Stripe state
-- tracking for parent subscription line items + franchisee invite tokens.
--
-- ZERO MIGRATION RISK: All columns are nullable or have safe defaults.
-- Existing single-tenant flow (Gladiators) is unaffected — they get
-- parent_mode='operating_hq' and billing_responsibility='parent_pays'
-- as defaults but neither matters until they add a child location.
--
-- See conversation Apr 19 for full design rationale.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Parent mode: operational HQ vs rollup-only HQ ────────────────────────
-- operating_hq (default): Gladiators-style. HQ runs jobs on a Pro/Elite
--   plan. Locations cost 50% of parent's effective rate (when parent_pays).
-- rollup_only: Franchise brand corporate. HQ pays a tiered HQ plan
--   ($297/$597/$1,497) and provides admin + rollup dashboard only.
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS parent_mode TEXT DEFAULT 'operating_hq';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE table_name = 'tenants' AND constraint_name = 'tenants_parent_mode_check'
  ) THEN
    ALTER TABLE tenants
      ADD CONSTRAINT tenants_parent_mode_check
      CHECK (parent_mode IN ('operating_hq', 'rollup_only'));
  END IF;
END $$;

-- ── Per-LOCATION billing flag ─────────────────────────────────────────────
-- parent_pays (default): Location cost added to parent's Stripe subscription.
--   Used for operating_hq + corporate-pays franchise.
-- self_pays: Location has its own independent Stripe subscription.
--   Franchisee enters their own payment method via invite flow.
-- Per-location flag (not parent-level) so MIXED franchises work — some
-- corporate-paid, some franchisee-paid under the same HQ.
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS billing_responsibility TEXT DEFAULT 'parent_pays';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE table_name = 'tenants' AND constraint_name = 'tenants_billing_responsibility_check'
  ) THEN
    ALTER TABLE tenants
      ADD CONSTRAINT tenants_billing_responsibility_check
      CHECK (billing_responsibility IN ('parent_pays', 'self_pays'));
  END IF;
END $$;

-- ── Superadmin pricing overrides ──────────────────────────────────────────
-- Three independent override surfaces (per Apr 19 spec):
--
-- 1. plan_monthly_override_cents / plan_annual_override_cents
--    What this tenant pays for THEIR OWN plan, monthly or annual.
--    Set on parent → overrides parent's plan price.
--    Set on child → overrides child's plan price (relevant for self_pays
--    franchisees or rollup_only children with independent plans).
--    Takes precedence over the existing plan_overrides jsonb column.
--
-- 2. locations_monthly_rate_cents / locations_annual_rate_cents
--    What the PARENT is billed for hosting THIS specific child location.
--    Set on the CHILD's row. Overrides the calculated 50%-of-parent rate
--    (operating_hq) or the child's plan rate (rollup_only + parent_pays).
--    Irrelevant when child is self_pays (child has its own subscription).
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS plan_monthly_override_cents INT,
  ADD COLUMN IF NOT EXISTS plan_annual_override_cents INT,
  ADD COLUMN IF NOT EXISTS locations_monthly_rate_cents INT,
  ADD COLUMN IF NOT EXISTS locations_annual_rate_cents INT;

-- ── Removal + 30-day data retention ───────────────────────────────────────
-- Removal flow per Apr 19 spec:
--   1. location_removed_at = now()    (immediate deactivation)
--   2. is_suspended = true            (already exists; blocks calls/SMS)
--   3. location_data_retention_until = now() + 30 days
--   4. Daily cron at 3 AM hard-deletes tenants where retention has expired.
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS location_removed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS location_data_retention_until TIMESTAMPTZ;

-- ── Stripe state tracking for PARENT-pays line items ─────────────────────
-- For operating_hq + parent_pays children: parent's single Stripe sub gets
-- one "Additional Locations" line item per child price tier. We store the
-- Stripe subscription item ID and price ID so syncLocationsToStripe can
-- update quantity / swap prices without recreating items.
--
-- Why per-tenant prices: each parent's 50% rate is different (Pro parent
-- hosting locations at $248.50, Elite parent hosting at $498.50, plus
-- override variations). Single shared price IDs would not work.
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS parent_location_stripe_item_id TEXT,
  ADD COLUMN IF NOT EXISTS parent_location_stripe_price_id TEXT;

-- ── Franchisee invite flow (rollup_only + self_pays) ─────────────────────
-- When franchisor adds a self_pays location, we create the tenant row in
-- pending state and email an invite link with this token. Franchisee clicks,
-- completes their own Stripe checkout, location activates.
-- Token expires after 14 days; can be regenerated by franchisor.
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS franchisee_invite_token TEXT,
  ADD COLUMN IF NOT EXISTS franchisee_invite_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS franchisee_invite_accepted_at TIMESTAMPTZ;

-- ── Indexes ───────────────────────────────────────────────────────────────
-- Active children lookup (most common query: list a parent's locations)
CREATE INDEX IF NOT EXISTS idx_tenants_parent_id_active
  ON tenants(parent_id)
  WHERE parent_id IS NOT NULL AND location_removed_at IS NULL;

-- Daily retention cron scan
CREATE INDEX IF NOT EXISTS idx_tenants_data_retention
  ON tenants(location_data_retention_until)
  WHERE location_data_retention_until IS NOT NULL;

-- Franchisee invite token lookup
CREATE INDEX IF NOT EXISTS idx_tenants_franchisee_invite_token
  ON tenants(franchisee_invite_token)
  WHERE franchisee_invite_token IS NOT NULL;

-- ── Comments for future maintainers (Rahul, May 1+) ──────────────────────
COMMENT ON COLUMN tenants.parent_mode IS
  'operating_hq (default, Gladiators-style HQ runs jobs) | rollup_only (franchise corporate, admin+rollup only)';

COMMENT ON COLUMN tenants.billing_responsibility IS
  'Per-LOCATION flag set on CHILD rows. parent_pays = location on parent subscription | self_pays = independent subscription via franchisee invite';

COMMENT ON COLUMN tenants.locations_monthly_rate_cents IS
  'Set on CHILD row. What parent pays per month for hosting this specific location. NULL = use calculated rate (50%-of-parent for operating_hq, child plan rate for rollup_only).';

COMMENT ON COLUMN tenants.locations_annual_rate_cents IS
  'Same as locations_monthly_rate_cents but for annual billing interval.';

COMMENT ON COLUMN tenants.plan_monthly_override_cents IS
  'Tenant-level plan price override (monthly). Takes precedence over plan_overrides jsonb. Set by superadmin for negotiated deals.';

COMMENT ON COLUMN tenants.plan_annual_override_cents IS
  'Same as plan_monthly_override_cents but for annual billing interval.';

COMMENT ON COLUMN tenants.location_removed_at IS
  'Timestamp when child was removed. Triggers immediate deactivation + 30-day retention clock. NULL = active location.';

COMMENT ON COLUMN tenants.location_data_retention_until IS
  'When this tenant row + all its data gets hard-deleted by daily cron. Set to location_removed_at + 30 days.';

COMMENT ON COLUMN tenants.parent_location_stripe_item_id IS
  'Stripe subscription item ID on the PARENT subscription representing this child. Used to update quantity / cancel without recreating.';

COMMENT ON COLUMN tenants.parent_location_stripe_price_id IS
  'Stripe price ID for the parent_location_stripe_item_id. Per-tenant ad-hoc price (since each parent rate differs).';

COMMENT ON COLUMN tenants.franchisee_invite_token IS
  'Random token for self_pays franchisee invite acceptance. Cleared on accept.';
