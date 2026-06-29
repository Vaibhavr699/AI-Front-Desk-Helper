-- 092_rep_email_otp.sql
-- Rep mobile app login MFA moves from authenticator TOTP to emailed one-time
-- codes. These columns hold the active login code (hashed), its expiry, a
-- per-code attempt counter, and the last-sent timestamp for resend throttling.
-- The legacy totp_secret column is left in place but no longer read.

ALTER TABLE dashboard_users
  ADD COLUMN IF NOT EXISTS login_otp_hash TEXT,
  ADD COLUMN IF NOT EXISTS login_otp_expires TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS login_otp_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS login_otp_sent_at TIMESTAMPTZ;
