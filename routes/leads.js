"use strict";

const express = require("express");
const router = express.Router();
const leadsService = require("../services/leads");
const messagesService = require("../services/messages");
const callsService = require("../services/calls");
const authLib = require("../lib/auth");
const { logAction } = require("../lib/auditLogger");
const db = require("../lib/db");

// All routes require authentication and at least Manager-level access
router.use(function(req, res, next) { return authLib.authMiddleware(req, res, next); });
router.use(function(req, res, next) { return authLib.requireRole([authLib.ROLES.OWNER, authLib.ROLES.ADMIN, authLib.ROLES.MANAGER])(req, res, next); });

/** GET /api/leads - List all leads for a tenant */
router.get("/", async (req, res) => {
  try {
    const tenantIds = await authLib.getTargetTenantIds(req);
    if (!tenantIds.length) return res.status(400).json({ error: "Missing tenantId" });
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;
    const leads = await leadsService.getLeadsByTenant(tenantIds, limit, offset);
    res.json(leads);
  } catch (err) {
    console.error("[Leads API] List failed:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

/** GET /api/leads/:id - Get a single lead's profile */
router.get("/:id", async (req, res) => {
  try {
    const lead = await leadsService.getLeadById(req.params.id);
    if (!lead) return res.status(404).json({ error: "Lead not found" });

    const isOwner = lead.tenant_id === req.user?.tenant_id;
    let isParentOfOwner = false;
    if (!isOwner && req.user?.tenant_business_type === 'parent') {
      const check = await db.query("SELECT 1 FROM tenants WHERE id = $1 AND parent_id = $2", [lead.tenant_id, req.user.tenant_id]);
      isParentOfOwner = check.rows.length > 0;
    }
    if (!isOwner && !isParentOfOwner && !req.user?.is_super_admin) {
      return res.status(403).json({ error: "Forbidden" });
    }

    // Audit log: lead viewed
    await logAction({
      organization_id: String(lead.tenant_id),
      user_id: req.user?.sub ? String(req.user.sub) : null,
      action: "lead_viewed",
      entity_type: "lead",
      entity_id: String(lead.id),
      new_value: { lead_name: lead.name, lead_source: lead.lead_source, lead_status: lead.status },
      ip_address: req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.ip || null,
      user_agent: req.get("user-agent") || null,
    }).catch(() => {});

    res.json(lead);
  } catch (err) {
    console.error("[Leads API] Get failed:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

/** PATCH /api/leads/:id - Update lead profile or status */
router.patch("/:id", async (req, res) => {
  try {
    const lead = await leadsService.getLeadById(req.params.id);
    if (!lead) return res.status(404).json({ error: "Lead not found" });

    const isOwner = lead.tenant_id === req.user?.tenant_id;
    let isParentOfOwner = false;
    if (!isOwner && req.user?.tenant_business_type === 'parent') {
      const check = await db.query("SELECT 1 FROM tenants WHERE id = $1 AND parent_id = $2", [lead.tenant_id, req.user.tenant_id]);
      isParentOfOwner = check.rows.length > 0;
    }
    if (!isOwner && !isParentOfOwner && !req.user?.is_super_admin) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const updated = await leadsService.updateLeadInfo(req.params.id, req.body);
    res.json(updated);
  } catch (err) {
    console.error("[Leads API] Update failed:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

/** GET /api/leads/:id/history - Get aggregated conversation history */
router.get("/:id/history", async (req, res) => {
  try {
    const leadId = req.params.id;
    const messages = await messagesService.getLeadMessages(leadId, 100);
    const callsRes = await db.query(
      "SELECT id, started_at, transcript, disposition, status, metadata FROM calls WHERE lead_id = $1 ORDER BY started_at DESC LIMIT 50",
      [leadId]
    );
    const bookingsRes = await db.query(
      "SELECT id, created_at, contact_name, status, preferred_date, estimated_revenue_cents, scope FROM bookings WHERE lead_id = $1 ORDER BY created_at DESC",
      [leadId]
    );
    const history = [
      ...messages.map(m => ({ ...m, type: 'message' })),
      ...callsRes.rows.map(c => ({ ...c, created_at: c.started_at, type: 'call' })),
      ...bookingsRes.rows.map(b => ({ ...b, type: 'booking' }))
    ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    res.json(history);
  } catch (err) {
    console.error("[Leads API] History failed:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
