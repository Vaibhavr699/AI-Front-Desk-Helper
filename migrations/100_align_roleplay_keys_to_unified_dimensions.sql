-- Aligns legacy roleplay vocabulary to the unified scoring dimensions (migration 099).
-- Issue C: roleplay_scenarios.skills_trained tags must use unified dimension keys so
--          weak-spot -> targeted-practice routing can filter on them.
-- Issue B: 3 historical roleplay_sessions.scoring rows carry old dimension keys.
--
-- Key remap:
--   presenting     -> value_framing
--   closing        -> close
--   assertiveness  -> close          (closest unified concept: driving commitment)
--   price_objection-> objection_handling  (skills_trained tag only)

UPDATE roleplay_scenarios
SET skills_trained = (
  SELECT jsonb_agg(DISTINCT
    CASE k
      WHEN 'presenting' THEN 'value_framing'
      WHEN 'closing' THEN 'close'
      WHEN 'assertiveness' THEN 'close'
      WHEN 'price_objection' THEN 'objection_handling'
      ELSE k
    END
  )
  FROM jsonb_array_elements_text(skills_trained::jsonb) AS k
)
WHERE skills_trained IS NOT NULL
  AND skills_trained::jsonb ?| array['presenting', 'closing', 'assertiveness', 'price_objection'];

-- Both 'closing' and 'assertiveness' remap to 'close'; rows may contain both.
-- Dedupe by keeping the MAX score per remapped key so no dimension is silently dropped.
UPDATE roleplay_sessions
SET scoring = jsonb_set(
  scoring,
  '{dimensions}',
  (
    SELECT jsonb_object_agg(mapped_key, max_val)
    FROM (
      SELECT
        CASE k
          WHEN 'presenting' THEN 'value_framing'
          WHEN 'closing' THEN 'close'
          WHEN 'assertiveness' THEN 'close'
          ELSE k
        END AS mapped_key,
        to_jsonb(max((v#>>'{}')::numeric)) AS max_val
      FROM jsonb_each(scoring->'dimensions') AS e(k, v)
      WHERE jsonb_typeof(v) = 'number'
      GROUP BY 1
    ) collapsed
  )
)
WHERE scoring ? 'dimensions'
  AND (scoring->'dimensions') ?| array['presenting', 'closing', 'assertiveness'];
