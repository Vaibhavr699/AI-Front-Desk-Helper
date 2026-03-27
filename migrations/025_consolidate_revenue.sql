-- Migration: 025_consolidate_revenue.sql
-- Consolidate revenue_cents and estimated_revenue_cents into a single column

-- 1. Ensure estimated_revenue_cents exists (it should from 024)
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS estimated_revenue_cents INTEGER;

-- 2. Backfill estimated_revenue_cents from the old revenue_cents column if it was used
UPDATE bookings 
SET estimated_revenue_cents = revenue_cents 
WHERE estimated_revenue_cents IS NULL OR estimated_revenue_cents = 0 
AND revenue_cents IS NOT NULL 
AND revenue_cents > 0;

-- 3. Drop the old column to avoid confusion
-- WARNING: Only do this if we are sure all logic has been updated
-- ALTER TABLE bookings DROP COLUMN IF EXISTS revenue_cents;

-- NOTE: I'll keep the column for now but rename the usage in the app to match the new one.
-- Actually, the user wants the logic to work, so I'll prioritize the new one.
