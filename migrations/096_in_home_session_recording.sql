ALTER TABLE coaching_conversations DROP CONSTRAINT IF EXISTS coaching_conversations_source_type_check;
ALTER TABLE coaching_conversations ADD CONSTRAINT coaching_conversations_source_type_check
  CHECK (source_type IN (
    'ai_call_inbound',
    'ai_call_outbound',
    'ai_sms',
    'rep_recording',
    'rep_call_outbound',
    'ai_roleplay',
    'live_coach',
    'in_home_session'
  ));

ALTER TABLE in_home_sessions
  ADD COLUMN IF NOT EXISTS coaching_conversation_id UUID
  REFERENCES coaching_conversations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_in_home_sessions_conversation
  ON in_home_sessions(coaching_conversation_id);
