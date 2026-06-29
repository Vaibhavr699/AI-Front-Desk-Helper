-- Migration 053: Cancellation Flow
-- Adds columns to track WHEN, HOW, and WHY a booking was cancelled,
-- plus google_event_id for Phase 3 calendar deletion.

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS cancelled_via TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS google_event_id TEXT;

-- Verify
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'bookings'
  AND column_name IN ('cancelled_at', 'cancelled_via', 'cancellation_reason', 'google_event_id');
