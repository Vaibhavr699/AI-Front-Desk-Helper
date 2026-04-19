-- Per-tenant Google Calendar OAuth2 support
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS google_refresh_token TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS google_calendar_email TEXT;
