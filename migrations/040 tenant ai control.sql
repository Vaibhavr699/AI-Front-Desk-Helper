- ═════════════════════════════════════════════════════════════════════
-- Migration 040 — Tenant-wide AI Control (Apr 23, 2026)
--
-- Pivot from per-phone routing (mig 039) to tenant-wide routing. All
-- phone lines on a tenant now follow the same AI Control settings.
-- Mig 039 phone_numbers cols stay in DB but become permanently dormant.
--
-- 6 new cols on tenants:
--   ai_master_enabled          bool  — hard kill switch ("turn AI off")
--   ai_answers_after_hours     bool  — 24/7 (false) vs after-hours only (true)
--   ring_first_enabled         bool  — ring a human first before AI
--   ring_first_phone           text  — E.164 destination (CHECK enforced)
--   ring_first_timeout_seconds int   — ring duration, 5–60, default 20
--   voicemail_message_url      text  — optional custom voicemail greeting
--
-- Cross-field CHECK: ring_first_enabled=true requires ring_first_phone
-- NOT NULL. Matches the pattern used on phone_numbers in mig 039 so the
-- backend validator in routes/dashboard.js gets clean 23514 errors it
-- can translate to 400.
--
-- Note: afterhours_behavior col stays on tenants (DB), but the UI
-- retires the dropdown per the Apr 23 pivot. Leaving the col in place
-- means no data loss for tenants who set it previously.
-- ═════════════════════════════════════════════════════════════════════
 
BEGIN;
 
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS ai_master_enabled          boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS ai_answers_after_hours     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ring_first_enabled         boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ring_first_phone           text,
  ADD COLUMN IF NOT EXISTS ring_first_timeout_seconds integer NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS voicemail_message_url      text;
 
-- E.164 format check on ring_first_phone (matches the pattern used on
-- phone_numbers.ring_first_phone in mig 039). NULL is allowed.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tenants_ring_first_phone_format'
  ) THEN
    ALTER TABLE tenants
      ADD CONSTRAINT tenants_ring_first_phone_format
      CHECK (
        ring_first_phone IS NULL
        OR ring_first_phone ~ '^\+[1-9]\d{1,14}$'
      );
  END IF;
END$$;
 
-- Timeout range check (5–60 seconds). Matches mig 039 bound on the
-- phone_numbers column so validator behavior is identical.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tenants_ring_first_timeout_range'
  ) THEN
    ALTER TABLE tenants
      ADD CONSTRAINT tenants_ring_first_timeout_range
      CHECK (ring_first_timeout_seconds BETWEEN 5 AND 60);
  END IF;
END$$;
 
-- Cross-field CHECK: if ring_first_enabled is true, ring_first_phone
-- must be populated. Deferred check style so bulk updates can set both
-- fields in any order within a single UPDATE.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tenants_ring_first_phone_required'
  ) THEN
    ALTER TABLE tenants
      ADD CONSTRAINT tenants_ring_first_phone_required
      CHECK (
        ring_first_enabled = false
        OR ring_first_phone IS NOT NULL
      );
  END IF;
END$$;
 
-- voicemail_message_url sanity: if set, must be https and reasonable
-- length. We don't enforce .mp3/.wav at the DB layer — the validator in
-- routes/dashboard.js handles that with a friendlier error message.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tenants_voicemail_url_format'
  ) THEN
    ALTER TABLE tenants
      ADD CONSTRAINT tenants_voicemail_url_format
      CHECK (
        voicemail_message_url IS NULL
        OR (
          voicemail_message_url ~ '^https://'
          AND length(voicemail_message_url) <= 2000
        )
      );
  END IF;
END$$;
 
COMMIT;
 
-- ─── Verification queries (run manually after the migration) ─────────
-- SELECT ai_master_enabled, ai_answers_after_hours, ring_first_enabled,
--        ring_first_phone, ring_first_timeout_seconds, voicemail_message_url
--   FROM tenants
--  WHERE id = 'a2942de5-5bfd-4cb1-8071-9207fe290a4b';
--
-- Expected row for Gladiators right after migration:
--   ai_master_enabled          = true
--   ai_answers_after_hours     = false
--   ring_first_enabled         = false
--   ring_first_phone           = NULL
--   ring_first_timeout_seconds = 20
--   voicemail_message_url      = NULL
 
