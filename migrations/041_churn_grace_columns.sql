-- ============================================================================
-- Migration 041 — Churn Grace Columns
-- Apr 23, 2026
-- ============================================================================
-- Adds the columns required by lib/resellerBilling.js transferCustomersToDirect.
-- Without these, when a reseller cancels their Stripe subscription, the cascade
-- UPDATE silently fails and customers are orphaned (reseller_id points to an
-- inactive reseller, billing_owner stays 'reseller').
--
-- These columns implement the 30-day grace window where a customer can set up
-- direct billing via a tokenized URL: /churn/setup-direct-billing/<token>
-- ============================================================================

-- Idempotent column additions (safe to re-run)
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS churn_grace_token text;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS churn_grace_expires_at timestamptz;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS churn_grace_originated_reseller_id uuid;

-- Drop existing constraints/indexes if re-running, then recreate
ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_churn_grace_token_unique;
DROP INDEX IF EXISTS tenants_churn_grace_token_idx;
DROP INDEX IF EXISTS tenants_churn_grace_expires_idx;

-- Sparse unique index on grace tokens. NULL tokens (the vast majority of rows)
-- are exempt from the uniqueness check.
CREATE UNIQUE INDEX tenants_churn_grace_token_idx
  ON tenants (churn_grace_token)
  WHERE churn_grace_token IS NOT NULL;

-- Index on expiration so the daily cron suspension job is fast.
CREATE INDEX tenants_churn_grace_expires_idx
  ON tenants (churn_grace_expires_at)
  WHERE churn_grace_expires_at IS NOT NULL;

-- FK to track the originating reseller for analytics/disputes (no CASCADE
-- delete — if the reseller is hard-deleted later, we still want the audit
-- trail of where this customer came from).
ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_churn_originated_reseller_fk;
ALTER TABLE tenants
  ADD CONSTRAINT tenants_churn_originated_reseller_fk
  FOREIGN KEY (churn_grace_originated_reseller_id)
  REFERENCES tenants(id)
  ON DELETE SET NULL;
