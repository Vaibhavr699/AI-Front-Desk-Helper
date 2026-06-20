"use strict";

// ═══════════════════════════════════════════════════════════════════════════
// /api/call-coach — Phase 6 A3 + B0 + B2 + A6
// Last updated: May 18, 2026 (A6 one-sided handling)
//
// Read API for the Call Coach dashboard surface. Consumes data populated by:
//   - services/coachingScorer.js (cron, every 5 min)
//   - services/coachingRuleExtractor.js (cron, every 5 min)
//   - lib/coachingEngine.js (scoring + persona detection)
//
// A6 (May 18): Filter one-sided / silent / insufficient-customer-speech
// conversations from the dashboard by default. The 26 backfill calls scored
// 5.0-5.3 from pre-Whisper-fix one-sided transcripts polluted the average
// score. Summary aggregations now always exclude rows with
// scoring_skip_reason IS NOT NULL. List endpoint accepts ?hideOneSided
// (default true) so owners see only analyzable calls.
//
// B2 (May 15): rule approval queue. Pending rules from coachingRuleExtractor
// surface inline on CallCoachDetail. Owner approves/rejects/edits before
// rules go live in voice/SMS prompts (B3).
//
// Endpoints:
//   GET    /conversations                            list scored convos
//   GET    /conversations/:id                        full detail
//   GET    /summary                                  aggregate metrics
//   POST   /conversations/:id/feedback               submit owner feedback (B0)
//   GET    /conversations/:id/feedback               list feedback for convo (B0)
//   GET    /conversations/:id/rules                  list rules for convo (B2)
//   POST   /rules/:ruleId/approve                    approve a rule (B2)
//   POST   /rules/:ruleId/reject                     reject a rule (B2)
//   PATCH  /rules/:ruleId                            edit a pending rule (B2)
// ═══════════════════════════════════════════════════════════════════════════

const express = require("express");
const router = express.Router();
const db = require("../lib/db");
const { getSignedRecordingUrl } = require("../services/fieldRecording");
const scorecards = require("../lib/scorecards");

let logAction;
try {
  ({ logAction } = require("../lib/auditLogger"));
} catch (_) {
  logAction = async () => {};
}

const RULE_CATEGORIES = [
  "rapport", "property_walkthrough", "discovery", "education",
  "value_framing", "objection_handling", "close", "professionalism",
  "tone", "scripting", "pricing", "qualification", "other",
];
const RULE_TYPES = ["do", "dont", "when_then"];

function getTenantId(req) {
  const impersonate = req.headers["x-impersonate-tenant-id"];
  if (impersonate && (req.user?.is_super_admin || req.user?.role === "super_admin")) {
    return impersonate;
  }
  return req.user?.tenant_id || null;
}

// ─────────────────────────────────────────────────────────────────────────
// GET /api/call-coach/conversations
//
// A6: hideOneSided query param (default true) excludes rows where the
// transcript was one-sided/silent/insufficient. When explicitly set to
// false ('0' or 'false'), all rows return including the skipped ones —
// owner can review what was filtered out.
// ─────────────────────────────────────────────────────────────────────────
router.get("/conversations", async (req, res) => {
  const tenantId = getTenantId(req);
  if (!tenantId) return res.status(401).json({ error: "No tenant in session" });

  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  const offset = parseInt(req.query.offset, 10) || 0;

  // A6: hideOneSided defaults true. Accept "false" or "0" to disable.
  const hideOneSidedRaw = req.query.hideOneSided;
  const hideOneSided = !(hideOneSidedRaw === "false" || hideOneSidedRaw === "0");

  const filters = ["cc.tenant_id = $1", "cc.scored_at IS NOT NULL"];
  const params = [tenantId];

  if (hideOneSided) {
    // Show only analyzable calls — those without skip reasons.
    // PR 4.1 (May 29, 2026): bypass the skip filter for conversations
    // explicitly flagged as exceptions by smsCoachingScorer's
    // HIGH_SIGNAL_PATTERNS detector. These are 1-message exchanges that
    // contain high-signal customer language (conversion / frustration /
    // soft cancellation) and need to surface for coaching regardless
    // of persona/scoring skip status.
    filters.push(`(
      (cc.persona_skip_reason IS NULL AND cc.scoring_skip_reason IS NULL)
      OR cc.metadata->>'exception_flag' = 'true'
    )`);
  }

  if (req.query.persona)     { params.push(req.query.persona);        filters.push(`cc.buyer_persona = $${params.length}`); }
  if (req.query.source_type) { params.push(req.query.source_type);    filters.push(`cc.source_type = $${params.length}`); }
  // Phase 6E (May 22, 2026) — channel filter for the Voice/SMS toggle.
  // Maps a friendly channel name to the underlying source_type values.
  // Voice spans both inbound + outbound calls; SMS is the single ai_sms
  // value. Left as a separate param from source_type so the existing
  // exact-match filter above is untouched.
  if (req.query.channel === "voice") {
    filters.push(`cc.source_type IN ('ai_call_inbound', 'ai_call_outbound')`);
  } else if (req.query.channel === "sms") {
    filters.push(`cc.source_type = 'ai_sms'`);
  }
  if (req.query.outcome)     { params.push(req.query.outcome);        filters.push(`cc.outcome = $${params.length}`); }
  if (req.query.rep_user_id) { params.push(req.query.rep_user_id);    filters.push(`cc.rep_user_id = $${params.length}`); }
  if (req.query.minScore)    { params.push(parseFloat(req.query.minScore)); filters.push(`cc.overall_score >= $${params.length}`); }
  if (req.query.maxScore)    { params.push(parseFloat(req.query.maxScore)); filters.push(`cc.overall_score <= $${params.length}`); }
  if (req.query.dateFrom)    { params.push(req.query.dateFrom);       filters.push(`cc.scored_at >= $${params.length}`); }
  if (req.query.dateTo)      { params.push(req.query.dateTo);         filters.push(`cc.scored_at <= $${params.length}`); }

  const whereClause = filters.join(" AND ");

  const listSql = `
    SELECT
      cc.id, cc.source_type, cc.source_id, cc.scored_at,
      cc.overall_score, cc.buyer_persona, cc.persona_confidence,
      cc.outcome, cc.outcome_revenue_cents, cc.outcome_recorded_at,
      cc.rep_user_id, cc.industry, cc.metadata,
      cc.persona_skip_reason, cc.scoring_skip_reason, cc.customer_turn_count,
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

  // A6: Also return the count of one-sided calls so the dashboard can show
  // "X calls hidden — show all" affordance when hideOneSided is active.
  // PR 4.1 (May 29, 2026): exception-flagged conversations are visible
  // even with skip reasons set, so they should NOT count toward the
  // "hidden" total — otherwise the banner says "1 hidden" while the
  // exception conversation is right there in the list.
  const hiddenCountSql = `
    SELECT COUNT(*)::int AS hidden_count
    FROM coaching_conversations cc
    WHERE cc.tenant_id = $1
      AND cc.scored_at IS NOT NULL
      AND (cc.persona_skip_reason IS NOT NULL OR cc.scoring_skip_reason IS NOT NULL)
      AND COALESCE(cc.metadata->>'exception_flag', 'false') != 'true'
  `;

  try {
    const listParams = [...params, limit, offset];
    const [listRes, countRes, hiddenRes] = await Promise.all([
      db.query(listSql, listParams),
      db.query(countSql, params),
      db.query(hiddenCountSql, [tenantId]),
    ]);

    res.json({
      conversations: listRes.rows,
      total: countRes.rows[0].total,
      hidden_count: hiddenRes.rows[0].hidden_count,
      hide_one_sided: hideOneSided,
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
//
// A6: Detail includes persona_skip_reason / scoring_skip_reason /
// customer_turn_count so the detail page can render a "Not Analyzable"
// banner instead of empty scores.
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
//
// A6: ALL summary aggregations exclude rows where scoring_skip_reason IS
// NOT NULL. The 26 backfilled 5.0-5.3 scores from one-sided transcripts
// were dragging avg_overall down — they're meaningless data, not legit
// low scores, so they shouldn't pollute the headline metric.
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
  // A6: Always exclude skipped rows from aggregations
  const analyzable = `cc.scoring_skip_reason IS NULL`;

  try {
    const overallSql = `
      SELECT
        ROUND(AVG(cc.overall_score)::numeric, 1) AS avg_overall,
        COUNT(*)::int AS scored_count,
        SUM(CASE WHEN cc.outcome = 'booked' THEN 1 ELSE 0 END)::int AS booked_count
      FROM coaching_conversations cc
      WHERE cc.tenant_id = $1
        AND cc.scored_at IS NOT NULL
        AND ${analyzable}
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
        AND ${analyzable}
        AND ${windowFilter}
        ${repFilter}
      GROUP BY cs.dimension ORDER BY cs.dimension
    `;
    const personaSql = `
      SELECT cc.buyer_persona, COUNT(*)::int AS count
      FROM coaching_conversations cc
      WHERE cc.tenant_id = $1
        AND cc.scored_at IS NOT NULL
        AND cc.persona_skip_reason IS NULL
        AND ${windowFilter}
        AND cc.buyer_persona IS NOT NULL
        ${repFilter}
      GROUP BY cc.buyer_persona ORDER BY count DESC
    `;
    const trendSql = `
      SELECT date_trunc('day', cc.scored_at)::date AS day,
             ROUND(AVG(cc.overall_score)::numeric, 1) AS avg_score,
             COUNT(*)::int AS count
      FROM coaching_conversations cc
      WHERE cc.tenant_id = $1
        AND cc.scored_at IS NOT NULL
        AND ${analyzable}
        AND ${windowFilter}
        ${repFilter}
      GROUP BY day ORDER BY day ASC
    `;
    // A6: surface count of hidden (skipped) calls in window so dashboard
    // can show "X calls couldn't be analyzed — review" affordance.
    const hiddenSql = `
      SELECT COUNT(*)::int AS hidden_count
      FROM coaching_conversations cc
      WHERE cc.tenant_id = $1
        AND cc.scored_at IS NOT NULL
        AND cc.scoring_skip_reason IS NOT NULL
        AND ${windowFilter}
        ${repFilter}
    `;

    const [overall, dimensions, personas, trend, hidden] = await Promise.all([
      db.query(overallSql, params),
      db.query(dimSql, params),
      db.query(personaSql, params),
      db.query(trendSql, params),
      db.query(hiddenSql, params),
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
      hidden_count: hidden.rows[0].hidden_count,
    });
  } catch (err) {
    console.error("[callCoach] summary error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// GET /api/call-coach/team-analytics
// Cross-rep comparison: per-rep avg score + cue-type counts (incl missing_close),
// plus a team-wide daily trend. Owner/admin only.
// ─────────────────────────────────────────────────────────────────────────
router.get("/team-analytics", async (req, res) => {
  const tenantId = getTenantId(req);
  if (!tenantId) return res.status(401).json({ error: "No tenant in session" });
  if (!["owner", "admin"].includes(req.user?.role)) {
    return res.status(403).json({ error: "Owner or admin only" });
  }

  const days = Math.min(parseInt(req.query.days, 10) || 30, 365);

  try {
    const perRepScoreSql = `
      SELECT u.id AS rep_user_id,
             u.email AS rep_email,
             ROUND(AVG(cc.overall_score)::numeric, 1) AS avg_score,
             COUNT(*)::int AS scored_count
      FROM coaching_conversations cc
      JOIN dashboard_users u ON u.id = cc.rep_user_id
      WHERE cc.tenant_id = $1
        AND cc.rep_user_id IS NOT NULL
        AND cc.scored_at IS NOT NULL
        AND cc.scoring_skip_reason IS NULL
        AND cc.scored_at > now() - INTERVAL '${days} days'
      GROUP BY u.id, u.email
      ORDER BY avg_score DESC NULLS LAST
    `;
    const perRepCueSql = `
      SELECT s.user_id AS rep_user_id,
             COALESCE(a.cue_type, a.alert_type) AS cue_type,
             COUNT(*)::int AS count
      FROM in_home_alerts a
      JOIN in_home_sessions s ON s.id = a.session_id
      WHERE s.tenant_id = $1
        AND s.user_id IS NOT NULL
        AND a.fired_at > now() - INTERVAL '${days} days'
        AND COALESCE(a.cue_type, a.alert_type) IS NOT NULL
      GROUP BY s.user_id, COALESCE(a.cue_type, a.alert_type)
    `;
    const trendSql = `
      SELECT date_trunc('day', cc.scored_at)::date AS day,
             ROUND(AVG(cc.overall_score)::numeric, 1) AS avg_score,
             COUNT(*)::int AS count
      FROM coaching_conversations cc
      WHERE cc.tenant_id = $1
        AND cc.scored_at IS NOT NULL
        AND cc.scoring_skip_reason IS NULL
        AND cc.scored_at > now() - INTERVAL '${days} days'
      GROUP BY day ORDER BY day ASC
    `;

    const [scores, cues, trend] = await Promise.all([
      db.query(perRepScoreSql, [tenantId]),
      db.query(perRepCueSql, [tenantId]),
      db.query(trendSql, [tenantId]),
    ]);

    const repsById = new Map();
    for (const row of scores.rows) {
      repsById.set(row.rep_user_id, {
        rep_user_id: row.rep_user_id,
        rep_email: row.rep_email,
        avg_score: row.avg_score != null ? Number(row.avg_score) : null,
        scored_count: row.scored_count,
        cues: {},
        total_cues: 0,
      });
    }
    for (const row of cues.rows) {
      let rep = repsById.get(row.rep_user_id);
      if (!rep) {
        rep = {
          rep_user_id: row.rep_user_id,
          rep_email: null,
          avg_score: null,
          scored_count: 0,
          cues: {},
          total_cues: 0,
        };
        repsById.set(row.rep_user_id, rep);
      }
      rep.cues[row.cue_type] = row.count;
      rep.total_cues += row.count;
    }

    res.json({
      window_days: days,
      reps: Array.from(repsById.values()),
      trend: trend.rows.map((t) => ({
        day: t.day,
        avg_score: t.avg_score != null ? Number(t.avg_score) : null,
        count: t.count,
      })),
    });
  } catch (err) {
    console.error("[callCoach] team-analytics error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// POST /api/call-coach/conversations/:id/feedback   (B0)
// ─────────────────────────────────────────────────────────────────────────
router.post("/conversations/:id/feedback", async (req, res) => {
  const tenantId = getTenantId(req);
  if (!tenantId) return res.status(401).json({ error: "No tenant in session" });

  const userId = req.user?.id || null;
  const conversationId = req.params.id;

  const whatWentRight = typeof req.body?.what_went_right === "string"
    ? req.body.what_went_right.trim().slice(0, 2000) : null;
  const whatToImprove = typeof req.body?.what_to_improve === "string"
    ? req.body.what_to_improve.trim().slice(0, 2000) : null;
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

    Promise.resolve(
      logAction({
        tenant_id: tenantId,
        user_id: userId,
        action: "coaching_feedback_submitted",
        resource_type: "coaching_feedback",
        resource_id: feedback.id,
        metadata: { conversation_id: conversationId, has_right: hasRight, has_improve: hasImprove, rating: overallRating },
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
// ─────────────────────────────────────────────────────────────────────────
router.get("/conversations/:id/feedback", async (req, res) => {
  const tenantId = getTenantId(req);
  if (!tenantId) return res.status(401).json({ error: "No tenant in session" });

  try {
    const result = await db.query(
      `SELECT
         cf.id, cf.conversation_id, cf.what_went_right, cf.what_to_improve,
         cf.overall_rating, cf.rules_extracted_at, cf.created_at,
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

// ─────────────────────────────────────────────────────────────────────────
// GET /api/call-coach/conversations/:id/rules   (B2)
//
// Returns ALL coaching_rules for this conversation regardless of status,
// so the UI can show pending vs approved vs rejected counts. Default UI
// only displays pending_approval — frontend filters client-side.
// ─────────────────────────────────────────────────────────────────────────
router.get("/conversations/:id/rules", async (req, res) => {
  const tenantId = getTenantId(req);
  if (!tenantId) return res.status(401).json({ error: "No tenant in session" });

  try {
    const result = await db.query(
      `SELECT cr.*,
              approver.email AS approved_by_email
       FROM coaching_rules cr
       LEFT JOIN dashboard_users approver ON approver.id = cr.approved_by_user_id
       WHERE cr.source_conversation_id = $1 AND cr.tenant_id = $2
       ORDER BY cr.created_at DESC`,
      [req.params.id, tenantId]
    );

    res.json({ rules: result.rows });
  } catch (err) {
    console.error("[callCoach] rules list error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// POST /api/call-coach/rules/:ruleId/approve   (B2)
//
// Sets status='approved', stamps approved_at + approved_by_user_id.
// Idempotent: re-approving an approved rule is a no-op. Rejected rules
// CAN be re-approved (think: "I changed my mind").
// ─────────────────────────────────────────────────────────────────────────
router.post("/rules/:ruleId/approve", async (req, res) => {
  const tenantId = getTenantId(req);
  if (!tenantId) return res.status(401).json({ error: "No tenant in session" });

  const userId = req.user?.id || null;

  try {
    const result = await db.query(
      `UPDATE coaching_rules
       SET status = 'approved',
           approved_at = now(),
           approved_by_user_id = $3,
           rejected_at = NULL,
           rejected_reason = NULL
       WHERE id = $1 AND tenant_id = $2
       RETURNING *`,
      [req.params.ruleId, tenantId, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Rule not found" });
    }

    const rule = result.rows[0];
    Promise.resolve(
      logAction({
        tenant_id: tenantId, user_id: userId,
        action: "coaching_rule_approved",
        resource_type: "coaching_rules", resource_id: rule.id,
        metadata: { category: rule.category, rule_type: rule.rule_type },
      })
    ).catch((err) => console.warn("[callCoach] audit log failed:", err.message));

    res.json({ rule });
  } catch (err) {
    console.error("[callCoach] rule approve error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// POST /api/call-coach/rules/:ruleId/reject   (B2)
// Body: { reason? } — optional rejection reason
// ─────────────────────────────────────────────────────────────────────────
router.post("/rules/:ruleId/reject", async (req, res) => {
  const tenantId = getTenantId(req);
  if (!tenantId) return res.status(401).json({ error: "No tenant in session" });

  const userId = req.user?.id || null;
  const reason = typeof req.body?.reason === "string"
    ? req.body.reason.trim().slice(0, 500) || null
    : null;

  try {
    const result = await db.query(
      `UPDATE coaching_rules
       SET status = 'rejected',
           rejected_at = now(),
           rejected_reason = $3
       WHERE id = $1 AND tenant_id = $2
       RETURNING *`,
      [req.params.ruleId, tenantId, reason]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Rule not found" });
    }

    const rule = result.rows[0];
    Promise.resolve(
      logAction({
        tenant_id: tenantId, user_id: userId,
        action: "coaching_rule_rejected",
        resource_type: "coaching_rules", resource_id: rule.id,
        metadata: { category: rule.category, rule_type: rule.rule_type, reason },
      })
    ).catch((err) => console.warn("[callCoach] audit log failed:", err.message));

    res.json({ rule });
  } catch (err) {
    console.error("[callCoach] rule reject error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// PATCH /api/call-coach/rules/:ruleId   (B2)
//
// Edit a rule's content. Only allowed when status = 'pending_approval' —
// approved/rejected rules are frozen.
// Body: { rule_text?, rationale?, category?, rule_type?, example_quote? }
// ─────────────────────────────────────────────────────────────────────────
router.patch("/rules/:ruleId", async (req, res) => {
  const tenantId = getTenantId(req);
  if (!tenantId) return res.status(401).json({ error: "No tenant in session" });

  const userId = req.user?.id || null;
  const updates = {};

  if (typeof req.body?.rule_text === "string") {
    const t = req.body.rule_text.trim();
    if (t.length === 0) return res.status(400).json({ error: "rule_text cannot be empty" });
    updates.rule_text = t.slice(0, 1000);
  }
  if (typeof req.body?.rationale === "string") {
    updates.rationale = req.body.rationale.trim().slice(0, 1000);
  }
  if (req.body?.category !== undefined) {
    if (!RULE_CATEGORIES.includes(req.body.category)) {
      return res.status(400).json({ error: `category must be one of: ${RULE_CATEGORIES.join(", ")}` });
    }
    updates.category = req.body.category;
  }
  if (req.body?.rule_type !== undefined) {
    if (!RULE_TYPES.includes(req.body.rule_type)) {
      return res.status(400).json({ error: `rule_type must be one of: ${RULE_TYPES.join(", ")}` });
    }
    updates.rule_type = req.body.rule_type;
  }
  if (req.body?.example_quote !== undefined) {
    if (req.body.example_quote === null || req.body.example_quote === "") {
      updates.example_quote = null;
    } else if (typeof req.body.example_quote === "string") {
      updates.example_quote = req.body.example_quote.trim().slice(0, 500) || null;
    }
  }

  const keys = Object.keys(updates);
  if (keys.length === 0) {
    return res.status(400).json({ error: "No editable fields provided" });
  }

  // Verify rule is pending + belongs to tenant
  const existing = await db.query(
    "SELECT id, status FROM coaching_rules WHERE id = $1 AND tenant_id = $2 LIMIT 1",
    [req.params.ruleId, tenantId]
  );
  if (existing.rows.length === 0) {
    return res.status(404).json({ error: "Rule not found" });
  }
  if (existing.rows[0].status !== "pending_approval") {
    return res.status(400).json({
      error: `Cannot edit a rule with status '${existing.rows[0].status}'. Only pending rules are editable.`,
    });
  }

  const setClauses = keys.map((k, i) => `${k} = $${i + 3}`).join(", ");
  const values = keys.map((k) => updates[k]);

  try {
    const result = await db.query(
      `UPDATE coaching_rules
       SET ${setClauses}
       WHERE id = $1 AND tenant_id = $2 AND status = 'pending_approval'
       RETURNING *`,
      [req.params.ruleId, tenantId, ...values]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Rule not found or no longer editable" });
    }

    const rule = result.rows[0];
    Promise.resolve(
      logAction({
        tenant_id: tenantId, user_id: userId,
        action: "coaching_rule_edited",
        resource_type: "coaching_rules", resource_id: rule.id,
        metadata: { fields: keys },
      })
    ).catch((err) => console.warn("[callCoach] audit log failed:", err.message));

    res.json({ rule });
  } catch (err) {
    console.error("[callCoach] rule edit error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get("/in-home/sessions", async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(401).json({ error: "No tenant" });

    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const offset = parseInt(req.query.offset, 10) || 0;
    const days = parseInt(req.query.days, 10) || 30;

    const r = await db.query(
      `SELECT s.id, s.user_id, s.lead_id, s.started_at, s.ended_at,
              s.outcome, s.estimate_value_cents, s.total_cues_fired,
              s.consent_state, s.rep_satisfaction,
              u.email AS rep_email,
              l.customer_name AS lead_name,
              (SELECT count(*) FROM in_home_alerts a WHERE a.session_id = s.id) AS alert_count
         FROM in_home_sessions s
         LEFT JOIN dashboard_users u ON u.id = s.user_id
         LEFT JOIN leads l ON l.id = s.lead_id
        WHERE s.tenant_id = $1
          AND s.started_at >= now() - ($4 || ' days')::interval
        ORDER BY s.started_at DESC
        LIMIT $2 OFFSET $3`,
      [tenantId, limit, offset, days],
    );

    res.json({ sessions: r.rows });
  } catch (err) {
    console.error("[callCoach] in-home sessions error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get("/in-home/sessions/:id", async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(401).json({ error: "No tenant" });

    const [sessionR, alertsR, commentsR] = await Promise.all([
      db.query(
        `SELECT s.*, u.email AS rep_email, l.customer_name AS lead_name
           FROM in_home_sessions s
           LEFT JOIN dashboard_users u ON u.id = s.user_id
           LEFT JOIN leads l ON l.id = s.lead_id
          WHERE s.id = $1 AND s.tenant_id = $2`,
        [req.params.id, tenantId],
      ),
      db.query(
        `SELECT id, alert_type, alert_content, alert_urgency, cue_type,
                watch_label, fired_at, window_start, window_end,
                transcript_window, dismissed_at, payload
           FROM in_home_alerts
          WHERE session_id = $1
          ORDER BY fired_at ASC`,
        [req.params.id],
      ),
      db.query(
        `SELECT c.id, c.turn_index, c.flag, c.text, c.created_at,
                c.manager_id, u.email AS manager_email,
                COALESCE(NULLIF(u.full_name, ''), split_part(u.email, '@', 1)) AS manager_name
           FROM session_comments c
           LEFT JOIN dashboard_users u ON u.id = c.manager_id
          WHERE c.session_id = $1 AND c.tenant_id = $2
          ORDER BY c.turn_index ASC, c.created_at ASC`,
        [req.params.id, tenantId],
      ),
    ]);

    const session = sessionR.rows[0];
    if (!session) return res.status(404).json({ error: "Session not found" });

    let recording = null;
    if (session.coaching_conversation_id) {
      const convR = await db.query(
        `SELECT id, metadata, transcript
           FROM coaching_conversations
          WHERE id = $1 AND tenant_id = $2`,
        [session.coaching_conversation_id, tenantId],
      );
      const convo = convR.rows[0];
      if (convo) {
        const s3Key = convo.metadata?.s3_key || null;
        const url = s3Key ? await getSignedRecordingUrl(s3Key) : null;
        recording = { conversation_id: convo.id, url };
      }
    }

    res.json({ session, alerts: alertsR.rows, recording, comments: commentsR.rows });
  } catch (err) {
    console.error("[callCoach] in-home session detail error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post("/in-home/sessions/:id/comments", async (req, res) => {
  const tenantId = getTenantId(req);
  if (!tenantId) return res.status(401).json({ error: "No tenant" });
  if (!["owner", "admin"].includes(req.user?.role)) {
    return res.status(403).json({ error: "Owner or admin only" });
  }
  try {
    const turnIndex = Number(req.body?.turn_index);
    const flag = req.body?.flag;
    const text = typeof req.body?.text === "string" ? req.body.text.trim() : null;

    if (!Number.isInteger(turnIndex) || turnIndex < 0) {
      return res.status(400).json({ error: "turn_index must be a non-negative integer" });
    }
    if (!["good", "improve"].includes(flag)) {
      return res.status(400).json({ error: "flag must be 'good' or 'improve'" });
    }
    if (text && text.length > 2000) {
      return res.status(400).json({ error: "text must be 2000 characters or fewer" });
    }

    const sessionR = await db.query(
      `SELECT id FROM in_home_sessions WHERE id = $1 AND tenant_id = $2`,
      [req.params.id, tenantId],
    );
    if (!sessionR.rows[0]) return res.status(404).json({ error: "Session not found" });

    // Resolve the manager's display name from the DB (the JWT carries email but
    // not full_name), using the same fallback as the GET query so the optimistic
    // comment matches what a later refresh shows.
    const r = await db.query(
      `WITH inserted AS (
         INSERT INTO session_comments (session_id, tenant_id, manager_id, turn_index, flag, text)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, turn_index, flag, text, created_at, manager_id
       )
       SELECT i.id, i.turn_index, i.flag, i.text, i.created_at, i.manager_id,
              u.email AS manager_email,
              COALESCE(NULLIF(u.full_name, ''), split_part(u.email, '@', 1)) AS manager_name
         FROM inserted i
         LEFT JOIN dashboard_users u ON u.id = i.manager_id`,
      [req.params.id, tenantId, req.user?.id || null, turnIndex, flag, text || null],
    );
    res.status(201).json({ comment: r.rows[0] });
  } catch (err) {
    console.error("[callCoach] create comment error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.delete("/in-home/sessions/:id/comments/:commentId", async (req, res) => {
  const tenantId = getTenantId(req);
  if (!tenantId) return res.status(401).json({ error: "No tenant" });
  if (!["owner", "admin"].includes(req.user?.role)) {
    return res.status(403).json({ error: "Owner or admin only" });
  }
  try {
    const r = await db.query(
      `DELETE FROM session_comments
        WHERE id = $1 AND session_id = $2 AND tenant_id = $3
        RETURNING id`,
      [req.params.commentId, req.params.id, tenantId],
    );
    if (!r.rows[0]) return res.status(404).json({ error: "Comment not found" });
    res.json({ ok: true, id: r.rows[0].id });
  } catch (err) {
    console.error("[callCoach] delete comment error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// Scorecard config — tenant-customizable in-home walkthrough stages.
// GET  /api/call-coach/scorecard/walkthrough   (any dashboard user)
// PATCH /api/call-coach/scorecard/walkthrough  (owner/admin only)
// ─────────────────────────────────────────────────────────────────────────
router.get("/scorecard/walkthrough", async (req, res) => {
  const tenantId = getTenantId(req);
  if (!tenantId) return res.status(401).json({ error: "No tenant" });
  try {
    const walkthrough = await scorecards.getWalkthrough(tenantId);
    res.json({ walkthrough });
  } catch (err) {
    console.error("[callCoach] get walkthrough error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.patch("/scorecard/walkthrough", async (req, res) => {
  const tenantId = getTenantId(req);
  if (!tenantId) return res.status(401).json({ error: "No tenant" });
  if (!["owner", "admin"].includes(req.user?.role)) {
    return res.status(403).json({ error: "Owner or admin only" });
  }
  try {
    const walkthrough = await scorecards.setWalkthrough(
      tenantId,
      req.body?.walkthrough,
      req.user?.id || null,
    );
    res.json({ walkthrough });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get("/scorecard/cue-emphasis", async (req, res) => {
  const tenantId = getTenantId(req);
  if (!tenantId) return res.status(401).json({ error: "No tenant" });
  try {
    const cue_emphasis = await scorecards.getCueEmphasis(tenantId);
    res.json({ cue_emphasis });
  } catch (err) {
    console.error("[callCoach] get cue-emphasis error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.patch("/scorecard/cue-emphasis", async (req, res) => {
  const tenantId = getTenantId(req);
  if (!tenantId) return res.status(401).json({ error: "No tenant" });
  if (!["owner", "admin"].includes(req.user?.role)) {
    return res.status(403).json({ error: "Owner or admin only" });
  }
  try {
    const cue_emphasis = await scorecards.setCueEmphasis(
      tenantId,
      req.body?.cue_emphasis,
      req.user?.id || null,
    );
    res.json({ cue_emphasis });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get("/scorecard/dimensions", async (req, res) => {
  const tenantId = getTenantId(req);
  if (!tenantId) return res.status(401).json({ error: "No tenant" });
  try {
    const dimensions = await scorecards.getScoringDimensions(tenantId);
    res.json({ dimensions });
  } catch (err) {
    console.error("[callCoach] get dimensions error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.patch("/scorecard/dimensions", async (req, res) => {
  const tenantId = getTenantId(req);
  if (!tenantId) return res.status(401).json({ error: "No tenant" });
  if (!["owner", "admin"].includes(req.user?.role)) {
    return res.status(403).json({ error: "Owner or admin only" });
  }
  try {
    const dimensions = await scorecards.setScoringDimensions(
      tenantId,
      req.body?.dimensions,
      req.user?.id || null,
    );
    res.json({ dimensions });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
