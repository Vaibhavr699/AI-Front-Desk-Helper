BEGIN;

ALTER TABLE in_home_alerts
  ADD COLUMN IF NOT EXISTS cue_type TEXT,
  ADD COLUMN IF NOT EXISTS watch_label TEXT,
  ADD COLUMN IF NOT EXISTS window_start TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS window_end TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS transcript_window JSONB,
  ADD COLUMN IF NOT EXISTS dismissed_at TIMESTAMPTZ;

ALTER TABLE in_home_sessions
  ADD COLUMN IF NOT EXISTS transcription_mode TEXT DEFAULT 'realtime',
  ADD COLUMN IF NOT EXISTS cue_engine_active BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS total_cues_fired INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS wpm_samples JSONB DEFAULT '[]'::jsonb;

ALTER TABLE dashboard_users
  ADD COLUMN IF NOT EXISTS cue_preferences JSONB DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_in_home_alerts_cue_type
  ON in_home_alerts(session_id, cue_type, fired_at DESC);

COMMIT;
