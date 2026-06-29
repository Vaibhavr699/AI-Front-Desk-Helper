-- ============================================================================
-- Migration 051 — vertical_services.includes_text
-- ============================================================================
-- Phase 7 V1.5 (May 5, 2026)
--
-- Adds an includes_text column to vertical_services so the chat widget can
-- show "what's included" text dynamically per service rather than relying on
-- a hardcoded JS constant. Sets up V2 multi-vertical (roofing, fence) where
-- each vertical needs its own includes text.
-- ============================================================================

BEGIN;

-- Step 1: Add the column (nullable so existing rows don't break)
ALTER TABLE vertical_services
  ADD COLUMN IF NOT EXISTS includes_text TEXT;

-- Step 2: Seed painting vertical's 4 services with current widget defaults
-- These match the INCLUDES_BY_SERVICE constant in chat-widget.js
UPDATE vertical_services
   SET includes_text = 'walls, ceilings, trim, and doors'
 WHERE service_slug = 'interior'
   AND vertical_id = (SELECT vertical_id FROM verticals WHERE slug = 'painting' LIMIT 1);

UPDATE vertical_services
   SET includes_text = 'siding, soffits, eaves, trim, and garage door'
 WHERE service_slug = 'exterior'
   AND vertical_id = (SELECT vertical_id FROM verticals WHERE slug = 'painting' LIMIT 1);

UPDATE vertical_services
   SET includes_text = 'doors, drawer fronts, and frames'
 WHERE service_slug = 'cabinets'
   AND vertical_id = (SELECT vertical_id FROM verticals WHERE slug = 'painting' LIMIT 1);

UPDATE vertical_services
   SET includes_text = 'all paintable surfaces'
 WHERE service_slug = 'deck_fence'
   AND vertical_id = (SELECT vertical_id FROM verticals WHERE slug = 'painting' LIMIT 1);

COMMENT ON COLUMN vertical_services.includes_text IS
  'Phase 7 V1.5 — Display text shown in chat widget for "what''s included" per service. Per-vertical customizable for V2 multi-vertical support.';

COMMIT;
