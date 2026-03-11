-- Add comprehensive settings columns to tenants table
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS tone_of_voice TEXT DEFAULT 'professional',
  ADD COLUMN IF NOT EXISTS objection_handling_config JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS business_hours JSONB DEFAULT '{
    "monday": {"open": "08:00", "close": "17:00", "closed": false},
    "tuesday": {"open": "08:00", "close": "17:00", "closed": false},
    "wednesday": {"open": "08:00", "close": "17:00", "closed": false},
    "thursday": {"open": "08:00", "close": "17:00", "closed": false},
    "friday": {"open": "08:00", "close": "17:00", "closed": false},
    "saturday": {"open": "09:00", "close": "12:00", "closed": true},
    "sunday": {"open": "09:00", "close": "12:00", "closed": true}
  }',
  ADD COLUMN IF NOT EXISTS afterhours_behavior TEXT DEFAULT 'voicemail',
  ADD COLUMN IF NOT EXISTS google_calendar_linked BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS google_calendar_id TEXT,
  ADD COLUMN IF NOT EXISTS zapier_webhook_url TEXT,
  ADD COLUMN IF NOT EXISTS api_key TEXT DEFAULT encode(gen_random_bytes(24), 'base64');

COMMENT ON COLUMN tenants.tone_of_voice IS 'Voice tone: professional, friendly, formal, concise.';
COMMENT ON COLUMN tenants.business_hours IS 'Weekly schedule for AI behavior gating.';
COMMENT ON COLUMN tenants.afterhours_behavior IS 'Behavior when called outside business hours: voicemail, transfer, simple_response.';
