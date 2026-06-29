-- ============================================================================
-- Migration: competitor_audits — persist every competitive-benchmark run
-- Date: Jun 26, 2026
-- ----------------------------------------------------------------------------
-- Phase 3 of the Website Intelligence suite: the competitive GBP benchmark.
-- For a tenant, we pull the top painters in their area via the Google Places
-- API, normalize each competitor's PUBLIC listing signals (rating, review
-- count, newest-review age, photo presence), and benchmark the tenant against
-- them on the three signals Places can honestly return. Owner-triggered, no cap.
--
-- Mirrors website_audits exactly (history kept, jsonb payload, composite index)
-- so the read pattern ("latest run for this tenant") and the data-flywheel
-- posture are identical across the suite.
--
-- What we store (all from PUBLIC business listings — no private/PII data):
--   search:       { strategy, term, lat, lng, radius_m, api_used }
--   competitors:  [ { name, rating, review_count, newest_review_days,
--                     photo_bucket, place_id }, ... ]   (top N)
--   benchmark:    the computed standing + severity-tagged gap list
--                 (same gap shape as gbp_audit.gaps / website scorecard gaps)
--   meta:         { competitor_count, api_used, warnings: [], tenant_snapshot }
--
-- NOTE: place_id is a stable public Google identifier for a business listing,
-- not personal data. It's stored so a later run can dedupe / track the same
-- competitor over time without re-searching.
--
-- Idempotent: IF NOT EXISTS on table + index. No backfill. Safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS competitor_audits (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- How we found the competitors (which strategy/term won, which API answered).
  --   { strategy: "gbp_category"|"city_text"|"custom",
  --     term: text, lat: num|null, lng: num|null, radius_m: int, api_used: text }
  search          jsonb         NOT NULL DEFAULT '{}'::jsonb,

  -- Normalized competitor set (top N), public listing signals only.
  competitors     jsonb         NOT NULL DEFAULT '[]'::jsonb,

  -- Computed benchmark: the tenant's standing on each axis + the gap list.
  --   { reviews: {...}, freshness: {...}, photos: {...},
  --     gaps: [ { key, severity, label, advice, actionable? } ],
  --     in_sync: bool }
  benchmark       jsonb         NOT NULL DEFAULT '{}'::jsonb,

  -- Run-level metadata + the tenant's own numbers at run time (so the row is
  -- self-describing without a join back to gbp_audit).
  --   { competitor_count: int, api_used: text, warnings: [],
  --     tenant_snapshot: { review_total, review_avg_rating, photo_count, ... } }
  meta            jsonb         NOT NULL DEFAULT '{}'::jsonb,

  created_at      timestamptz   NOT NULL DEFAULT now()
);

-- Most common read: "latest run for this tenant" / "this tenant's history".
CREATE INDEX IF NOT EXISTS competitor_audits_tenant_created_idx
  ON competitor_audits (tenant_id, created_at DESC);

-- ----------------------------------------------------------------------------
-- Per-tenant competitor-search override (the "custom term/radius" layer).
-- Optional; when null the resolver falls back to GBP category, then city text.
-- Added as nullable columns on tenants so there's no separate table to join.
-- ----------------------------------------------------------------------------
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS competitor_search_term   text,
  ADD COLUMN IF NOT EXISTS competitor_search_radius_m integer;
