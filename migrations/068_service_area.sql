-- Migration 068: Service Area Boundary (May 14, 2026)
-- Adds tenant-level service area so the AI knows when to decline
-- out-of-area work and capture an expansion lead instead of
-- hallucinating coverage (cf. Massachusetts incident, May 13).
--
-- Three shapes (discriminated by `type`):
--   { "type": "states", "values": ["NE","IA"],    "home_city": "Omaha", "home_state": "NE" }
--   { "type": "radius", "values": [30],           "home_city": "Omaha", "home_state": "NE" }
--   { "type": "zips",   "values": ["68022", ...], "home_city": "Omaha", "home_state": "NE" }
--
-- NULL = no boundary configured → AI behavior is unchanged (Pass 1 null-safe default).

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS service_area JSONB DEFAULT NULL;

-- Defense in depth: ensure shape is one of the three types when set.
-- App-level validation also enforces this in routes/serviceArea.js.
ALTER TABLE tenants
  ADD CONSTRAINT service_area_type_check CHECK (
    service_area IS NULL
    OR (service_area->>'type') IN ('states', 'radius', 'zips')
  );

COMMENT ON COLUMN tenants.service_area IS
  'JSONB service area boundary. NULL = no boundary. Shape: { type, values, home_city, home_state }. See routes/serviceArea.js for validation rules.';
