-- ============================================================================
-- Migration 050 — Tenant Service Rate Overrides
-- ============================================================================
-- Phase 7 V1.5 (May 4, 2026)
--
-- Lets tenants override the default rates for each service in their vertical
-- without SQL access. Stored as a percentage adjustment (+0.20 = 20% above
-- default, -0.10 = 10% below). Multiplied against base rates BEFORE modifier
-- stacking and BEFORE the cost_region custom multiplier.
--
-- One row per (tenant, service). NULL/missing row = no override (use default).
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS tenant_service_rate_overrides (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  service_slug TEXT NOT NULL,
  percentage_adjustment NUMERIC(5,4) NOT NULL,
    -- e.g. 0.2000 = +20%, -0.1500 = -15%
    -- Range enforced at application layer: -0.50 to +1.00 (-50% to +100%)
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (tenant_id, service_slug)
);

CREATE INDEX IF NOT EXISTS idx_tsro_tenant ON tenant_service_rate_overrides(tenant_id);

COMMENT ON TABLE tenant_service_rate_overrides IS
  'Phase 7 V1.5 — Per-service percentage rate overrides set in Settings UI by tenant.';
COMMENT ON COLUMN tenant_service_rate_overrides.percentage_adjustment IS
  'Decimal multiplier adjustment. 0.2000 = +20% above default. -0.1000 = 10% below.';

COMMIT;
