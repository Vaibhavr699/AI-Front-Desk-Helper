-- Allow tenants to use their own Twilio account (bring your own Twilio).
-- If set, voice/SMS/recording for that tenant use this account; otherwise platform credentials are used.
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS twilio_account_sid TEXT,
  ADD COLUMN IF NOT EXISTS twilio_auth_token TEXT;
