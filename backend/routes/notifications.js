"use strict";

const express = require("express");
const router = express.Router();
const authLib = require("../lib/auth");
const db = require("../lib/db");

// All routes require authentication
router.use(function(req, res, next) { return authLib.authMiddleware(req, res, next); });

/** GET /api/notifications - List unread notifications for a tenant (or rollup) */
router.get("/", async (req, res) => {
  try {
    const tenantIds = await authLib.getTargetTenantIds(req);
    if (!tenantIds.length) return res.status(400).json({ error: "Missing tenantId" });

    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);

    const placeholders = tenantIds.map((_, i) => `$${i + 1}`).join(", ");
    const q = `
      SELECT id, tenant_id, type, title, body, data, read, created_at
      FROM notifications
      WHERE tenant_id IN (${placeholders}) AND read = FALSE
      ORDER BY created_at DESC
      LIMIT $${tenantIds.length + 1}
    `;
    const result = await db.query(q, [...tenantIds, limit]);
    res.json({ notifications: result.rows });
  } catch (err) {
    console.error("[Notifications API] List failed:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

/** POST /api/notifications/mark-all-read - Mark all unread as read for tenant(s) */
/** NOTE: must be defined BEFORE /:id/read to avoid "mark-all-read" being parsed as an id */
router.post("/mark-all-read", async (req, res) => {
  try {
    const tenantIds = await authLib.getTargetTenantIds(req);
    if (!tenantIds.length) return res.status(400).json({ error: "Missing tenantId" });

    const placeholders = tenantIds.map((_, i) => `$${i + 1}`).join(", ");
    const q = `
      UPDATE notifications
      SET read = TRUE
      WHERE tenant_id IN (${placeholders}) AND read = FALSE
    `;
    const result = await db.query(q, tenantIds);
    res.json({ ok: true, count: result.rowCount });
  } catch (err) {
    console.error("[Notifications API] Mark all read failed:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

/** POST /api/notifications/:id/read - Mark single notification as read */
router.post("/:id/read", async (req, res) => {
  try {
    const tenantIds = await authLib.getTargetTenantIds(req);
    if (!tenantIds.length) return res.status(400).json({ error: "Missing tenantId" });

    const placeholders = tenantIds.map((_, i) => `$${i + 2}`).join(", ");
    const q = `
      UPDATE notifications
      SET read = TRUE
      WHERE id = $1 AND tenant_id IN (${placeholders})
      RETURNING id, tenant_id, type, title, read
    `;
    const result = await db.query(q, [req.params.id, ...tenantIds]);
    if (!result.rows.length) return res.status(404).json({ error: "Notification not found" });
    res.json({ ok: true, notification: result.rows[0] });
  } catch (err) {
    console.error("[Notifications API] Mark read failed:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
