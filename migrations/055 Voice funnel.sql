-- ═══════════════════════════════════════════════════════════════════════
--   Migration: Voice → Estimate Funnel Tracking
--   Phase E1.2 (May 4, 2026) — companion to Phase E1.1 recovery flow add
-- ═══════════════════════════════════════════════════════════════════════
--
-- Adds estimate_link_sent_at to the calls table. This is Stage 1 of the
-- voice attribution funnel:
--
--   Stage 1: Links Sent       ← this column
--   Stage 2: Estimates Filled ← leads.estimator_payload->>'source_call_id'
--   Stage 3: Booked           ← bookings JOIN leads on Stage 2
--
-- Without this column, we can only measure Stages 2 and 3 (which show
-- "submissions that came from voice → bookings"), but we'd be blind on
-- the Stage 1 → Stage 2 conversion (the "fill rate" — how often a sent
-- link actually gets filled out). That's the diagnostic the prompt
-- tuning relies on, so we want it.
--
-- The partial index makes the dashboard funnel query fast even on large
-- calls tables — most rows have NULL here, so we skip them entirely.
--
-- Rename this file to match your migration sequence (last one was 054,
-- so this is probably 055 — but check your migrations folder).

ALTER TABLE calls
  ADD COLUMN IF NOT EXISTS estimate_link_sent_at TIMESTAMPTZ;

COMMENT ON COLUMN calls.estimate_link_sent_at IS
  'Set by server.js send_estimate_link dispatcher when the AI successfully fires the tool during this call. Stage 1 of the Voice → Estimate funnel.';

CREATE INDEX IF NOT EXISTS idx_calls_estimate_link_sent
  ON calls(tenant_id, estimate_link_sent_at)
  WHERE estimate_link_sent_at IS NOT NULL;

-- Verify
SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
 WHERE table_name = 'calls'
   AND column_name = 'estimate_link_sent_at';
