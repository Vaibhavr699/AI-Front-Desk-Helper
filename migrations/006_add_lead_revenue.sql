-- Add estimated_revenue_cents column to leads table
ALTER TABLE leads ADD COLUMN IF NOT EXISTS estimated_revenue_cents INTEGER DEFAULT 0;
