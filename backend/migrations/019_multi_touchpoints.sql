-- Multi-touchpoint maintenance & re-engagement
-- Each is a JSONB array of { months: number, header: string } (up to 3 entries)

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS maintenance_touchpoints JSONB DEFAULT '[{"months": 6, "header": ""}]';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS reengagement_touchpoints JSONB DEFAULT '[{"months": 12, "header": ""}]';

-- Add metadata column to nurturing_schedule for touchpoint-specific data (index, header)
ALTER TABLE nurturing_schedule ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';
