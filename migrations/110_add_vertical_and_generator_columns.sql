-- ============================================================================
-- Migration 110 (revised) — Instruction-generator draft columns
-- Feature 1: draft-time instruction generation (no live call-path changes)
-- ============================================================================
--
-- IMPORTANT REVISION: the "vertical" field already exists on tenants as
-- `industry` (enum enforced at self-serve signup in routes/dashboard.js
-- POST /tenants — VALID_INDUSTRIES = painting, roofing, fencing, plumbing,
-- hvac, electrical, general_contractor, other). We do NOT add a new column.
-- The generator reads tenants.industry.
--
-- NOTE: industry is only enforced for self-serve standalone signups, so it
-- may be NULL for tenants created via admin/seed paths (e.g. the existing
-- 24). The generator handles a missing industry by returning a "set your
-- industry first" message rather than guessing.
--
-- This migration ONLY adds the columns that hold the generated draft for
-- owner review. The live bot never reads these — it only reads
-- tenants.instructions.
--
-- All additive + IF NOT EXISTS, safe to re-run.
-- ============================================================================

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS instructions_draft text;

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS instructions_draft_status text NOT NULL DEFAULT 'none';

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS instructions_draft_generated_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tenants_instructions_draft_status_chk'
  ) THEN
    ALTER TABLE tenants
      ADD CONSTRAINT tenants_instructions_draft_status_chk
      CHECK (instructions_draft_status IN ('none', 'unreviewed', 'applied'));
  END IF;
END$$;
