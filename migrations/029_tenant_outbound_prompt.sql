-- Migration: 029_tenant_outbound_prompt.sql
-- Add a separate agent prompt for outbound calls to differentiate from inbound receptionist.

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS outbound_instructions TEXT;
