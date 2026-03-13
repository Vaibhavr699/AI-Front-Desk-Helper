-- Super admin role + per-tenant pricing overrides
ALTER TABLE dashboard_users ADD COLUMN IF NOT EXISTS is_super_admin BOOLEAN DEFAULT false;

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS price_override_monthly INTEGER;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS price_override_setup   INTEGER;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS promo_label            TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS promo_expires_at       TIMESTAMPTZ;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS promo_applied_by       UUID;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS promo_notes            TEXT;
