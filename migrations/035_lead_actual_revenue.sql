-- Migration: 035_lead_actual_revenue.sql
-- Add actual_revenue_cents to leads table for CRM tracking
ALTER TABLE leads ADD COLUMN IF NOT EXISTS actual_revenue_cents INTEGER DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_leads_actual_revenue ON leads(actual_revenue_cents) WHERE actual_revenue_cents > 0;
