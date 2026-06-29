-- Plan tier per tenant (basic | pro | elite). No payment yet — used for limits and feature gating.
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'basic'
    CHECK (plan IN ('basic', 'pro', 'elite'));

COMMENT ON COLUMN tenants.plan IS 'Plan tier: basic, pro, elite. Used for voice/SMS limits and feature flags.';
