-- =====================================================================
-- Migration 074: Recovery Toggle System (Phase 10)
-- =====================================================================
-- Adds:
--   * recovery_settings table (1:1 with tenants)
--   * Per-lead override columns on leads
--   * Backfill all existing tenants with industry-based default presets
-- Industry defaults: roofing/home_ext = aggressive, fence = gentle,
--                    everything else = standard
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. recovery_settings table
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS recovery_settings (
  tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,

  -- 10A: Master + channels
  recovery_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  sms_enabled      BOOLEAN NOT NULL DEFAULT TRUE,
  email_enabled    BOOLEAN NOT NULL DEFAULT TRUE,
  voice_enabled    BOOLEAN NOT NULL DEFAULT TRUE,

  -- 10B: Cadence preset
  cadence_preset TEXT NOT NULL DEFAULT 'standard'
    CHECK (cadence_preset IN ('aggressive','standard','gentle','single','custom')),
  custom_cadence_days INTEGER[] DEFAULT NULL,

  -- 10B granular per-trigger toggles (Pro+)
  trigger_estimate_recovery     BOOLEAN NOT NULL DEFAULT TRUE,
  trigger_missed_call           BOOLEAN NOT NULL DEFAULT TRUE,
  trigger_appointment_reminder  BOOLEAN NOT NULL DEFAULT TRUE,
  trigger_nurturing             BOOLEAN NOT NULL DEFAULT TRUE,
  trigger_voicemail_followup    BOOLEAN NOT NULL DEFAULT TRUE,
  trigger_no_show               BOOLEAN NOT NULL DEFAULT TRUE,

  -- 10C: Quiet hours
  quiet_hours_enabled  BOOLEAN NOT NULL DEFAULT TRUE,
  quiet_hours_start    TIME    NOT NULL DEFAULT '21:00',
  quiet_hours_end      TIME    NOT NULL DEFAULT '08:00',
  quiet_hours_timezone TEXT    NOT NULL DEFAULT 'America/Chicago',
  quiet_hours_weekend  BOOLEAN NOT NULL DEFAULT FALSE,

  -- 10D: Auto-pause on negative sentiment
  auto_pause_enabled              BOOLEAN NOT NULL DEFAULT TRUE,
  auto_pause_sentiment_threshold  NUMERIC(3,2) NOT NULL DEFAULT -0.50,
  auto_pause_keywords             TEXT[] NOT NULL DEFAULT ARRAY[
    'stop','unsubscribe','remove me','not interested',
    'quit calling','quit texting','leave me alone','do not contact'
  ],

  -- Data flywheel (memory line 24)
  industry_tag           TEXT,
  cohort_analysis_opt_in BOOLEAN NOT NULL DEFAULT FALSE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recovery_settings_enabled
  ON recovery_settings(tenant_id) WHERE recovery_enabled = TRUE;

-- ---------------------------------------------------------------------
-- 2. Per-lead override columns on leads
-- ---------------------------------------------------------------------
ALTER TABLE leads ADD COLUMN IF NOT EXISTS recovery_paused          BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS recovery_paused_reason   TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS recovery_paused_at       TIMESTAMPTZ;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS recovery_paused_by       UUID;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS recovery_cadence_override TEXT
  CHECK (recovery_cadence_override IS NULL OR
         recovery_cadence_override IN ('aggressive','standard','gentle','single','off'));

CREATE INDEX IF NOT EXISTS idx_leads_recovery_active
  ON leads(tenant_id) WHERE recovery_paused = FALSE;

-- ---------------------------------------------------------------------
-- 3. Backfill: row for every existing tenant with industry default
-- ---------------------------------------------------------------------
INSERT INTO recovery_settings (tenant_id, cadence_preset, industry_tag)
SELECT
  t.id,
  CASE
    WHEN COALESCE(t.industry, '') IN ('roofing','home_ext','home_exterior') THEN 'aggressive'
    WHEN COALESCE(t.industry, '') = 'fence' THEN 'gentle'
    ELSE 'standard'
  END,
  t.industry
FROM tenants t
ON CONFLICT (tenant_id) DO NOTHING;

COMMIT;

-- =====================================================================
-- Verification queries (run after migration)
-- =====================================================================
-- SELECT COUNT(*) AS tenant_count,
--        COUNT(*) FILTER (WHERE recovery_enabled) AS recovery_on
-- FROM recovery_settings;
--
-- SELECT cadence_preset, COUNT(*) FROM recovery_settings GROUP BY 1;
--
-- SELECT * FROM recovery_settings
-- WHERE tenant_id = 'a2942de5-5bfd-4cb1-8071-9207fe290a4b';  -- Gladiators
