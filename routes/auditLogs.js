"use strict";

const express = require("express");
const { createClient } = require("@supabase/supabase-js");
const router = express.Router();

const supabase =
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
    : null;

/**
 * GET /api/audit-logs
 * Returns paginated audit log entries.
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

    // Build org_id list to filter by
    let orgIds = [String(tenantId)];

    if (isParentAdmin) {
      // Fetch child tenant IDs from Supabase
      const { data: childTenants, error: tenantErr } = await supabase
        .from("tenants")
        .select("id")
        .eq("parent_id", tenantId);

      if (tenantErr) {
        console.error("GET /api/audit-logs tenant fetch error:", tenantErr);
      } else if (childTenants?.length) {
        orgIds = [...orgIds, ...childTenants.map((t) => String(t.id))];
      }
    }

    // Build Supabase query
    let query = supabase
      .from("audit_logs")
      .select(
        `
        id,
        action,
        organization_id,
        entity_type,
        entity_id,
        old_value,
        new_value,
        ip_address,
        user_agent,
        created_at,
        user_id
      `,
        { count: "exact" }
      )
      .in("organization_id", orgIds)
      .order("created_at", { ascending: false })
      .range(offset, offset + limitNum - 1);

    if (user_id) query = query.eq("user_id", String(user_id));
    if (action) query = query.eq("action", action);
    if (from) query = query.gte("created_at", from);
    if (to) {
      // Include the full "to" day
      const toDate = new Date(to);
      toDate.setDate(toDate.getDate() + 1);
      query = query.lt("created_at", toDate.toISOString().split("T")[0]);
    }

    const { data: logs, error, count } = await query;

    if (error) {
      console.error("GET /api/audit-logs supabase error:", error);
      return res.status(500).json({ error: "Server error" });
    }

    res.json({
      logs: logs || [],
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
