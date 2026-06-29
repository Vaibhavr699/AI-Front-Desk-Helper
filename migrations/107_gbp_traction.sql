-- 107_gbp_traction.sql
-- GBP Traction: gap audit + AI auto-posting + performance evaluation
-- Reuses existing per-tenant Google OAuth on tenants table
--   (google_refresh_token, google_access_token, google_token_expiry,
--    google_account_id, google_location_id) — NO new connection columns needed.
-- Resource name for GBP API calls = accounts/{google_account_id}/locations/{google_location_id}
--
-- Flywheel discipline: tenant-keyed, opt-in/out toggles, industry-taggable.
-- Safe to run: pure additive (CREATE TABLE IF NOT EXISTS + indexes). No drops, no alters to existing tables.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. gbp_posts — draft / approved / published post queue
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gbp_posts (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- content
  post_type                 text NOT NULL DEFAULT 'STANDARD'
                              CHECK (post_type IN ('STANDARD','OFFER','EVENT')),
  summary                   text NOT NULL,           -- main post body (LocalPost.summary)
  cta_type                  text                     -- LEARN_MORE / CALL / BOOK / ORDER / SIGN_UP / NONE
                              CHECK (cta_type IS NULL OR cta_type IN
                                ('LEARN_MORE','CALL','BOOK','ORDER','SIGN_UP','SHOP','NONE')),
  cta_url                   text,                    -- e.g. booking page / estimator link
  media_url                 text,                    -- optional photo for the post

  -- OFFER-specific (nullable)
  offer_coupon_code         text,
  offer_terms               text,
  -- EVENT-specific (nullable)
  event_title               text,
  event_start               timestamptz,
  event_end                 timestamptz,

  -- lifecycle
  status                    text NOT NULL DEFAULT 'draft'
                              CHECK (status IN ('draft','approved','publishing','published','failed','archived')),
  google_post_resource_name text,                    -- accounts/*/locations/*/localPosts/* once published
  publish_error             text,                    -- last failure reason (403/quota/etc) — never silent-drop
  approved_by               uuid,                    -- dashboard_users.id who approved (nullable for auto)
  approved_at               timestamptz,
  published_at              timestamptz,

  -- provenance / flywheel
  source                    text DEFAULT 'ai_generated'  -- ai_generated / manual / recurring
                              CHECK (source IN ('ai_generated','manual','recurring')),
  source_job_id             uuid,                    -- job-completion row this post was generated from (nullable)
  industry_tag              text,                    -- for cross-tenant pattern mining (anonymizable)

  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gbp_posts_tenant_status
  ON gbp_posts (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_gbp_posts_tenant_created
  ON gbp_posts (tenant_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 2. gbp_post_schedule — per-tenant cadence + master toggle + auto-publish flag
--    One row per tenant. Auto-publish defaults OFF (owner-in-loop).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gbp_post_schedule (
  tenant_id            uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  enabled              boolean NOT NULL DEFAULT false,  -- master on/off for auto-generation
  auto_publish         boolean NOT NULL DEFAULT false,  -- if false, drafts wait in approval queue
  posts_per_week       integer NOT NULL DEFAULT 2
                         CHECK (posts_per_week BETWEEN 1 AND 7),
  preferred_days       integer[] DEFAULT '{2,4}',       -- 0=Sun..6=Sat; default Tue/Thu
  preferred_hour       integer NOT NULL DEFAULT 10       -- local hour to publish
                         CHECK (preferred_hour BETWEEN 0 AND 23),
  last_generated_at    timestamptz,                      -- cursor: when cron last produced drafts
  last_published_at    timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 3. gbp_performance_daily — metrics cache from fetchMultiDailyMetricsTimeSeries
--    One row per tenant per day. Upsert on (tenant_id, metric_date).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gbp_performance_daily (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  metric_date           date NOT NULL,

  -- metrics exposed by the new performance API
  business_impressions_search   integer DEFAULT 0,   -- desktop+mobile maps+search combined (sum on read)
  business_conversations        integer DEFAULT 0,   -- messages
  call_clicks                   integer DEFAULT 0,
  website_clicks                integer DEFAULT 0,
  direction_requests            integer DEFAULT 0,
  bookings                      integer DEFAULT 0,
  raw_metrics                   jsonb,               -- full API payload for any metric we don't column out yet

  fetched_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, metric_date)
);

CREATE INDEX IF NOT EXISTS idx_gbp_perf_tenant_date
  ON gbp_performance_daily (tenant_id, metric_date DESC);

-- ---------------------------------------------------------------------------
-- 4. gbp_audit — latest gap/health snapshot per tenant
--    Read-only feature (Business Information API). Re-run overwrites latest.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gbp_audit (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  health_score          integer,                     -- 0-100 completeness/health
  gaps                  jsonb,                        -- prioritized list: [{key,severity,label,advice}]
  profile_snapshot      jsonb,                        -- what we read (categories, hours, photo count, etc.)
  generated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id)                                  -- one current snapshot per tenant
);

CREATE INDEX IF NOT EXISTS idx_gbp_audit_tenant
  ON gbp_audit (tenant_id);

COMMIT;
