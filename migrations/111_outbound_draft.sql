-- ============================================================================
-- Migration: outbound instruction generator draft columns
-- Date: Jun 26, 2026
-- ----------------------------------------------------------------------------
-- Mirrors the inbound instructions_draft columns (Feature 1) for the new
-- Outbound AI Agent generator. The outbound generator drafts the AI's
-- *outbound* personality/instructions (re-engagement + sales push for cold
-- leads) and stores it here for review before the owner applies it into
-- tenants.outbound_instructions.
--
-- Safe / idempotent: IF NOT EXISTS on every column. No backfill needed —
-- NULL means "no draft yet", which the route + UI already treat as 'none'.
-- ============================================================================

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS outbound_instructions_draft              text,
  ADD COLUMN IF NOT EXISTS outbound_instructions_draft_status       text,
  ADD COLUMN IF NOT EXISTS outbound_instructions_draft_generated_at timestamptz;
