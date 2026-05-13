-- Migration 067 — Custom domain support for white-label tenants
-- Phase: White-label DNS feature (May 13, 2026)
--
-- Adds the three columns needed for tenants to self-configure a branded
-- dashboard URL (e.g. app.paragonext.com → routes to their tenant).
--
-- Only tenants with brand_mode='white_label' will see the configuration UI,
-- but the columns are added to all rows for schema consistency. The vast
-- majority of tenants will leave these NULL.
--
-- Status transitions:
--   NULL → pending     : tenant has saved a desired hostname but not yet verified DNS
--   pending → verifying: verification attempted, in progress
--   verifying → active : CNAME confirmed, hostname is live for routing
--   verifying → failed : CNAME lookup failed, tenant needs to retry
--   active → NULL      : tenant disconnected the custom domain
--
-- Verification logic lives in routes/branding.js; the column transitions
-- are managed exclusively there.

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS custom_domain              text,
  ADD COLUMN IF NOT EXISTS custom_domain_status       text,
  ADD COLUMN IF NOT EXISTS custom_domain_verified_at  timestamptz;

-- Constrain status to known values. NULL is allowed (most tenants).
ALTER TABLE tenants
  DROP CONSTRAINT IF EXISTS tenants_custom_domain_status_check;

ALTER TABLE tenants
  ADD CONSTRAINT tenants_custom_domain_status_check
  CHECK (
    custom_domain_status IS NULL
    OR custom_domain_status IN ('pending', 'verifying', 'active', 'failed')
  );

-- Index for hostname-based tenant resolution. Only indexes active rows
-- since that's the only state where the hostname is queried at request time.
-- Partial index keeps it tiny — only ~1 row per white-label tenant.
CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_custom_domain_active
  ON tenants (custom_domain)
  WHERE custom_domain_status = 'active';

-- Quick verification queries to run after migration:
-- SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_name = 'tenants'
--   AND column_name LIKE 'custom_domain%';
--
-- Expected output: 3 rows (custom_domain text, custom_domain_status text,
-- custom_domain_verified_at timestamp with time zone)
