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
 * Sort:          ?sort=<column>&dir=asc|desc (default revenue_cents desc).
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

// ── Sort handling (location table) ─────────────────────────────────────────
// Whitelist of allowed sort columns. Anything else → default revenue_cents.
// This is an SQL injection defense — we interpolate the column name directly
// into the ORDER BY clause (Postgres doesn't support parameterized ORDER BY),
// so we MUST validate against a known-safe set before use.
const ALLOWED_SORT_COLUMNS = new Set([
  "tenant_name",
  "calls_total",
  "bookings_total",
  "booking_rate_pct",
  "revenue_cents",
  "avg_rating",
  "review_count",
  "pending_alerts_count",
]);

function resolveSort(rawSort, rawDir) {
  const sort = ALLOWED_SORT_COLUMNS.has(rawSort) ? rawSort : "revenue_cents";
  const dir = String(rawDir || "").toLowerCase() === "asc" ? "ASC" : "DESC";
  return { sort, dir };
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

  const result = await db.query(
    `SELECT
       AVG(r.rating)::numeric(3,2) AS avg_rating_lifetime,
       COUNT(r.id)::int AS total_review_count,
       COUNT(r.id) FILTER (
         WHERE r.rating <= 3
           AND r.status = 'pending'
           AND r.review_date > now() - interval '90 days'
       )::int AS prominent_alert_count,
       (SELECT COUNT(*)::int FROM tenants
         WHERE id = ANY($1::uuid[])
           AND google_access_token IS NOT NULL
           AND google_location_id IS NOT NULL
       ) AS oauth_connected_count,
       $2::int AS total_tenant_count
     FROM google_reviews r
     WHERE r.tenant_id = ANY($1::uuid[])`,
    [tenantIds, tenantIds.length]
  );

  const row = result.rows[0];

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
// CONTACT-METHOD DONUT
// ═══════════════════════════════════════════════════════════════════════════
const DONUT_METHOD_ORDER = ["voice", "sms", "web_form", "facebook", "crm", "unknown"];

async function getContactMethodDonut(tenantIds, days) {
  if (tenantIds.length === 0) {
    return {
      total_leads:   0,
      unknown_count: 0,
      buckets:       DONUT_METHOD_ORDER.map((method) => ({
        method,
        count: 0,
        pct:   0,
      })),
    };
  }

  const result = await db.query(
    `SELECT contact_method, COUNT(*)::int AS count
       FROM leads
      WHERE tenant_id = ANY($1::uuid[])
        AND created_at > now() - ($2::int * interval '1 day')
      GROUP BY contact_method`,
    [tenantIds, days]
  );

  const countMap = {};
  let total_leads = 0;
  for (const row of result.rows) {
    const count = Number(row.count);
    countMap[row.contact_method] = count;
    total_leads += count;
  }

  const buckets = DONUT_METHOD_ORDER.map((method) => {
    const count = countMap[method] || 0;
    const pct =
      total_leads > 0
        ? Math.round((count / total_leads) * 1000) / 10
        : 0;
    return { method, count, pct };
  });

  const unknown_count = countMap["unknown"] || 0;

  return {
    total_leads,
    unknown_count,
    buckets,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// REVIEWS ALERTS LIST
// ═══════════════════════════════════════════════════════════════════════════
async function getReviewsAlertsList(tenantIds) {
  if (tenantIds.length === 0) {
    return { alerts: [], total_count_14d: 0 };
  }

  const result = await db.query(
    `
    WITH candidate_alerts AS (
      SELECT
        r.id                          AS review_id,
        r.google_review_id,
        r.tenant_id,
        COALESCE(t.company_name, t.name, 'Unknown') AS tenant_name,
        r.rating,
        r.reviewer_name,
        r.review_text,
        r.review_date,
        r.ai_draft,
        (r.ai_draft IS NOT NULL AND length(r.ai_draft) > 0) AS has_ai_draft
      FROM google_reviews r
      JOIN tenants t ON t.id = r.tenant_id
      WHERE r.tenant_id = ANY($1::uuid[])
        AND r.rating <= 3
        AND r.status = 'pending'
        AND r.review_date > now() - interval '14 days'
    )
    SELECT
      review_id,
      google_review_id,
      tenant_id,
      tenant_name,
      rating,
      reviewer_name,
      review_text,
      review_date,
      ai_draft,
      has_ai_draft,
      (SELECT COUNT(*)::int FROM candidate_alerts) AS total_count_14d
    FROM candidate_alerts
    ORDER BY review_date DESC
    LIMIT 2
    `,
    [tenantIds]
  );

  if (result.rows.length === 0) {
    return { alerts: [], total_count_14d: 0 };
  }

  const total_count_14d = Number(result.rows[0].total_count_14d);

  const alerts = result.rows.map((row) => ({
    review_id:        row.review_id,
    google_review_id: row.google_review_id,
    tenant_id:        row.tenant_id,
    tenant_name:      row.tenant_name,
    rating:           Number(row.rating),
    reviewer_name:    row.reviewer_name,
    review_text:      row.review_text,
    review_date:      row.review_date,
    has_ai_draft:     Boolean(row.has_ai_draft),
    ai_draft:         row.ai_draft,
  }));

  return { alerts, total_count_14d };
}

// ═══════════════════════════════════════════════════════════════════════════
// LOCATION TABLE
// ═══════════════════════════════════════════════════════════════════════════
// Per-tenant row breakdown across the network. Sortable by any displayed
// column, with default sort revenue_cents desc (business-health framing).
//
// Design decisions:
//   • Scope: uses scope.all_ids (same as tiles) so operating_hq parents
//     see themselves in the table alongside children. A tenant viewing
//     their own rollup SHOULD see their own row — excluding self would
//     mean the table sum wouldn't equal the hero tiles.
//   • One big query via LEFT JOINs + CTEs rather than N separate queries.
//     For 50-location networks this is the difference between 50ms and
//     2500ms. Every aggregate computes once on pre-filtered rowsets.
//   • rank_revenue computed via window function (RANK() OVER). Always
//     reflects ranking across the current scope, regardless of what the
//     user is sorting by — so the frontend can show "#3 of 10" badges
//     even when sorted alphabetically.
//   • SQL injection: sort column is whitelisted BEFORE interpolation.
//     See ALLOWED_SORT_COLUMNS above. Direction is ASC/DESC only.
//   • NULLS handling: revenue-zero, rating-null tenants are sorted last
//     for DESC sorts via NULLS LAST. For ASC we use NULLS FIRST so
//     "worst first" actually shows worst.
//
// Returns: { locations: [ {...rowShape}, ... ], sort, dir }
async function getLocationTable(tenantIds, days, sort, dir) {
  if (tenantIds.length === 0) {
    return { locations: [], sort, dir };
  }

  // The column we ORDER BY has two edge cases:
  //   1. booking_rate_pct is derived (not a raw column) — we compute it
  //      inline in the SELECT so we can sort on the alias.
  //   2. For numeric columns, NULL values need to sort at the extreme
  //      "worst" end (NULLS LAST for DESC, NULLS FIRST for ASC) so users
  //      always see ranked data first.
  //
  // We build the ORDER BY clause server-side after whitelist validation.
  const nullsPosition = dir === "DESC" ? "NULLS LAST" : "NULLS FIRST";
  // Secondary sort by tenant_name for deterministic ordering when primary
  // sort values tie (e.g. two locations both have $0 revenue).
  const orderByClause = `${sort} ${dir} ${nullsPosition}, tenant_name ASC`;

  const result = await db.query(
    `
    WITH
    -- Per-tenant basic info + OAuth status
    location_info AS (
      SELECT
        t.id AS tenant_id,
        COALESCE(t.company_name, t.name, 'Unknown') AS tenant_name,
        (t.google_access_token IS NOT NULL AND t.google_location_id IS NOT NULL) AS oauth_connected
      FROM tenants t
      WHERE t.id = ANY($1::uuid[])
    ),
    -- Per-tenant call counts in period (inbound only)
    call_stats AS (
      SELECT
        tenant_id,
        COUNT(*)::int AS calls_total
      FROM calls
      WHERE tenant_id = ANY($1::uuid[])
        AND direction = 'inbound'
        AND started_at > now() - ($2::int * interval '1 day')
      GROUP BY tenant_id
    ),
    -- Per-tenant booking counts + revenue sums in period
    booking_stats AS (
      SELECT
        tenant_id,
        COUNT(*)::int AS bookings_total,
        COALESCE(SUM(actual_revenue_cents), 0)::bigint AS revenue_cents
      FROM bookings
      WHERE tenant_id = ANY($1::uuid[])
        AND created_at > now() - ($2::int * interval '1 day')
      GROUP BY tenant_id
    ),
    -- Per-tenant review stats (lifetime avg + count, pending alerts 90d)
    review_stats AS (
      SELECT
        tenant_id,
        AVG(rating)::numeric(3,2) AS avg_rating,
        COUNT(*)::int AS review_count,
        COUNT(*) FILTER (
          WHERE rating <= 3
            AND status = 'pending'
            AND review_date > now() - interval '90 days'
        )::int AS pending_alerts_count
      FROM google_reviews
      WHERE tenant_id = ANY($1::uuid[])
      GROUP BY tenant_id
    ),
    -- Assemble per-location rows with derived fields
    rows_assembled AS (
      SELECT
        li.tenant_id,
        li.tenant_name,
        li.oauth_connected,
        COALESCE(cs.calls_total,      0)    AS calls_total,
        COALESCE(bs.bookings_total,   0)    AS bookings_total,
        COALESCE(bs.revenue_cents,    0)    AS revenue_cents,
        CASE
          WHEN COALESCE(cs.calls_total, 0) > 0
          THEN ROUND(
            (COALESCE(bs.bookings_total, 0)::numeric /
             cs.calls_total::numeric) * 1000
          ) / 10
          ELSE NULL
        END AS booking_rate_pct,
        rs.avg_rating,  -- null if no reviews (preserved)
        COALESCE(rs.review_count,         0) AS review_count,
        COALESCE(rs.pending_alerts_count, 0) AS pending_alerts_count
      FROM location_info li
      LEFT JOIN call_stats    cs ON cs.tenant_id = li.tenant_id
      LEFT JOIN booking_stats bs ON bs.tenant_id = li.tenant_id
      LEFT JOIN review_stats  rs ON rs.tenant_id = li.tenant_id
    ),
    -- Add revenue rank across the entire network (regardless of sort).
    -- RANK() handles ties — two tenants with same revenue get same rank.
    -- We use DENSE_RANK to avoid skipped numbers on ties.
    rows_ranked AS (
      SELECT
        *,
        DENSE_RANK() OVER (ORDER BY revenue_cents DESC)::int AS rank_revenue
      FROM rows_assembled
    )
    SELECT *
    FROM rows_ranked
    ORDER BY ${orderByClause}
    `,
    [tenantIds, days]
  );

  const locations = result.rows.map((row) => ({
    tenant_id:            row.tenant_id,
    tenant_name:          row.tenant_name,
    oauth_connected:      Boolean(row.oauth_connected),
    calls_total:          Number(row.calls_total),
    bookings_total:       Number(row.bookings_total),
    booking_rate_pct:     row.booking_rate_pct === null ? null : Number(row.booking_rate_pct),
    revenue_cents:        Number(row.revenue_cents),
    avg_rating:           row.avg_rating === null ? null : Number(row.avg_rating),
    review_count:         Number(row.review_count),
    pending_alerts_count: Number(row.pending_alerts_count),
    rank_revenue:         Number(row.rank_revenue),
  }));

  return { locations, sort, dir };
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN ENDPOINT
// GET /api/rollup-v5/:parentId?period=30d&sort=revenue_cents&dir=desc
// ═══════════════════════════════════════════════════════════════════════════
router.get("/:parentId", async (req, res) => {
  try {
    const { parentId } = req.params;
    const { period, days } = resolvePeriod(req.query.period);
    const { sort, dir } = resolveSort(req.query.sort, req.query.dir);

    const parent = await validateParentAccess(req, res, parentId);
    if (!parent) return;

    const scope = await getRollupScopeIds(parent);

    // 7 queries in parallel. Single round-trip latency for the whole endpoint.
    const [
      aiActivity,
      afterHoursRevenue,
      networkRevenue,
      reviewsHealth,
      donut,
      reviewsAlerts,
      locationTable,
    ] = await Promise.all([
      getAiActivityTile(scope.all_ids, days),
      getAfterHoursRevenueTile(scope.all_ids, days),
      getNetworkRevenueTile(scope.all_ids, days, parent.created_at),
      getReviewsHealthTile(scope.all_ids),
      getContactMethodDonut(scope.all_ids, days),
      getReviewsAlertsList(scope.all_ids),
      getLocationTable(scope.all_ids, days, sort, dir),
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
        sort,
        dir:                 dir.toLowerCase(),
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
      contact_method_donut: donut,
      reviews_alerts:       reviewsAlerts,
      locations:            locationTable.locations,
    });
  } catch (err) {
    console.error("[RollupV5] Error:", err);
    res.status(500).json({ error: "Server error", detail: err.message });
  }
});

module.exports = router;
