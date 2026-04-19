-- New table for SMS opt-in consents
CREATE TABLE IF NOT EXISTS sms_consents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    phone TEXT NOT NULL,
    consent_text TEXT NOT NULL,
    consent_given_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    source TEXT,
    ip_address TEXT,
    user_agent TEXT,
    page_url TEXT,
    session_id TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sms_consents_phone ON sms_consents(phone);
CREATE INDEX IF NOT EXISTS idx_sms_consents_tenant_id ON sms_consents(tenant_id);
