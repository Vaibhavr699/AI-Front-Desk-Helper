-- Add column to track independent nurturing add-on subscription from Stripe
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS stripe_nurturing_subscription_id TEXT;
