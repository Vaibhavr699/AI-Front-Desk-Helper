ALTER TABLE tenant_scorecards
  ALTER COLUMN scoring_dimensions SET DEFAULT '[
    {"key": "rapport", "label": "Rapport", "criteria": "opened warmly, used customer name, built personal connection, found common ground"},
    {"key": "property_walkthrough", "label": "Property Walkthrough", "criteria": "surveyed the space methodically (rooms/areas/condition/history per area)", "contexts": ["visit"]},
    {"key": "discovery", "label": "Discovery", "criteria": "uncovered motivation, timeline, budget signal, decision-maker structure"},
    {"key": "listening", "label": "Listening", "criteria": "let the customer finish, reflected back what they heard, did not talk over or interrupt"},
    {"key": "education", "label": "Education", "criteria": "positioned expertise (process, materials, timeline, warranty) without jargon-dumping"},
    {"key": "value_framing", "label": "Value Framing", "criteria": "connected solution to customer''s stated needs; anchored on transformation, not features"},
    {"key": "objection_handling", "label": "Objection Handling", "criteria": "acknowledged + validated + reframed; not defensive, not capitulating"},
    {"key": "close", "label": "Close", "criteria": "asked for the sale or specific next step; locked a date/action/commitment"},
    {"key": "next_steps", "label": "Next Steps", "criteria": "secured a concrete follow-up: appointment, signature, or committed action with a date"},
    {"key": "professionalism", "label": "Professionalism", "criteria": "tone, language, respect for time, clarity; penalize filler/talking over customer"}
  ]'::jsonb;

UPDATE tenant_scorecards
SET scoring_dimensions = (
  SELECT jsonb_agg(d.elem ORDER BY d.ord)
  FROM (
    SELECT elem, ord
    FROM jsonb_array_elements(scoring_dimensions) WITH ORDINALITY AS t(elem, ord)
    UNION ALL
    SELECT '{"key": "listening", "label": "Listening", "criteria": "let the customer finish, reflected back what they heard, did not talk over or interrupt"}'::jsonb, 3.5
    WHERE NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(scoring_dimensions) e
      WHERE e->>'key' = 'listening'
    )
    UNION ALL
    SELECT '{"key": "next_steps", "label": "Next Steps", "criteria": "secured a concrete follow-up: appointment, signature, or committed action with a date"}'::jsonb, 8.5
    WHERE NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(scoring_dimensions) e
      WHERE e->>'key' = 'next_steps'
    )
  ) d
)
WHERE jsonb_typeof(scoring_dimensions) = 'array';

UPDATE tenant_scorecards
SET scoring_dimensions = (
  SELECT jsonb_agg(
    CASE WHEN elem->>'key' = 'property_walkthrough' AND NOT (elem ? 'contexts')
         THEN elem || '{"contexts": ["visit"]}'::jsonb
         ELSE elem END
  )
  FROM jsonb_array_elements(scoring_dimensions) elem
)
WHERE jsonb_typeof(scoring_dimensions) = 'array';
