-- Add JSONB column to hold overrides per plan mapping
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS plan_overrides JSONB DEFAULT '{}'::jsonb;
