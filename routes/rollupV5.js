"use strict";

/**
 * Rollup V5 — Parent Tenant Dashboard
 * Mounted at /api/rollup-v5
 *
 * Replaces the V4 Businesses page (routes/rollup.js) with a single-page
 * dashboard built around 4 hero tiles, a contact-method donut, reviews
 * alerts, and a sortable location table.
 *
 * Spec locked Apr 23, 2026 (userMemories #7).
 *
 * Period toggle: ?period=7d|30d|90d (default 30d).
 * Child scope:   direct children only (WHERE parent_id = $1).
 */

const express = require("express");
const db      = require("../lib/db");
const router  = express.Router();

// ── Period handling ────────────────────────────────────────────────────────
// Accept only the 3 values the spec locks. Anything else → 30d default.
// Returned as a days int so SQL can do `now() - interval '$N days'`.
const PERIOD_TO_DAYS = { "7d": 7, "30d": 30, "90d": 90 };

function resolvePeriod(raw) {
  const normalized = String(raw || "30d").toLowerCase();
  const days = PERIOD_TO_DAYS[normalized];
  if (!days) return { period: "30d", days: 30 };
  return { period: normalized, days };
}

// ── Parent tenant validation ───────────────────────────────────────────────
// Ensures the authenticated user owns this parent tenant OR is a superadmin.
// Also ensures the parent IS actually a parent (operating_hq or rollup_only).
// Returns the parent row on success, or null + writes an error response.
async function validateParentAccess(req, res, parentId) {
  if (!parentId || !/^[0-9a-f-]{36}$/i.test(parentId)) {
    res.status(400).json({ error: "Invalid parent tenant ID" });
    return null;
  }

  const parentRes = await db.query(
    `SELECT id, name, company_name, parent_id, parent_mode, brand_mode,
            timezone, brand_color, logo_url, created_at
       FROM tenants
      WHERE id = $1
      LIMIT 1`,
    [parentId]
  );
  const parent = parentRes.rows[0];

  if (!parent) {
    res.status(404).json({ error: "Parent tenant not found" });
    return null;
  }

  if (!parent.parent_mode) {
    res.status(400).json({ error: "This tenant is not a parent / rollup tenant" });
    return null;
  }

  if (req.user?.is_super_admin) return parent;

  const membershipRes = await db.query(
    `SELECT 1 FROM team_members
      WHERE user_id = $1 AND tenant_id = $2
      LIMIT 1`,
    [req.user.id, parentId]
  );
  if (membershipRes.rows.length === 0) {
    res.status(403).json({ error: "You do not have access to this parent tenant" });
    return null;
  }

  return parent;
}

// ── Rollup scope resolver ──────────────────────────────────────────────────
// Returns the set of tenant IDs that contribute to rollup metrics.
//
// For parent_mode='operating_hq' (Gladiators-style — HQ runs jobs itself):
//   includes parent + all active children
//
// For parent_mode='rollup_only' (franchise brand corp — no jobs):
//   children only (including parent would always add zeros)
//
// Active children = haven't been removed, aren't suspended, not soft-deleted.
async function getRollupScopeIds(parent) {
  const { rows } = await db.query(
    `SELECT id
       FROM tenants
      WHERE parent_id = $1
        AND location_removed_at IS NULL
        AND (is_suspended IS NULL OR is_suspended = false)
        AND deleted_at IS NULL`,
    [parent.id]
  );
  const childIds = rows.map((r) => r.id);

  if (parent.parent_mode === "operating_hq") {
    return { all_ids: [parent.id, ...childIds], child_ids: childIds };
  }
  return { all_ids: childIds, child_ids: childIds };
}

// ═══════════════════════════════════════════════════════════════════════════
// HERO TILE 1 — AI ACTIVITY
// ═══════════════════════════════════════════════════════════════════════════
async function getAiActivityTile(tenantIds, days) {
  if (tenantIds.length === 0) {
    return { calls_total: 0, bookings_total: 0, booking_rate_pct: null };
  }

  const result = await db.query(
    `SELECT
       (SELECT COUNT(*)::int FROM calls
         WHERE tenant_id = ANY($1::uuid[])
           AND direction = 'inbound'
           AND started_at > now() - ($2::int * interval '1 day'))
         AS calls_total,
       (SELECT COUNT(*)::int FROM bookings
         WHERE tenant_id = ANY($1::uuid[])
           AND created_at > now() - ($2::int * interval '1 day'))
         AS bookings_total`,
    [tenantIds, days]
  );

  const { calls_total, bookings_total } = result.rows[0];
  const booking_rate_pct =
    calls_total > 0
      ? Math.round((bookings_total / calls_total) * 1000) / 10
      : null;

  return { calls_total, bookings_total, booking_rate_pct };
}

// ═══════════════════════════════════════════════════════════════════════════
// HERO TILE 2 — AFTER-HOURS REVENUE
// ═══════════════════════════════════════════════════════════════════════════
async function getAfterHoursRevenueTile(tenantIds, days) {
  if (tenantIds.length === 0) {
    return {
      after_hours_revenue_cents: 0,
      after_hours_booking_count: 0,
      total_revenue_cents:       0,
      after_hours_pct_of_total:  null,
    };
  }

  const result = await db.query(
    `
    WITH booking_scope AS (
      SELECT
        b.id,
        b.actual_revenue_cents,
        b.created_at,
        COALESCE(t.timezone, 'America/Chicago') AS tz,
        t.business_hours
      FROM bookings b
      JOIN tenants t ON t.id = b.tenant_id
      WHERE b.tenant_id = ANY($1::uuid[])
        AND b.created_at > now() - ($2::int * interval '1 day')
        AND b.actual_revenue_cents IS NOT NULL
        AND b.actual_revenue_cents > 0
    ),
    booking_classified AS (
      SELECT
        id,
        actual_revenue_cents,
        CASE
          WHEN business_hours IS NULL THEN
            CASE
              WHEN EXTRACT(DOW FROM (created_at AT TIME ZONE tz)) NOT IN (1,2,3,4,5) THEN true
              WHEN (created_at AT TIME ZONE tz)::time < '08:00:00' THEN true
              WHEN (created_at AT TIME ZONE tz)::time >= '18:00:00' THEN true
              ELSE false
            END
          ELSE
            CASE
              WHEN COALESCE(
                (business_hours -> (
                  CASE EXTRACT(DOW FROM (created_at AT TIME ZONE tz))::int
                    WHEN 0 THEN 'sunday'
                    WHEN 1 THEN 'monday'
                    WHEN 2 THEN 'tuesday'
                    WHEN 3 THEN 'wednesday'
                    WHEN 4 THEN 'thursday'
                    WHEN 5 THEN 'friday'
                    WHEN 6 THEN 'saturday'
                  END
                ) ->> 'closed')::boolean,
                true
              ) THEN true
              WHEN (created_at AT TIME ZONE tz)::time 
                COALESCE(
                  (business_hours -> (
                    CASE EXTRACT(DOW FROM (created_at AT TIME ZONE tz))::int
                      WHEN 0 THEN 'sunday'
                      WHEN 1 THEN 'monday'
                      WHEN 2 THEN 'tuesday'
                      WHEN 3 THEN 'wednesday'
                      WHEN 4 THEN 'thursday'
                      WHEN 5 THEN 'friday'
                      WHEN 6 THEN 'saturday'
                    END
                  ) ->> 'open')::time,
                  '08:00'::time
                )
              THEN true
              WHEN (created_at AT TIME ZONE tz)::time >=
                COALESCE(
                  (business_hours -> (
                    CASE EXTRACT(DOW FROM (created_at AT TIME ZONE tz))::int
                      WHEN 0 THEN 'sunday'
                      WHEN 1 THEN 'monday'
                      WHEN 2 THEN 'tuesday'
                      WHEN 3 THEN 'wednesday'
                      WHEN 4 THEN 'thursday'
                      WHEN 5 THEN 'friday'
                      WHEN 6 THEN 'saturday'
                    END
                  ) ->> 'close')::time,
                  '18:00'::time
                )
              THEN true
              ELSE false
            END
        END AS is_after_hours
      FROM booking_scope
    )
    SELECT
      COALESCE(SUM(CASE WHEN is_after_hours THEN actual_revenue_cents ELSE 0 END), 0)::bigint
        AS after_hours_revenue_cents,
      COUNT(*) FILTER (WHERE is_after_hours)::int
        AS after_hours_booking_count,
      COALESCE(SUM(actual_revenue_cents), 0)::bigint
        AS total_revenue_cents
    FROM booking_classified
    `,
    [tenantIds, days]
  );

  const row = result.rows[0];
  const after_hours_revenue_cents = Number(row.after_hours_revenue_cents);
  const after_hours_booking_count = Number(row.after_hours_booking_count);
  const total_revenue_cents       = Number(row.total_revenue_cents);

  const after_hours_pct_of_total =
    total_revenue_cents > 0
      ? Math.round((after_hours_revenue_cents / total_revenue_cents) * 1000) / 10
      : null;

  return {
    after_hours_revenue_cents,
    after_hours_booking_count,
    total_revenue_cents,
    after_hours_pct_of_total,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// HERO TILE 3 — NETWORK REVENUE
// ═══════════════════════════════════════════════════════════════════════════
// Sum of actual_revenue_cents across all rollup-scope tenants in the period,
// plus MoM delta comparing to the immediately prior same-length window.
//
// Definition per Apr 23 spec:
//   • actual_revenue_cents ONLY — matches Tile 2, keeps the dashboard honest.
//     Pipeline (estimated_revenue_cents) NOT included.
//   • MoM delta: current period total vs previous equal-length period
//     (e.g. period=30d → current 0-30d, previous 30-60d).
//   • Confidence flag: 'high' when parent has ≥60d of history, otherwise
//     'low' so the UI can gray out or show a disclaimer. We do NOT suppress
//     the delta itself — backend returns data, frontend decides display.
//
// Age source: tenant parent's created_at. For rollup_only parents with
// multiple children of varying ages this is still the right signal —
// the question is "has THIS dashboard accumulated enough data yet", which
// is answered by when the parent tenant was created.
//
// Edge cases:
//   • Previous period total = 0 → delta_pct = null (can't divide by zero).
//     UI should render "No prior data" instead of "+∞%".
//   • Current = 0 and previous = 0 → delta_pct = null, delta_direction = 'flat'.
//   • Current > 0 and previous = 0 → delta_cents > 0 but delta_pct = null.
//     UI shows absolute delta ("+$X") without a percentage.
async function getNetworkRevenueTile(tenantIds, days, parentCreatedAt) {
  if (tenantIds.length === 0) {
    return {
      current_cents:     0,
      previous_cents:    0,
      delta_cents:       0,
      delta_pct:         null,
      delta_direction:   "flat",
      confidence:        "low",
      parent_age_days:   0,
    };
  }

  // Two SUMs in a single query — Postgres handles the date math. We express
  // both windows in terms of `now()` so there's no timezone edge case: both
  // windows always compare to the same reference point.
  //
  // Current window:  now() - $days               → now()
  // Previous window: now() - ($days * 2)         → now() - $days
  const result = await db.query(
    `SELECT
       COALESCE(SUM(CASE
         WHEN created_at > now() - ($2::int * interval '1 day') THEN actual_revenue_cents
         ELSE 0
       END), 0)::bigint AS current_cents,
       COALESCE(SUM(CASE
         WHEN created_at <= now() - ($2::int * interval '1 day')
          AND created_at >  now() - (($2::int * 2) * interval '1 day')
         THEN actual_revenue_cents
         ELSE 0
       END), 0)::bigint AS previous_cents
     FROM bookings
     WHERE tenant_id = ANY($1::uuid[])
       AND created_at > now() - (($2::int * 2) * interval '1 day')
       AND actual_revenue_cents IS NOT NULL
       AND actual_revenue_cents > 0`,
    [tenantIds, days]
  );

  const current_cents  = Number(result.rows[0].current_cents);
  const previous_cents = Number(result.rows[0].previous_cents);
  const delta_cents    = current_cents - previous_cents;

  // Percentage: divide by previous, but guard against /0.
  // Signed — positive when growing, negative when shrinking.
  const delta_pct =
    previous_cents > 0
      ? Math.round((delta_cents / previous_cents) * 1000) / 10
      : null;

  let delta_direction = "flat";
  if (delta_cents > 0) delta_direction = "up";
  else if (delta_cents < 0) delta_direction = "down";

  // Confidence: based on how long this parent tenant has existed relative
  // to the comparison window. "60 days" is the spec's heuristic for "enough
  // history to trust the delta." We use the actual window size * 2 as the
  // threshold because that's what we're comparing against — if a parent is
  // 65 days old and period=30d, we need 60d of data and have 65, which is
  // high confidence. If period=90d, we need 180d and 65 is low confidence.
  const parent_age_days = parentCreatedAt
    ? Math.floor((Date.now() - new Date(parentCreatedAt).getTime()) / (1000 * 60 * 60 * 24))
    : 0;
  const required_days_for_high_confidence = days * 2;
  const confidence =
    parent_age_days >= required_days_for_high_confidence ? "high" : "low";

  return {
    current_cents,
    previous_cents,
    delta_cents,
    delta_pct,
    delta_direction,
    confidence,
    parent_age_days,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN ENDPOINT
// GET /api/rollup-v5/:parentId?period=30d
// ═══════════════════════════════════════════════════════════════════════════
router.get("/:parentId", async (req, res) => {
  try {
    const { parentId } = req.params;
    const { period, days } = resolvePeriod(req.query.period);

    const parent = await validateParentAccess(req, res, parentId);
    if (!parent) return;

    const scope = await getRollupScopeIds(parent);

    // All three tiles run in parallel. Tile 3 needs the parent row's
    // created_at to compute confidence, so we pass it down.
    const [aiActivity, afterHoursRevenue, networkRevenue] = await Promise.all([
      getAiActivityTile(scope.all_ids, days),
      getAfterHoursRevenueTile(scope.all_ids, days),
      getNetworkRevenueTile(scope.all_ids, days, parent.created_at),
    ]);

    res.json({
      parent: {
        id:           parent.id,
        name:         parent.name,
        company_name: parent.company_name,
        brand_mode:   parent.brand_mode,
        parent_mode:  parent.parent_mode,
        timezone:     parent.timezone,
        brand_color:  parent.brand_color,
        logo_url:     parent.logo_url,
      },
      meta: {
        period,
        days,
        location_count:      scope.child_ids.length,
        includes_parent:     parent.parent_mode === "operating_hq",
        rollup_tenant_count: scope.all_ids.length,
        generated_at:        new Date().toISOString(),
      },
      tiles: {
        ai_activity:         aiActivity,
        after_hours_revenue: afterHoursRevenue,
        network_revenue:     networkRevenue,
        // reviews_health:      TODO (tile 4)
      },
      // contact_method_donut: TODO
      // reviews_alerts:       TODO
      // locations:            TODO
    });
  } catch (err) {
    console.error("[RollupV5] Error:", err);
    res.status(500).json({ error: "Server error", detail: err.message });
  }
});

module.exports = router;
