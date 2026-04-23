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
const PERIOD_TO_DAYS = { "7d": 7, "30d": 30, "90d": 90 };

function resolvePeriod(raw) {
  const normalized = String(raw || "30d").toLowerCase();
  const days = PERIOD_TO_DAYS[normalized];
  if (!days) return { period: "30d", days: 30 };
  return { period: normalized, days };
}

// ── Parent tenant validation ───────────────────────────────────────────────
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

  const delta_pct =
    previous_cents > 0
      ? Math.round((delta_cents / previous_cents) * 1000) / 10
      : null;

  let delta_direction = "flat";
  if (delta_cents > 0) delta_direction = "up";
  else if (delta_cents < 0) delta_direction = "down";

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
// HERO TILE 4 — REVIEWS HEALTH
// ═══════════════════════════════════════════════════════════════════════════
// Shows: lifetime avg rating + count of "prominent alerts" needing response.
//
// Definitions (locked Apr 23 spec + session decisions):
//   • Avg rating: ALL-TIME average of google_reviews.rating across all
//     in-scope tenants, not period-filtered. Rationale: star rating is a
//     slow-moving leading indicator; period filtering generates noise on
//     small samples (one angry 1-star tanks a 30-day window).
//   • Prominent alerts: reviews where rating ≤ 3 AND status = 'pending'
//     AND review_date > now() - 90 days. "Pending" means the owner hasn't
//     responded yet. 90-day window catches still-unresponded older ones
//     without pulling in truly ancient complaints.
//   • Tenant scope: all in-scope tenants. If none have OAuth'd Google,
//     avg_rating = null and prominent_alert_count = 0 — we do NOT filter
//     the scope to only OAuth'd tenants. That way the tile accurately
//     reports "X of Y locations connected."
//
// Returns:
//   {
//     avg_rating_lifetime:     <number|null>,  // e.g. 4.7, or null
//     total_review_count:      <int>,          // lifetime, all tenants
//     prominent_alert_count:   <int>,          // 1-3 star pending, last 90d
//     oauth_connected_count:   <int>,          // tenants with Google linked
//     total_tenant_count:      <int>,          // for "X of Y" display
//   }
async function getReviewsHealthTile(tenantIds) {
  if (tenantIds.length === 0) {
    return {
      avg_rating_lifetime:   null,
      total_review_count:    0,
      prominent_alert_count: 0,
      oauth_connected_count: 0,
      total_tenant_count:    0,
    };
  }

  // Single query covering all four metrics. Cheaper than 4 separate
  // queries — Postgres plans all the aggregates in one pass.
  //
  // OAuth-connected check: tenant has both google_access_token AND
  // google_location_id. Matches the `connected` definition in
  // routes/reviews.js GET /status. We count, not list, because the
  // tile only shows a count — the location table will show per-location
  // connection status later.
  const result = await db.query(
    `SELECT
       -- All-time avg across all reviews for these tenants.
       -- Returns null when there are zero reviews (AVG of empty set).
       AVG(r.rating)::numeric(3,2) AS avg_rating_lifetime,

       -- Lifetime total review count across all in-scope tenants.
       COUNT(r.id)::int AS total_review_count,

       -- Prominent alerts: 1-3 star, pending, last 90 days.
       -- COUNT(*) FILTER (WHERE ...) is the Postgres idiom for conditional
       -- counts in a single aggregate pass.
       COUNT(r.id) FILTER (
         WHERE r.rating <= 3
           AND r.status = 'pending'
           AND r.review_date > now() - interval '90 days'
       )::int AS prominent_alert_count,

       -- OAuth-connected tenant count. Subquery against the tenants table
       -- so we count tenants regardless of whether they have reviews yet
       -- (a newly-connected tenant with zero reviews still counts as
       -- connected for the "X of Y" display).
       (SELECT COUNT(*)::int FROM tenants
         WHERE id = ANY($1::uuid[])
           AND google_access_token IS NOT NULL
           AND google_location_id IS NOT NULL
       ) AS oauth_connected_count,

       -- Total tenants in scope (denominator for "X of Y connected").
       $2::int AS total_tenant_count
     FROM google_reviews r
     WHERE r.tenant_id = ANY($1::uuid[])`,
    [tenantIds, tenantIds.length]
  );

  const row = result.rows[0];

  // AVG returns null when no reviews exist, or a numeric string when it
  // does. Cast carefully — Number(null) is 0, which would misreport
  // "0.0 stars" to the frontend. Preserve the null signal.
  const avg_rating_lifetime =
    row.avg_rating_lifetime === null
      ? null
      : Number(row.avg_rating_lifetime);

  return {
    avg_rating_lifetime,
    total_review_count:    Number(row.total_review_count),
    prominent_alert_count: Number(row.prominent_alert_count),
    oauth_connected_count: Number(row.oauth_connected_count),
    total_tenant_count:    Number(row.total_tenant_count),
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

    // All four tiles run in parallel. Tile 4 doesn't use `days` since
    // avg rating is always lifetime — keeps the signature clean.
    const [aiActivity, afterHoursRevenue, networkRevenue, reviewsHealth] =
      await Promise.all([
        getAiActivityTile(scope.all_ids, days),
        getAfterHoursRevenueTile(scope.all_ids, days),
        getNetworkRevenueTile(scope.all_ids, days, parent.created_at),
        getReviewsHealthTile(scope.all_ids),
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
        reviews_health:      reviewsHealth,
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
