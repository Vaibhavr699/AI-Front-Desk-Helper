ALTER TABLE coaching_scores DROP CONSTRAINT IF EXISTS coaching_scores_dimension_check;

ALTER TABLE coaching_scores DROP CONSTRAINT IF EXISTS coaching_scores_dimension_len_chk;
ALTER TABLE coaching_scores ADD CONSTRAINT coaching_scores_dimension_len_chk
  CHECK (char_length(dimension) BETWEEN 1 AND 60);

ALTER TABLE tenant_scorecards
  ADD COLUMN IF NOT EXISTS scoring_dimensions JSONB NOT NULL DEFAULT '[
    {"key": "rapport", "label": "Rapport", "criteria": "opened warmly, used customer name, built personal connection, found common ground"},
    {"key": "property_walkthrough", "label": "Property Walkthrough", "criteria": "surveyed the space methodically (rooms/areas/condition/history per area)"},
    {"key": "discovery", "label": "Discovery", "criteria": "uncovered motivation, timeline, budget signal, decision-maker structure"},
    {"key": "education", "label": "Education", "criteria": "positioned expertise (process, materials, timeline, warranty) without jargon-dumping"},
    {"key": "value_framing", "label": "Value Framing", "criteria": "connected solution to customer''s stated needs; anchored on transformation, not features"},
    {"key": "objection_handling", "label": "Objection Handling", "criteria": "acknowledged + validated + reframed; not defensive, not capitulating"},
    {"key": "close", "label": "Close", "criteria": "asked for the sale or specific next step; locked a date/action/commitment"},
    {"key": "professionalism", "label": "Professionalism", "criteria": "tone, language, respect for time, clarity; penalize filler/talking over customer"}
  ]'::jsonb;
