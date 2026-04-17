-- Migration: 028_outbound_system.sql
-- Supports AI Outbound Calling (Auto-Optimize Mode, Performance Tracking, Minute Bundles)

-- 1. Extend tenants table with bundle minute balance
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS bundle_minutes_balance INTEGER DEFAULT 0;

-- 2. New table for Outbound Campaigns
CREATE TABLE IF NOT EXISTS outbound_campaigns (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  mode              TEXT NOT NULL CHECK (mode IN ('manual', 'auto')),
  status            TEXT NOT NULL DEFAULT 'paused' CHECK (status IN ('draft', 'active', 'paused', 'completed')),
  
  -- Settings
  prompt_description TEXT, -- For Manual mode
  calling_hours_start TIME DEFAULT '08:00:00',
  calling_hours_end   TIME DEFAULT '19:00:00',
  max_attempts       INTEGER DEFAULT 3,
  
  -- Tracking
  total_contacts    INTEGER DEFAULT 0,
  booked_count      INTEGER DEFAULT 0,
  calls_made        INTEGER DEFAULT 0,
  
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);

-- 3. New table for Campaign Scripts (A/B versions for Auto Mode)
CREATE TABLE IF NOT EXISTS outbound_scripts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id       UUID NOT NULL REFERENCES outbound_campaigns(id) ON DELETE CASCADE,
  content           TEXT NOT NULL,
  performance_pct   NUMERIC(5,2) DEFAULT 0.00,
  status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
  created_at        TIMESTAMPTZ DEFAULT now()
);

-- 4. New table for Campaign Contacts
CREATE TABLE IF NOT EXISTS outbound_contacts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id       UUID NOT NULL REFERENCES outbound_campaigns(id) ON DELETE CASCADE,
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name              TEXT,
  phone             TEXT NOT NULL,
  
  -- Status: pending, contacted, no_answer,booked, follow_up, dnc, failed
  status            TEXT NOT NULL DEFAULT 'pending',
  attempts          INTEGER DEFAULT 0,
  last_attempt_at   TIMESTAMPTZ,
  last_call_id      UUID REFERENCES calls(id) ON DELETE SET NULL,
  last_script_id    UUID REFERENCES outbound_scripts(id) ON DELETE SET NULL,
  
  metadata          JSONB DEFAULT '{}',
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);

-- 5. Indexes for performance
CREATE INDEX IF NOT EXISTS idx_outbound_campaigns_tenant ON outbound_campaigns(tenant_id);
CREATE INDEX IF NOT EXISTS idx_outbound_contacts_campaign ON outbound_contacts(campaign_id);
CREATE INDEX IF NOT EXISTS idx_outbound_contacts_phone ON outbound_contacts(phone);
CREATE INDEX IF NOT EXISTS idx_outbound_scripts_campaign ON outbound_scripts(campaign_id);
