-- Business logo / image for tenant (URL or data URL)
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS logo_url TEXT;

COMMENT ON COLUMN tenants.logo_url IS 'Business image URL or data URL for profile/avatar display.';
