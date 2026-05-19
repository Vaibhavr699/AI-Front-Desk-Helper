-- ============================================================================
-- Migration 081 — Phase 8A DISC Classifier v0
-- Date: May 19, 2026
--
-- Adds DISC quadrant classification fields to coaching_conversations and
-- leads. DISC is computed alongside the existing buyer_persona in a single
-- GPT-4o call (see lib/coachingEngine.js detectPersona), so no new cron and
-- no new trigger point. Forward-only — existing rows stay null until they're
-- re-analyzed via force=true.
--
-- Skip-reason semantics mirror persona_skip_reason. Adds one new value:
--   'low_confidence_classification' — GPT returned confidence < 0.4
--
-- Phase 8B (pre-visit briefing), 8D (intel dashboard), 8E (owner accuracy
-- feedback) all read from these columns. No prompt-injection wiring in 8A
-- per Drew's call — DISC stays out of the live AI receptionist prompt until
-- 8E feedback validates accuracy.
-- ============================================================================

BEGIN;

-- ──── coaching_conversations: per-call DISC classification ─────────────────
ALTER TABLE coaching_conversations
  ADD COLUMN IF NOT EXISTS disc_primary       text,
  ADD COLUMN IF NOT EXISTS disc_secondary     text,
  ADD COLUMN IF NOT EXISTS disc_scores        jsonb,
  ADD COLUMN IF NOT EXISTS disc_confidence    numeric(3,2),
  ADD COLUMN IF NOT EXISTS disc_signals       jsonb,
  ADD COLUMN IF NOT EXISTS disc_skip_reason   text;

-- Constrain DISC enum at the DB level to catch any classifier drift
ALTER TABLE coaching_conversations
  ADD CONSTRAINT coaching_conversations_disc_primary_chk
    CHECK (disc_primary IS NULL OR disc_primary IN ('D','I','S','C','unknown'));

ALTER TABLE coaching_conversations
  ADD CONSTRAINT coaching_conversations_disc_secondary_chk
    CHECK (disc_secondary IS NULL OR disc_secondary IN ('D','I','S','C'));

ALTER TABLE coaching_conversations
  ADD CONSTRAINT coaching_conversations_disc_confidence_chk
    CHECK (disc_confidence IS NULL OR (disc_confidence >= 0 AND disc_confidence <= 1));

-- Index for 8D dashboard rollup queries (tenant DISC distribution over time)
CREATE INDEX IF NOT EXISTS idx_coaching_conv_disc_primary
  ON coaching_conversations (tenant_id, disc_primary)
  WHERE disc_primary IS NOT NULL AND disc_primary <> 'unknown';

-- ──── leads: latest DISC propagated from most recent classified call ───────
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS disc_primary       text,
  ADD COLUMN IF NOT EXISTS disc_secondary     text,
  ADD COLUMN IF NOT EXISTS disc_scores        jsonb,
  ADD COLUMN IF NOT EXISTS disc_confidence    numeric(3,2),
  ADD COLUMN IF NOT EXISTS disc_signals       jsonb,
  ADD COLUMN IF NOT EXISTS disc_detected_at   timestamptz;

ALTER TABLE leads
  ADD CONSTRAINT leads_disc_primary_chk
    CHECK (disc_primary IS NULL OR disc_primary IN ('D','I','S','C','unknown'));

ALTER TABLE leads
  ADD CONSTRAINT leads_disc_secondary_chk
    CHECK (disc_secondary IS NULL OR disc_secondary IN ('D','I','S','C'));

ALTER TABLE leads
  ADD CONSTRAINT leads_disc_confidence_chk
    CHECK (disc_confidence IS NULL OR (disc_confidence >= 0 AND disc_confidence <= 1));

-- Index for 8D tenant-wide DISC pattern queries on the leads table
CREATE INDEX IF NOT EXISTS idx_leads_disc_primary
  ON leads (tenant_id, disc_primary)
  WHERE disc_primary IS NOT NULL AND disc_primary <> 'unknown';

COMMIT;
