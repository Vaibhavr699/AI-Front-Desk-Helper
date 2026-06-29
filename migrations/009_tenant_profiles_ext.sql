-- Add website and voice_model to tenants table
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS website TEXT,
  ADD COLUMN IF NOT EXISTS voice_model TEXT DEFAULT 'gpt-4o-realtime';

COMMENT ON COLUMN tenants.website IS 'Business website URL.';
COMMENT ON COLUMN tenants.voice_model IS 'OpenAI voice model for this tenant (e.g., gpt-4o-realtime, gpt-4o-realtime-preview).';
