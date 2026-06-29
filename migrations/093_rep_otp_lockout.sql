-- 093_rep_otp_lockout.sql
-- Hardens the rep email-OTP login against brute force.
--   login_otp_failed_count  — failures across codes (NOT reset when a new code
--                             is issued); only cleared on success or lockout expiry.
--   login_otp_locked_until  — set once failures cross the threshold; login + verify
--                             are refused until it passes.
--   login_otp_session_id    — nonce embedded in the challenge token and rotated on
--                             each /login, so a stale challenge can't verify a fresh code.

ALTER TABLE dashboard_users
  ADD COLUMN IF NOT EXISTS login_otp_failed_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS login_otp_locked_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS login_otp_session_id TEXT;
