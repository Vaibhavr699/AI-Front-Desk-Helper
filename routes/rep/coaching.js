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

// GET /me/history — paginated list of this rep's scored conversations.
//   ?days=30 (window), ?limit=20, ?offset=0
//   Returns { window_days, conversations, next_offset }.
router.get("/me/history", ...repAuthChain, async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days, 10) || 30, 180);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 50);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    const r = await db.query(
      `SELECT c.id, c.lead_id, l.name AS lead_name,
              c.overall_score, c.buyer_persona, c.disc_primary,
              c.scored_at, c.created_at, c.outcome, c.duration_seconds,
              c.source_type, c.scoring_skip_reason
         FROM coaching_conversations c
         LEFT JOIN leads l ON l.id = c.lead_id
        WHERE c.rep_user_id = $1 AND c.tenant_id = $2
          AND COALESCE(c.scored_at, c.created_at) >= now() - ($3 || ' days')::interval
        ORDER BY COALESCE(c.scored_at, c.created_at) DESC
        LIMIT $4 OFFSET $5`,
      [req.rep.id, req.rep.tenant_id, days, limit, offset]
    );

    res.json({
      window_days: days,
      conversations: r.rows.map((c) => ({
        id: c.id,
        lead_id: c.lead_id,
        lead_name: c.lead_name,
        overall_score: c.overall_score != null ? Number(c.overall_score) : null,
        buyer_persona: c.buyer_persona,
        disc_primary: c.disc_primary,
        scored_at: c.scored_at,
        created_at: c.created_at,
        outcome: c.outcome,
        duration_seconds: c.duration_seconds,
        source_type: c.source_type,
        scoring_skip_reason: c.scoring_skip_reason,
      })),
      next_offset: r.rows.length === limit ? offset + limit : null,
    });
  } catch (e) {
    console.error("[rep/coaching/me/history]", e);
    res.status(500).json({ error: "Server error" });
  }
});

// GET /conversations/:id — single-conversation post-call review.
//   8-dimension scores with rationale + derived top-3 strengths and
//   top-3 improvement areas. Tenant-scoped.
router.get("/conversations/:id", ...repAuthChain, async (req, res) => {
  try {
    const convId = req.params.id;

    const cR = await db.query(
      `SELECT c.id, c.lead_id, l.name AS lead_name,
              c.overall_score, c.buyer_persona, c.persona_confidence,
              c.disc_primary, c.disc_secondary, c.scored_at, c.created_at,
              c.outcome, c.duration_seconds, c.source_type, c.scoring_skip_reason
         FROM coaching_conversations c
         LEFT JOIN leads l ON l.id = c.lead_id
        WHERE c.id = $1 AND c.tenant_id = $2`,
      [convId, req.rep.tenant_id]
    );
    const conv = cR.rows[0];
    if (!conv) return res.status(404).json({ error: "Conversation not found" });

    const sR = await db.query(
      `SELECT dimension, score, rationale, evidence
         FROM coaching_scores
        WHERE conversation_id = $1
        ORDER BY score DESC`,
      [convId]
    );

    const dimensions = sR.rows.map((s) => ({
      dimension: s.dimension,
      score: Number(s.score),
      rationale: s.rationale || null,
      evidence: s.evidence || [],
    }));

    const byScore = [...dimensions].sort((a, b) => b.score - a.score);
    const strengths = byScore.slice(0, 3);
    const improvements = [...dimensions]
      .sort((a, b) => a.score - b.score)
      .slice(0, 3);

    res.json({
      conversation: {
        id: conv.id,
        lead_id: conv.lead_id,
        lead_name: conv.lead_name,
        overall_score: conv.overall_score != null ? Number(conv.overall_score) : null,
        buyer_persona: conv.buyer_persona,
        persona_confidence: conv.persona_confidence != null ? Number(conv.persona_confidence) : null,
        disc_primary: conv.disc_primary,
        disc_secondary: conv.disc_secondary,
        scored_at: conv.scored_at,
        created_at: conv.created_at,
        outcome: conv.outcome,
        duration_seconds: conv.duration_seconds,
        source_type: conv.source_type,
        scoring_skip_reason: conv.scoring_skip_reason,
      },
      dimensions,
      strengths,
      improvements,
    });
  } catch (e) {
    console.error("[rep/coaching/conversations/:id]", e);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
