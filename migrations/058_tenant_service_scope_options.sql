-- Migration 052: owner-facing scope toggles per service
-- Phase V2 (May 5, 2026)

-- Table 1: catalog of available toggles per service
CREATE TABLE vertical_scope_options (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vertical_service_id UUID NOT NULL REFERENCES vertical_services(id) ON DELETE CASCADE,
  option_key TEXT NOT NULL,
  display_label TEXT NOT NULL,
  default_enabled BOOLEAN NOT NULL DEFAULT false,
  affects_includes_text BOOLEAN NOT NULL DEFAULT true,
  price_modifier_default NUMERIC(8,4),
  modifier_type TEXT CHECK (modifier_type IN ('percent', 'flat', 'per_unit', 'per_lf', 'per_sq')),
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(vertical_service_id, option_key)
);

-- Table 2: per-tenant toggle state (overrides catalog defaults)
CREATE TABLE tenant_service_scope_options (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  vertical_service_id UUID NOT NULL REFERENCES vertical_services(id) ON DELETE CASCADE,
  option_key TEXT NOT NULL,
  enabled BOOLEAN NOT NULL,
  price_modifier_override NUMERIC(8,4),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, vertical_service_id, option_key)
);

-- Index for fast tenant lookup
CREATE INDEX idx_tenant_scope_options_tenant ON tenant_service_scope_options(tenant_id);

-- Seed: painting interior toggles (assumes vertical_services rows exist)
INSERT INTO vertical_scope_options (vertical_service_id, option_key, display_label, default_enabled, modifier_type, price_modifier_default, display_order)
SELECT id, 'include_trim', 'Include trim & baseboards', true, 'percent', 12.0, 1
FROM vertical_services WHERE service_slug = 'painting_interior';
-- ... repeated for ceilings, doors, closets, exterior toggles, roofing, fencing
