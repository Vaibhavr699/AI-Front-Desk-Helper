-- ============================================================================
-- Migration 090 — Merge duplicate leads + backfill phone to E.164
-- Date: 2026-05-28
--
-- SUPABASE EDITOR NOTE:
--   The Supabase SQL editor runs statements in separate sessions and drops
--   ON COMMIT temp tables between statements, which broke the multi-statement
--   version (relation "_lead_merge_map" does not exist). This version is ONE
--   atomic DO block: the whole merge + backfill runs as a single statement /
--   single transaction. If any part fails, nothing is applied.
--
-- WHY:
--   getOrCreateLead did exact-string phone matching with no normalization, so
--   one real number stored in multiple formats (+14022907925, 402-290-7925,
--   4022907925) bypassed UNIQUE (tenant_id, phone) and created duplicate rows.
--   Voice calls looking for the exact E.164 string missed legacy-format rows,
--   producing the 34% call→lead link rate.
--
--   The code fix (services/leads.js) normalizes going forward. This migration
--   cleans up EXISTING data: merge dupes (re-point all 11 FK columns) + backfill
--   leads.phone to E.164.
--
-- FK columns re-pointed (verified via information_schema):
--   bookings.lead_id, calls.lead_id, campaign_log.lead_id, disc_feedback.lead_id,
--   estimate_recoveries.lead_id, in_home_sessions.lead_id, messages.lead_id,
--   nurturing_schedule.lead_id, recording_consents.lead_id,
--   referral_leads.lead_id, referral_leads.referring_lead_id
--
-- Survivor = OLDEST row per (tenant_id, last10) cluster. Missing non-null
-- fields are copied from the newest dupe that has them.
-- ============================================================================

DO $migration$
DECLARE
  remaining int;
  merged    int;
BEGIN
  -- ── Build the survivor/dupe map (plain temp table, lives for this block) ──
  CREATE TEMP TABLE _lead_merge_map AS
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
    d.id AS dupe_id,
    s.id AS survivor_id
  FROM clusters d
  JOIN clusters s
    ON s.tenant_id = d.tenant_id
   AND s.last10    = d.last10
   AND s.rn        = 1
  WHERE d.cluster_size > 1
    AND d.rn > 1;

  SELECT count(*) INTO merged FROM _lead_merge_map;
  RAISE NOTICE 'Migration 090: dupe rows to merge = %', merged;

  -- ── 1. Copy missing non-null fields onto survivor from newest dupe ──
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

  -- ── 2. Re-point every FK from dupe rows to the survivor ──
  UPDATE bookings b             SET lead_id = m.survivor_id FROM _lead_merge_map m WHERE b.lead_id  = m.dupe_id;
  UPDATE calls c                SET lead_id = m.survivor_id FROM _lead_merge_map m WHERE c.lead_id  = m.dupe_id;
  UPDATE campaign_log cl        SET lead_id = m.survivor_id FROM _lead_merge_map m WHERE cl.lead_id = m.dupe_id;
  UPDATE disc_feedback df       SET lead_id = m.survivor_id FROM _lead_merge_map m WHERE df.lead_id = m.dupe_id;
  UPDATE estimate_recoveries er SET lead_id = m.survivor_id FROM _lead_merge_map m WHERE er.lead_id = m.dupe_id;
  UPDATE in_home_sessions ihs   SET lead_id = m.survivor_id FROM _lead_merge_map m WHERE ihs.lead_id = m.dupe_id;
  UPDATE messages ms            SET lead_id = m.survivor_id FROM _lead_merge_map m WHERE ms.lead_id = m.dupe_id;
  UPDATE nurturing_schedule ns  SET lead_id = m.survivor_id FROM _lead_merge_map m WHERE ns.lead_id = m.dupe_id;
  UPDATE recording_consents rc  SET lead_id = m.survivor_id FROM _lead_merge_map m WHERE rc.lead_id = m.dupe_id;
  UPDATE referral_leads rl      SET lead_id = m.survivor_id FROM _lead_merge_map m WHERE rl.lead_id = m.dupe_id;
  UPDATE referral_leads rl      SET referring_lead_id = m.survivor_id FROM _lead_merge_map m WHERE rl.referring_lead_id = m.dupe_id;

  -- ── 3. Delete the now-orphaned dupe rows ──
  DELETE FROM leads l USING _lead_merge_map m WHERE l.id = m.dupe_id;

  -- ── 4. Backfill all remaining leads.phone to canonical E.164 ──
  -- US-number canonicalization inline (matches lib/phone normalizeE164Phone
  -- for the formats present: 10 digits -> +1XXXXXXXXXX, 11 starting with 1 ->
  -- +1XXXXXXXXXX, else + all digits). Synthetic fb-/web- rows are skipped.
  UPDATE leads
  SET phone = CASE
        WHEN length(regexp_replace(phone, '[^0-9]', '', 'g')) = 10
          THEN '+1' || regexp_replace(phone, '[^0-9]', '', 'g')
        WHEN length(regexp_replace(phone, '[^0-9]', '', 'g')) = 11
             AND left(regexp_replace(phone, '[^0-9]', '', 'g'), 1) = '1'
          THEN '+'  || regexp_replace(phone, '[^0-9]', '', 'g')
        ELSE '+'    || regexp_replace(phone, '[^0-9]', '', 'g')
      END,
      updated_at = now()
  WHERE phone IS NOT NULL
    AND phone NOT LIKE 'fb-%'
    AND phone NOT LIKE 'web-%'
    AND regexp_replace(phone, '[^0-9]', '', 'g') <> ''
    AND phone <> CASE
        WHEN length(regexp_replace(phone, '[^0-9]', '', 'g')) = 10
          THEN '+1' || regexp_replace(phone, '[^0-9]', '', 'g')
        WHEN length(regexp_replace(phone, '[^0-9]', '', 'g')) = 11
             AND left(regexp_replace(phone, '[^0-9]', '', 'g'), 1) = '1'
          THEN '+'  || regexp_replace(phone, '[^0-9]', '', 'g')
        ELSE '+'    || regexp_replace(phone, '[^0-9]', '', 'g')
      END;

  -- ── 5. Verify: zero remaining duplicate clusters ──
  SELECT count(*) INTO remaining FROM (
    SELECT tenant_id,
           right(regexp_replace(COALESCE(phone,''), '[^0-9]', '', 'g'), 10) AS last10
    FROM leads
    WHERE phone IS NOT NULL AND phone NOT LIKE 'fb-%' AND phone NOT LIKE 'web-%'
      AND length(regexp_replace(COALESCE(phone,''), '[^0-9]', '', 'g')) >= 10
    GROUP BY 1, 2
    HAVING count(*) > 1
  ) x;

  RAISE NOTICE 'Migration 090: remaining duplicate lead clusters = %', remaining;
  IF remaining > 0 THEN
    RAISE EXCEPTION 'Migration 090 ABORT: % duplicate clusters still present after merge', remaining;
  END IF;

  DROP TABLE _lead_merge_map;
  RAISE NOTICE 'Migration 090: complete. Merged % dupe rows.', merged;
END
$migration$;
