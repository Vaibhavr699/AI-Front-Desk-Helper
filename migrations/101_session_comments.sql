CREATE TABLE IF NOT EXISTS session_comments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  UUID NOT NULL REFERENCES in_home_sessions(id) ON DELETE CASCADE,
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  manager_id  UUID REFERENCES dashboard_users(id) ON DELETE SET NULL,
  turn_index  INTEGER NOT NULL CHECK (turn_index >= 0),
  flag        TEXT NOT NULL CHECK (flag IN ('good', 'improve')),
  text        TEXT CHECK (text IS NULL OR char_length(text) <= 2000),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_session_comments_session
  ON session_comments(session_id, turn_index, created_at);

CREATE INDEX IF NOT EXISTS idx_session_comments_tenant
  ON session_comments(tenant_id, created_at DESC);
