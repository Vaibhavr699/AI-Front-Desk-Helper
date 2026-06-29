-- Add reset token columns to dashboard_users
ALTER TABLE dashboard_users
ADD COLUMN IF NOT EXISTS reset_token TEXT,
ADD COLUMN IF NOT EXISTS reset_token_expires TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_dashboard_users_reset_token ON dashboard_users(reset_token);
