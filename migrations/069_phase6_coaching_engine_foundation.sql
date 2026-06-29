-- migrations/069_phase6_coaching_engine_foundation.sql
-- Phase 6 AI+Sales Coaching Engine — Schema Foundation
-- May 14, 2026

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Industry on tenants
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS industry TEXT;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenants_industry_check') THEN
    ALTER TABLE tenants
      ADD CONSTRAINT tenants_industry_check
      CHECK (industry IS NULL OR industry IN (
        'painting', 'roofing', 'hvac', 'plumbing', 'electrical',
        'landscaping', 'cleaning', 'pest', 'handyman', 'exterior', 'other'
      ));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tenants_industry ON tenants(industry) WHERE industry IS NOT NULL;

UPDATE tenants SET industry = 'painting', updated_at = now()
  WHERE id = 'a2942de5-5bfd-4cb1-8071-9207fe290a4b' AND industry IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Persona columns on leads
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS buyer_persona TEXT,
  ADD COLUMN IF NOT EXISTS persona_signals JSONB,
  ADD COLUMN IF NOT EXISTS persona_confidence NUMERIC(3,2),
  ADD COLUMN IF NOT EXISTS persona_detected_at TIMESTAMPTZ;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leads_buyer_persona_check') THEN
    ALTER TABLE leads
      ADD CONSTRAINT leads_buyer_persona_check
      CHECK (buyer_persona IS NULL OR buyer_persona IN (
        'researcher', 'protector', 'status_seeker', 'pragmatist',
        'negotiator', 'collaborator', 'unknown'
      ));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leads_persona_confidence_check') THEN
    ALTER TABLE leads
      ADD CONSTRAINT leads_persona_confidence_check
      CHECK (persona_confidence IS NULL OR (persona_confidence >= 0 AND persona_confidence <= 1));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_leads_persona
  ON leads(buyer_persona) WHERE buyer_persona IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. coaching_conversations
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS coaching_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  source_type TEXT NOT NULL CHECK (source_type IN (
    'ai_call_inbound', 'ai_call_outbound', 'ai_sms',
    'rep_recording', 'ai_roleplay', 'live_coach'
  )),
  source_id TEXT,

  rep_user_id UUID REFERENCES dashboard_users(id) ON DELETE SET NULL,
  industry TEXT,

  customer_phone TEXT,
  customer_name TEXT,
  lead_id UUID,

  transcript JSONB,
  duration_seconds INTEGER,

  overall_score NUMERIC(3,1),
  scored_at TIMESTAMPTZ,
  scoring_model TEXT,

  buyer_persona TEXT CHECK (buyer_persona IS NULL OR buyer_persona IN (
    'researcher', 'protector', 'status_seeker', 'pragmatist',
    'negotiator', 'collaborator', 'unknown'
  )),
  persona_signals JSONB,
  persona_confidence NUMERIC(3,2) CHECK (
    persona_confidence IS NULL OR (persona_confidence >= 0 AND persona_confidence <= 1)
  ),
  persona_detected_at TIMESTAMPTZ,

  outcome TEXT CHECK (outcome IS NULL OR outcome IN (
    'booked', 'estimate_sent', 'closed_won', 'closed_lost', 'no_followup', 'unknown'
  )),
  outcome_revenue_cents INTEGER,
  outcome_recorded_at TIMESTAMPTZ,

  metadata JSONB,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_coaching_conv_tenant
  ON coaching_conversations(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_coaching_conv_source
  ON coaching_conversations(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_coaching_conv_rep
  ON coaching_conversations(rep_user_id, created_at DESC)
  WHERE rep_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_coaching_conv_outcome
  ON coaching_conversations(tenant_id, outcome) WHERE outcome IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_coaching_conv_unscored
  ON coaching_conversations(tenant_id, created_at) WHERE scored_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_coaching_conv_persona
  ON coaching_conversations(tenant_id, buyer_persona) WHERE buyer_persona IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. coaching_scores
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS coaching_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES coaching_conversations(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  dimension TEXT NOT NULL CHECK (dimension IN (
    'rapport', 'property_walkthrough', 'discovery', 'education',
    'value_framing', 'objection_handling', 'close', 'professionalism'
  )),

  score NUMERIC(3,1) NOT NULL CHECK (score >= 0 AND score <= 10),
  rationale TEXT,
  evidence JSONB,

  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (conversation_id, dimension)
);

CREATE INDEX IF NOT EXISTS idx_coaching_scores_tenant_dim
  ON coaching_scores(tenant_id, dimension, created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. coaching_feedback
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS coaching_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES coaching_conversations(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  submitted_by_user_id UUID REFERENCES dashboard_users(id) ON DELETE SET NULL,

  what_went_right TEXT,
  what_to_improve TEXT,
  overall_rating INTEGER CHECK (overall_rating IS NULL OR overall_rating BETWEEN 1 AND 5),

  rules_extracted_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_coaching_feedback_tenant
  ON coaching_feedback(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_coaching_feedback_unprocessed
  ON coaching_feedback(tenant_id) WHERE rules_extracted_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. coaching_rules (with self-training effectiveness columns)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS coaching_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  source_feedback_id UUID REFERENCES coaching_feedback(id) ON DELETE SET NULL,
  source_conversation_id UUID REFERENCES coaching_conversations(id) ON DELETE SET NULL,

  category TEXT NOT NULL CHECK (category IN (
    'rapport', 'property_walkthrough', 'discovery', 'education',
    'value_framing', 'objection_handling', 'close', 'professionalism',
    'tone', 'scripting', 'pricing', 'qualification', 'other'
  )),
  rule_type TEXT NOT NULL CHECK (rule_type IN ('do', 'dont', 'when_then')),

  rule_text TEXT NOT NULL,
  rationale TEXT,

  status TEXT NOT NULL DEFAULT 'pending_approval' CHECK (status IN (
    'pending_approval', 'approved', 'rejected', 'archived'
  )),
  approved_at TIMESTAMPTZ,
  approved_by_user_id UUID REFERENCES dashboard_users(id) ON DELETE SET NULL,

  similarity_hash TEXT,
  priority INTEGER NOT NULL DEFAULT 5 CHECK (priority BETWEEN 1 AND 10),
  last_reinforced_at TIMESTAMPTZ DEFAULT now(),

  -- Self-training: rule effectiveness over time
  fire_count INTEGER NOT NULL DEFAULT 0,
  close_when_fired INTEGER NOT NULL DEFAULT 0,
  close_correlation NUMERIC(4,3),
  persona_affinity JSONB,
  rep_affinity JSONB,
  last_evaluated_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_coaching_rules_tenant_active
  ON coaching_rules(tenant_id, status, priority DESC, close_correlation DESC NULLS LAST)
  WHERE status = 'approved';
CREATE INDEX IF NOT EXISTS idx_coaching_rules_tenant_pending
  ON coaching_rules(tenant_id, created_at DESC) WHERE status = 'pending_approval';
CREATE INDEX IF NOT EXISTS idx_coaching_rules_dedup
  ON coaching_rules(tenant_id, similarity_hash) WHERE similarity_hash IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. coaching_nudges (every nudge fired in a live session, for self-training)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS coaching_nudges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES coaching_conversations(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  rule_id UUID REFERENCES coaching_rules(id) ON DELETE SET NULL,

  nudge_text TEXT NOT NULL,
  category TEXT NOT NULL,
  delivery_method TEXT CHECK (delivery_method IN (
    'earbud_tts', 'phone_haptic', 'screen_text', 'post_session'
  )),

  fired_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  transcript_turn_index INTEGER,
  buyer_persona_at_fire TEXT,
  rep_user_id UUID REFERENCES dashboard_users(id) ON DELETE SET NULL,

  was_acted_on BOOLEAN,
  acted_on_confidence NUMERIC(3,2),
  evaluated_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_coaching_nudges_conv
  ON coaching_nudges(conversation_id, fired_at);
CREATE INDEX IF NOT EXISTS idx_coaching_nudges_rule
  ON coaching_nudges(rule_id, fired_at DESC) WHERE rule_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_coaching_nudges_tenant
  ON coaching_nudges(tenant_id, fired_at DESC);
CREATE INDEX IF NOT EXISTS idx_coaching_nudges_unevaluated
  ON coaching_nudges(tenant_id) WHERE evaluated_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. updated_at triggers
-- ─────────────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS update_coaching_conversations_updated_at ON coaching_conversations;
CREATE TRIGGER update_coaching_conversations_updated_at
  BEFORE UPDATE ON coaching_conversations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_coaching_rules_updated_at ON coaching_rules;
CREATE TRIGGER update_coaching_rules_updated_at
  BEFORE UPDATE ON coaching_rules
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
