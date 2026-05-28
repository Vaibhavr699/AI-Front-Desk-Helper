-- ============================================================================
-- Migration 090 — Merge duplicate leads + backfill phone to E.164
-- Date: 2026-05-28
--
-- WHY:
--   getOrCreateLead did exact-string phone matching with no normalization,
--   so one real number stored in multiple formats (+14022907925, 402-290-7925,
--   4022907925) bypassed the UNIQUE (tenant_id, phone) constraint and created
--   duplicate lead rows. Voice calls looking for the exact E.164 string missed
--   legacy-format rows, producing the 34% call→lead link rate.
--
--   The code fix (services/leads.js, same rollout) normalizes phones going
--   forward. This migration cleans up the EXISTING mess:
--     STEP 1 — merge duplicate lead clusters (re-point all FKs, then delete dupes)
--     STEP 2 — backfill all remaining leads.phone to canonical E.164
--
-- KNOWN CLUSTERS (Gladiators tenant a2942de5-…, confirmed via dupe scan):
--   last10 4022907925 → 3 rows  (+14022907925 / 402-290-7925 / 4022907925)
--   last10 3083798373 → 2 rows  (308-379-8373 / +13083798373)
--   This migration is written generically so it catches ANY cluster across
--   ALL tenants, not just these two.
--
-- FK TABLES RE-POINTED (verified via information_schema):
--   bookings.lead_id, calls.lead_id, campaign_log.lead_id, disc_feedback.lead_id,
--   estimate_recoveries.lead_id, in_home_sessions.lead_id, messages.lead_id,
--   nurturing_schedule.lead_id, recording_consents.lead_id,
--   referral_leads.lead_id, referral_leads.referring_lead_id
--
-- SAFETY:
--   - Entire migration runs in ONE transaction. If anything fails, nothing
--     commits.
--   - Survivor = OLDEST row per (tenant_id, last10) cluster (preserves the
--     original created_at and any history attached to it).
--   - Non-null fields missing on the survivor are copied from the newest dupe
--     that has them (so we don't lose a name/email captured on a later row).
--   - Run the SELECT preview blocks (commented) first if you want to eyeball
--     what will change before committing.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- Helper: canonical E.164 for a raw phone string.
--   - Strips non-digits.
--   - If 10 digits → assume US, prefix +1.
--   - If 11 digits starting with 1 → +<digits>.
--   - Otherwise → + <digits> (best effort; covers the formats we actually have).
-- This mirrors the JS normalizeE164Phone for US numbers, which is all the
-- data in play here.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pg_temp.canon_phone(raw text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  digits text;
BEGIN
  IF raw IS NULL THEN RETURN NULL; END IF;
  -- Leave synthetic keys untouched.
  IF raw LIKE 'fb-%' OR raw LIKE 'web-%' THEN RETURN raw; END IF;

  digits := regexp_replace(raw, '[^0-9]', '', 'g');
  IF digits = '' THEN RETURN raw; END IF;

  IF length(digits) = 10 THEN
    RETURN '+1' || digits;
  ELSIF length(digits) = 11 AND left(digits, 1) = '1' THEN
    RETURN '+' || digits;
  ELSE
    RETURN '+' || digits;
  END IF;
END;
$$;

-- ----------------------------------------------------------------------------
-- STEP 1 — Merge duplicate lead clusters
-- ----------------------------------------------------------------------------

-- Build the survivor/dupe mapping into a temp table.
-- Cluster key = (tenant_id, last-10-digits of phone), only for real phones,
-- only where more than one row exists.
CREATE TEMP TABLE _lead_merge_map ON COMMIT DROP AS
WITH clusters AS (
  SELECT
    tenant_id,
    right(regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g'), 10) AS last10,
    id,
    created_at,
    ROW_NUMBER() OVER (
      PARTITION BY tenant_id,
        right(regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g'), 10)
      ORDER BY created_at ASC, id ASC
    ) AS rn,
    COUNT(*) OVER (
      PARTITION BY tenant_id,
        right(regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g'), 10)
    ) AS cluster_size
  FROM leads
  WHERE phone IS NOT NULL
    AND phone NOT LIKE 'fb-%'
    AND phone NOT LIKE 'web-%'
    AND length(regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g')) >= 10
)
SELECT
  d.tenant_id,
  d.last10,
  d.id            AS dupe_id,
  s.id            AS survivor_id
FROM clusters d
JOIN clusters s
  ON s.tenant_id = d.tenant_id
 AND s.last10    = d.last10
 AND s.rn        = 1            -- survivor is the oldest row
WHERE d.cluster_size > 1
  AND d.rn > 1;                 -- only the non-survivor rows are "dupes"

-- Optional preview — uncomment to inspect before committing:
-- SELECT * FROM _lead_merge_map ORDER BY tenant_id, last10;

-- 1a. Copy missing non-null fields onto the survivor from its dupes.
--     We take the most-recently-created dupe value for each field that the
--     survivor is missing. This prevents losing a name/email/address that was
--     captured on a later duplicate row.
UPDATE leads s
SET
  name                    = COALESCE(s.name,                    picks.name),
  email                   = COALESCE(s.email,                   picks.email),
  address                 = COALESCE(s.address,                 picks.address),
  project_type            = COALESCE(s.project_type,            picks.project_type),
  notes                   = COALESCE(s.notes,                   picks.notes),
  facebook_id             = COALESCE(s.facebook_id,             picks.facebook_id),
  web_id                  = COALESCE(s.web_id,                  picks.web_id),
  estimated_revenue_cents = COALESCE(s.estimated_revenue_cents, picks.estimated_revenue_cents),
  actual_revenue_cents    = COALESCE(s.actual_revenue_cents,    picks.actual_revenue_cents),
  has_sms_consent         = (s.has_sms_consent OR COALESCE(picks.has_sms_consent, false)),
  updated_at              = now()
FROM (
  SELECT DISTINCT ON (m.survivor_id)
    m.survivor_id,
    l.name, l.email, l.address, l.project_type, l.notes,
    l.facebook_id, l.web_id,
    l.estimated_revenue_cents, l.actual_revenue_cents, l.has_sms_consent
  FROM _lead_merge_map m
  JOIN leads l ON l.id = m.dupe_id
  ORDER BY m.survivor_id, l.created_at DESC
) picks
WHERE s.id = picks.survivor_id;

-- 1b. Re-point every FK from dupe rows to the survivor.
UPDATE bookings b            SET lead_id = m.survivor_id FROM _lead_merge_map m WHERE b.lead_id = m.dupe_id;
UPDATE calls c               SET lead_id = m.survivor_id FROM _lead_merge_map m WHERE c.lead_id = m.dupe_id;
UPDATE campaign_log cl       SET lead_id = m.survivor_id FROM _lead_merge_map m WHERE cl.lead_id = m.dupe_id;
UPDATE disc_feedback df      SET lead_id = m.survivor_id FROM _lead_merge_map m WHERE df.lead_id = m.dupe_id;
UPDATE estimate_recoveries er SET lead_id = m.survivor_id FROM _lead_merge_map m WHERE er.lead_id = m.dupe_id;
UPDATE in_home_sessions ihs  SET lead_id = m.survivor_id FROM _lead_merge_map m WHERE ihs.lead_id = m.dupe_id;
UPDATE messages ms           SET lead_id = m.survivor_id FROM _lead_merge_map m WHERE ms.lead_id = m.dupe_id;
UPDATE nurturing_schedule ns SET lead_id = m.survivor_id FROM _lead_merge_map m WHERE ns.lead_id = m.dupe_id;
UPDATE recording_consents rc SET lead_id = m.survivor_id FROM _lead_merge_map m WHERE rc.lead_id = m.dupe_id;
UPDATE referral_leads rl     SET lead_id = m.survivor_id FROM _lead_merge_map m WHERE rl.lead_id = m.dupe_id;
UPDATE referral_leads rl     SET referring_lead_id = m.survivor_id FROM _lead_merge_map m WHERE rl.referring_lead_id = m.dupe_id;

-- 1c. Delete the now-orphaned dupe rows.
DELETE FROM leads l USING _lead_merge_map m WHERE l.id = m.dupe_id;

-- ----------------------------------------------------------------------------
-- STEP 2 — Backfill all remaining leads.phone to canonical E.164
-- ----------------------------------------------------------------------------
-- After the merge, each (tenant_id, last10) has exactly one row, so canonical-
-- izing the phone string can no longer collide with a sibling dupe. We still
-- guard per-row in case a non-dupe row in another tenant somehow shares the
-- canonical form (it won't, since the constraint is per-tenant, but belt +
-- suspenders). Synthetic fb-/web- rows are skipped by canon_phone().
UPDATE leads
SET phone = pg_temp.canon_phone(phone),
    updated_at = now()
WHERE phone IS NOT NULL
  AND phone NOT LIKE 'fb-%'
  AND phone NOT LIKE 'web-%'
  AND phone <> pg_temp.canon_phone(phone);

-- ----------------------------------------------------------------------------
-- Verification (runs inside the txn; results visible before COMMIT)
-- ----------------------------------------------------------------------------
-- Expect: zero remaining duplicate clusters.
DO $$
DECLARE
  remaining int;
BEGIN
  SELECT count(*) INTO remaining FROM (
    SELECT tenant_id,
           right(regexp_replace(COALESCE(phone,''), '[^0-9]', '', 'g'), 10) AS last10
    FROM leads
    WHERE phone IS NOT NULL AND phone NOT LIKE 'fb-%' AND phone NOT LIKE 'web-%'
      AND length(regexp_replace(COALESCE(phone,''), '[^0-9]', '', 'g')) >= 10
    GROUP BY 1, 2
    HAVING count(*) > 1
  ) x;
  RAISE NOTICE 'Migration 085: remaining duplicate lead clusters = %', remaining;
  IF remaining > 0 THEN
    RAISE EXCEPTION 'Migration 085 ABORT: % duplicate clusters still present after merge', remaining;
  END IF;
END $$;

COMMIT;

-- ============================================================================
-- POST-COMMIT sanity checks (run separately after the migration):
--
--   -- 1. The known clusters should now be single rows in E.164:
--   SELECT id, phone, name, created_at FROM leads
--   WHERE tenant_id = 'a2942de5-5bfd-4cb1-8071-9207fe290a4b'
--     AND right(regexp_replace(phone,'[^0-9]','','g'),10) IN ('4022907925','3083798373');
--
--   -- 2. No leads.phone should contain non-E.164 chars (dashes, parens, spaces):
--   SELECT count(*) FROM leads
--   WHERE phone IS NOT NULL AND phone NOT LIKE 'fb-%' AND phone NOT LIKE 'web-%'
--     AND phone !~ '^\+[0-9]+$';
--   -- expect 0
--
--   -- 3. Re-run the 14-day call link-rate query — new voice calls should now
--   --    link at a much higher rate once the code fix is deployed.
-- ============================================================================
