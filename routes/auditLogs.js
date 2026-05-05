"use strict";

const express = require("express");
const { createClient } = require("@supabase/supabase-js");
const db = require("../lib/db");
const router = express.Router();

const supabase =
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
    : null;

/**
 * GET /api/audit-logs
 * Returns paginated audit log entries with resolved user emails and location names.
 * HQ/admin users see all locations under their org.
 * Location users see only their own tenant.
 */
router.get("/", async (req, res) => {
  try {
    if (!supabase) {
      return res.status(500).json({ error: "Supabase not configured" });
    }

    const { user_id, action, from, to, page = 1, limit = 25 } = req.query;
    const tenantId = req.user.tenant_id;
    const isParentAdmin =
      req.user?.tenant_business_type === "parent" &&
      (req.user?.role === "admin" || req.user?.role === "owner");

    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const offset = (pageNum - 1) * limitNum;

    // ── Build tenant_id list ─────────────────────────────────────────────
    let tenantIds = [String(tenantId)];

    if (isParentAdmin) {
      const { data: childTenants, error: tenantErr } = await supabase
        .from("tenants")
        .select("id")
        .eq("parent_id", tenantId);

      if (tenantErr) {
        console.error("GET /api/audit-logs tenant fetch error:", tenantErr);
      } else if (childTenants?.length) {
        tenantIds = [...tenantIds, ...childTenants.map((t) => String(t.id))];
      }
    }

    // ── Build Supabase query ─────────────────────────────────────────────
    let query = supabase
      .from("audit_logs")
      .select(
        `id, action, tenant_id, entity_type, entity_id,
         old_value, new_value, ip_address, user_agent, created_at, user_id`,
        { count: "exact" }
      )
      .in("tenant_id", tenantIds)
      .order("created_at", { ascending: false })
      .range(offset, offset + limitNum - 1);

    if (user_id) query = query.eq("user_id", String(user_id));
    if (action)  query = query.eq("action", action);
    if (from)    query = query.gte("created_at", from);
    if (to) {
      const toDate = new Date(to);
      toDate.setDate(toDate.getDate() + 1);
      query = query.lt("created_at", toDate.toISOString().split("T")[0]);
    }

    const { data: logs, error, count } = await query;

    if (error) {
      console.error("GET /api/audit-logs supabase error:", error);
      return res.status(500).json({ error: "Server error" });
    }

    if (!logs || logs.length === 0) {
      return res.json({ logs: [], total: 0, page: pageNum, pages: 0 });
    }

    // ── Batch resolve user emails from PostgreSQL ────────────────────────
    const userIds = [...new Set(logs.map((l) => l.user_id).filter(Boolean))];
    const tenantIdsToResolve = [...new Set(logs.map((l) => l.tenant_id).filter(Boolean))];

    let userMap = {};
    let locationMap = {};

    if (userIds.length > 0) {
      const userRes = await db.query(
        `SELECT id::text, email, role FROM dashboard_users WHERE id::text = ANY($1)`,
        [userIds]
      );
      userRes.rows.forEach((u) => {
        userMap[u.id] = { email: u.email, role: u.role };
      });
    }

    // ── Batch resolve tenant names from PostgreSQL ───────────────────────
    if (tenantIdsToResolve.length > 0) {
      const tenantRes = await db.query(
        `SELECT id::text, name FROM tenants WHERE id::text = ANY($1)`,
        [tenantIdsToResolve]
      );
      tenantRes.rows.forEach((t) => {
        locationMap[t.id] = t.name;
      });
    }

    // ── Stitch resolved values onto each log row ─────────────────────────
    const enrichedLogs = logs.map((log) => ({
      ...log,
      user_email: userMap[log.user_id]?.email || null,
      user_role:  userMap[log.user_id]?.role  || null,
      location_name: locationMap[log.tenant_id] || null,
    }));

    res.json({
      logs: enrichedLogs,
      total: count || 0,
      page: pageNum,
      pages: Math.ceil((count || 0) / limitNum),
    });
  } catch (err) {
    console.error("GET /api/audit-logs error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
