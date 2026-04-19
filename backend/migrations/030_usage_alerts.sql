-- Migration: 030_usage_alerts.sql
-- Add support for automated usage alerts and email notifications.

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS usage_alert_thresholds JSONB DEFAULT '{"75": true, "90": true, "100": true}'::jsonb;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS usage_alerts_enabled BOOLEAN DEFAULT true;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS last_alert_sent_at TIMESTAMPTZ;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS alert_history JSONB DEFAULT '[]'::jsonb;
