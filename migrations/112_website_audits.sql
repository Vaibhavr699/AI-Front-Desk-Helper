-- ============================================================================
-- Migration: website_audits — persist every website-extractor run
-- Date: Jun 26, 2026
-- ----------------------------------------------------------------------------
-- Phase 1 of the Website Intelligence suite. The extractor (lib/websiteExtractor.js)
-- crawls a tenant's site (homepage + value-scored inner pages, 8-page cap) and
-- pulls a structured facts object that feeds the inbound + outbound instruction
-- generators. We persist EVERY run here, button-triggered, no hard cap.
--
-- Why store every run (not just the latest):
--   1. Data flywheel — each run is anonymizable site-structure data we own.
--   2. Foundation for Phase 3 trend-tracking (AI-perception over time) without
--      a rebuild — the history is already here.
--   3. Lets us add a usage cap LATER from real data instead of guessing now.
--
-- Idempotent: IF NOT EXISTS on table + index. No backfill. Safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS website_audits (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- The site we crawled (snapshot of tenant.website at run time, in case it
  -- changes later). Stored so a run is self-describing without a tenant join.
  url             text,

  -- Structured output of the extraction pass. Shape (Phase 1):
  --   {
  --     services: [],
  --     service_area_mentions: [],
  --     pricing_cues: [],
  --     trust_signals: [],
  --     differentiators: [],
  --     booking_path: { present: bool, location: text|null, note: text|null },
  --     contact_methods: []
  --   }
  -- Kept as jsonb (not columns) because the schema will grow across phases and
  -- we never query individual fields in SQL — the app reads the whole object.
  facts           jsonb         NOT NULL DEFAULT '{}'::jsonb,

  -- What the crawl actually fetched: the pages it chose, in priority order,
  -- with per-page status. Shape:
  --   [ { url, title, status: "ok"|"empty"|"error", chars, reason? }, ... ]
  -- This is the audit trail — lets us see WHY a fact was/wasn't found (e.g.
  -- a JS-rendered page that came back empty) without re-running.
  fetched_pages   jsonb         NOT NULL DEFAULT '[]'::jsonb,

  -- Run-level metadata: page count, whether the homepage was JS-rendered/thin,
  -- which model did the extraction, any soft warnings surfaced to the owner.
  --   { pages_fetched: int, pages_capped: bool, homepage_thin: bool,
  --     model: text, warnings: [] }
  meta            jsonb         NOT NULL DEFAULT '{}'::jsonb,

  created_at      timestamptz   NOT NULL DEFAULT now()
);

-- Most common read: "latest run for this tenant" and "this tenant's run history,
-- newest first." A composite (tenant_id, created_at DESC) serves both.
CREATE INDEX IF NOT EXISTS website_audits_tenant_created_idx
  ON website_audits (tenant_id, created_at DESC);
