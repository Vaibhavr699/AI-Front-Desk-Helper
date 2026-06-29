-- =============================================================================
-- Migration 058: Owner-facing scope toggles per service
-- =============================================================================
-- Phase V2 (May 5, 2026) — adds the schema for owner-controlled scope toggles
-- (e.g. "include trim", "include doors", "include gutters") that adjust both
-- estimator pricing AND the customer-facing "What's included" strip.
--
-- Customer never sees toggles. Owner configures default scope in Settings,
-- estimator computes a single price + clear includes line based on those
-- choices. Pattern works across painting, roofing, fencing, and any future
-- vertical.
--
-- Two tables:
--   1. vertical_scope_options       — catalog of available toggles per service
--   2. tenant_service_scope_options — per-tenant chosen state (overrides catalog)
--
-- Seed data covers the three main painting services. Deck/fence is skipped
-- because the service is a catch-all that needs splitting before scope
-- toggles make sense (different toggles for decks vs fences).
--
-- Roofing + fencing toggles will land in their respective vertical-launch
-- migrations alongside their vertical_services rows.
-- =============================================================================

-- Clean up any partial state. Safe to drop because:
--   - Previous run created the tables but seeded zero rows (slug mismatch)
--   - No application code reads these tables yet
--   - No tenant has flipped any toggles yet
DROP TABLE IF EXISTS tenant_service_scope_options CASCADE;
DROP TABLE IF EXISTS vertical_scope_options CASCADE;

-- =============================================================================
-- TABLE 1: vertical_scope_options
-- Catalog. Defines what toggles are available for each service.
-- =============================================================================
CREATE TABLE vertical_scope_options (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vertical_service_id     INTEGER NOT NULL REFERENCES vertical_services(id) ON DELETE CASCADE,
  option_key              TEXT NOT NULL,
  display_label           TEXT NOT NULL,
  default_enabled         BOOLEAN NOT NULL DEFAULT false,
  affects_includes_text   BOOLEAN NOT NULL DEFAULT true,
  modifier_type           TEXT NOT NULL CHECK (modifier_type IN ('percent','flat','per_unit','per_lf','per_sq')),
  price_modifier_default  NUMERIC(10,4),
  display_order           INTEGER NOT NULL DEFAULT 0,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (vertical_service_id, option_key)
);

CREATE INDEX idx_vertical_scope_options_service
  ON vertical_scope_options(vertical_service_id);

COMMENT ON TABLE vertical_scope_options IS
  'Catalog of available scope toggles per service (e.g. include_trim, include_doors). Seeds in migrations 058+.';
COMMENT ON COLUMN vertical_scope_options.modifier_type IS
  'percent=% of base; flat=fixed $; per_unit=$ per item (count comes from estimator question); per_lf=per linear foot; per_sq=per square (roofing).';
COMMENT ON COLUMN vertical_scope_options.affects_includes_text IS
  'When true, toggling this option updates the customer-facing "What''s included" strip on the estimator page.';

-- =============================================================================
-- TABLE 2: tenant_service_scope_options
-- Per-tenant chosen state. When the owner flips "include doors" ON,
-- a row gets inserted/updated here.
-- =============================================================================
CREATE TABLE tenant_service_scope_options (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  vertical_service_id      INTEGER NOT NULL REFERENCES vertical_services(id) ON DELETE CASCADE,
  option_key               TEXT NOT NULL,
  enabled                  BOOLEAN NOT NULL,
  price_modifier_override  NUMERIC(10,4),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, vertical_service_id, option_key)
);

CREATE INDEX idx_tenant_scope_options_tenant
  ON tenant_service_scope_options(tenant_id);

CREATE INDEX idx_tenant_scope_options_lookup
  ON tenant_service_scope_options(tenant_id, vertical_service_id);

COMMENT ON TABLE tenant_service_scope_options IS
  'Per-tenant scope toggle state. Absent row = use vertical_scope_options.default_enabled.';
COMMENT ON COLUMN tenant_service_scope_options.price_modifier_override IS
  'Optional per-tenant override of catalog default modifier. NULL = use catalog value.';

-- =============================================================================
-- SEED: interior (per-room bundled)
-- =============================================================================
-- Defaults reflect what most painters quote standard:
--   trim + ceilings included; doors + closets quoted on walkthrough.
INSERT INTO vertical_scope_options
  (vertical_service_id, option_key, display_label, default_enabled, modifier_type, price_modifier_default, display_order)
SELECT id, 'include_trim',     'Include trim & baseboards',  true,  'percent',  12.0, 1 FROM vertical_services WHERE service_slug = 'interior'
UNION ALL
SELECT id, 'include_ceilings', 'Include ceilings',           true,  'percent',  18.0, 2 FROM vertical_services WHERE service_slug = 'interior'
UNION ALL
SELECT id, 'include_doors',    'Include interior doors',     false, 'per_unit', 75.0, 3 FROM vertical_services WHERE service_slug = 'interior'
UNION ALL
SELECT id, 'include_closets',  'Include closet interiors',   false, 'percent',  8.0,  4 FROM vertical_services WHERE service_slug = 'interior';

-- =============================================================================
-- SEED: exterior (per-paintable-sqft)
-- =============================================================================
-- Trim/fascia almost always bundled. Gutters/shutters/garage door usually
-- quoted separately because they're add-ons on the in-person walkthrough.
INSERT INTO vertical_scope_options
  (vertical_service_id, option_key, display_label, default_enabled, modifier_type, price_modifier_default, display_order)
SELECT id, 'include_trim_fascia',  'Include trim & fascia',     true,  'percent',  10.0,  1 FROM vertical_services WHERE service_slug = 'exterior'
UNION ALL
SELECT id, 'include_gutters',      'Include gutters',           false, 'percent',  8.0,   2 FROM vertical_services WHERE service_slug = 'exterior'
UNION ALL
SELECT id, 'include_shutters',     'Include shutters',          false, 'per_unit', 35.0,  3 FROM vertical_services WHERE service_slug = 'exterior'
UNION ALL
SELECT id, 'include_garage_door',  'Include garage door',       false, 'flat',     200.0, 4 FROM vertical_services WHERE service_slug = 'exterior';

-- =============================================================================
-- SEED: cabinets (bundled per facing)
-- =============================================================================
-- Doors/drawers basically required (the visible part). Inside boxes + hardware
-- are common upsells on the walkthrough.
INSERT INTO vertical_scope_options
  (vertical_service_id, option_key, display_label, default_enabled, modifier_type, price_modifier_default, display_order)
SELECT id, 'include_doors_drawers', 'Include doors & drawer fronts', true,  'percent',  20.0, 1 FROM vertical_services WHERE service_slug = 'cabinets'
UNION ALL
SELECT id, 'include_inside_boxes',  'Include inside cabinet boxes',  false, 'percent',  30.0, 2 FROM vertical_services WHERE service_slug = 'cabinets'
UNION ALL
SELECT id, 'include_hardware_swap', 'Include new hardware install',  false, 'per_unit', 10.0, 3 FROM vertical_services WHERE service_slug = 'cabinets';

-- =============================================================================
-- SEED: deck_fence — INTENTIONALLY SKIPPED
-- =============================================================================
-- The deck_fence service is a catch-all for both decks AND fences, but the
-- two have completely different scope concerns:
--   Deck:  railings, stairs, pickets/balusters, post caps, stain vs paint
--   Fence: gates beyond first, post depth, height, removal of old fence
--
-- Best path forward: split deck_fence into two services (deck + fence) in a
-- future migration, then add toggles per service. Doing it that way keeps the
-- toggle UI clean for owners and the includes-text accurate for customers.
--
-- For now, deck_fence service stays functional with no scope toggles —
-- pricing comes purely from the base formula in vertical_services.
-- =============================================================================

-- =============================================================================
-- VERIFICATION
-- Run this to confirm seeds landed correctly. All four services should now
-- show toggle_count > 0 except deck_fence (intentionally 0 — see comment above).
-- =============================================================================
SELECT
  vs.service_slug,
  COUNT(vso.id) AS toggle_count,
  STRING_AGG(vso.option_key, ', ' ORDER BY vso.display_order) AS toggles
FROM vertical_services vs
LEFT JOIN vertical_scope_options vso ON vso.vertical_service_id = vs.id
GROUP BY vs.service_slug
ORDER BY vs.service_slug;

-- Expected output:
--  service_slug  | toggle_count | toggles
-- ---------------+--------------+--------------------------------------------------------------
--  cabinets      |            3 | include_doors_drawers, include_inside_boxes, include_hardware_swap
--  deck_fence    |            0 | (none — intentionally skipped, see migration comment)
--  exterior      |            4 | include_trim_fascia, include_gutters, include_shutters, include_garage_door
--  interior      |            4 | include_trim, include_ceilings, include_doors, include_closets
