-- AI Mini-CRM: Leads and Persistent Messages
-- Tracks customer profiles and full conversation history.

CREATE TABLE IF NOT EXISTS leads (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  
  -- Info
  name              TEXT,
  phone             TEXT NOT NULL,
  email             TEXT,
  address           TEXT,
  project_type      TEXT,
  notes             TEXT,
  
  -- CRM State
  status            TEXT DEFAULT 'New Lead', -- New Lead, Qualified, Estimate Sent, FollowUp, Booked, Closed, Lost
  
  -- Tracking
  metadata          JSONB DEFAULT '{}',
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now(),
  
  -- Unique per tenant+phone
  UNIQUE(tenant_id, phone)
);

CREATE INDEX IF NOT EXISTS idx_leads_tenant ON leads(tenant_id);
CREATE INDEX IF NOT EXISTS idx_leads_phone ON leads(phone);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);

CREATE TABLE IF NOT EXISTS messages (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  lead_id           UUID REFERENCES leads(id) ON DELETE CASCADE,
  
  -- Details
  channel           TEXT NOT NULL,               -- sms, website, facebook
  direction         TEXT NOT NULL,               -- inbound, outbound
  body              TEXT NOT NULL,
  
  -- Tracking
  metadata          JSONB DEFAULT '{}',
  created_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_lead ON messages(lead_id);
CREATE INDEX IF NOT EXISTS idx_messages_tenant ON messages(tenant_id);

-- Link existing tables to leads for better aggregation
ALTER TABLE calls ADD COLUMN IF NOT EXISTS lead_id UUID REFERENCES leads(id) ON DELETE SET NULL;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS lead_id UUID REFERENCES leads(id) ON DELETE SET NULL;
ALTER TABLE estimate_recoveries ADD COLUMN IF NOT EXISTS lead_id UUID REFERENCES leads(id) ON DELETE SET NULL;
