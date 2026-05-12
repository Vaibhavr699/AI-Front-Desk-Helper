"use strict";

const express = require("express");
const router = express.Router();
const leadsService = require("../services/leads");
const messagesService = require("../services/messages");
const callsService = require("../services/calls");
const smsService = require("../services/sms");
const twilio = require("../lib/twilio");
const authLib = require("../lib/auth");
const { logAction } = require("../lib/auditLogger");
const db = require("../lib/db");

// All routes require authentication and at least Manager-level access
router.use(function(req, res, next) { return authLib.authMiddleware(req, res, next); });
router.use(function(req, res, next) { return authLib.requireRole([authLib.ROLES.OWNER, authLib.ROLES.ADMIN, authLib.ROLES.MANAGER])(req, res, next); });

// ─────────────────────────────────────────────────────────────────────
// Helper: tenant-isolation check used by every per-lead route. Pulled
// out so the new owner-messaging endpoints stay consistent with the
// existing GET / PATCH / DNC handlers.
// ─────────────────────────────────────────────────────────────────────
async function checkLeadAccess(lead, req) {
  const isOwner = lead.tenant_id === req.user?.tenant_id;
  let isParentOfOwner = false;
  if (!isOwner && req.user?.tenant_business_type === 'parent') {
    const check = await db.query(
      "SELECT 1 FROM tenants WHERE id = $1 AND parent_id = $2",
      [lead.tenant_id, req.user.tenant_id]
    );
    isParentOfOwner = check.rows.length > 0;
  }
  return isOwner || isParentOfOwner || req.user?.is_super_admin;
}

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
    if (!(await checkLeadAccess(lead, req))) {
      return res.status(403).json({ error: "Forbidden" });
    }

    // Audit log: lead viewed
    await logAction({
      tenant_id: String(lead.tenant_id),
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
    if (!(await checkLeadAccess(lead, req))) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const updated = await leadsService.updateLeadInfo(req.params.id, req.body);
    res.json(updated);
  } catch (err) {
    console.error("[Leads API] Update failed:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * PATCH /api/leads/:id/do-not-contact
 *
 * Toggle the do_not_contact flag on a lead (Migration 059, May 8 2026).
 *
 * Body: { value: boolean, reason?: string }
 *
 * When value=true, this also CASCADES: cancels any active estimate
 * recoveries and pending nurturing schedule rows for the lead, so the
 * dashboard reflects clean state immediately and no cron tick can fire
 * a stray text. When value=false, the lead is reopened to future
 * automation but previously cancelled sequences stay cancelled.
 *
 * Returns: { lead, cancelled_recoveries, cancelled_nurtures }
 */
router.patch("/:id/do-not-contact", async (req, res) => {
  try {
    const lead = await leadsService.getLeadById(req.params.id);
    if (!lead) return res.status(404).json({ error: "Lead not found" });
    if (!(await checkLeadAccess(lead, req))) {
      return res.status(403).json({ error: "Forbidden" });
    }

    // Body validation
    const { value, reason } = req.body || {};
    if (typeof value !== "boolean") {
      return res.status(400).json({ error: "Body must include 'value' as a boolean (true to enable DNC, false to clear)" });
    }
    const trimmedReason = (typeof reason === "string" ? reason.trim() : null) || null;
    if (trimmedReason && trimmedReason.length > 500) {
      return res.status(400).json({ error: "Reason must be 500 characters or less" });
    }

    // Idempotency: no-op when already in the requested state.
    if (Boolean(lead.do_not_contact) === value) {
      return res.json({
        lead,
        cancelled_recoveries: 0,
        cancelled_nurtures: 0,
        no_change: true,
      });
    }

    const userId = req.user?.sub ? String(req.user.sub) : null;
    const result = await leadsService.setDoNotContact(req.params.id, value, {
      userId,
      reason: trimmedReason,
      trigger_source: "owner_dashboard",
      // Migration 060 (May 9, 2026): audit logging moved into setDoNotContact()
      // so every path (dashboard PATCH, SMS keyword, SMS intent, voice intent)
      // is captured identically.
      ip_address: req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.ip || null,
      user_agent: req.get("user-agent") || null,
    });

    res.json({
      lead: result.lead,
      cancelled_recoveries: result.cancelled_recoveries,
      cancelled_nurtures: result.cancelled_nurtures,
    });
  } catch (err) {
    console.error("[Leads API] DNC toggle failed leadId=%s err=%s", req.params.id, err.message);
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

// ============================================================================
// PHASE 8 — Owner Messaging (May 12, 2026)
// ============================================================================

/**
 * POST /api/leads/:id/send
 *
 * Manually send an SMS to the lead from the dashboard. This is the
 * "owner takes over" path — when a human jumps into the conversation,
 * the AI is paused on this lead until manually resumed.
 *
 * Body: { body: string, channel?: 'sms' (default) }
 * Auth: Owner, Admin, or Manager (set at router.use above)
 *
 * Behavior:
 *   - Validates lead exists + tenant isolation
 *   - DNC check: reuses isPhoneDoNotContact from services/sms.js
 *     Returns 422 if blocked (TCPA-equivalent — even though a human
 *     pressed the button, the lead opted out of all contact)
 *   - Looks up tenant's primary phone, dispatches via Twilio
 *   - Records the outbound message with sent_by_user_id set, so the
 *     conversation viewer can distinguish AI-sent from owner-sent
 *   - Sets human_handoff_at on the lead, idempotent — only the FIRST
 *     owner message in a handoff session updates the timestamp
 *   - Audit log: action='manual_message_sent'
 *
 * Returns: { message: <created row>, lead: <updated row> }
 *
 * Companion behavior in the AI inbound SMS handler: when an inbound
 * message arrives for a lead with human_handoff_at IS NOT NULL, the
 * handler should record the inbound message but skip the auto-response.
 * That check lives in the inbound handler, not here.
 */
router.post("/:id/send", async (req, res) => {
  try {
    const lead = await leadsService.getLeadById(req.params.id);
    if (!lead) return res.status(404).json({ error: "Lead not found" });
    if (!(await checkLeadAccess(lead, req))) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const { body, channel = "sms" } = req.body || {};
    if (!body || typeof body !== "string" || !body.trim()) {
      return res.status(400).json({ error: "Message body required" });
    }
    if (body.length > 1600) {
      return res.status(400).json({ error: "Message too long (max 1600 chars)" });
    }
    if (channel !== "sms") {
      return res.status(400).json({ error: "Only SMS supported currently" });
    }
    if (!lead.phone) {
      return res.status(400).json({ error: "Lead has no phone number" });
    }

    // Load tenant for Twilio routing
    const tenantRes = await db.query("SELECT * FROM tenants WHERE id = $1", [lead.tenant_id]);
    const tenant = tenantRes.rows[0];
    if (!tenant) return res.status(500).json({ error: "Tenant not found" });

    // DNC check — same helper auto-paths use, so semantics stay consistent
    // across AI sends and manual sends. Even though a human pressed the
    // button, sending to a DNC-flagged number is a TCPA risk.
    const dncBlocked = await smsService.isPhoneDoNotContact(lead.tenant_id, lead.phone);
    if (dncBlocked) {
      return res.status(422).json({ error: "This lead is on the do-not-contact list. Cannot send messages." });
    }

    // Twilio client + from number
    const client = twilio.getClientForTenant(tenant);
    if (!client) {
      return res.status(500).json({ error: "Twilio is not configured for this tenant" });
    }
    const fromPhone = await smsService.getTenantPrimaryPhone(tenant.id);
    if (!fromPhone) {
      return res.status(500).json({ error: "No outbound phone number configured for this tenant" });
    }

    // Send via Twilio
    let twilioSid = null;
    try {
      const message = await client.messages.create({
        to:   lead.phone,
        from: fromPhone,
        body: body.trim(),
      });
      twilioSid = message.sid;
    } catch (e) {
      console.error(
        "[Manual SMS] Twilio send failed leadId=%s tenant=%s code=%s err=%s",
        lead.id, tenant.id, e.code || "unknown", e.message
      );
      return res.status(502).json({ error: `SMS send failed: ${e.message}` });
    }

    const userId = req.user?.sub ? String(req.user.sub) : null;

    // Record the outbound message. sent_by_user_id distinguishes this from
    // AI-sent messages in the conversation viewer + analytics queries.
    const messageRes = await db.query(
      `INSERT INTO messages (tenant_id, lead_id, channel, direction, body, metadata, sent_by_user_id)
       VALUES ($1, $2, 'sms', 'outbound', $3, $4::jsonb, $5)
       RETURNING id, tenant_id, lead_id, channel, direction, body, metadata, sent_by_user_id, created_at`,
      [
        tenant.id,
        lead.id,
        body.trim(),
        JSON.stringify({ twilio_sid: twilioSid, sent_manually: true }),
        userId,
      ]
    );
    const messageRow = messageRes.rows[0];

    // Set handoff on the lead — idempotent. COALESCE preserves the original
    // timestamp/user of the FIRST owner message in a session, so the audit
    // trail of "when did the human take over" stays accurate even across
    // multiple owner messages.
    const handoffRes = await db.query(
      `UPDATE leads
          SET human_handoff_at         = COALESCE(human_handoff_at, now()),
              human_handoff_by_user_id = COALESCE(human_handoff_by_user_id, $1),
              updated_at               = now()
        WHERE id = $2
       RETURNING *`,
      [userId, lead.id]
    );
    const updatedLead = handoffRes.rows[0] || lead;
    const triggeredHandoff = !lead.human_handoff_at;

    // Audit log
    await logAction({
      tenant_id: String(tenant.id),
      user_id: userId,
      action: "manual_message_sent",
      entity_type: "lead",
      entity_id: String(lead.id),
      new_value: {
        message_id:        messageRow.id,
        channel:           "sms",
        to_phone:          lead.phone,
        from_phone:        fromPhone,
        body_length:       body.length,
        twilio_sid:        twilioSid,
        triggered_handoff: triggeredHandoff,
      },
      ip_address: req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.ip || null,
      user_agent: req.get("user-agent") || null,
    }).catch(() => {});

    console.log(
      "[Manual SMS] Sent leadId=%s tenant=%s user=%s sid=%s handoff_triggered=%s",
      lead.id, tenant.id, userId, twilioSid, triggeredHandoff
    );

    res.json({
      message: messageRow,
      lead:    updatedLead,
    });
  } catch (err) {
    console.error("[Leads API] Manual send failed leadId=%s err=%s", req.params.id, err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /api/leads/:id/resume-ai
 *
 * Clear the human handoff flag so the AI resumes auto-responding to
 * future inbound messages from this lead. Idempotent — safe to call
 * even when the lead isn't currently in handoff (returns no_change=true).
 *
 * Auth: Owner, Admin, or Manager
 * Body: empty
 *
 * Returns: { lead: <updated row>, no_change?: true }
 */
router.post("/:id/resume-ai", async (req, res) => {
  try {
    const lead = await leadsService.getLeadById(req.params.id);
    if (!lead) return res.status(404).json({ error: "Lead not found" });
    if (!(await checkLeadAccess(lead, req))) {
      return res.status(403).json({ error: "Forbidden" });
    }

    if (!lead.human_handoff_at) {
      return res.json({ lead, no_change: true });
    }

    const userId = req.user?.sub ? String(req.user.sub) : null;
    const updated = await db.query(
      `UPDATE leads
          SET human_handoff_at         = NULL,
              human_handoff_by_user_id = NULL,
              updated_at               = now()
        WHERE id = $1
       RETURNING *`,
      [lead.id]
    );

    await logAction({
      tenant_id: String(lead.tenant_id),
      user_id: userId,
      action: "ai_resumed",
      entity_type: "lead",
      entity_id: String(lead.id),
      old_value: {
        was_handoff_at: lead.human_handoff_at,
        was_handoff_by: lead.human_handoff_by_user_id,
      },
      ip_address: req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.ip || null,
      user_agent: req.get("user-agent") || null,
    }).catch(() => {});

    console.log(
      "[Manual SMS] AI resumed leadId=%s tenant=%s user=%s",
      lead.id, lead.tenant_id, userId
    );

    res.json({ lead: updated.rows[0] });
  } catch (err) {
    console.error("[Leads API] Resume AI failed leadId=%s err=%s", req.params.id, err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
