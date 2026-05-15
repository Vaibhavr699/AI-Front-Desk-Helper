"use strict";

// ═══════════════════════════════════════════════════════════════════════════
// /api/call-coach — Phase 6 A3 + B0 (May 15, 2026)
//
// Read API for the Call Coach dashboard surface. Consumes data populated by:
//   - services/coachingScorer.js (cron, every 5 min)
//   - lib/coachingEngine.js (scoring + persona detection)
//
// B0 (May 15): owner feedback intake. POST/GET endpoints write to
// coaching_feedback (mig 069). The B1 extractor cron will then turn pending
// feedback into coaching_rules.
//
// Mounted in server.js with authMiddleware. All endpoints are tenant-scoped
// via req.user.tenant_id. Superadmin impersonation honored via
// x-impersonate-tenant-id header.
//
// Endpoints:
//   GET  /conversations                     — list scored conversations
//   GET  /conversations/:id                 — full detail
//   GET  /summary                           — aggregate metrics
//   POST /conversations/:id/feedback        — submit owner feedback (B0)
//   GET  /conversations/:id/feedback        — list feedback for one convo (B0)
// ═══════════════════════════════════════════════════════════════════════════

const express = require("express");
const router = express.Router();
const db = require("../lib/db");

// Audit logger — defensive import. If lib/auditLogger doesn't expose
// logAction with the expected signature, we'll fail open (skip audit
// instead of blocking the request).
let logAction;
try {
  ({ logAction } = require("../lib/auditLogger"));
} catch (_) {
  logAction = async () => {}; // no-op fallback
}

function getTenantId(req) {
  const impersonate = req.headers["x-impersonate-tenant-id"];
  if (impersonate && (req.user?.is_super_admin || req.user?.role === "super_admin")) {
    return impersonate;
  }
  return req.user?.tenant_id || null;
}

// ─────────────────────────────────────────────────────────────────────────
// GET /api/call-coach/conversations
// ─────────────────────────────────────────────────────────────────────────
router.get("/conversations", async (req, res) => {
  const tenantId = getTenantId(req);
  if (!tenantId) return res.status(401).json({ error: "No tenant in session" });

  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  const offset = parseInt(req.query.offset, 10) || 0;

  const filters = ["cc.tenant_id = $1", "cc.scored_at IS NOT NULL"];
  const params = [tenantId];

  if (req.query.persona)     { params.push(req.query.persona);        filters.push(`cc.buyer_persona = $${params.length}`); }
  if (req.query.source_type) { params.push(req.query.source_type);    filters.push(`cc.source_type = $${params.length}`); }
  if (req.query.outcome)     { params.push(req.query.outcome);        filters.push(`cc.outcome = $${params.length}`); }
  if (req.query.rep_user_id) { params.push(req.query.rep_user_id);    filters.push(`cc.rep_user_id = $${params.length}`); }
  if (req.query.minScore)    { params.push(parseFloat(req.query.minScore)); filters.push(`cc.overall_score >= $${params.length}`); }
  if (req.query.maxScore)    { params.push(parseFloat(req.query.maxScore)); filters.push(`cc.overall_score <= $${params.length}`); }
  if (req.query.dateFrom)    { params.push(req.query.dateFrom);       filters.push(`cc.scored_at >= $${params.length}`); }
  if (req.query.dateTo)      { params.push(req.query.dateTo);         filters.push(`cc.scored_at <= $${params.length}`); }

  const whereClause = filters.join(" AND ");

  const listSql = `
    SELECT
      cc.id,
      cc.source_type,
      cc.source_id,
      cc.scored_at,
      cc.overall_score,
      cc.buyer_persona,
      cc.persona_confidence,
      cc.outcome,
      cc.outcome_revenue_cents,
      cc.outcome_recorded_at,
      cc.rep_user_id,
      cc.industry,
      cc.metadata,
      du.email AS rep_name
    FROM coaching_conversations cc
    LEFT JOIN dashboard_users du ON du.id = cc.rep_user_id
    WHERE ${whereClause}
    ORDER BY cc.scored_at DESC NULLS LAST
    LIMIT $${params.length + 1} OFFSET $${params.length + 2}
  `;

  const countSql = `
    SELECT COUNT(*)::int AS total
    FROM coaching_conversations cc
    WHERE ${whereClause}
  `;

  try {
    const listParams = [...params, limit, offset];
    const [listRes, countRes] = await Promise.all([
      db.query(listSql, listParams),
      db.query(countSql, params),
    ]);

    res.json({
      conversations: listRes.rows,
      total: countRes.rows[0].total,
      limit,
      offset,
    });
  } catch (err) {
    console.error("[callCoach] list error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// GET /api/call-coach/conversations/:id
// ─────────────────────────────────────────────────────────────────────────
router.get("/conversations/:id", async (req, res) => {
  const tenantId = getTenantId(req);
  if (!tenantId) return res.status(401).json({ error: "No tenant in session" });

  try {
    const convoRes = await db.query(
      `SELECT
         cc.*,
         du.email AS rep_name,
         du.email AS rep_email
       FROM coaching_conversations cc
       LEFT JOIN dashboard_users du ON du.id = cc.rep_user_id
       WHERE cc.id = $1 AND cc.tenant_id = $2
       LIMIT 1`,
      [req.params.id, tenantId]
    );

    if (convoRes.rows.length === 0) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    const convo = convoRes.rows[0];

    const scoresRes = await db.query(
      `SELECT dimension, score, rationale, evidence
       FROM coaching_scores
       WHERE conversation_id = $1
       ORDER BY
         CASE dimension
           WHEN 'rapport' THEN 1
           WHEN 'property_walkthrough' THEN 2
           WHEN 'discovery' THEN 3
           WHEN 'education' THEN 4
           WHEN 'value_framing' THEN 5
           WHEN 'objection_handling' THEN 6
           WHEN 'close' THEN 7
           WHEN 'professionalism' THEN 8
           ELSE 99
         END`,
      [req.params.id]
    );

    let callMeta = null;
    if (convo.source_type === "ai_call_inbound" || convo.source_type === "ai_call_outbound") {
      const callRes = await db.query(
        `SELECT id, twilio_call_sid, from_number, to_number,
                started_at, ended_at, duration_minutes,
                direction, status, disposition, lead_id
         FROM calls
         WHERE twilio_call_sid = $1 AND tenant_id = $2
         LIMIT 1`,
        [convo.source_id, tenantId]
      );
      callMeta = callRes.rows[0] || null;

      if (callMeta?.lead_id) {
        const leadRes = await db.query(
          "SELECT id, name, phone, email FROM leads WHERE id = $1 AND tenant_id = $2 LIMIT 1",
          [callMeta.lead_id, tenantId]
        );
        callMeta.lead = leadRes.rows[0] || null;
      }
    }

    res.json({
      conversation: convo,
      scores: scoresRes.rows,
      call: callMeta,
    });
  } catch (err) {
    console.error("[callCoach] detail error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// GET /api/call-coach/summary
// ─────────────────────────────────────────────────────────────────────────
router.get("/summary", async (req, res) => {
  const tenantId = getTenantId(req);
  if (!tenantId) return res.status(401).json({ error: "No tenant in session" });

  const days = Math.min(parseInt(req.query.days, 10) || 30, 365);
  const repUserId = req.query.rep_user_id || null;

  const params = [tenantId];
  let repFilter = "";
  if (repUserId) {
    params.push(repUserId);
    repFilter = `AND cc.rep_user_id = $${params.length}`;
  }

  const windowFilter = `cc.scored_at > now() - INTERVAL '${days} days'`;

  try {
    const overallSql = `
      SELECT
        ROUND(AVG(cc.overall_score)::numeric, 1) AS avg_overall,
        COUNT(*)::int AS scored_count,
        SUM(CASE WHEN cc.outcome = 'booked' THEN 1 ELSE 0 END)::int AS booked_count
      FROM coaching_conversations cc
      WHERE cc.tenant_id = $1
        AND cc.scored_at IS NOT NULL
        AND ${windowFilter}
        ${repFilter}
    `;

    const dimSql = `
      SELECT cs.dimension,
             ROUND(AVG(cs.score)::numeric, 1) AS avg_score,
             COUNT(*)::int AS count
      FROM coaching_scores cs
      JOIN coaching_conversations cc ON cc.id = cs.conversation_id
      WHERE cc.tenant_id = $1
        AND cc.scored_at IS NOT NULL
        AND ${windowFilter}
        ${repFilter}
      GROUP BY cs.dimension
      ORDER BY cs.dimension
    `;

    const personaSql = `
      SELECT cc.buyer_persona, COUNT(*)::int AS count
      FROM coaching_conversations cc
      WHERE cc.tenant_id = $1
        AND cc.scored_at IS NOT NULL
        AND ${windowFilter}
        AND cc.buyer_persona IS NOT NULL
        ${repFilter}
      GROUP BY cc.buyer_persona
      ORDER BY count DESC
    `;

    const trendSql = `
      SELECT
        date_trunc('day', cc.scored_at)::date AS day,
        ROUND(AVG(cc.overall_score)::numeric, 1) AS avg_score,
        COUNT(*)::int AS count
      FROM coaching_conversations cc
      WHERE cc.tenant_id = $1
        AND cc.scored_at IS NOT NULL
        AND ${windowFilter}
        ${repFilter}
      GROUP BY day
      ORDER BY day ASC
    `;

    const [overall, dimensions, personas, trend] = await Promise.all([
      db.query(overallSql, params),
      db.query(dimSql, params),
      db.query(personaSql, params),
      db.query(trendSql, params),
    ]);

    let topWeakness = null;
    if (dimensions.rows.length > 0) {
      topWeakness = dimensions.rows
        .filter((d) => d.avg_score != null)
        .sort((a, b) => parseFloat(a.avg_score) - parseFloat(b.avg_score))[0] || null;
    }

    res.json({
      window_days: days,
      overall: overall.rows[0],
      dimensions: dimensions.rows,
      personas: personas.rows,
      trend: trend.rows,
      top_weakness: topWeakness,
    });
  } catch (err) {
    console.error("[callCoach] summary error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// POST /api/call-coach/conversations/:id/feedback   (B0, May 15, 2026)
//
// Owner-supplied feedback on a scored conversation. Writes to
// coaching_feedback (mig 069). The B1 extractor cron picks up rows where
// rules_extracted_at IS NULL and runs them through GPT-4o to produce
// coaching_rules.
//
// Body shape:
//   { what_went_right?, what_to_improve?, overall_rating? (1-5) }
//
// Validation: at least one of the three must be present + meaningful.
// "Meaningful" = non-empty after trim for text fields, or rating in 1..5.
// ─────────────────────────────────────────────────────────────────────────
router.post("/conversations/:id/feedback", async (req, res) => {
  const tenantId = getTenantId(req);
  if (!tenantId) return res.status(401).json({ error: "No tenant in session" });

  const userId = req.user?.id || null;
  const conversationId = req.params.id;

  // Normalize input
  const whatWentRight  = typeof req.body?.what_went_right === "string"
                           ? req.body.what_went_right.trim().slice(0, 2000)
                           : null;
  const whatToImprove  = typeof req.body?.what_to_improve === "string"
                           ? req.body.what_to_improve.trim().slice(0, 2000)
                           : null;
  let overallRating = req.body?.overall_rating;
  if (overallRating !== null && overallRating !== undefined && overallRating !== "") {
    overallRating = parseInt(overallRating, 10);
    if (!Number.isFinite(overallRating) || overallRating < 1 || overallRating > 5) {
      return res.status(400).json({ error: "overall_rating must be an integer 1–5 or null" });
    }
  } else {
    overallRating = null;
  }

  const hasRight   = !!(whatWentRight && whatWentRight.length > 0);
  const hasImprove = !!(whatToImprove && whatToImprove.length > 0);
  const hasRating  = overallRating !== null;

  if (!hasRight && !hasImprove && !hasRating) {
    return res.status(400).json({
      error: "Provide at least one of: what_went_right, what_to_improve, overall_rating",
    });
  }

  try {
    // Verify conversation belongs to tenant — never leak existence cross-tenant
    const convoCheck = await db.query(
      "SELECT id FROM coaching_conversations WHERE id = $1 AND tenant_id = $2 LIMIT 1",
      [conversationId, tenantId]
    );
    if (convoCheck.rows.length === 0) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    const insertRes = await db.query(
      `INSERT INTO coaching_feedback
         (conversation_id, tenant_id, submitted_by_user_id,
          what_went_right, what_to_improve, overall_rating)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [conversationId, tenantId, userId, whatWentRight, whatToImprove, overallRating]
    );

    const feedback = insertRes.rows[0];

    // Audit (non-blocking — feedback already persisted)
    Promise.resolve(
      logAction({
        tenant_id: tenantId,
        user_id: userId,
        action: "coaching_feedback_submitted",
        resource_type: "coaching_feedback",
        resource_id: feedback.id,
        metadata: {
          conversation_id: conversationId,
          has_right: hasRight,
          has_improve: hasImprove,
          rating: overallRating,
        },
      })
    ).catch((err) => console.warn("[callCoach] audit log failed:", err.message));

    res.status(201).json({
      feedback,
      message: "Feedback captured. Rules will be extracted within ~5 minutes.",
    });
  } catch (err) {
    console.error("[callCoach] feedback submit error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// GET /api/call-coach/conversations/:id/feedback   (B0)
//
// Returns all feedback rows for one conversation, newest first, with author
// email + count of extracted rules (LEFT JOIN coaching_rules.source_feedback_id).
// ─────────────────────────────────────────────────────────────────────────
router.get("/conversations/:id/feedback", async (req, res) => {
  const tenantId = getTenantId(req);
  if (!tenantId) return res.status(401).json({ error: "No tenant in session" });

  try {
    const result = await db.query(
      `SELECT
         cf.id,
         cf.conversation_id,
         cf.what_went_right,
         cf.what_to_improve,
         cf.overall_rating,
         cf.rules_extracted_at,
         cf.created_at,
         cf.submitted_by_user_id,
         du.email AS submitted_by_email,
         COUNT(cr.id) FILTER (WHERE cr.id IS NOT NULL)::int AS extracted_rule_count
       FROM coaching_feedback cf
       LEFT JOIN dashboard_users du ON du.id = cf.submitted_by_user_id
       LEFT JOIN coaching_rules cr ON cr.source_feedback_id = cf.id
       WHERE cf.conversation_id = $1 AND cf.tenant_id = $2
       GROUP BY cf.id, du.email
       ORDER BY cf.created_at DESC`,
      [req.params.id, tenantId]
    );

    res.json({ feedback: result.rows });
  } catch (err) {
    console.error("[callCoach] feedback list error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
