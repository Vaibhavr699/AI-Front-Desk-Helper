-- ═══════════════════════════════════════════════════════════════════════
-- Migration 084 — Phase 10E DISC-Adaptive Cadence
-- May 27, 2026
--
-- Adds three columns to recovery_settings to enable per-tenant DISC-aware
-- cadence scaling on top of the existing Phase 10 recovery system.
--
--   disc_adaptive_cadence_enabled
--     Master toggle for the feature, per tenant. Default FALSE — ships
--     dark. Flip per tenant when ready to A/B against the static cadence.
--
--   disc_cadence_multipliers
--     Per-tenant override of the default DISC bucket multipliers. Each
--     bucket scales the BASE delay between recovery touches:
--       D (Driver/Direct)    — 0.6× : faster, more direct
--       I (Influencer)       — 1.0× : default pacing, warm enough
--       S (Steady/Patient)   — 1.5× : slower, no pressure
--       C (Compliant/Detail) — 1.3× : slightly slower, time to weigh
--       unknown              — 1.0× : default for unclassified or
--                                     low-confidence leads
--
--   disc_cadence_min_confidence
--     Floor below which we treat the lead as unknown. Phase 8 classifier
--     produces 0.0–1.0 floats; live data shows 0.30–0.86 range with mean
--     0.67. Default 0.6 keeps borderline classifications out of the
--     adaptive flow — bad inferences are worse than no inferences,
--     because they act on noise.
--
-- All three columns are NOT NULL with defaults, so existing tenant rows
-- get the safe-by-default values automatically. No backfill needed.
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE recovery_settings
  ADD COLUMN IF NOT EXISTS disc_adaptive_cadence_enabled bool NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS disc_cadence_multipliers jsonb NOT NULL DEFAULT
    '{"D":0.6,"I":1.0,"S":1.5,"C":1.3,"unknown":1.0}'::jsonb,
  ADD COLUMN IF NOT EXISTS disc_cadence_min_confidence numeric NOT NULL DEFAULT 0.6;

