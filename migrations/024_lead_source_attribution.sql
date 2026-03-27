-- Migration: 024_lead_source_attribution.sql
-- Add lead source tracking across the system

-- 1. Add lead_source to phone_numbers to label each number
ALTER TABLE phone_numbers ADD COLUMN IF NOT EXISTS lead_source TEXT;
ALTER TABLE phone_numbers ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;

-- 2. Add lead_source to calls for inbound attribution
ALTER TABLE calls ADD COLUMN IF NOT EXISTS lead_source TEXT;
CREATE INDEX IF NOT EXISTS idx_calls_lead_source ON calls(lead_source);

-- 3. Add lead_source and estimated_revenue_cents to bookings for ROI tracking
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS lead_source TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS estimated_revenue_cents INTEGER;
CREATE INDEX IF NOT EXISTS idx_bookings_lead_source ON bookings(lead_source);

-- 4. Add lead_source to leads for consistency
ALTER TABLE leads ADD COLUMN IF NOT EXISTS lead_source TEXT;
CREATE INDEX IF NOT EXISTS idx_leads_lead_source ON leads(lead_source);

-- Update existing data if possible (e.g., set default to 'direct' or 'phone')
UPDATE phone_numbers SET lead_source = 'Direct' WHERE lead_source IS NULL AND is_primary = true;
UPDATE phone_numbers SET lead_source = 'Other' WHERE lead_source IS NULL AND is_primary = false;
