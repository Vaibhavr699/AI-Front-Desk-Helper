-- Add faqs column to tenants table
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS faqs JSONB DEFAULT '[]';

COMMENT ON COLUMN tenants.faqs IS 'Array of {question, answer} objects for AI knowledge.';
