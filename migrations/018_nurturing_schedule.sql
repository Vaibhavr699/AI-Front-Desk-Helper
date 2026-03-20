-- Nurturing: scheduled campaign touches (post-service, referral request, etc.)
CREATE TABLE IF NOT EXISTS nurturing_schedule (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  lead_id           UUID REFERENCES leads(id) ON DELETE CASCADE,
  booking_id        UUID REFERENCES bookings(id) ON DELETE SET NULL,
  campaign_type     TEXT NOT NULL,
  due_at            TIMESTAMPTZ NOT NULL,
  status            TEXT DEFAULT 'pending',
  campaign_log_id   UUID REFERENCES campaign_log(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nurturing_schedule_due ON nurturing_schedule(due_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_nurturing_schedule_tenant ON nurturing_schedule(tenant_id);

-- Lead source: allow 'referral' for referral-sourced leads
-- (leads.metadata or a dedicated column - status already exists; we can use metadata.lead_source or add column)
ALTER TABLE leads ADD COLUMN IF NOT EXISTS lead_source TEXT DEFAULT 'phone';
