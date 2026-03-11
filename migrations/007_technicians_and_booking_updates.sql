-- Migration 007: Technicians and Booking Enhancements

CREATE TABLE IF NOT EXISTS technicians (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  email        TEXT,
  phone        TEXT,
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_technicians_tenant ON technicians(tenant_id);

-- Update bookings table
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS technician_id UUID REFERENCES technicians(id) ON DELETE SET NULL;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS appointment_time TIME;

-- Update existing statuses to match requested set if needed, though they are just strings now
-- Requested: Booked, Confirmed, Completed, Rescheduled, Cancelled
-- Current default is 'scheduled', we should probably align 'scheduled' with 'Booked'
UPDATE bookings SET status = 'Booked' WHERE status = 'scheduled';
