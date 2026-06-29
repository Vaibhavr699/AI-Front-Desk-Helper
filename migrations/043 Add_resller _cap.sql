ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS usage_cap_voice_minutes integer,
  ADD COLUMN IF NOT EXISTS usage_cap_sms integer,
  ADD COLUMN IF NOT EXISTS overage_rate_voice_cents integer,
  ADD COLUMN IF NOT EXISTS overage_rate_sms_cents integer,
  ADD COLUMN IF NOT EXISTS hard_cap_enabled boolean DEFAULT false;

COMMENT ON COLUMN tenants.usage_cap_voice_minutes IS 'For reseller tenants only. Monthly cap on aggregated child voice minutes.';
COMMENT ON COLUMN tenants.usage_cap_sms IS 'For reseller tenants only. Monthly cap on aggregated child SMS.';
COMMENT ON COLUMN tenants.overage_rate_voice_cents IS 'Cents charged per minute over cap. NULL = no overage billing.';
COMMENT ON COLUMN tenants.overage_rate_sms_cents IS 'Cents charged per SMS over cap. NULL = no overage billing.';
COMMENT ON COLUMN tenants.hard_cap_enabled IS 'If true, block service at 100% cap instead of allowing overage.';
