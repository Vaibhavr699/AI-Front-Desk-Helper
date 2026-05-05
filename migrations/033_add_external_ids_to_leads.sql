-- Migration: 033_add_external_ids_to_leads.sql
-- Add specific columns for Facebook and Website identification to allow phone number updates.

-- 1. Add columns
ALTER TABLE leads ADD COLUMN IF NOT EXISTS facebook_id TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS web_id TEXT;

-- 2. Create indexes
CREATE INDEX IF NOT EXISTS idx_leads_facebook_id ON leads(facebook_id);
CREATE INDEX IF NOT EXISTS idx_leads_web_id ON leads(web_id);

-- 3. Add unique constraints per tenant
-- We use separate constraints because a lead might have both or neither.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'unique_tenant_facebook_id'
  ) THEN
    ALTER TABLE leads
      ADD CONSTRAINT unique_tenant_facebook_id UNIQUE (tenant_id, facebook_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'unique_tenant_web_id'
  ) THEN
    ALTER TABLE leads
      ADD CONSTRAINT unique_tenant_web_id UNIQUE (tenant_id, web_id);
  END IF;
END $$;

-- 4. Backfill existing leads that have 'fb-' or 'web-' in the phone column
UPDATE leads 
SET facebook_id = SUBSTRING(phone FROM 4) 
WHERE phone LIKE 'fb-%' AND facebook_id IS NULL;

UPDATE leads 
SET web_id = SUBSTRING(phone FROM 5) 
WHERE phone LIKE 'web-%' AND web_id IS NULL;
