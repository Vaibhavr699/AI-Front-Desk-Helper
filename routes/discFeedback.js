"use strict";

// ═══════════════════════════════════════════════════════════════════════════
// /api/disc-feedback — Phase 8E DISC Feedback Capture (v0)
// Shipped: May 19, 2026
//
// Capture endpoints for owner/rep verdicts on DISC classifications.
// AI self-grade rows are inserted directly by lib/coachingEngine.js
// at classification time when confidence is in the 0.4-0.6 band.
//
// Phase 8E v0 = CAPTURE ONLY. No refinement cron yet — corrections
// accumulate until ~50 per tenant, then the refinement loop ships.
//
// Endpoints:
//   POST   /leads/:leadId                  submit feedback on a lead's DISC
//   GET    /leads/:leadId                  list feedback history for a lead
//   GET    /tenants/me/accuracy            tenant-wide accuracy snapshot
//
// Mount in server.js:
//   const discFeedbackRoutes = require("./routes/discFeedback");
//   app.use("/api/disc-feedback", discFeedbackRoutes);
// ═══════════════════════════════════════════════════════════════════════════

const express = require("express");
const router = express.Router();
const db = require("../lib/db");

let logAction;
try {
  ({ logAction } = require("../lib/auditLogger"));
} catch (_) {
  logAction = async () => {};
}

const VALID_DISC = new Set(["D", "I", "S", "C"]);
const VALID_ROLES = new Set(["owner", "rep"]); // 'ai' is internal-only

function getTenantId(req) {
  const impersonate = req.headers["x-impersonate-tenant-id"];
  if (impersonate && (req.user?.is_super_admin || req.user?.role === "super_admin")) {
    return impersonate;
  }
  return req.user?.tenant_id || null;
}

// Infer submitter role from user record. Falls back to 'owner' when role
// claim is ambiguous — most dashboard users are owners. Reps will be
// distinguishable once Rep Mobile (6C) wires its own auth claims.
function inferRole(req) {
  const explicit = req.body?.submitted_by_role;
  if (explicit && VALID_ROLES.has(explicit)) return explicit;
  const userRole = req.user?.role;
  if (userRole === "rep" || userRole === "field_rep") return "rep";
  return "owner";
}

// ─────────────────────────────────────────────────────────────────────────
// POST /api/disc-feedback/leads/:leadId
//
// Submit feedback on a lead's current DISC classification. The classification
// being judged is snapshotted INTO the feedback row at insert time, so the
// verdict survives later re-classification.
//
// Body:
//   { was_accurate: true | false,
//     corrected_primary?: 'D'|'I'|'S'|'C',     -- required when was_accurate=false
//     corrected_secondary?: 'D'|'I'|'S'|'C',
//     reason?: string }
// ─────────────────────────────────────────────────────────────────────────
router.post("/leads/:leadId", async (req, res) => {
  const tenantId = getTenantId(req);
  if (!tenantId) return res.status(401).json({ error: "No tenant in session" });

  const userId = req.user?.id || null;
  const leadId = req.params.leadId;
  const role = inferRole(req);

  const wasAccurate = req.body?.was_accurate;
  if (typeof wasAccurate !== "boolean") {
    return res.status(400).json({ error: "was_accurate must be true or false" });
  }

  const correctedPrimary = req.body?.corrected_primary || null;
  const correctedSecondary = req.body?.corrected_secondary || null;

  if (wasAccurate === false && !correctedPrimary) {
    return res.status(400).json({
      error: "corrected_primary required when was_accurate=false",
    });
  }
  if (correctedPrimary && !VALID_DISC.has(correctedPrimary)) {
    return res.status(400).json({ error: "corrected_primary must be D, I, S, or C" });
  }
  if (correctedSecondary && !VALID_DISC.has(correctedSecondary)) {
    return res.status(400).json({ error: "corrected_secondary must be D, I, S, or C" });
  }
  if (correctedSecondary && correctedSecondary === correctedPrimary) {
    return res.status(400).json({ error: "corrected_secondary cannot equal corrected_primary" });
  }

  const reason = typeof req.body?.reason === "string"
    ? req.body.reason.trim().slice(0, 1000) || null
    : null;

  try {
    // Verify lead belongs to tenant AND snapshot current classification
    const leadRes = await db.query(
      `SELECT id, disc_primary, disc_secondary, disc_confidence,
              (SELECT id FROM coaching_conversations
                WHERE lead_id = $1 AND disc_primary IS NOT NULL
                ORDER BY persona_detected_at DESC LIMIT 1) AS source_conversation_id
         FROM leads
        WHERE id = $1 AND tenant_id = $2
        LIMIT 1`,
      [leadId, tenantId]
    );
    if (leadRes.rows.length === 0) {
      return res.status(404).json({ error: "Lead not found" });
    }
    const lead = leadRes.rows[0];

    if (!lead.disc_primary) {
      return res.status(400).json({
        error: "Lead has no DISC classification to give feedback on",
      });
    }

    const insertRes = await db.query(
      `INSERT INTO disc_feedback (
         tenant_id, conversation_id, lead_id,
         submitted_by_user_id, submitted_by_role,
         classified_primary, classified_secondary, classified_confidence,
         was_accurate, corrected_primary, corrected_secondary,
         reason
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [
        tenantId,
        lead.source_conversation_id,
        leadId,
        userId,
        role,
        lead.disc_primary,
        lead.disc_secondary,
        lead.disc_confidence,
        wasAccurate,
        correctedPrimary,
        correctedSecondary,
        reason,
      ]
    );

    const feedback = insertRes.rows[0];

    Promise.resolve(
      logAction({
        tenant_id: tenantId,
        user_id: userId,
        action: "disc_feedback_submitted",
        resource_type: "disc_feedback",
        resource_id: feedback.id,
        metadata: {
          lead_id: leadId,
          role,
          was_accurate: wasAccurate,
          classified: lead.disc_primary,
          corrected: correctedPrimary,
        },
      })
    ).catch((err) => console.warn("[discFeedback] audit log failed:", err.message));

    res.status(201).json({
      feedback,
      message: wasAccurate
        ? "Thanks — accuracy confirmed."
        : "Thanks — correction logged and will refine future classifications.",
    });
  } catch (err) {
    console.error("[discFeedback] submit error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// GET /api/disc-feedback/leads/:leadId
//
// Returns all feedback rows for this lead, ordered most-recent first.
// Used by the Customer Intel card to render "you already said this was X"
// state and prevent duplicate submissions.
// ─────────────────────────────────────────────────────────────────────────
router.get("/leads/:leadId", async (req, res) => {
  const tenantId = getTenantId(req);
  if (!tenantId) return res.status(401).json({ error: "No tenant in session" });

  try {
    const leadCheck = await db.query(
      "SELECT id FROM leads WHERE id = $1 AND tenant_id = $2 LIMIT 1",
      [req.params.leadId, tenantId]
    );
    if (leadCheck.rows.length === 0) {
      return res.status(404).json({ error: "Lead not found" });
    }

    const result = await db.query(
      `SELECT df.*,
              du.email AS submitted_by_email
         FROM disc_feedback df
         LEFT JOIN dashboard_users du ON du.id = df.submitted_by_user_id
        WHERE df.lead_id = $1 AND df.tenant_id = $2
        ORDER BY df.created_at DESC`,
      [req.params.leadId, tenantId]
    );

    res.json({ feedback: result.rows });
  } catch (err) {
    console.error("[discFeedback] list error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// GET /api/disc-feedback/tenants/me/accuracy
//
// Tenant-wide accuracy snapshot. Used by 8D dashboard (when shipped).
// Excludes AI self-grade rows from the human-validation rate calc.
//
// Query: ?days=30 (default 30, max 365)
// ─────────────────────────────────────────────────────────────────────────
router.get("/tenants/me/accuracy", async (req, res) => {
  const tenantId = getTenantId(req);
  if (!tenantId) return res.status(401).json({ error: "No tenant in session" });

  const days = Math.min(parseInt(req.query.days, 10) || 30, 365);

  try {
    const result = await db.query(
      `SELECT
         COUNT(*) FILTER (WHERE submitted_by_role IN ('owner','rep'))::int AS human_total,
         COUNT(*) FILTER (WHERE submitted_by_role IN ('owner','rep') AND was_accurate = true)::int AS human_accurate,
         COUNT(*) FILTER (WHERE submitted_by_role IN ('owner','rep') AND was_accurate = false)::int AS human_corrected,
         COUNT(*) FILTER (WHERE submitted_by_role = 'ai')::int AS ai_flagged,
         COUNT(*) FILTER (WHERE submitted_by_role = 'ai' AND analyzed_at IS NULL)::int AS ai_flagged_unreviewed,
         ROUND(
           CASE
             WHEN COUNT(*) FILTER (WHERE submitted_by_role IN ('owner','rep')) > 0
             THEN (COUNT(*) FILTER (WHERE submitted_by_role IN ('owner','rep') AND was_accurate = true)::numeric
                   / COUNT(*) FILTER (WHERE submitted_by_role IN ('owner','rep'))::numeric) * 100
             ELSE NULL
           END,
           1
         ) AS accuracy_pct
       FROM disc_feedback
       WHERE tenant_id = $1
         AND created_at > now() - INTERVAL '${days} days'`,
      [tenantId]
    );

    res.json({
      window_days: days,
      ...result.rows[0],
    });
  } catch (err) {
    console.error("[discFeedback] accuracy error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
