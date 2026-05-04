-- ============================================================================
-- Migration 052 — Rename estimator_widget_enabled → estimator_enabled
-- ============================================================================
-- Phase 7 V1.5 (May 4, 2026)
--
-- Original column name was misleading: it gates ALL estimator surfaces, not
-- just the chat widget. After Phase 7 V1 shipped, this column became the
-- master toggle for: chat widget Quick Quote, popup, voice handoff (V2),
-- and SMS estimator (V2). Renaming now before V2 builds reference it.
--
-- Single-PR rename. Code changes deploy together with this migration.
-- ============================================================================

BEGIN;

ALTER TABLE tenants
  RENAME COLUMN estimator_widget_enabled TO estimator_enabled;

COMMENT ON COLUMN tenants.estimator_enabled IS
  'Phase 7 V1.5 — Master toggle for all estimator surfaces (widget Quick Quote, popup, V2 voice handoff, V2 SMS estimator). Was estimator_widget_enabled before May 4, 2026.';

COMMIT;
