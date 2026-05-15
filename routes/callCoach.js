"use strict";

// ═══════════════════════════════════════════════════════════════════════════
// /api/call-coach — Phase 6 A3 (May 15, 2026)
//
// Read API for the Call Coach dashboard surface. Consumes data populated by:
//   - services/coachingScorer.js (cron, every 5 min)
//   - lib/coachingEngine.js (scoring + persona detection)
//
// Mounted in server.js with authMiddleware. All endpoints are tenant-scoped
// via req.user.tenant_id. No write endpoints — A3 is read-only. Rescoring
// and rule extraction land in Phase 6 B.
//
// Endpoints:
//   GET /conversations              — list scored conversations (paginated, filterable)
//   GET /conversations/:id          — full detail: 8-dim scores + rationale + transcript
//   GET /summary                    — aggregate: per-dim averages, persona dist, trend
// ═══════════════════════════════════════════════════════════════════════════

const express = require("express");
const router = express.Router();
const db = require("../lib/db");

// Resolve tenant from auth middleware. Superadmin impersonation honored
// via x-impersonate-tenant-id header (matches existing CORS allowlist).
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
// Query params (all optional):
//   limit, offset       — pagination (default 50, max 200)
//   persona             — filter by buyer_persona enum value
//   source_type         — ai_call_inbound | ai_call_outbound | ai_sms | etc.
//   outcome             — booked | not_booked | etc.
//   rep_user_id         — filter to one rep
//   minScore, maxScore  — overall_score range
//   dateFrom, dateTo    — ISO timestamps, filters on scored_at
//
// Returns: { conversations: [...], total, limit, offset }
// ─────────────────────────────────────────────────────────────────────────
router.get("/conversations", async (req, res) => {
  const tenantId = getTenantId(req);
  if (!tenantId) return res.status(401).json({ error: "No tenant in session" });

  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  const offset = parseInt(req.query.offset, 10) || 0;

  const filters = ["cc.tenant_id = $1", "cc.scored_at IS NOT NULL"];
  const params = [tenantId];

  if (req.query.persona) {
    params.push(req.query.persona);
    filters.push(`cc.buyer_persona = $${params.length}`);
  }
  if (req.query.source_type) {
    params.push(req.query.source_type);
    filters.push(`cc.source_type = $${params.length}`);
  }
  if (req.query.outcome) {
    params.push(req.query.outcome);
    filters.push(`cc.outcome = $${params.length}`);
  }
  if (req.query.rep_user_id) {
    params.push(req.query.rep_user_id);
    filters.push(`cc.rep_user_id = $${params.length}`);
  }
  if (req.query.minScore) {
    params.push(parseFloat(req.query.minScore));
    filters.push(`cc.overall_score >= $${params.length}`);
  }
  if (req.query.maxScore) {
    params.push(parseFloat(req.query.maxScore));
    filters.push(`cc.overall_score <= $${params.length}`);
  }
  if (req.query.dateFrom) {
    params.push(req.query.dateFrom);
    filters.push(`cc.scored_at >= $${params.length}`);
  }
  if (req.query.dateTo) {
    params.push(req.query.dateTo);
    filters.push(`cc.scored_at <= $${params.length}`);
  }

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
      du.name AS rep_name
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
//
// Full detail. Returns:
//   conversation — including transcript JSONB + persona_signals
//   scores       — array of 8 dimension rows (dimension, score, rationale, evidence)
//   call         — joined calls row when source_type is ai_call_*, else null
// ─────────────────────────────────────────────────────────────────────────
router.get("/conversations/:id", async (req, res) => {
  const tenantId = getTenantId(req);
  if (!tenantId) return res.status(401).json({ error: "No tenant in session" });

  try {
    const convoRes = await db.query(
      `SELECT
         cc.*,
         du.name AS rep_name,
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

    // Hydrate with the underlying call row when this is a voice conversation.
    // source_id for ai_call_* rows is the twilio_call_sid (set in coachingScorer).
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

      // Pull lead name if we have one — gives the dashboard a nicer header
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
// Aggregate metrics for the dashboard hero tiles + charts.
//
// Query params:
//   days          — lookback window (default 30, max 365)
//   rep_user_id   — optional, filters to one rep
//
// Returns:
//   overall.avg_overall, overall.scored_count
//   dimensions   — array of { dimension, avg_score, count }
//   personas     — array of { buyer_persona, count }
//   trend        — array of { day (date), avg_score, count }
//   top_weakness — the dimension with the lowest avg, for the "focus area" tile
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

  // Inline interval is safe — `days` is a clamped int
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

    // Pick the lowest-scoring dimension as the "focus area" hero tile signal
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

module.exports = router;
