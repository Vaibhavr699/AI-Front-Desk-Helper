-- Nurturing + Referral: campaign log, referral leads, lead last_service_date, tenant flags

-- Leads: when was their last completed service (for maintenance / re-engagement triggers)
ALTER TABLE leads ADD COLUMN IF NOT EXISTS last_service_date DATE;

-- Campaign log: every nurturing touch (email, sms, call)
CREATE TABLE IF NOT EXISTS campaign_log (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  lead_id           UUID REFERENCES leads(id) ON DELETE SET NULL,
  booking_id        UUID REFERENCES bookings(id) ON DELETE SET NULL,
  campaign_type     TEXT NOT NULL,
  channel           TEXT NOT NULL,
  direction         TEXT DEFAULT 'outbound',
  message_subject   TEXT,
  message_body      TEXT,
  sent_at           TIMESTAMPTZ DEFAULT now(),
  response_status   TEXT,
  metadata          JSONB DEFAULT '{}',
  created_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_campaign_log_tenant ON campaign_log(tenant_id);
CREATE INDEX IF NOT EXISTS idx_campaign_log_lead ON campaign_log(lead_id);
CREATE INDEX IF NOT EXISTS idx_campaign_log_sent ON campaign_log(sent_at);
CREATE INDEX IF NOT EXISTS idx_campaign_log_type ON campaign_log(campaign_type);

-- Referral leads: parsed from customer reply to referral campaign
CREATE TABLE IF NOT EXISTS referral_leads (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  referring_lead_id       UUID REFERENCES leads(id) ON DELETE SET NULL,
  referring_booking_id    UUID REFERENCES bookings(id) ON DELETE SET NULL,
  referral_name           TEXT,
  referral_phone          TEXT NOT NULL,
  referral_email          TEXT,
  service_interest        TEXT,
  lead_status             TEXT DEFAULT 'new',
  lead_id                 UUID REFERENCES leads(id) ON DELETE SET NULL,
  created_at              TIMESTAMPTZ DEFAULT now(),
  updated_at              TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_referral_leads_tenant ON referral_leads(tenant_id);
CREATE INDEX IF NOT EXISTS idx_referral_leads_phone ON referral_leads(referral_phone);
CREATE INDEX IF NOT EXISTS idx_referral_leads_referring ON referral_leads(referring_lead_id);

-- Tenant nurturing config (Elite + add-on feature)
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS nurturing_enabled BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS referral_enabled BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS seasonal_campaigns_enabled BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS maintenance_reminder_months INTEGER DEFAULT 6,
  ADD COLUMN IF NOT EXISTS reengagement_reminder_months INTEGER DEFAULT 12,
  ADD COLUMN IF NOT EXISTS referral_request_days_after_service INTEGER DEFAULT 5,
  ADD COLUMN IF NOT EXISTS nurturing_campaign_calendar JSONB DEFAULT '{}';
