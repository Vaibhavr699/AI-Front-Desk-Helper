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

// Phase 7 E (May 18, 2026) — variance coaching service. Lazy-loaded with
// try/catch so this file deploys cleanly even if varianceCoaching.js hasn't
// shipped yet (defensive against deploy ordering). If unavailable, the
// quote-entered endpoint still writes the quote but skips coaching.
let varianceCoaching = null;
try {
  varianceCoaching = require("../services/varianceCoaching");
} catch (err) {
  console.warn(
    "[Leads API] varianceCoaching service not available — quote variance coaching will be skipped:",
    err.message
  );
}

// All routes require authentication and at least Manager-level access
router.use(function(req, res, next) { return authLib.authMiddleware(req, res, next); });
router.use(function(req, res, next) { return authLib.requireRole([authLib.ROLES.OWNER, authLib.ROLES.ADMIN, authLib.ROLES.MANAGER])(req, res, next); });

// ─────────────────────────────────────────────────────────────────────
// Helper: tenant-isolation check used by every per-lead route.
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

// ─────────────────────────────────────────────────────────────────────
// Phase 7 E (May 18, 2026) — augment a lead row with the widget estimate
// + rep quote + variance coaching columns. Doing this as a focused
// follow-up SELECT lets us stay agnostic to whatever leadsService.getLeadById
// returns (SELECT * vs explicit column list). Adds ~1ms latency, guarantees
// the dashboard always sees the Phase 7 E fields.
// ─────────────────────────────────────────────────────────────────────
async function loadPhase7eFields(leadId) {
  try {
    const result = await db.query(
      `SELECT widget_estimate_low_cents,
              widget_estimate_high_cents,
              widget_estimate_scope_summary,
              widget_estimated_at,
              rep_quote_total_cents,
              rep_quote_entered_at,
              rep_quote_entered_by_user_id,
              variance_coaching
         FROM leads
        WHERE id = $1
        LIMIT 1`,
      [leadId]
    );
    return result.rows[0] || {};
  } catch (err) {
    // If the columns don't exist yet (migration 078 not run), silently
    // return empty so the dashboard renders without the widget card.
    console.warn("[Leads API] Phase 7 E column load failed (non-fatal):", err.message);
    return {};
  }
}

// ─────────────────────────────────────────────────────────────────────
// Phase 8A (May 20, 2026) — hoist latest DISC + persona from
// coaching_conversations onto the lead response so LeadDetail.jsx can
// render the Customer Intel card. We pick the most recent classified
// row (disc_primary IS NOT NULL OR buyer_persona != 'unknown') because
// the latest classification is the most representative; older calls
// may have failed classification or had less customer speech.
//
// If no coaching_conversations row exists, all fields come back NULL
// and the card stays hidden — graceful fallback for leads that haven't
// had a voice interaction yet.
// ─────────────────────────────────────────────────────────────────────
async function loadDiscFields(leadId) {
  try {
    const result = await db.query(
      `SELECT disc_primary,
              disc_secondary,
              disc_scores,
              disc_confidence,
              disc_signals,
              disc_skip_reason,
              buyer_persona,
              persona_confidence,
              persona_signals,
              persona_skip_reason,
              persona_detected_at,
              created_at AS disc_detected_at
         FROM coaching_conversations
        WHERE lead_id = $1
          AND (disc_primary IS NOT NULL OR (buyer_persona IS NOT NULL AND buyer_persona != 'unknown'))
        ORDER BY created_at DESC
        LIMIT 1`,
      [leadId]
    );
    return result.rows[0] || {};
  } catch (err) {
    // Don't fail the lead load on a DISC lookup error — log and return
    // empty so the page renders without the Customer Intel card.
    console.warn("[Leads API] Phase 8A DISC field load failed (non-fatal):", err.message);
    return {};
  }
}

// ─────────────────────────────────────────────────────────────────────
// Phase 8B (May 20, 2026) — tech assignment.
//
// Hoists onto the lead response:
//   - assigned_technician      : { id, name, email, phone } | null
//   - assignable_technicians   : [{ id, name, email, phone }]
//   - assignment_booking_id    : the booking the assignment lives on | null
//
// The assignment lives on bookings.technician_id, which is a FK to the
// `technicians` table (NOT dashboard_users — technicians are a separate
// population: people who do estimate visits, who may not have a dashboard
// login). A lead can have several bookings — we use the most recent
// NON-CANCELLED one. If the lead has no such booking, assignment_booking_id
// is null and the dashboard disables the control.
//
// assignable_technicians is every technician on the lead's tenant. Each
// carries `phone` so the dashboard can warn when a chosen tech has no
// number on file (the pre-visit briefing SMS needs it).
// ─────────────────────────────────────────────────────────────────────
async function loadAssignmentFields(lead) {
  try {
    // 1. Most recent non-cancelled booking for this lead.
    const bookingRes = await db.query(
      `SELECT id, technician_id
         FROM bookings
        WHERE lead_id = $1
          AND status != 'Cancelled'
        ORDER BY created_at DESC
        LIMIT 1`,
      [lead.id]
    );
    const booking = bookingRes.rows[0] || null;

    // 2. Assigned technician detail (if a booking exists and has one).
    let assignedTechnician = null;
    if (booking?.technician_id) {
      const techRes = await db.query(
        `SELECT id, name, email, phone FROM technicians WHERE id = $1 LIMIT 1`,
        [booking.technician_id]
      );
      assignedTechnician = techRes.rows[0] || null;
    }

    // 3. All assignable technicians on the lead's tenant.
    const techsRes = await db.query(
      `SELECT id, name, email, phone
         FROM technicians
        WHERE tenant_id = $1
        ORDER BY name ASC`,
      [lead.tenant_id]
    );

    return {
      assigned_technician: assignedTechnician,
      assignable_technicians: techsRes.rows,
      assignment_booking_id: booking?.id || null,
    };
  } catch (err) {
    // Non-fatal — page renders without the assignment control.
    console.warn("[Leads API] Phase 8B assignment field load failed (non-fatal):", err.message);
    return {
      assigned_technician: null,
      assignable_technicians: [],
      assignment_booking_id: null,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────
// Phase 8.3 (May 12, 2026) — Facebook page access token lookup.
//
// This is the SINGLE PLACE the FB token column is read. If your actual
// schema uses a different column name (e.g. fb_page_access_token,
// facebook_access_token, or it lives in a separate tenant_integrations
// table), adjust this function only — the route handler below stays the
// same.
//
// Returns the token string or null if not found / lookup fails.
// ─────────────────────────────────────────────────────────────────────
async function getFacebookPageAccessToken(tenantId) {
  try {
    const res = await db.query(
      "SELECT facebook_page_access_token FROM tenants WHERE id = $1 LIMIT 1",
      [tenantId]
    );
    return res.rows[0]?.facebook_page_access_token || null;
  } catch (err) {
    console.error(
      "[FB token lookup] Failed for tenant=%s — schema mismatch? err=%s",
      tenantId, err.message
    );
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Phase 8.3 (May 12, 2026) — Direct Facebook Graph API send.
//
// Inline to avoid coupling routes/leads.js to server.js (which has its
// own sendFacebookMessage but isn't easily importable). For owner-sent
// FB messages we only need text + recipient — no quick replies, no
// postback buttons.
//
// messaging_type='RESPONSE' is correct for owner-handoff scenarios
// because the customer just messaged us — we're inside Facebook's
// 24-hour standard messaging window.
//
// Throws on Graph API errors. Caller handles response codes.
// ─────────────────────────────────────────────────────────────────────
async function sendFacebookGraphMessage(senderId, text, pageAccessToken) {
  const url = `https://graph.facebook.com/v18.0/me/messages?access_token=${encodeURIComponent(pageAccessToken)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      recipient: { id: senderId },
      message: { text },
      messaging_type: "RESPONSE",
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    const msg = data.error?.message || `FB Graph API returned ${res.status}`;
    const code = data.error?.code;
    const err = new Error(msg);
    err.code = code;
    throw err;
  }
  return data.message_id || null;
}

// ─────────────────────────────────────────────────────────────────────
// Phase 8.3 (May 12, 2026) — Auto-detect channel from latest inbound.
//
// Returns 'sms' | 'website' | 'facebook'. Falls back to 'sms' for leads
// with no inbound history (defensive — should only happen for manually-
// created leads or fresh leads that haven't sent anything yet).
// ─────────────────────────────────────────────────────────────────────
async function detectLeadChannel(leadId) {
  try {
    const res = await db.query(
      `SELECT channel FROM messages
        WHERE lead_id = $1 AND direction = 'inbound'
        ORDER BY created_at DESC
        LIMIT 1`,
      [leadId]
    );
    const ch = res.rows[0]?.channel;
    if (ch === "website" || ch === "facebook" || ch === "sms") return ch;
    return "sms";
  } catch (err) {
    console.error("[Channel detect] Failed leadId=%s err=%s", leadId, err.message);
    return "sms";
  }
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

/** GET /api/leads/:id - Get a single lead's profile (Phase 7 E + 8A augmented) */
router.get("/:id", async (req, res) => {
  try {
    const lead = await leadsService.getLeadById(req.params.id);
    if (!lead) return res.status(404).json({ error: "Lead not found" });
    if (!(await checkLeadAccess(lead, req))) {
      return res.status(403).json({ error: "Forbidden" });
    }

    // Phase 7 E — merge in widget estimate + rep quote + variance coaching
    // columns regardless of what leadsService.getLeadById selected.
    // Phase 8A — also hoist DISC + persona from coaching_conversations
    // so LeadDetail.jsx can render the Customer Intel card.
    // Run both in parallel — they're independent table queries.
    const [phase7eFields, discFields, assignmentFields] = await Promise.all([
      loadPhase7eFields(lead.id),
      loadDiscFields(lead.id),
      loadAssignmentFields(lead),
    ]);
    const enriched = { ...lead, ...phase7eFields, ...discFields, ...assignmentFields };

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

    res.json(enriched);
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
 * Body: { value: boolean, reason?: string }
 * Returns: { lead, cancelled_recoveries, cancelled_nurtures }
 */
router.patch("/:id/do-not-contact", async (req, res) => {
  try {
    const lead = await leadsService.getLeadById(req.params.id);
    if (!lead) return res.status(404).json({ error: "Lead not found" });
    if (!(await checkLeadAccess(lead, req))) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const { value, reason } = req.body || {};
    if (typeof value !== "boolean") {
      return res.status(400).json({ error: "Body must include 'value' as a boolean (true to enable DNC, false to clear)" });
    }
    const trimmedReason = (typeof reason === "string" ? reason.trim() : null) || null;
    if (trimmedReason && trimmedReason.length > 500) {
      return res.status(400).json({ error: "Reason must be 500 characters or less" });
    }

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

/**
 * PATCH /api/leads/:id/assign-tech
 *
 * Phase 8B (May 20, 2026) — assign (or clear) the estimator for a lead's
 * most recent non-cancelled booking. The assigned technician receives the
 * pre-visit briefing SMS instead of the tenant-level recipient.
 *
 * Body: { technician_id: string | null }
 *   - technician_id = a technicians.id on the same tenant → assign
 *   - technician_id = null                                → unassign
 *
 * Returns the enriched lead (same shape as GET /:id) so the dashboard can
 * refresh in place.
 */
router.patch("/:id/assign-tech", async (req, res) => {
  try {
    const lead = await leadsService.getLeadById(req.params.id);
    if (!lead) return res.status(404).json({ error: "Lead not found" });
    if (!(await checkLeadAccess(lead, req))) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const { technician_id } = req.body || {};
    if (technician_id !== null && typeof technician_id !== "string") {
      return res.status(400).json({
        error: "Body must include 'technician_id' as a string (the technician's id) or null to unassign",
      });
    }

    // The lead's most recent non-cancelled booking is what we assign on.
    const bookingRes = await db.query(
      `SELECT id FROM bookings
        WHERE lead_id = $1 AND status != 'Cancelled'
        ORDER BY created_at DESC
        LIMIT 1`,
      [lead.id]
    );
    const booking = bookingRes.rows[0];
    if (!booking) {
      return res.status(409).json({
        error: "This lead has no active booking. Assign a technician once an appointment is booked.",
        code: "NO_ACTIVE_BOOKING",
      });
    }

    // If assigning (not clearing), validate the technician belongs to the
    // lead's tenant — prevents cross-tenant assignment.
    if (technician_id) {
      const techRes = await db.query(
        `SELECT id, name, email, phone FROM technicians
          WHERE id = $1 AND tenant_id = $2
          LIMIT 1`,
        [technician_id, lead.tenant_id]
      );
      if (techRes.rows.length === 0) {
        return res.status(400).json({
          error: "Technician not found on this lead's location.",
          code: "INVALID_TECHNICIAN",
        });
      }
    }

    // Write the assignment.
    await db.query(
      `UPDATE bookings SET technician_id = $1 WHERE id = $2`,
      [technician_id, booking.id]
    );

    await logAction({
      tenant_id: String(lead.tenant_id),
      user_id: req.user?.sub ? String(req.user.sub) : null,
      action: "booking_updated",
      entity_type: "booking",
      entity_id: String(booking.id),
      new_value: {
        lead_id: String(lead.id),
        assigned_technician_id: technician_id ? String(technician_id) : null,
        change: technician_id ? "tech_assigned" : "tech_unassigned",
      },
      ip_address: req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.ip || null,
      user_agent: req.get("user-agent") || null,
    }).catch(() => {});

    // Return the enriched lead so the dashboard refreshes in place.
    const [phase7eFields, discFields, assignmentFields] = await Promise.all([
      loadPhase7eFields(lead.id),
      loadDiscFields(lead.id),
      loadAssignmentFields(lead),
    ]);
    res.json({ ...lead, ...phase7eFields, ...discFields, ...assignmentFields });
  } catch (err) {
    console.error("[Leads API] assign-tech failed leadId=%s err=%s", req.params.id, err.message);
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
// PHASE 7 E (May 18, 2026) — Rep Quote Entry + Variance Coaching
// ============================================================================

/**
 * POST /api/leads/:id/quote-entered
 *
 * Called from the dashboard (and later rep mobile app) when the rep enters
 * their real in-home quote total. Writes the quote, then triggers GPT-4o
 * variance coaching if the quote differs from the widget ballpark by
 * >=15%. Returns the enriched lead with variance_coaching populated.
 *
 * Body (accepts either):
 *   { total_cents: 200000 }           — integer cents
 *   { total_dollars: 2000.00 }        — decimal dollars (UI sends this)
 *
 * Response:
 *   200 { lead, variance_coaching_generated: boolean }
 *   400 — bad input
 *   403 — access denied
 *   404 — lead not found
 *
 * Variance coaching is awaited (not fire-and-forget) so the user sees the
 * coaching on the same response that confirms the save. GPT-4o takes 2-5
 * seconds — acceptable UX for a "save quote" action. If the coaching call
 * fails, the response still returns success — the rep's quote is saved.
 */
router.post("/:id/quote-entered", async (req, res) => {
  try {
    const lead = await leadsService.getLeadById(req.params.id);
    if (!lead) return res.status(404).json({ error: "Lead not found" });
    if (!(await checkLeadAccess(lead, req))) {
      return res.status(403).json({ error: "Forbidden" });
    }

    // ── Parse + validate input (accept cents or dollars) ─────────────
    const body = req.body || {};
    let totalCents = null;

    if (typeof body.total_cents === "number" && Number.isFinite(body.total_cents)) {
      totalCents = Math.round(body.total_cents);
    } else if (typeof body.total_cents === "string" && /^\d+$/.test(body.total_cents.trim())) {
      totalCents = parseInt(body.total_cents.trim(), 10);
    } else if (typeof body.total_dollars === "number" && Number.isFinite(body.total_dollars)) {
      totalCents = Math.round(body.total_dollars * 100);
    } else if (typeof body.total_dollars === "string" && /^\d+(\.\d+)?$/.test(body.total_dollars.trim())) {
      totalCents = Math.round(parseFloat(body.total_dollars.trim()) * 100);
    }

    if (totalCents === null) {
      return res.status(400).json({
        error: "Provide total_cents (integer) or total_dollars (number) in the request body",
      });
    }
    if (totalCents < 0) {
      return res.status(400).json({ error: "Quote total cannot be negative" });
    }
    if (totalCents > 100_000_000) {
      return res.status(400).json({ error: "Quote total exceeds $1,000,000 cap. Contact support." });
    }

    const userId = req.user?.sub ? String(req.user.sub) : null;

    // ── Write the rep quote + clear stale variance coaching ──────────
    //
    // Clearing variance_coaching first means the dashboard never shows
    // stale coaching for the old quote while the new coaching is being
    // generated. The frontend can show "Analyzing..." in the gap.
    await db.query(
      `UPDATE leads
          SET rep_quote_total_cents        = $1,
              rep_quote_entered_at         = now(),
              rep_quote_entered_by_user_id = $2,
              variance_coaching            = NULL,
              updated_at                   = now()
        WHERE id = $3`,
      [totalCents, userId, lead.id]
    );

    // Audit log (non-blocking)
    await logAction({
      tenant_id: String(lead.tenant_id),
      user_id: userId,
      action: "rep_quote_entered",
      entity_type: "lead",
      entity_id: String(lead.id),
      new_value: {
        total_cents: totalCents,
        total_dollars: Math.round(totalCents / 100),
        widget_low_cents: lead.widget_estimate_low_cents || null,
        widget_high_cents: lead.widget_estimate_high_cents || null,
      },
      ip_address: req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.ip || null,
      user_agent: req.get("user-agent") || null,
    }).catch(() => {});

    console.log(
      "[Leads API] Rep quote entered leadId=%s tenant=%s user=%s totalCents=%d",
      lead.id, lead.tenant_id, userId, totalCents
    );

    // ── Trigger variance coaching (awaited; ~3 sec) ──────────────────
    //
    // Failure modes (any return null/skipped):
    //   - varianceCoaching service not loaded → skip silently
    //   - Lead has no widget estimate → skipped 'no_widget_estimate'
    //   - Variance < 15% threshold → skipped 'within_threshold'
    //   - GPT-4o error → returns { ok: false }
    //
    // The endpoint always succeeds with the quote saved regardless.
    let coachingGenerated = false;
    if (varianceCoaching && typeof varianceCoaching.computeVarianceCoaching === "function") {
      try {
        const result = await varianceCoaching.computeVarianceCoaching({ leadId: lead.id });
        coachingGenerated = !!(result?.ok && !result?.skipped);
        if (result?.skipped) {
          console.log(
            "[Leads API] Variance coaching skipped leadId=%s reason=%s",
            lead.id, result.reason
          );
        }
      } catch (vcErr) {
        console.error(
          "[Leads API] Variance coaching threw leadId=%s err=%s",
          lead.id, vcErr.message
        );
      }
    }

    // ── Re-read lead with Phase 7 E + Phase 8A fields included ───────
    const freshLead = await leadsService.getLeadById(lead.id);
    const [phase7eFields, discFields] = await Promise.all([
      loadPhase7eFields(lead.id),
      loadDiscFields(lead.id),
    ]);
    const enriched = { ...freshLead, ...phase7eFields, ...discFields };

    res.json({
      lead: enriched,
      variance_coaching_generated: coachingGenerated,
    });
  } catch (err) {
    console.error("[Leads API] Quote entered failed leadId=%s err=%s", req.params.id, err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ============================================================================
// PHASE 8 + 8.3 — Owner Messaging (multi-channel, May 12, 2026)
// ============================================================================

/**
 * POST /api/leads/:id/send
 *
 * Manually send a message to the lead from the dashboard. The AI is
 * paused on this lead until the owner explicitly resumes it.
 *
 * Body: { body: string, channel?: 'sms' | 'website' | 'facebook' }
 *
 * If channel is omitted, the backend auto-detects from the lead's most
 * recent inbound message. Reply goes out on whatever channel the customer
 * is using.
 *
 * Behavior by channel:
 *
 *   sms:
 *     - DNC check (TCPA gate) → 422 if blocked
 *     - Twilio dispatch via tenant's primary phone
 *     - Insert message row with sent_by_user_id, twilio_sid in metadata
 *
 *   website:
 *     - DNC check (consistent with SMS — owner explicitly set the flag)
 *     - No external API call. Message is inserted with channel='website'
 *       and the customer's chat widget picks it up via the next poll of
 *       GET /api/widget/poll-messages (~5s cadence while widget is open).
 *
 *   facebook:
 *     - DNC check
 *     - Look up tenant's FB page access token (helper at top of file)
 *     - Direct Graph API call → 502 if Graph errors, 503 if no token
 *     - Insert message row with fb_message_id in metadata
 *
 * All paths set human_handoff_at on the lead (idempotent COALESCE) and
 * audit-log action='manual_message_sent' with channel + IDs.
 *
 * Returns: { message, lead, channel_used }
 */
router.post("/:id/send", async (req, res) => {
  try {
    const lead = await leadsService.getLeadById(req.params.id);
    if (!lead) return res.status(404).json({ error: "Lead not found" });
    if (!(await checkLeadAccess(lead, req))) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const { body } = req.body || {};
    let { channel } = req.body || {};

    // Body validation
    if (!body || typeof body !== "string" || !body.trim()) {
      return res.status(400).json({ error: "Message body required" });
    }
    if (body.length > 1600) {
      return res.status(400).json({ error: "Message too long (max 1600 chars)" });
    }
    const trimmedBody = body.trim();

    // Channel resolution: explicit param wins; else auto-detect.
    if (channel && !["sms", "website", "facebook"].includes(channel)) {
      return res.status(400).json({ error: "Invalid channel. Must be sms, website, or facebook." });
    }
    if (!channel) {
      channel = await detectLeadChannel(lead.id);
    }

    // Load tenant for routing
    const tenantRes = await db.query("SELECT * FROM tenants WHERE id = $1", [lead.tenant_id]);
    const tenant = tenantRes.rows[0];
    if (!tenant) return res.status(500).json({ error: "Tenant not found" });

    const userId = req.user?.sub ? String(req.user.sub) : null;

    // DNC check applies to all channels. The owner explicitly set this
    // flag (or the customer opted out via STOP); honoring it across all
    // channels respects the customer's wishes regardless of medium.
    const dncBlocked = await smsService.isPhoneDoNotContact(lead.tenant_id, lead.phone);
    if (dncBlocked) {
      return res.status(422).json({ error: "This lead is on the do-not-contact list. Cannot send messages." });
    }

    // Per-channel dispatch
    let providerMessageId = null;
    let providerMetadata = { sent_manually: true };

    if (channel === "sms") {
      // ── SMS path ─────────────────────────────────────────────────────
      if (!lead.phone) {
        return res.status(400).json({ error: "Lead has no phone number" });
      }
      const client = twilio.getClientForTenant(tenant);
      if (!client) {
        return res.status(500).json({ error: "Twilio is not configured for this tenant" });
      }
      const fromPhone = await smsService.getTenantPrimaryPhone(tenant.id);
      if (!fromPhone) {
        return res.status(500).json({ error: "No outbound phone number configured for this tenant" });
      }

      try {
        const message = await client.messages.create({
          to:   lead.phone,
          from: fromPhone,
          body: trimmedBody,
        });
        providerMessageId = message.sid;
        providerMetadata = { ...providerMetadata, twilio_sid: message.sid };
      } catch (e) {
        console.error(
          "[Manual SMS] Twilio send failed leadId=%s tenant=%s code=%s err=%s",
          lead.id, tenant.id, e.code || "unknown", e.message
        );
        return res.status(502).json({ error: `SMS send failed: ${e.message}` });
      }

    } else if (channel === "website") {
      // ── Website path: insert into DB, widget polls it up ─────────────
      //
      // For website leads, lead.phone holds the sessionId (e.g. "web-abc-123").
      // The widget polls GET /api/widget/poll-messages?sessionId=... every
      // ~5s while open and renders any new owner-sent messages with
      // channel='website' as assistant-style bubbles.
      if (!lead.phone) {
        return res.status(400).json({ error: "Lead has no website session on file" });
      }
      providerMetadata = { ...providerMetadata, delivery: "widget_poll" };

    } else if (channel === "facebook") {
      // ── Facebook path: Graph API send ────────────────────────────────
      //
      // For FB leads, lead.phone holds the FB sender_id (Page-scoped ID).
      if (!lead.phone) {
        return res.status(400).json({ error: "Lead has no Facebook sender ID on file" });
      }

      const pageAccessToken = await getFacebookPageAccessToken(tenant.id);
      if (!pageAccessToken) {
        return res.status(503).json({ error: "Facebook is not connected for this tenant" });
      }

      try {
        const fbMessageId = await sendFacebookGraphMessage(lead.phone, trimmedBody, pageAccessToken);
        providerMessageId = fbMessageId;
        providerMetadata = { ...providerMetadata, fb_message_id: fbMessageId };
      } catch (e) {
        console.error(
          "[Manual FB] Graph API send failed leadId=%s tenant=%s code=%s err=%s",
          lead.id, tenant.id, e.code || "unknown", e.message
        );
        // FB error code 190 = token expired/invalid — flag it so the
        // owner can re-auth.
        if (e.code === 190) {
          db.query(
            "UPDATE tenants SET facebook_token_error = 'expired', updated_at = now() WHERE id = $1",
            [tenant.id]
          ).catch(() => {});
        }
        return res.status(502).json({ error: `Facebook send failed: ${e.message}` });
      }
    }

    // Record the outbound message. Same INSERT across all channels —
    // only `channel` and `metadata` differ.
    const messageRes = await db.query(
      `INSERT INTO messages (tenant_id, lead_id, channel, direction, body, metadata, sent_by_user_id)
       VALUES ($1, $2, $3, 'outbound', $4, $5::jsonb, $6)
       RETURNING id, tenant_id, lead_id, channel, direction, body, metadata, sent_by_user_id, created_at`,
      [
        tenant.id,
        lead.id,
        channel,
        trimmedBody,
        JSON.stringify(providerMetadata),
        userId,
      ]
    );
    const messageRow = messageRes.rows[0];

    // Set handoff on the lead — idempotent. COALESCE preserves the
    // original timestamp/user of the FIRST owner message in a session.
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
        message_id:           messageRow.id,
        channel:              channel,
        body_length:          body.length,
        provider_message_id:  providerMessageId,
        triggered_handoff:    triggeredHandoff,
      },
      ip_address: req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.ip || null,
      user_agent: req.get("user-agent") || null,
    }).catch(() => {});

    console.log(
      "[Manual %s] Sent leadId=%s tenant=%s user=%s providerId=%s handoff_triggered=%s",
      channel.toUpperCase(), lead.id, tenant.id, userId, providerMessageId, triggeredHandoff
    );

    res.json({
      message:       messageRow,
      lead:          updatedLead,
      channel_used:  channel,
    });
  } catch (err) {
    console.error("[Leads API] Manual send failed leadId=%s err=%s", req.params.id, err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /api/leads/:id/resume-ai
 *
 * Clear human handoff so the AI resumes auto-responding. Idempotent.
 * Returns: { lead, no_change?: true }
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
      "[Manual] AI resumed leadId=%s tenant=%s user=%s",
      lead.id, lead.tenant_id, userId
    );

    res.json({ lead: updated.rows[0] });
  } catch (err) {
    console.error("[Leads API] Resume AI failed leadId=%s err=%s", req.params.id, err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
