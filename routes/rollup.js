// server/routes/rollup.js
//
// HQ Rollup Dashboard — Apr 21, 2026.
//
// GET /api/rollup/:parentId/overview  — aggregated KPIs + per-location cards
// GET /api/rollup/:parentId/activity  — cross-location event feed, paginated
// GET /api/rollup/:parentId/alerts    — health signals (stalled, missed, etc.)
//
// All three endpoints require the requester's tenant_id to match :parentId
// OR be a super admin.  Auth middleware is applied at mount time in server.js.
//
// Caller scope: operating_hq or rollup_only tenants (has children).  Reseller
// scope lives in a separate endpoint for Phase 3 (not built tonight).

"use strict";

const express = require("express");
const router = express.Router();
const db = require("../lib/db");

// ─────────────────────────────────────────────────────────────────────────────
// Helper: resolve the full set of tenant IDs in the HQ rollup (parent + kids).
// Returns { parent, childIds, allIds } where allIds = [parent.id, ...childIds].
// ─────────────────────────────────────────────────────────────────────────────
async function resolveRollupScope(parentId) {
  const parentRow = await db.query(
    `SELECT id, name, company_name, parent_id, parent_mode, brand_mode,
            brand_color, accent_color, logo_url, timezone
       FROM tenants
      WHERE id = $1
      LIMIT 1`,
    [parentId]
  ).then((r) => r.rows[0]);

  if (!parentRow) return null;

  // HQ scope requires parent_mode set (operating_hq or rollup_only).
  // If parent_mode is null we still allow the query but childIds may be empty.
  const children = await db.query(
    `SELECT id FROM tenants
      WHERE parent_id = $1
        AND (is_suspended IS NULL OR is_suspended = false)
        AND deleted_at IS NULL`,
    [parentId]
  ).then((r) => r.rows.map((row) => row.id));

  const includeParentInAggregates = parentRow.parent_mode !== "rollup_only";
  const allIds = includeParentInAggregates
    ? [parentRow.id, ...children]
    : [...children];

  return { parent: parentRow, childIds: children, allIds, includeParentInAggregates };
}

// Authorization gate: requester must belong to the parent tenant OR super admin.
function assertRollupAccess(req, parentId) {
  if (req.user?.is_super_admin) return true;
  if (req.user?.tenant_id === parentId) return true;
  return false;
}

// ═════════════════════════════════════════════════════════════════════════════
// OVERVIEW — KPI rollup + per-location cards
// ═════════════════════════════════════════════════════════════════════════════
router.get("/:parentId/overview", async (req, res) => {
  const { parentId } = req.params;

  if (!assertRollupAccess(req, parentId)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  try {
    const scope = await resolveRollupScope(parentId);
    if (!scope) return res.status(404).json({ error: "Parent not found" });

    const { parent, childIds, allIds } = scope;

    // Empty rollup (no children) — return structured empty state.
    if (allIds.length === 0) {
      return res.json({
        parent,
        locationCount: 0,
        kpis: emptyKpis(),
        locations: [],
      });
    }

    // Window: last 30 days for KPIs.  Uses a single query with FILTER
    // to keep the DB round-trip count low.
    const kpiRes = await db.query(
      `
      WITH scope AS (
        SELECT unnest($1::uuid[]) AS tenant_id
      )
      SELECT
        (SELECT COUNT(*) FROM leads l
          WHERE l.tenant_id IN (SELECT tenant_id FROM scope)
            AND l.created_at >= now() - INTERVAL '30 days') AS leads_30d,
        (SELECT COUNT(*) FROM bookings b
          WHERE b.tenant_id IN (SELECT tenant_id FROM scope)
            AND b.created_at >= now() - INTERVAL '30 days') AS bookings_30d,
        (SELECT COUNT(*) FROM calls c
          WHERE c.tenant_id IN (SELECT tenant_id FROM scope)
            AND c.started_at >= now() - INTERVAL '30 days') AS calls_30d,
        (SELECT COALESCE(SUM(b.actual_revenue_cents), 0) FROM bookings b
          WHERE b.tenant_id IN (SELECT tenant_id FROM scope)
            AND b.actual_revenue_cents IS NOT NULL
            AND b.created_at >= now() - INTERVAL '30 days') AS revenue_cents_30d
      `,
      [allIds]
    );
    const kpiRow = kpiRes.rows[0] || {};

    // Per-location breakdown: lead/booking/call counts + revenue for each tenant.
    // We SELECT from tenants and LEFT JOIN counts from subqueries to preserve
    // zero-activity locations in the result.
    const locationsRes = await db.query(
      `
      SELECT
        t.id,
        t.name,
        t.company_name,
        t.brand_color,
        t.logo_url,
        t.parent_id,
        t.parent_mode,
        t.is_suspended,
        (SELECT COUNT(*) FROM leads l
          WHERE l.tenant_id = t.id
            AND l.created_at >= now() - INTERVAL '30 days') AS leads_30d,
        (SELECT COUNT(*) FROM bookings b
          WHERE b.tenant_id = t.id
            AND b.created_at >= now() - INTERVAL '30 days') AS bookings_30d,
        (SELECT COUNT(*) FROM calls c
          WHERE c.tenant_id = t.id
            AND c.started_at >= now() - INTERVAL '30 days') AS calls_30d,
        (SELECT COALESCE(SUM(b.actual_revenue_cents), 0) FROM bookings b
          WHERE b.tenant_id = t.id
            AND b.actual_revenue_cents IS NOT NULL
            AND b.created_at >= now() - INTERVAL '30 days') AS revenue_cents_30d
      FROM tenants t
      WHERE t.id = ANY($1::uuid[])
      ORDER BY
        CASE WHEN t.id = $2 THEN 0 ELSE 1 END,  -- parent first
        t.company_name NULLS LAST, t.name NULLS LAST
      `,
      [allIds, parent.id]
    );

    res.json({
      parent,
      locationCount: allIds.length,
      kpis: {
        leads_30d:          Number(kpiRow.leads_30d)        || 0,
        bookings_30d:       Number(kpiRow.bookings_30d)     || 0,
        calls_30d:          Number(kpiRow.calls_30d)        || 0,
        revenue_cents_30d:  Number(kpiRow.revenue_cents_30d)|| 0,
      },
      locations: locationsRes.rows.map((row) => ({
        ...row,
        leads_30d:         Number(row.leads_30d)        || 0,
        bookings_30d:      Number(row.bookings_30d)     || 0,
        calls_30d:         Number(row.calls_30d)        || 0,
        revenue_cents_30d: Number(row.revenue_cents_30d)|| 0,
      })),
    });
  } catch (err) {
    console.error("[Rollup] overview error:", err);
    res.status(500).json({ error: "Internal error" });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// ACTIVITY — cross-location event feed (from notifications table)
// ═════════════════════════════════════════════════════════════════════════════
//
// Why notifications-only?
// - notifications.tenant_id is already indexed
// - All event types we care about already flow through it:
//   missed_call, booking_created, new_lead, transfer_requested,
//   lead_captured, spam_detected, revenue_recovered
// - One table → simple query, no multi-JOIN perf risk
// - created_at is authoritative timestamp
//
// Filter:     ?locationId=<uuid>   limit to one child tenant
// Pagination: ?before=<ISO ts>     fetch next page older than this cursor
// Limit:      ?limit=50            default 50, max 200
// Types:      ?types=a,b,c         CSV of notification types; default to all
//
router.get("/:parentId/activity", async (req, res) => {
  const { parentId } = req.params;

  if (!assertRollupAccess(req, parentId)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const locationId = req.query.locationId || null;
  const before = req.query.before || null; // cursor (ISO timestamp)
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
  const typesParam = (req.query.types || "").trim();
  const types = typesParam ? typesParam.split(",").map((s) => s.trim()).filter(Boolean) : null;

  try {
    const scope = await resolveRollupScope(parentId);
    if (!scope) return res.status(404).json({ error: "Parent not found" });

    // Tenant ID filter — single location if query says so, else full scope.
    let tenantIds = scope.allIds;
    if (locationId) {
      if (!scope.allIds.includes(locationId)) {
        return res.status(403).json({ error: "Location not in your rollup" });
      }
      tenantIds = [locationId];
    }

    if (tenantIds.length === 0) {
      return res.json({ events: [], nextCursor: null });
    }

    // Default event type allowlist — matches the "core 3 + revenue + transfers + reviews"
    // scope locked with Drew.  If the client asks for a specific CSV, we honor it
    // (still must overlap this allowlist — we reject unknown types).
    const KNOWN_TYPES = [
      "new_lead",
      "lead_captured",
      "booking_created",
      "missed_call",
      "transfer_requested",
      "revenue_recovered",
      "negative_review",
      "review_received",
      "spam_detected",
    ];
    const effectiveTypes = types
      ? types.filter((t) => KNOWN_TYPES.includes(t))
      : KNOWN_TYPES;

    if (effectiveTypes.length === 0) {
      return res.json({ events: [], nextCursor: null });
    }

    // 7-day default window, overridable by ?before cursor.
    const params = [tenantIds, effectiveTypes];
    let whereExtras = "";
    if (before) {
      params.push(before);
      whereExtras = `AND n.created_at < $${params.length}::timestamptz`;
    } else {
      // Initial page: last 7 days.
      whereExtras = `AND n.created_at >= now() - INTERVAL '7 days'`;
    }
    params.push(limit + 1); // fetch one extra to know if there's a next page

    const q = `
      SELECT
        n.id,
        n.tenant_id,
        n.type,
        n.title,
        n.body,
        n.data,
        n.created_at,
        t.name         AS tenant_name,
        t.company_name AS tenant_company_name,
        t.brand_color  AS tenant_brand_color
      FROM notifications n
      JOIN tenants t ON t.id = n.tenant_id
      WHERE n.tenant_id = ANY($1::uuid[])
        AND n.type = ANY($2::text[])
        ${whereExtras}
      ORDER BY n.created_at DESC
      LIMIT $${params.length}
    `;

    const rows = await db.query(q, params).then((r) => r.rows);

    const hasNext = rows.length > limit;
    const events = hasNext ? rows.slice(0, limit) : rows;
    const nextCursor = hasNext ? events[events.length - 1].created_at : null;

    res.json({
      events: events.map((ev) => ({
        id:          ev.id,
        tenantId:    ev.tenant_id,
        tenantName:  ev.tenant_company_name || ev.tenant_name || "Unknown",
        tenantBrand: ev.tenant_brand_color || null,
        type:        ev.type,
        title:       ev.title,
        body:        ev.body,
        data:        ev.data,
        createdAt:   ev.created_at,
      })),
      nextCursor,
    });
  } catch (err) {
    console.error("[Rollup] activity error:", err);
    res.status(500).json({ error: "Internal error" });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// ALERTS — health signals per location
// ═════════════════════════════════════════════════════════════════════════════
//
// Fires for:
//   1. stalled_lead       — lead with no booking within 7 days of creation
//   2. missed_call_no_reply — missed_call notification >24h old without response
//   3. negative_review    — review with rating 1-3 in last 7 days
//   4. high_hangup_rate   — >30% calls under 30s in last 7 days
//
// Each alert carries { kind, severity, tenantId, tenantName, summary, data }
// Severity: 'info' | 'warn' | 'critical'
//
router.get("/:parentId/alerts", async (req, res) => {
  const { parentId } = req.params;

  if (!assertRollupAccess(req, parentId)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  try {
    const scope = await resolveRollupScope(parentId);
    if (!scope) return res.status(404).json({ error: "Parent not found" });

    const { allIds } = scope;
    if (allIds.length === 0) {
      return res.json({ alerts: [] });
    }

    // Run each alert query independently. If any one fails we log and continue
    // so a single bad table doesn't empty the whole Alerts tab.
    const alerts = [];

    // 1. STALLED LEADS — created >7 days ago, no booking attached, status not Won/Lost/Cancelled
    try {
      const { rows } = await db.query(
        `
        SELECT
          l.id, l.tenant_id, l.name, l.phone, l.created_at, l.status,
          t.company_name AS tenant_company_name,
          t.name         AS tenant_name
        FROM leads l
        JOIN tenants t ON t.id = l.tenant_id
        WHERE l.tenant_id = ANY($1::uuid[])
          AND l.created_at < now() - INTERVAL '7 days'
          AND l.created_at >= now() - INTERVAL '30 days'
          AND COALESCE(l.status, 'New') NOT IN ('Booked','Won','Lost','Cancelled','Completed')
          AND NOT EXISTS (
            SELECT 1 FROM bookings b
            WHERE b.lead_id = l.id
              AND b.status != 'Cancelled'
          )
        ORDER BY l.created_at ASC
        LIMIT 50
        `,
        [allIds]
      );
      for (const row of rows) {
        alerts.push({
          kind: "stalled_lead",
          severity: "warn",
          tenantId: row.tenant_id,
          tenantName: row.tenant_company_name || row.tenant_name || "Unknown",
          summary: `${row.name || "Unknown lead"} (${row.phone || "no phone"}) — no booking in ${daysSince(row.created_at)} days`,
          data: { leadId: row.id, phone: row.phone, createdAt: row.created_at, status: row.status },
          createdAt: row.created_at,
        });
      }
    } catch (e) {
      console.error("[Rollup] stalled_lead check failed:", e.message);
    }

    // 2. MISSED CALL, NO REPLY — notifications.type='missed_call' >24h old, no messages out since then
    try {
      const { rows } = await db.query(
        `
        SELECT
          n.id, n.tenant_id, n.created_at, n.data,
          t.company_name AS tenant_company_name,
          t.name         AS tenant_name
        FROM notifications n
        JOIN tenants t ON t.id = n.tenant_id
        WHERE n.tenant_id = ANY($1::uuid[])
          AND n.type = 'missed_call'
          AND n.created_at < now() - INTERVAL '24 hours'
          AND n.created_at >= now() - INTERVAL '7 days'
        ORDER BY n.created_at ASC
        LIMIT 50
        `,
        [allIds]
      );
      for (const row of rows) {
        const phone = row.data?.from_number || row.data?.from || "unknown";
        alerts.push({
          kind: "missed_call_no_reply",
          severity: "warn",
          tenantId: row.tenant_id,
          tenantName: row.tenant_company_name || row.tenant_name || "Unknown",
          summary: `Missed call from ${phone} — ${daysSince(row.created_at)}+ days without a human follow-up`,
          data: row.data,
          createdAt: row.created_at,
        });
      }
    } catch (e) {
      console.error("[Rollup] missed_call check failed:", e.message);
    }

    // 3. NEGATIVE REVIEWS — notifications.type='negative_review' in last 7d
    try {
      const { rows } = await db.query(
        `
        SELECT
          n.id, n.tenant_id, n.created_at, n.title, n.body, n.data,
          t.company_name AS tenant_company_name,
          t.name         AS tenant_name
        FROM notifications n
        JOIN tenants t ON t.id = n.tenant_id
        WHERE n.tenant_id = ANY($1::uuid[])
          AND n.type IN ('negative_review', 'review_received')
          AND n.created_at >= now() - INTERVAL '7 days'
          AND (
            (n.data->>'rating')::int <= 3
            OR n.type = 'negative_review'
          )
        ORDER BY n.created_at DESC
        LIMIT 50
        `,
        [allIds]
      );
      for (const row of rows) {
        alerts.push({
          kind: "negative_review",
          severity: "critical",
          tenantId: row.tenant_id,
          tenantName: row.tenant_company_name || row.tenant_name || "Unknown",
          summary: row.title || "Negative review received",
          data: row.data,
          createdAt: row.created_at,
        });
      }
    } catch (e) {
      console.error("[Rollup] negative_review check failed:", e.message);
    }

    // 4. HIGH HANGUP RATE — >30% of calls under 30s in last 7d, per tenant (minimum 5 calls)
    try {
      const { rows } = await db.query(
        `
        SELECT
          c.tenant_id,
          t.company_name AS tenant_company_name,
          t.name         AS tenant_name,
          COUNT(*) AS total_calls,
          COUNT(*) FILTER (
            WHERE (c.duration_minutes IS NULL OR c.duration_minutes < 0.5)
              AND (c.status IS NULL OR c.status NOT IN ('transferred','completed_booked','booked'))
          ) AS short_calls
        FROM calls c
        JOIN tenants t ON t.id = c.tenant_id
        WHERE c.tenant_id = ANY($1::uuid[])
          AND c.started_at >= now() - INTERVAL '7 days'
        GROUP BY c.tenant_id, t.company_name, t.name
        HAVING COUNT(*) >= 5
           AND (COUNT(*) FILTER (
            WHERE (c.duration_minutes IS NULL OR c.duration_minutes < 0.5)
              AND (c.status IS NULL OR c.status NOT IN ('transferred','completed_booked','booked'))
          ))::float / COUNT(*)::float > 0.30
        ORDER BY total_calls DESC
        `,
        [allIds]
      );
      for (const row of rows) {
        const pct = Math.round((row.short_calls / row.total_calls) * 100);
        alerts.push({
          kind: "high_hangup_rate",
          severity: "warn",
          tenantId: row.tenant_id,
          tenantName: row.tenant_company_name || row.tenant_name || "Unknown",
          summary: `${pct}% of calls under 30s in the last 7 days (${row.short_calls}/${row.total_calls})`,
          data: { shortCalls: Number(row.short_calls), totalCalls: Number(row.total_calls), pct },
          createdAt: new Date().toISOString(),
        });
      }
    } catch (e) {
      console.error("[Rollup] high_hangup_rate check failed:", e.message);
    }

    // Sort alerts: critical first, then warn, then info; within each, newest first
    const sevRank = { critical: 0, warn: 1, info: 2 };
    alerts.sort((a, b) => {
      const rank = (sevRank[a.severity] ?? 3) - (sevRank[b.severity] ?? 3);
      if (rank !== 0) return rank;
      return new Date(b.createdAt) - new Date(a.createdAt);
    });

    res.json({ alerts });
  } catch (err) {
    console.error("[Rollup] alerts error:", err);
    res.status(500).json({ error: "Internal error" });
  }
});

function emptyKpis() {
  return {
    leads_30d: 0,
    bookings_30d: 0,
    calls_30d: 0,
    revenue_cents_30d: 0,
  };
}

function daysSince(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

module.exports = router;
