-- Migration: 027_parent_child_tenants.sql
-- Supports hierarchical business structures

-- 1. Add Parent/Child columns to tenants
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS business_type TEXT DEFAULT 'standalone' CHECK (business_type IN ('parent', 'location', 'standalone'));
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS default_lead_source TEXT;

-- 2. Index for performance
CREATE INDEX IF NOT EXISTS idx_tenants_parent_id ON tenants(parent_id);

-- 3. Update existing tenants to 'standalone'
UPDATE tenants SET business_type = 'standalone' WHERE business_type IS NULL;
