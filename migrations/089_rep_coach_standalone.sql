ALTER TABLE tenants ADD COLUMN IF NOT EXISTS aifdh_enabled BOOLEAN DEFAULT true;

ALTER TABLE coaching_conversations DROP CONSTRAINT IF EXISTS coaching_conversations_source_type_check;
ALTER TABLE coaching_conversations ADD CONSTRAINT coaching_conversations_source_type_check
  CHECK (source_type IN (
    'ai_call_inbound',
    'ai_call_outbound',
    'ai_sms',
    'rep_recording',
    'rep_call_outbound',
    'ai_roleplay',
    'live_coach'
  ));

CREATE TABLE IF NOT EXISTS recording_consents (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  coaching_conversation_id  UUID REFERENCES coaching_conversations(id) ON DELETE SET NULL,
  in_home_session_id        UUID REFERENCES in_home_sessions(id) ON DELETE SET NULL,
  lead_id                   UUID REFERENCES leads(id) ON DELETE SET NULL,
  rep_user_id               UUID NOT NULL REFERENCES dashboard_users(id) ON DELETE CASCADE,
  consent_status            TEXT NOT NULL CHECK (consent_status IN ('obtained', 'declined', 'not_required')),
  consent_method            TEXT NOT NULL CHECK (consent_method IN ('verbal_in_person', 'tts_voip', 'one_party_state')),
  consent_state             TEXT,
  consent_script            TEXT,
  recorded_at               TIMESTAMPTZ DEFAULT now(),
  metadata                  JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_recording_consents_conversation ON recording_consents(coaching_conversation_id);
CREATE INDEX IF NOT EXISTS idx_recording_consents_lead ON recording_consents(lead_id);

ALTER TABLE dashboard_users ADD COLUMN IF NOT EXISTS rep_caller_id_number TEXT;
