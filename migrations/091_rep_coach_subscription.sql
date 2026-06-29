-- 091_rep_coach_subscription.sql
-- Per-tenant Stripe subscription that bills active AI Rep Coach seats:
-- one line item per tier (standard/pro/elite), quantity = active seats at
-- that tier. Separate from the tenant's main AIFDH plan subscription.

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS rep_coach_subscription_id TEXT;
