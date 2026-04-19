-- Add state column to bookings table
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS state TEXT;
