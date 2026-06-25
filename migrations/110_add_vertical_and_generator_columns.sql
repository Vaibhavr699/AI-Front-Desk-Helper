-- ============================================================================
-- Migration 110 — Vertical field + instruction-generator support columns
-- Feature 1: draft-time instruction generation (no live call-path changes)
-- ============================================================================
--
-- Adds:
--   tenants.vertical            — the business's industry (roofing, painting,
--                                 fencing, hvac, ...). This is the REQUIRED
--                                 input for the instruction generator. It is
--                                 NOT the same as business_type, which stores
--                                 account structure (standalone/parent/child).
--
--   tenants.instructions_draft         — generated draft text, held for owner
--                                        review. Never read by the live bot;
--                                        the live bot only ever reads
--                                        tenants.instructions.
--   tenants.instructions_draft_status  — 'none' | 'unreviewed' | 'applied'.
--                                        Drives the review banner in the UI.
--   tenants.instructions_draft_generated_at — audit timestamp.
--
-- website already exists on tenants (text) — no change needed here. This
-- migration only references it; it does not create it.
--
-- All additive + IF NOT EXISTS, so it is safe to re-run.
-- ============================================================================

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS vertical text;

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS instructions_draft text;

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS instructions_draft_status text NOT NULL DEFAULT 'none';

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS instructions_draft_generated_at timestamptz;

-- Optional: a light check so the status column can't drift to junk values.
-- Wrapped in a DO block so re-running doesn't error on an existing constraint.
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
