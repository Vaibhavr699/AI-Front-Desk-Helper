BEGIN;

CREATE TABLE IF NOT EXISTS roleplay_scenarios (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              UUID REFERENCES tenants(id) ON DELETE CASCADE,
  created_by_user_id     UUID REFERENCES dashboard_users(id) ON DELETE SET NULL,
  title                  TEXT NOT NULL,
  description            TEXT,
  industry               TEXT,
  scenario_type          TEXT,
  difficulty             INT  CHECK (difficulty BETWEEN 1 AND 5),
  caller_persona_prompt  TEXT,
  initial_opening        TEXT,
  skills_trained         JSONB DEFAULT '[]'::jsonb,
  disc_type              TEXT CHECK (disc_type IS NULL OR disc_type IN ('D','I','S','C','unknown')),
  is_template            BOOLEAN DEFAULT true,
  created_at             TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_roleplay_scenarios_tenant_template
  ON roleplay_scenarios(tenant_id, is_template);
CREATE INDEX IF NOT EXISTS idx_roleplay_scenarios_global_template
  ON roleplay_scenarios(is_template) WHERE tenant_id IS NULL;

CREATE TABLE IF NOT EXISTS roleplay_sessions (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              UUID REFERENCES tenants(id) ON DELETE CASCADE,
  user_id                UUID REFERENCES dashboard_users(id) ON DELETE CASCADE,
  scenario_id            UUID REFERENCES roleplay_scenarios(id) ON DELETE SET NULL,
  custom_scenario_text   TEXT,
  custom_persona_prompt  TEXT,
  custom_opening         TEXT,
  transcript             JSONB DEFAULT '[]'::jsonb,
  scoring                JSONB,
  outcome                TEXT,
  duration_seconds       INT,
  started_at             TIMESTAMPTZ DEFAULT now(),
  completed_at           TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_roleplay_sessions_user_started
  ON roleplay_sessions(user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_roleplay_sessions_tenant_started
  ON roleplay_sessions(tenant_id, started_at DESC);

INSERT INTO roleplay_scenarios
  (tenant_id, title, description, industry, scenario_type, difficulty,
   caller_persona_prompt, initial_opening, skills_trained, disc_type, is_template)
SELECT * FROM (VALUES
  (
    NULL::uuid,
    'Price Shopper'::text,
    'Customer pushes hard on cost. Pre-shopped 3 competitors and leads with "what''s your best price?". Tests price-objection handling and value framing.'::text,
    'painting'::text,
    'price_objection'::text,
    3,
    'You are a homeowner getting an in-home estimate for interior painting. You''ve already gotten two other quotes and you lead with the price. You''re direct, impatient, and uninterested in features unless they save money. Push back on every number. Stay in character — do not coach the rep.'::text,
    'Look, I''ve had two other quotes already and they''re both cheaper than what I''m guessing you''re about to tell me. What''s your best price, today?'::text,
    '["price_objection","value_framing","assertiveness"]'::jsonb,
    'D'::text,
    true
  ),
  (
    NULL::uuid,
    'Quality Buyer',
    'C-type buyer asks detailed warranty, paint brand, and prep questions. Tests technical accuracy and patience under interrogation.',
    'painting',
    'warranty_question',
    4,
    'You are a detail-oriented homeowner who has researched paint brands and prep procedures online. You ask follow-up questions on warranty terms, paint coverage rates, primer specifications, and crew certifications. You will not commit until every concern is addressed. Be polite but methodical. Stay in character.',
    'Before we talk about anything else — what warranty do you offer, what brand of paint do you use, and how many coats does that include?',
    '["discovery","presenting","objection_handling"]'::jsonb,
    'C',
    true
  ),
  (
    NULL::uuid,
    'Decision-Stalled Prospect',
    'S-type prospect who wants to "think about it" and avoid commitment. Tests next-steps and gentle closing.',
    'painting',
    'decision_stalled',
    4,
    'You are a homeowner who likes the rep''s pitch but is uncomfortable making a decision today. You want to "talk to your spouse," "think it over," or "wait until spring." You will agree the work needs doing but resist signing. Be warm but immovable. Stay in character.',
    'This all sounds great, thank you. I think we need to take a few days to talk it over and we''ll be in touch. Probably.',
    '["closing","next_steps","assertiveness"]'::jsonb,
    'S',
    true
  ),
  (
    NULL::uuid,
    'Urgent Storm Damage',
    'High-stress homeowner with active roof damage. Tests rapport under pressure and discovery while the customer is emotional.',
    'roofing',
    'urgent_storm',
    5,
    'You are a homeowner whose roof was just damaged in last night''s storm. There is water in your living room. You are anxious, talking fast, jumping between insurance, scheduling, and cost. You are skeptical of contractors after a previous bad experience. Stay in character.',
    'Thank god you''re here. Last night''s storm tore half the roof off and there''s water coming through the ceiling — please tell me you can start today. What''s this going to cost me?',
    '["rapport","discovery","objection_handling"]'::jsonb,
    'D',
    true
  ),
  (
    NULL::uuid,
    'Burned Before',
    'C-type customer who hired a bad contractor last year. Trust is low. Tests rapport-building and credibility-establishing.',
    'painting',
    'trust_low',
    4,
    'You are a homeowner who hired a contractor last year who took a deposit, did poor work, and disappeared. You are openly skeptical of every promise. You ask for references and reviews repeatedly. You bring up the previous bad experience often. Stay in character.',
    'Before you start your pitch I should tell you — I hired someone last year who took $4,000 and ghosted me. So why should I trust you?',
    '["rapport","listening","presenting"]'::jsonb,
    'C',
    true
  ),
  (
    NULL::uuid,
    'Excited Enthusiast',
    'I-type homeowner who loves the idea but talks tangentially. Tests staying on-agenda without dampening their energy.',
    'painting',
    'excited_buyer',
    2,
    'You are an enthusiastic homeowner who has been planning a colorful repaint for months. You constantly veer off into stories about your neighbor''s house, your kids'' rooms, Pinterest boards. You love everything the rep proposes but you keep talking past the close. Stay in character.',
    'Oh my gosh, I am SO excited you''re here. I''ve been on Pinterest for three months. Wait — let me show you my mood board. Have you ever painted a ceiling navy blue?',
    '["listening","next_steps","assertiveness"]'::jsonb,
    'I',
    true
  )
) AS seed(tenant_id, title, description, industry, scenario_type, difficulty,
           caller_persona_prompt, initial_opening, skills_trained, disc_type, is_template)
WHERE NOT EXISTS (
  SELECT 1 FROM roleplay_scenarios r
   WHERE r.is_template = true AND r.tenant_id IS NULL AND r.title = seed.title
);

COMMIT;
