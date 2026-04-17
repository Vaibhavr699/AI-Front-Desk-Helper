-- Migration: 031_campaign_voice.sql
-- Adds agent_voice column to outbound_campaigns

ALTER TABLE outbound_campaigns ADD COLUMN IF NOT EXISTS agent_voice TEXT DEFAULT 'ash';
