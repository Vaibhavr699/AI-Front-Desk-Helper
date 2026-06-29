BEGIN;

CREATE TABLE IF NOT EXISTS in_home_sessions (
  id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id                         UUID NOT NULL REFERENCES dashboard_users(id) ON DELETE CASCADE,
  lead_id                         UUID REFERENCES leads(id) ON DELETE SET NULL,
  started_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at                        TIMESTAMPTZ,
  consent_obtained                BOOLEAN NOT NULL,
  consent_type                    TEXT,
  consent_state                   TEXT,
  consent_audio_clip_url          TEXT,
  audio_archived                  BOOLEAN DEFAULT false,
  device_type                     TEXT,
  network_mode                    TEXT,
  transcript                      JSONB DEFAULT '[]'::jsonb,
  disc_progression                JSONB,
  coaching_alerts                 JSONB,
  walkthrough_checklist_completed JSONB,
  outcome                         TEXT,
  estimate_value_cents            INT,
  rep_satisfaction                INT CHECK (rep_satisfaction IS NULL OR rep_satisfaction BETWEEN 1 AND 5),
  customer_signals                JSONB,
  session_recording_url           TEXT,
  delivery_mode_used              JSONB,
  created_at                      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_in_home_sessions_user_started
  ON in_home_sessions(user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_in_home_sessions_tenant_started
  ON in_home_sessions(tenant_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_in_home_sessions_lead
  ON in_home_sessions(lead_id);

CREATE TABLE IF NOT EXISTS in_home_alerts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id       UUID NOT NULL REFERENCES in_home_sessions(id) ON DELETE CASCADE,
  alert_type       TEXT NOT NULL,
  alert_content    TEXT,
  alert_audio_url  TEXT,
  alert_color      TEXT,
  alert_urgency    TEXT CHECK (alert_urgency IS NULL OR alert_urgency IN ('green','yellow','orange','red')),
  fired_at         TIMESTAMPTZ DEFAULT now(),
  delivery_method  TEXT,
  rep_action_taken TEXT,
  outcome_after    TEXT,
  payload          JSONB
);

CREATE INDEX IF NOT EXISTS idx_in_home_alerts_session
  ON in_home_alerts(session_id, fired_at DESC);

COMMIT;
