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

    // 3. Build tiles. Each tile is independent so one failure doesn't break
    //    the whole response — future tiles will wrap in try/catch with a
    //    null fallback. For now only AI Activity is implemented.
    const aiActivity = await getAiActivityTile(scope.all_ids, days);

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
        ai_activity: aiActivity,
        // after_hours_revenue: TODO (tile 2)
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
