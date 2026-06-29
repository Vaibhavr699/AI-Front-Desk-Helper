-- Multi-tenant AI Front Desk - Initial Schema
-- One DB, one backend; tenants identified by Twilio phone number.

CREATE TABLE IF NOT EXISTS tenants (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT NOT NULL,
  slug              TEXT NOT NULL UNIQUE,
  timezone          TEXT NOT NULL DEFAULT 'America/Chicago',
  -- AI behavior
  company_name      TEXT NOT NULL,
  welcome_message   TEXT,
  instructions      TEXT,
  -- CRM (DripJobs or webhook)
  crm_webhook_url   TEXT,
  crm_api_key       TEXT,
  crm_type          TEXT DEFAULT 'webhook',
  -- Transfer
  transfer_numbers  JSONB DEFAULT '[]',
  transfer_sms_brief TEXT,
  -- Follow-up
  follow_up_enabled  BOOLEAN DEFAULT true,
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS phone_numbers (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  phone        TEXT NOT NULL UNIQUE,
  twilio_sid   TEXT,
  is_primary   BOOLEAN DEFAULT false,
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_phone_numbers_phone ON phone_numbers(phone);
CREATE INDEX IF NOT EXISTS idx_phone_numbers_tenant ON phone_numbers(tenant_id);

CREATE TABLE IF NOT EXISTS calls (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  twilio_call_sid TEXT NOT NULL UNIQUE,
  from_number     TEXT,
  to_number       TEXT,
  direction       TEXT DEFAULT 'inbound',
  status          TEXT DEFAULT 'in_progress',
  -- outcome
  disposition     TEXT,
  transferred     BOOLEAN DEFAULT false,
  transfer_to     TEXT,
  recording_sid   TEXT,
  started_at      TIMESTAMPTZ DEFAULT now(),
  ended_at        TIMESTAMPTZ,
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_calls_tenant ON calls(tenant_id);
CREATE INDEX IF NOT EXISTS idx_calls_twilio_sid ON calls(twilio_call_sid);
CREATE INDEX IF NOT EXISTS idx_calls_started_at ON calls(started_at DESC);

CREATE TABLE IF NOT EXISTS recordings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id         UUID NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  twilio_sid      TEXT UNIQUE,
  recording_url   TEXT,
  s3_key          TEXT,
  duration_sec    INTEGER,
  status          TEXT DEFAULT 'pending',
  transcript      TEXT,
  transcript_src  TEXT,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_recordings_call ON recordings(call_id);
CREATE INDEX IF NOT EXISTS idx_recordings_tenant ON recordings(tenant_id);

CREATE TABLE IF NOT EXISTS bookings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id         UUID REFERENCES calls(id) ON DELETE SET NULL,
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_name    TEXT,
  contact_phone   TEXT NOT NULL,
  contact_email   TEXT,
  address         TEXT,
  city            TEXT,
  scope           TEXT,
  job_type        TEXT,
  preferred_date  DATE,
  notes           TEXT,
  status          TEXT DEFAULT 'scheduled',
  crm_id          TEXT,
  crm_synced_at   TIMESTAMPTZ,
  revenue_cents   INTEGER,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bookings_tenant ON bookings(tenant_id);
CREATE INDEX IF NOT EXISTS idx_bookings_call ON bookings(call_id);
CREATE INDEX IF NOT EXISTS idx_bookings_created ON bookings(created_at DESC);

CREATE TABLE IF NOT EXISTS follow_ups (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  booking_id      UUID REFERENCES bookings(id) ON DELETE CASCADE,
  call_id         UUID REFERENCES calls(id) ON DELETE SET NULL,
  contact_phone   TEXT NOT NULL,
  contact_name    TEXT,
  follow_up_type  TEXT NOT NULL,
  due_at          TIMESTAMPTZ NOT NULL,
  sent_at        TIMESTAMPTZ,
  status          TEXT DEFAULT 'pending',
  channel         TEXT DEFAULT 'sms',
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_follow_ups_due ON follow_ups(due_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_follow_ups_tenant ON follow_ups(tenant_id);

CREATE TABLE IF NOT EXISTS dashboard_users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID REFERENCES tenants(id) ON DELETE CASCADE,
  email           TEXT NOT NULL,
  password_hash   TEXT NOT NULL,
  role            TEXT DEFAULT 'viewer',
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, email)
);

CREATE INDEX IF NOT EXISTS idx_dashboard_users_tenant ON dashboard_users(tenant_id);
