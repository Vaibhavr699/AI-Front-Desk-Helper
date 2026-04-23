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
            timezone, brand_color, logo_url
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

  // Must be a parent (has parent_mode set). Children/standalone tenants don't
  // have a rollup view — redirect them to their own dashboard instead.
  if (!parent.parent_mode) {
    res.status(400).json({ error: "This tenant is not a parent / rollup tenant" });
    return null;
  }

  // Superadmin bypass — match existing pattern from routes/admin.js
  if (req.user?.is_super_admin) return parent;

  // Otherwise the authenticated user must have membership in this tenant
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
// Removed-but-within-retention locations are excluded so tiles don't show
// zombie data from closed franchisees.
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

  // operating_hq parents count their own activity in the rollup.
  // rollup_only parents do not (they never have direct jobs/calls/bookings).
  if (parent.parent_mode === "operating_hq") {
    return { all_ids: [parent.id, ...childIds], child_ids: childIds };
  }
  return { all_ids: childIds, child_ids: childIds };
}

// ═══════════════════════════════════════════════════════════════════════════
// HERO TILE 1 — AI ACTIVITY
// ═══════════════════════════════════════════════════════════════════════════
// Shows: total calls handled + booking conversion rate across all locations.
// Definition per Apr 23 spec:
//   • calls_total       = COUNT(calls) in period where direction='inbound'
//   • bookings_total    = COUNT(bookings) created in period
//   • booking_rate      = bookings_total / calls_total (as percentage)
// Edge cases:
//   • If calls_total = 0, booking_rate = null (don't render "NaN%")
//   • If no tenant IDs in scope, all values return 0 / null
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
      ? Math.round((bookings_total / calls_total) * 1000) / 10  // 1 decimal place
      : null;

  return { calls_total, bookings_total, booking_rate_pct };
}

// ═══════════════════════════════════════════════════════════════════════════
// HERO TILE 2 — AFTER-HOURS REVENUE
// ═══════════════════════════════════════════════════════════════════════════
// The sales-pitch tile: "Your AI captured $X outside business hours."
//
// Definition per Apr 23 spec:
//   • Only bookings.actual_revenue_cents (honest — understates early but
//     never inflates).
//   • Bookings are "after-hours" if created_at falls OUTSIDE that tenant's
//     own business_hours when evaluated in that tenant's timezone.
//   • business_hours fallback when NULL/empty: Mon-Fri 8 AM - 6 PM local.
//
// SQL strategy:
//   1. JOIN bookings to tenants to get each tenant's business_hours + timezone
//   2. Convert booking.created_at to local time via AT TIME ZONE
//   3. Extract dow (day of week) and time-of-day
//   4. Compare against business_hours[day] JSONB — closed days always count
//      as after-hours, and time-outside-open/close counts too
//   5. Fallback to 8-6 Mon-Fri if business_hours IS NULL
//
// Returns:
//   {
//     after_hours_revenue_cents: <int>,
//     after_hours_booking_count: <int>,
//     total_revenue_cents:       <int>,  // for % comparison
//     after_hours_pct_of_total:  <number|null>
//   }
async function getAfterHoursRevenueTile(tenantIds, days) {
  if (tenantIds.length === 0) {
    return {
      after_hours_revenue_cents: 0,
      after_hours_booking_count: 0,
      total_revenue_cents:       0,
      after_hours_pct_of_total:  null,
    };
  }

  // Postgres dow: 0=Sunday, 1=Monday, ... 6=Saturday.
  // business_hours JSONB uses lowercase day names: sunday, monday, ...
  // We map dow → key via CASE, pull the nested open/close/closed, then
  // compare against the local time of booking.created_at.
  //
  // Fallback behavior:
  //   • If business_hours IS NULL → use Mon-Fri 8:00-18:00 (hardcoded in CASE)
  //   • If business_hours[day] has closed=true → always after-hours
  //   • If business_hours[day] has no open/close → same fallback
  //
  // Timezone handling:
  //   • Each tenant may have its own timezone (IANA string like 'America/Chicago')
  //   • Fallback to 'America/Chicago' if NULL (matches backend default)
  //   • AT TIME ZONE converts created_at (timestamptz) to local wall clock
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
          -- No business_hours configured: fallback Mon-Fri 8:00-18:00
          WHEN business_hours IS NULL THEN
            CASE
              WHEN EXTRACT(DOW FROM (created_at AT TIME ZONE tz)) NOT IN (1,2,3,4,5) THEN true
              WHEN (created_at AT TIME ZONE tz)::time < '08:00:00' THEN true
              WHEN (created_at AT TIME ZONE tz)::time >= '18:00:00' THEN true
              ELSE false
            END
          ELSE
            -- Use tenant's business_hours JSONB
            CASE
              -- Day marked closed OR missing entirely → after-hours
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
              -- Before opening time → after-hours
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
              -- At or after closing time → after-hours
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
// MAIN ENDPOINT
// GET /api/rollup-v5/:parentId?period=30d
// ═══════════════════════════════════════════════════════════════════════════
router.get("/:parentId", async (req, res) => {
  try {
    const { parentId } = req.params;
    const { period, days } = resolvePeriod(req.query.period);

    // 1. Validate access and fetch parent row
    const parent = await validateParentAccess(req, res, parentId);
    if (!parent) return; // validateParentAccess already sent the error response

    // 2. Resolve rollup scope. For operating_hq parents this includes the
    //    parent itself; for rollup_only it doesn't. See getRollupScopeIds.
    const scope = await getRollupScopeIds(parent);

    // 3. Build tiles. Run in parallel — independent data, no reason to wait
    //    serially. Future tiles will follow the same pattern.
    const [aiActivity, afterHoursRevenue] = await Promise.all([
      getAiActivityTile(scope.all_ids, days),
      getAfterHoursRevenueTile(scope.all_ids, days),
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
        // network_revenue:     TODO (tile 3)
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
