-- Migration: 032_lead_sms_consent_link.sql
-- Link leads directly to their SMS consent status

-- 1. Add consent tracking columns to leads
ALTER TABLE leads ADD COLUMN IF NOT EXISTS has_sms_consent BOOLEAN DEFAULT false;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS last_consent_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS last_consent_id UUID REFERENCES sms_consents(id) ON DELETE SET NULL;

-- 2. Index for visibility
CREATE INDEX IF NOT EXISTS idx_leads_has_sms_consent ON leads(has_sms_consent);

-- 3. Backfill existing consents if any
UPDATE leads l
SET 
  has_sms_consent = true,
  last_consent_at = s.consent_given_at,
  last_consent_id = s.id
FROM (
  SELECT DISTINCT ON (phone, tenant_id) id, phone, tenant_id, consent_given_at 
  FROM sms_consents 
  ORDER BY phone, tenant_id, consent_given_at DESC
) s
WHERE l.phone = s.phone AND l.tenant_id = s.tenant_id;
