-- ============================================================================
-- Migration 046: Add franchise + hq_* plan tiers to tenants.plan CHECK constraint
-- ============================================================================
-- Date: April 30, 2026
-- Author: Drew Koch
-- Phase: 6 (Franchise tier introduction)
--
-- Context:
-- The tenants.plan column originally accepted basic/pro/elite. Phase 6
-- (April 29, 2026) introduced franchise (per-zee billing) and hq_starter/
-- hq_growth/hq_enterprise (HQ tiers for franchise systems). These were
-- added to the database directly during the live build session, but never
-- captured as a migration file. This migration backfills that history so
-- the schema is reproducible from migrations/ alone.
--
-- Idempotent: safe to run multiple times. Drops constraint if exists, then
-- re-adds with the full plan list.
-- ============================================================================

BEGIN;

-- Drop the old constraint if it exists (name varies by environment;
-- pg_constraint lookup handles both common names).
DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT conname INTO constraint_name
  FROM pg_constraint
  WHERE conrelid = 'tenants'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%plan%IN%';

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE tenants DROP CONSTRAINT %I', constraint_name);
    RAISE NOTICE 'Dropped existing plan check constraint: %', constraint_name;
  END IF;
END $$;

-- Add the new constraint with the full plan list.
-- Order matches lib/plans.js ADMIN_PLAN_IDS for consistency.
ALTER TABLE tenants
  ADD CONSTRAINT tenants_plan_check
  CHECK (
    plan IS NULL
    OR plan IN (
      'basic',
      'pro',
      'elite',
      'franchise',
      'hq_starter',
      'hq_growth',
      'hq_enterprise'
    )
  );

-- Verify by counting rows in each plan tier (informational, not enforcing).
DO $$
DECLARE
  plan_counts text;
BEGIN
  SELECT string_agg(plan_name || '=' || count_str, ', ' ORDER BY plan_name)
  INTO plan_counts
  FROM (
    SELECT
      COALESCE(plan, 'NULL') AS plan_name,
      COUNT(*)::text AS count_str
    FROM tenants
    GROUP BY plan
  ) sub;

  RAISE NOTICE 'Migration 046 complete. Current tenant distribution: %', plan_counts;
END $$;

COMMIT;

-- ============================================================================
-- Rollback (manual, if needed):
-- ALTER TABLE tenants DROP CONSTRAINT tenants_plan_check;
-- ALTER TABLE tenants ADD CONSTRAINT tenants_plan_check CHECK (
--   plan IS NULL OR plan IN ('basic', 'pro', 'elite')
-- );
-- ============================================================================
