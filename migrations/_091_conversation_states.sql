-- ════════════════════════════════════════════════════════════════════════════
-- Migration 091 — conversation_states (Phase 12 A2, Jun 10, 2026)
--
-- Durable backing store for the in-memory SMS conversation state (booking
-- numbered-menu flow + cancellation flow). Today that structured state lives
-- ONLY in the smsThreads in-memory Map in server.js, so it's lost on every
-- Render restart/redeploy — a customer mid-booking when we deploy hits a fresh
-- empty thread on their next text and has to start over.
--
-- This table persists the structured state keyed on lead_id (channel-agnostic
-- by design — website/Meta can adopt it later). On an inbound message, if the
-- in-memory thread has no active state but a row here exists AND is within the
-- TTL (1 hour, enforced in lib/conversationState.js, not here), we rehydrate
-- the flow and resume. Older rows are treated as expired and deleted on read.
--
-- lead_id is the PRIMARY KEY: one live conversation state per lead. A person
-- isn't mid-booking AND mid-cancel at the same time — switching flows
-- overwrites. ON DELETE CASCADE cleans up if the lead is removed.
--
-- Deliberately NOT a JSONB column on `leads`: that row is read on every
-- dashboard page (Pipeline list, Conversations sidebar, lead detail feed) and
-- this state churns on every menu step. Keeping the fast-churning blob in its
-- own table keeps that write traffic off the heavily-read leads row.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS conversation_states (
  lead_id    uuid PRIMARY KEY REFERENCES leads(id) ON DELETE CASCADE,
  tenant_id  uuid NOT NULL,
  state      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Supports the TTL sweep / expired-row cleanup by updated_at.
CREATE INDEX IF NOT EXISTS idx_conversation_states_updated
  ON conversation_states (updated_at);

-- Tenant-scoped lookups (defensive; PK lookup by lead_id is the hot path).
CREATE INDEX IF NOT EXISTS idx_conversation_states_tenant
  ON conversation_states (tenant_id);
