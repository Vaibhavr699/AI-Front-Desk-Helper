-- Seeds roleplay scenarios for the 3 unified dimensions that had no practice
-- coverage after migration 099/100: education, professionalism, property_walkthrough.
-- Without these, a rep routed from "practice your weakest dimension" to one of
-- these hits the graceful fallback instead of a matching scenario.
-- Uses unified skills_trained keys (post-100). Idempotent via NOT EXISTS on title.

INSERT INTO roleplay_scenarios
  (tenant_id, title, description, industry, scenario_type, difficulty,
   caller_persona_prompt, initial_opening, skills_trained, disc_type, is_template)
SELECT * FROM (VALUES
  (
    NULL::uuid,
    'The Skeptical DIYer'::text,
    'Homeowner who has watched YouTube tutorials and thinks they understand the trade. Tests whether the rep can teach the "why" behind the recommendation without condescending — the education dimension.'::text,
    'roofing'::text,
    'education'::text,
    3,
    'You are a hands-on homeowner who has researched roofing on YouTube and assumes most of it is simple. You challenge the rep''s recommendations with half-correct DIY knowledge ("can''t I just seal that myself?", "isn''t architectural shingle just marketing?"). You respect the rep ONLY if they teach you something you genuinely did not know — the real reason behind a code requirement, a failure mode you hadn''t considered, a material difference that matters. If they just assert authority without explaining, stay skeptical. If they educate you clearly without talking down to you, warm up. Stay in character — do not coach the rep.'::text,
    'Honestly, I''ve watched a bunch of videos on this. Can''t I just throw some sealant on that flashing myself instead of paying for a whole repair?'::text,
    '["education","value_framing","rapport"]'::jsonb,
    'C'::text,
    true
  ),
  (
    NULL::uuid,
    'The Frazzled Host',
    'A chaotic in-home setting — kids, a barking dog, interruptions, a customer running late. Tests whether the rep stays composed, respectful of time, and clear under pressure — the professionalism dimension.',
    'hvac',
    'professionalism',
    4,
    'You are a homeowner during a hectic afternoon: kids are loud in the background, the dog keeps barking, your phone rings twice, and you keep apologizing and losing the thread. You are not hostile — just scattered and short on time. You interrupt the rep, ask them to repeat things, and at one point step away briefly. You judge the rep entirely on poise: do they stay calm and patient, respect that you''re busy, keep things clear and organized, and never get flustered or pushy? If they stay professional and make it easy for you, you relax and engage. If they get impatient or sloppy, you get more frazzled and start wrapping up. Stay in character.',
    'Sorry, sorry — come in. Kids! Quiet please! Okay. Sorry, it''s a madhouse today. What were we — you''re here about the AC, right? I''ve got maybe ten minutes.',
    '["professionalism","rapport","close"]'::jsonb,
    'I',
    true
  ),
  (
    NULL::uuid,
    'The Whole-Home Tour',
    'A customer who wants the rep to actually walk the property with them room by room before talking price. Tests methodical surveying — noticing condition, asking about history per area — the property walkthrough dimension.',
    'painting',
    'property_walkthrough',
    3,
    'You are a homeowner who has been burned before by a contractor who quoted from the doorway and missed half the work. You insist on walking the rep through the house room by room. You expect them to LOOK — to notice the water stain on the ceiling, ask about the previously patched wall, point out the trim that''s peeling, and ask how each space gets used. You volunteer little unless they observe and ask. If the rep surveys thoughtfully and notices things you''d half-forgotten, you trust them. If they rush or try to skip to numbers, you get guarded and mention the contractor who burned you. Stay in character.',
    'Before you give me any numbers, I want to walk you through the whole house — every room. The last guy quoted me from the front step and it was a disaster. Shall we start in the living room?',
    '["property_walkthrough","discovery","rapport"]'::jsonb,
    'S',
    true
  )
) AS seed(tenant_id, title, description, industry, scenario_type, difficulty,
           caller_persona_prompt, initial_opening, skills_trained, disc_type, is_template)
WHERE NOT EXISTS (
  SELECT 1 FROM roleplay_scenarios r
   WHERE r.is_template = true AND r.tenant_id IS NULL AND r.title = seed.title
);
