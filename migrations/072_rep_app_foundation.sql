-- ============================================================================
-- Migration 072 — Rep App Foundation (Phase 6 C)
-- Date:    May 19, 2026
-- Phase:   Phase 6 C (AI Front Desk Helper Rep Mobile Platform — Foundation)
--
-- Adds the schema the rep mobile app needs for:
--   • Seat-based access control ($119 Standard / $199 Pro / $249 Elite)
--   • TOTP-based MFA on first login per device per day
--   • Trusted-device tokens (skip TOTP for 30 days on known devices)
--   • Expo push token registration
--   • Coaching delivery preferences (audio / watch / pop-up / sidebar)
--   • Per-user event firehose (logins, screen views, alert outcomes — feeds
--     Phase 11 cross-tenant pattern mining)
--   • Anti-sharing violation log (multi-device-fingerprint, geo-jump, biometric
--     swap detection — staff review queue)
--
-- All columns are additive. Existing rows default to rep_seat_active = false,
-- which means no current dashboard user gains app access until a tenant admin
-- flips the flag for them.
-- ============================================================================

BEGIN;

-- ─── dashboard_users — rep seat + MFA + device columns ──────────────────────
ALTER TABLE dashboard_users
  ADD COLUMN IF NOT EXISTS rep_seat_active           BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS rep_seat_tier             TEXT    DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS rep_seat_activated_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS totp_secret               TEXT,
  ADD COLUMN IF NOT EXISTS trusted_devices           JSONB   DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS expo_push_token           TEXT,
  ADD COLUMN IF NOT EXISTS last_app_open_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS preferred_earbud_device   TEXT,
  ADD COLUMN IF NOT EXISTS coaching_delivery_prefs   JSONB
    DEFAULT '{"audio": true, "watch": true, "popup": true, "sidebar": true}'::jsonb;

COMMENT ON COLUMN dashboard_users.rep_seat_tier IS
  'One of: standard ($119/mo, visual coaching only), pro ($199/mo, +earbud audio), elite ($249/mo, +watch + manager live view + custom rules).';
COMMENT ON COLUMN dashboard_users.trusted_devices IS
  'Array of { fingerprint, token_hash, registered_at, expires_at, biometric_type } objects. Hashed device tokens that let the rep skip TOTP for 30 days on a known device.';
COMMENT ON COLUMN dashboard_users.coaching_delivery_prefs IS
  'Per-rep delivery channel toggles. App auto-detects what is connected (earbud/watch/tablet) at session start; these flags let the rep mute any channel even when connected.';

-- Filter index for the dashboard "active reps" list — most dashboard_users
-- rows are dashboard-only users without a seat, so a partial index is enough.
CREATE INDEX IF NOT EXISTS idx_dashboard_users_rep_seat_active
  ON dashboard_users(tenant_id, rep_seat_tier)
  WHERE rep_seat_active = true;

-- ─── rep_app_events — full event firehose ───────────────────────────────────
-- Every login, screen view, coaching-alert outcome, roleplay completion,
-- in-home session start/end, etc. is appended here. Drives:
--   • Anti-sharing detection (device fingerprint changes, geo jumps)
--   • Per-rep coaching analytics
--   • Phase 11 cross-tenant pattern mining
CREATE TABLE IF NOT EXISTS rep_app_events (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID REFERENCES dashboard_users(id) ON DELETE CASCADE,
  tenant_id           UUID REFERENCES tenants(id) ON DELETE CASCADE,
  event_type          TEXT NOT NULL,
  event_metadata      JSONB DEFAULT '{}'::jsonb,
  device_fingerprint  TEXT,
  device_type         TEXT,
  ip_address          INET,
  app_version         TEXT,
  created_at          TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rep_app_events_user_created
  ON rep_app_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rep_app_events_tenant_created
  ON rep_app_events(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rep_app_events_type_created
  ON rep_app_events(event_type, created_at DESC);

-- ─── rep_anti_sharing_violations — review queue ─────────────────────────────
-- Populated by the anti-sharing detector (runs on each login + nightly cron).
-- First violation → soft reminder + force TOTP. Second within 30 days → hard
-- block + admin alert. Resolved when staff manually closes the row.
CREATE TABLE IF NOT EXISTS rep_anti_sharing_violations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID REFERENCES dashboard_users(id) ON DELETE CASCADE,
  tenant_id           UUID REFERENCES tenants(id) ON DELETE CASCADE,
  violation_type      TEXT NOT NULL,
  violation_metadata  JSONB DEFAULT '{}'::jsonb,
  severity            TEXT,
  resolved_at         TIMESTAMPTZ,
  resolved_by_user_id UUID REFERENCES dashboard_users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rep_anti_sharing_user_created
  ON rep_anti_sharing_violations(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rep_anti_sharing_open
  ON rep_anti_sharing_violations(tenant_id, created_at DESC)
  WHERE resolved_at IS NULL;

-- ─── Verification ───────────────────────────────────────────────────────────
DO $$
DECLARE
  v_seat_col   INTEGER;
  v_totp_col   INTEGER;
  v_trust_col  INTEGER;
  v_events_t   INTEGER;
  v_violations INTEGER;
  v_seat_idx   INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_seat_col
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'dashboard_users'
     AND column_name = 'rep_seat_active';

  SELECT COUNT(*) INTO v_totp_col
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'dashboard_users'
     AND column_name = 'totp_secret';

  SELECT COUNT(*) INTO v_trust_col
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'dashboard_users'
     AND column_name = 'trusted_devices';

  SELECT COUNT(*) INTO v_events_t
    FROM information_schema.tables
   WHERE table_schema = 'public' AND table_name = 'rep_app_events';

  SELECT COUNT(*) INTO v_violations
    FROM information_schema.tables
   WHERE table_schema = 'public' AND table_name = 'rep_anti_sharing_violations';

  SELECT COUNT(*) INTO v_seat_idx
    FROM pg_indexes
   WHERE schemaname = 'public' AND indexname = 'idx_dashboard_users_rep_seat_active';

  RAISE NOTICE '====================================================================';
  RAISE NOTICE 'Migration 072 — Rep App Foundation COMPLETE';
  RAISE NOTICE '====================================================================';
  RAISE NOTICE 'dashboard_users.rep_seat_active:       %  (expected: 1)', v_seat_col;
  RAISE NOTICE 'dashboard_users.totp_secret:           %  (expected: 1)', v_totp_col;
  RAISE NOTICE 'dashboard_users.trusted_devices:       %  (expected: 1)', v_trust_col;
  RAISE NOTICE 'rep_app_events table:                  %  (expected: 1)', v_events_t;
  RAISE NOTICE 'rep_anti_sharing_violations table:     %  (expected: 1)', v_violations;
  RAISE NOTICE 'idx_dashboard_users_rep_seat_active:   %  (expected: 1)', v_seat_idx;
  RAISE NOTICE '====================================================================';
END $$;

COMMIT;
