"use strict";

// ── /api/rep/coaching ───────────────────────────────────────────────────────
//   GET /me           — aggregated coaching: 30-day trend, dimension averages,
//                       best/weakest dimension, recent conversations
//   GET /leads/:id    — coaching breakdown for a specific lead (sum of all
//                       coaching_conversations the rep had on this lead)
//
// Data model (already shipped by Phase 6 A):
//   coaching_conversations  one row per scored call/conversation
//     • rep_user_id, lead_id, overall_score, buyer_persona, scored_at, outcome
//   coaching_scores         per-dimension scores per conversation
//     • conversation_id, dimension, score, rationale, evidence
// ────────────────────────────────────────────────────────────────────────────

const express = require("express");
const db = require("../../lib/db");
const { repAuthChain } = require("../../lib/requireRep");

const router = express.Router();

router.get("/me", ...repAuthChain, async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days, 10) || 30, 180);

    // One big query batch — separate concerns, run in parallel.
    const [overall, dimensions, trend, recent] = await Promise.all([
      db.query(
        `SELECT COUNT(*)::int       AS conversations,
                AVG(overall_score)  AS avg_score
           FROM coaching_conversations
          WHERE rep_user_id = $1 AND tenant_id = $2
            AND scored_at IS NOT NULL
            AND scored_at >= now() - ($3 || ' days')::interval`,
        [req.rep.id, req.rep.tenant_id, days]
      ),
      db.query(
        `SELECT s.dimension,
                AVG(s.score)::numeric(10,2) AS avg_score,
                COUNT(*)::int               AS samples
           FROM coaching_scores s
           JOIN coaching_conversations c
             ON c.id = s.conversation_id
          WHERE c.rep_user_id = $1
            AND c.tenant_id = $2
            AND c.scored_at >= now() - ($3 || ' days')::interval
          GROUP BY s.dimension
          ORDER BY avg_score DESC`,
        [req.rep.id, req.rep.tenant_id, days]
      ),
      db.query(
        `SELECT date_trunc('day', scored_at)::date AS day,
                AVG(overall_score)::numeric(10,2) AS avg_score,
                COUNT(*)::int                     AS conversations
           FROM coaching_conversations
          WHERE rep_user_id = $1 AND tenant_id = $2
            AND scored_at >= now() - ($3 || ' days')::interval
          GROUP BY day
          ORDER BY day ASC`,
        [req.rep.id, req.rep.tenant_id, days]
      ),
      db.query(
        `SELECT id, lead_id, overall_score, buyer_persona, scored_at, outcome
           FROM coaching_conversations
          WHERE rep_user_id = $1 AND tenant_id = $2
          ORDER BY COALESCE(scored_at, created_at) DESC
          LIMIT 20`,
        [req.rep.id, req.rep.tenant_id]
      ),
    ]);

    const dims = dimensions.rows;
    res.json({
      window_days: days,
      overall: {
        conversations: overall.rows[0]?.conversations || 0,
        avg_score: overall.rows[0]?.avg_score != null ? Number(overall.rows[0].avg_score) : null,
      },
      dimensions: dims.map((d) => ({
        dimension: d.dimension,
        avg_score: Number(d.avg_score),
        samples: d.samples,
      })),
      best_dimension: dims[0] || null,
      weakest_dimension: dims.length ? dims[dims.length - 1] : null,
      trend: trend.rows.map((t) => ({
        day: t.day,
        avg_score: Number(t.avg_score),
        conversations: t.conversations,
      })),
      recent_conversations: recent.rows,
    });
  } catch (e) {
    console.error("[rep/coaching/me]", e);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/leads/:id", ...repAuthChain, async (req, res) => {
  try {
    const leadId = req.params.id;

    // Tenant gate — make sure the lead even belongs here before disclosing
    // anything about it (a NOT FOUND vs an empty list leak matters).
    const lead = await db.query(
      "SELECT id FROM leads WHERE id = $1 AND tenant_id = $2",
      [leadId, req.rep.tenant_id]
    );
    if (!lead.rows[0]) return res.status(404).json({ error: "Lead not found" });

    const [convs, dims] = await Promise.all([
      db.query(
        `SELECT id, overall_score, buyer_persona, persona_confidence, scored_at,
                outcome, outcome_revenue_cents, duration_seconds, rep_user_id,
                source_type, source_id
           FROM coaching_conversations
          WHERE lead_id = $1 AND tenant_id = $2
          ORDER BY COALESCE(scored_at, created_at) DESC`,
        [leadId, req.rep.tenant_id]
      ),
      db.query(
        `SELECT s.dimension,
                AVG(s.score)::numeric(10,2) AS avg_score,
                COUNT(*)::int               AS samples
           FROM coaching_scores s
           JOIN coaching_conversations c ON c.id = s.conversation_id
          WHERE c.lead_id = $1 AND c.tenant_id = $2
          GROUP BY s.dimension
          ORDER BY avg_score DESC`,
        [leadId, req.rep.tenant_id]
      ),
    ]);

    res.json({
      lead_id: leadId,
      conversations: convs.rows,
      dimensions: dims.rows.map((d) => ({
        dimension: d.dimension,
        avg_score: Number(d.avg_score),
        samples: d.samples,
      })),
    });
  } catch (e) {
    console.error("[rep/coaching/leads/:id]", e);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
