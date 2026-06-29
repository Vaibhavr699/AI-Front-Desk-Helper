-- Estimate Recovery: "Estimate Given → Not Booked" follow-up automation.
-- Tracks multi-step, multi-channel recovery sequences with objection routing.

CREATE TABLE IF NOT EXISTS estimate_recoveries (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  booking_id        UUID REFERENCES bookings(id) ON DELETE SET NULL,
  call_id           UUID REFERENCES calls(id) ON DELETE SET NULL,

  -- Contact info
  contact_name      TEXT,
  contact_phone     TEXT NOT NULL,
  contact_email     TEXT,

  -- State tracking
  status            TEXT DEFAULT 'active',      -- active, paused, converted, dormant, cancelled
  objection_type    TEXT,                        -- null (ghosting), price, thinking, spouse
  current_step      TEXT DEFAULT 'day1_sms',     -- current step in the sequence
  
  -- Counters
  call_attempts     INTEGER DEFAULT 0,
  sms_attempts      INTEGER DEFAULT 0,

  -- Timestamps
  estimate_sent_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_response_at  TIMESTAMPTZ,
  next_action_at    TIMESTAMPTZ,

  -- Source
  lead_source       TEXT DEFAULT 'phone',        -- phone, facebook, website

  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_estimate_recoveries_tenant ON estimate_recoveries(tenant_id);
CREATE INDEX IF NOT EXISTS idx_estimate_recoveries_next_action ON estimate_recoveries(next_action_at) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_estimate_recoveries_booking ON estimate_recoveries(booking_id);

-- Log every touch (SMS sent, call made, response received)
CREATE TABLE IF NOT EXISTS recovery_touches (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recovery_id       UUID NOT NULL REFERENCES estimate_recoveries(id) ON DELETE CASCADE,
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  channel           TEXT NOT NULL,               -- sms, call, facebook
  direction         TEXT DEFAULT 'outbound',     -- outbound, inbound (response)
  step              TEXT NOT NULL,               -- which step triggered this
  message_body      TEXT,
  call_sid          TEXT,
  status            TEXT DEFAULT 'sent',         -- sent, delivered, failed, answered, no_answer, voicemail
  created_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_recovery_touches_recovery ON recovery_touches(recovery_id);
