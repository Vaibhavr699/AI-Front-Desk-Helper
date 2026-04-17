-- Migration: 030_outbound_persona_fields.sql
-- Adds AI Agent Name and Persona Instructions for Outbound Campaigns

-- 1. Add default Outbound Agent Name to tenants
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS outbound_agent_name TEXT DEFAULT 'Alex';

-- 2. Add campaign-specific Persona fields to outbound_campaigns
ALTER TABLE outbound_campaigns ADD COLUMN IF NOT EXISTS agent_name TEXT;
ALTER TABLE outbound_campaigns ADD COLUMN IF NOT EXISTS persona_instructions TEXT;

-- 3. Update existing records if any
UPDATE tenants SET outbound_agent_name = 'Alex' WHERE outbound_agent_name IS NULL;
