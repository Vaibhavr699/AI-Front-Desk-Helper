"use strict";

const express = require("express");
const db = require("../lib/db");

const router = express.Router();

/**
 * GET /api/audit-logs
 * Returns paginated audit log entries.
 * HQ/admin users see all locations under their org.
 * Location users see only their own tenant.
 */
router.get("/", async (req, res) => {
  try {
    const { user_id, action, from, to, page = 1, limit = 50 } = req.query;

    const tenantId = req.user.tenant_id;
    const isParentAdmin =
      req.user?.tenant_business_type === "parent" &&
      (req.user?.role === "admin" || req.user?.role === "owner");

    const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);

    let conditions = [];
    let params = [];
    let idx = 1;

    // Scope by tenant — HQ sees all child locations, others see only their own
    if (isParentAdmin) {
      conditions.push(`(al.organization_id = $${idx} OR al.organization_id IN (
        SELECT id::text FROM tenants WHERE parent_id = $${idx}
      ))`);
      params.push(tenantId);
      idx++;
    } else {
      conditions.push(`al.organization_id = $${idx}`);
      params.push(tenantId);
      idx++;
    }

    // Filter by user
    if (user_id) {
      conditions.push(`al.user_id = $${idx}`);
      params.push(user_id);
      idx++;
    }

    // Filter by action type
    if (action) {
      conditions.push(`al.action = $${idx}`);
      params.push(action);
      idx++;
    }

    // Filter by date range
    if (from) {
      conditions.push(`al.created_at >= $${idx}::date`);
      params.push(from);
      idx++;
    }
    if (to) {
      conditions.push(`al.created_at < ($${idx}::date + interval '1 day')`);
      params.push(to);
      idx++;
    }

    const where = conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : "";

    // Get total count
    const countRes = await db.query(
      `SELECT COUNT(*) as total FROM audit_logs al ${where}`,
      params
    );
    const total = parseInt(countRes.rows[0].total, 10);

    // Get paginated rows with user email joined
    const rows = await db.query(
      `SELECT 
        al.id,
        al.action,
        al.organization_id,
        al.entity_type,
        al.entity_id,
        al.old_value,
        al.new_value,
        al.ip_address,
        al.user_agent,
        al.created_at,
        al.user_id,
        du.email as user_email,
        du.role as user_role,
        t.name as location_name
       FROM audit_logs al
       LEFT JOIN dashboard_users du ON du.id::text = al.user_id
       LEFT JOIN tenants t ON t.id::text = al.organization_id
       ${where}
       ORDER BY al.created_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, parseInt(limit, 10), offset]
    );

    res.json({
      logs: rows.rows,
      total,
      page: parseInt(page, 10),
      pages: Math.ceil(total / parseInt(limit, 10)),
    });
  } catch (err) {
    console.error("GET /api/audit-logs error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
