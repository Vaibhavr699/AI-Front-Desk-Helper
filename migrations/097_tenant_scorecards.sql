CREATE TABLE IF NOT EXISTS tenant_scorecards (
  tenant_id   UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  walkthrough JSONB NOT NULL DEFAULT '[
    {"key": "rooms", "label": "Rooms"},
    {"key": "scope", "label": "Scope"},
    {"key": "timeline", "label": "Timeline"},
    {"key": "budget", "label": "Budget"},
    {"key": "close", "label": "Close"}
  ]'::jsonb,
  updated_at  TIMESTAMPTZ DEFAULT now(),
  updated_by  UUID REFERENCES dashboard_users(id) ON DELETE SET NULL
);

ALTER TABLE tenant_scorecards
  ADD COLUMN IF NOT EXISTS cue_emphasis JSONB NOT NULL DEFAULT '{}'::jsonb;
