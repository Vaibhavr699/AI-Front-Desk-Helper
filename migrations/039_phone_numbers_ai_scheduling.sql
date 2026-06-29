-- Migration 039: AI Scheduling + Master Toggle + Ring-First (per-phone config)
-- Apr 23, 2026 — Build 1
--
-- Adds 6 columns to phone_numbers:
--   ai_status                  : master on/off per number (default 'on')
--   ring_first_enabled         : ring a human before handing to AI
--   ring_first_phone           : E.164 destination for ring-first
--   ring_first_timeout_seconds : Dial timeout (5-60s, default 20)
--   business_hours_enabled     : per-phone opt-in to tenant BH schedule
--   voicemail_message_url      : custom voicemail URL (MP3/WAV over HTTPS)
--
-- Tenant-level schedule stays at tenants.business_hours + tenants.timezone.
-- Phones opt in to it via business_hours_enabled. Default false preserves
-- pre-Build-1 24/7 AI answering for existing tenants.

BEGIN;

ALTER TABLE phone_numbers
  ADD COLUMN IF NOT EXISTS ai_status                  TEXT    NOT NULL DEFAULT 'on',
  ADD COLUMN IF NOT EXISTS ring_first_enabled         BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ring_first_phone           TEXT,
  ADD COLUMN IF NOT EXISTS ring_first_timeout_seconds INTEGER NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS business_hours_enabled     BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS voicemail_message_url      TEXT;

-- ai_status must be exactly 'on' or 'off'. Using a named constraint so the
-- ALTER is idempotent (DROP IF EXISTS + ADD).
ALTER TABLE phone_numbers
  DROP CONSTRAINT IF EXISTS phone_numbers_ai_status_check;
ALTER TABLE phone_numbers
  ADD CONSTRAINT phone_numbers_ai_status_check
  CHECK (ai_status IN ('on', 'off'));

-- Twilio <Dial timeout> accepts 1-600 but practical range for a ring-before-AI
-- flow is 5-60 seconds. Below 5 is useless, above 60 the caller walks away.
ALTER TABLE phone_numbers
  DROP CONSTRAINT IF EXISTS phone_numbers_ring_first_timeout_check;
ALTER TABLE phone_numbers
  ADD CONSTRAINT phone_numbers_ring_first_timeout_check
  CHECK (ring_first_timeout_seconds BETWEEN 5 AND 60);

-- If ring-first is enabled, a destination phone MUST be set. Prevents a
-- half-configured row from producing an invalid <Dial></Dial> tag at runtime.
ALTER TABLE phone_numbers
  DROP CONSTRAINT IF EXISTS phone_numbers_ring_first_phone_required;
ALTER TABLE phone_numbers
  ADD CONSTRAINT phone_numbers_ring_first_phone_required
  CHECK (NOT ring_first_enabled OR ring_first_phone IS NOT NULL);

-- E.164 format check when a ring-first phone IS provided. Matches the
-- existing normalizePhoneInput() output shape in routes/dashboard.js.
ALTER TABLE phone_numbers
  DROP CONSTRAINT IF EXISTS phone_numbers_ring_first_phone_format;
ALTER TABLE phone_numbers
  ADD CONSTRAINT phone_numbers_ring_first_phone_format
  CHECK (ring_first_phone IS NULL OR ring_first_phone ~ '^\+[1-9][0-9]{6,14}$');

-- Partial index to make the GOTCHA#23 self-bridge check cheap — we only look
-- up ring_first_phone for numbers that have ring-first enabled.
DROP INDEX IF EXISTS idx_phone_numbers_ring_first;
CREATE INDEX idx_phone_numbers_ring_first
  ON phone_numbers (ring_first_phone)
  WHERE ring_first_enabled = true;

COMMIT;
