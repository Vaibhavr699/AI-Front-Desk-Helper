"use strict";

// ── /api/rep/leads ──────────────────────────────────────────────────────────
//   GET  /                          — paginated lead list, filterable
//   GET  /:id                       — full lead detail with briefing fields,
//                                     widget estimate, persona, history, etc.
//   POST /:id/quote-entered         — rep submits their real quote total;
//                                     server computes variance + coaching
//   POST /:id/send-briefing         — SMS briefing to rep's phone (501 stub
//                                     until Phase 8 C SMS endpoint exists)
//
// All queries are tenant-scoped via req.rep.tenant_id. The lead :id is also
// re-checked against tenant_id on detail to prevent cross-tenant access by
// guessed UUIDs.
//
// "Mine" vs "all" leads:
//   The leads table has no explicit rep-assignment column. We derive
//   assignment two ways:
//     • bookings.technician_id  (assigned appointments)
//     • coaching_conversations.rep_user_id  (calls the rep has handled)
//   Pass ?mine=true to filter to those. Default is all tenant leads.
//
// Future columns from Phase 8 B (briefing generator) — pre_visit_prep,
// expected_objections, etc. — will be added to the leads table by Drew.
// When they ship, augment the detail SELECT below.
// ────────────────────────────────────────────────────────────────────────────

const express = require("express");
const db = require("../../lib/db");
const repAuth = require("../../lib/repAuth");
const { repAuthChain } = require("../../lib/requireRep");

const router = express.Router();

const PAGE_SIZE_DEFAULT = 50;
const PAGE_SIZE_MAX = 200;

const FILTER_TO_WHERE = {
  today: "AND l.updated_at >= CURRENT_DATE",
  week: "AND l.updated_at >= (CURRENT_DATE - INTERVAL '7 days')",
  needs_followup: "AND l.status IN ('contacted','quoted','no_answer')",
  booked: "AND l.status = 'booked'",
  lost: "AND l.status IN ('lost','dead','dnc')",
};

// ── GET /api/rep/leads ──────────────────────────────────────────────────────
router.get("/", ...repAuthChain, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || PAGE_SIZE_DEFAULT, PAGE_SIZE_MAX);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    const filter = FILTER_TO_WHERE[req.query.filter] || "";
    const search = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const mine = req.query.mine === "true" || req.query.mine === "1";

    const params = [req.rep.tenant_id];
    let p = 2;
    let searchClause = "";
    if (search) {
      // ILIKE on name + phone covers both the spec'd search axes. Phone is
      // matched as a substring against the raw string — Drew normalizes
      // phones on insert so "5551234" matches "+15551234567".
      searchClause = `AND (l.name ILIKE $${p} OR l.phone ILIKE $${p})`;
      params.push(`%${search}%`);
      p++;
    }
    let mineClause = "";
    if (mine) {
      mineClause = `AND (
        EXISTS (SELECT 1 FROM bookings b WHERE b.lead_id = l.id AND b.technician_id = $${p})
        OR EXISTS (SELECT 1 FROM coaching_conversations c WHERE c.lead_id = l.id AND c.rep_user_id = $${p})
      )`;
      params.push(req.rep.id);
      p++;
    }

    params.push(limit, offset);
    const sql = `
      SELECT l.id, l.name, l.phone, l.email, l.address, l.project_type, l.status,
             l.lead_source, l.estimated_revenue_cents, l.created_at, l.updated_at,
             l.buyer_persona, l.persona_confidence,
             l.disc_primary, l.disc_secondary, l.disc_confidence,
             l.widget_estimate_low_cents, l.widget_estimate_high_cents,
             l.widget_estimated_at,
             l.do_not_contact, l.human_handoff_at
        FROM leads l
       WHERE l.tenant_id = $1
         ${filter}
         ${searchClause}
         ${mineClause}
       ORDER BY l.updated_at DESC
       LIMIT $${p++} OFFSET $${p}
    `;
    const r = await db.query(sql, params);

    const rows = r.rows.map((l) => ({
      id: l.id,
      name: l.name,
      phone: l.phone,
      email: l.email,
      address: l.address,
      project_type: l.project_type,
      status: l.status,
      lead_source: l.lead_source,
      estimated_revenue_cents: l.estimated_revenue_cents,
      created_at: l.created_at,
      updated_at: l.updated_at,
      buyer_persona: l.buyer_persona,
      persona_confidence: l.persona_confidence,
      disc_primary: l.disc_primary,
      disc_secondary: l.disc_secondary,
      disc_confidence: l.disc_confidence != null ? Number(l.disc_confidence) : null,
      // Just the indicator flag for the list — full estimate object lives on /:id.
      has_widget_estimate: l.widget_estimate_low_cents != null,
      widget_estimate_low_cents: l.widget_estimate_low_cents,
      widget_estimate_high_cents: l.widget_estimate_high_cents,
      do_not_contact: l.do_not_contact === true,
      human_handoff_active: l.human_handoff_at != null,
    }));

    res.json({ leads: rows, limit, offset, has_more: rows.length === limit });
  } catch (e) {
    console.error("[rep/leads GET]", e);
    res.status(500).json({ error: "Server error" });
  }
});

// ── GET /api/rep/leads/:id ──────────────────────────────────────────────────
router.get("/:id", ...repAuthChain, async (req, res) => {
  try {
    const leadId = req.params.id;
    const r = await db.query(
      `SELECT * FROM leads WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
      [leadId, req.rep.tenant_id]
    );
    const lead = r.rows[0];
    if (!lead) return res.status(404).json({ error: "Lead not found" });

    // Conversation history — messages + calls for this lead, chronologically.
    const [msgs, calls, conversations, upcoming] = await Promise.all([
      db.query(
        `SELECT id, channel, direction, body, created_at, sent_by_user_id
           FROM messages
          WHERE lead_id = $1 AND tenant_id = $2
          ORDER BY created_at DESC LIMIT 200`,
        [leadId, req.rep.tenant_id]
      ),
      db.query(
        `SELECT id, direction, status, disposition, transferred, duration_minutes,
                started_at, ended_at, transcript, recording_sid
           FROM calls
          WHERE lead_id = $1 AND tenant_id = $2
          ORDER BY started_at DESC LIMIT 50`,
        [leadId, req.rep.tenant_id]
      ),
      db.query(
        `SELECT id, overall_score, buyer_persona, persona_confidence, scored_at, outcome
           FROM coaching_conversations
          WHERE lead_id = $1 AND tenant_id = $2
          ORDER BY created_at DESC LIMIT 20`,
        [leadId, req.rep.tenant_id]
      ),
      db.query(
        `SELECT id, preferred_date, appointment_time, technician_id, status, state
           FROM bookings
          WHERE lead_id = $1 AND tenant_id = $2
            AND (preferred_date IS NULL OR preferred_date >= CURRENT_DATE - 1)
          ORDER BY preferred_date ASC NULLS LAST, appointment_time ASC NULLS LAST
          LIMIT 10`,
        [leadId, req.rep.tenant_id]
      ),
    ]);

    // Widget estimate object (null if customer never used the website widget).
    const widget = lead.widget_estimate_low_cents != null
      ? {
          low_cents: lead.widget_estimate_low_cents,
          high_cents: lead.widget_estimate_high_cents,
          scope_summary: lead.widget_estimate_scope_summary,
          estimated_at: lead.widget_estimated_at,
        }
      : null;

    // Variance coaching (set by POST /:id/quote-entered when a real quote
    // diverges from the widget ballpark). Drew may upgrade the generator to
    // be LLM-driven later — the shape here is the contract.
    const variance = lead.variance_coaching || null;

    // Persona / customer intelligence card. Briefing-specific fields
    // (pre_visit_prep, expected_objections) will be added by Drew's Phase 8 B
    // migration; until then we surface the persona_signals JSONB as-is.
    const intelligence = lead.disc_primary || lead.buyer_persona
      ? {
          disc_primary: lead.disc_primary,
          disc_secondary: lead.disc_secondary,
          disc_confidence: lead.disc_confidence != null ? Number(lead.disc_confidence) : null,
          disc_signals: lead.disc_signals || null,
          disc_detected_at: lead.disc_detected_at,
          persona: lead.buyer_persona,
          confidence: lead.persona_confidence,
          detected_at: lead.persona_detected_at,
          signals: lead.persona_signals || null,
        }
      : null;

    res.json({
      id: lead.id,
      name: lead.name,
      phone: lead.phone,
      email: lead.email,
      address: lead.address,
      project_type: lead.project_type,
      notes: lead.notes,
      status: lead.status,
      lead_source: lead.lead_source,
      estimated_revenue_cents: lead.estimated_revenue_cents,
      actual_revenue_cents: lead.actual_revenue_cents,
      created_at: lead.created_at,
      updated_at: lead.updated_at,
      do_not_contact: lead.do_not_contact === true,
      human_handoff_active: lead.human_handoff_at != null,
      widget_estimate: widget,
      rep_quote: lead.rep_quote_total_cents != null
        ? {
            total_cents: lead.rep_quote_total_cents,
            entered_at: lead.rep_quote_entered_at,
            entered_by_user_id: lead.rep_quote_entered_by_user_id,
          }
        : null,
      variance_coaching: variance,
      intelligence,
      messages: msgs.rows,
      calls: calls.rows,
      coaching_conversations: conversations.rows,
      upcoming_appointments: upcoming.rows,
    });
  } catch (e) {
    console.error("[rep/leads/:id GET]", e);
    res.status(500).json({ error: "Server error" });
  }
});

// ── POST /api/rep/leads/:id/quote-entered ───────────────────────────────────
// Rep enters their real quote total. Server:
//   1. Writes rep_quote_total_cents + entered_at + entered_by_user_id
//   2. If a widget estimate exists, computes variance vs the midpoint and
//      writes a variance_coaching JSONB blob the lead detail screen renders.
//
// Variance coaching shape (the rep app reads this verbatim):
//   {
//     widget_midpoint_cents: int,
//     variance_pct: number,  // (quote - midpoint) / midpoint * 100
//     direction: "above"|"below"|"within",
//     reasons: [string],     // canned bullets, LLM-augment later
//     talking_points: [string]
//   }
// ────────────────────────────────────────────────────────────────────────────
router.post("/:id/quote-entered", ...repAuthChain, async (req, res) => {
  try {
    const leadId = req.params.id;
    const total = Number(req.body?.total_cents);
    if (!Number.isFinite(total) || total <= 0) {
      return res.status(400).json({ error: "total_cents must be a positive number" });
    }
    const r = await db.query(
      `SELECT widget_estimate_low_cents, widget_estimate_high_cents,
              widget_estimate_scope_summary
         FROM leads
        WHERE id = $1 AND tenant_id = $2`,
      [leadId, req.rep.tenant_id]
    );
    const lead = r.rows[0];
    if (!lead) return res.status(404).json({ error: "Lead not found" });

    let varianceCoaching = null;
    if (lead.widget_estimate_low_cents != null && lead.widget_estimate_high_cents != null) {
      const lo = lead.widget_estimate_low_cents;
      const hi = lead.widget_estimate_high_cents;
      const mid = Math.round((lo + hi) / 2);
      const variancePct = mid === 0 ? 0 : ((total - mid) / mid) * 100;
      const within = total >= lo && total <= hi;
      const direction = within ? "within" : total > hi ? "above" : "below";

      // Canned reasons today. Drew can swap in an LLM call later that reads
      // the rep's quote line items + widget scope summary and generates
      // grounded reasons — schema doesn't change, only the generator does.
      const reasons = within
        ? ["Your quote falls inside the website ballpark range."]
        : direction === "above"
        ? [
            "Real space is larger than the tier the customer chose in the widget.",
            "Additional scope items not captured in the ballpark (trim, prep, repairs).",
            "Quality of materials or number of coats exceeds the widget assumption.",
          ]
        : [
            "Smaller scope than the customer entered in the widget.",
            "Promotional pricing or scope reduction agreed in-person.",
          ];
      const talking_points = within
        ? ["Reference the website estimate as confirmation — your quote matches what they saw."]
        : direction === "above"
        ? [
            "The website is a great starting point but can't see your actual space.",
            "Walk through the specific scope items that drove the difference.",
            "Anchor on the warranty + outcome value before discussing the gap.",
          ]
        : [
            "Acknowledge the lower number explicitly so the customer feels seen.",
            "Reinforce that scope was tightened together in person, not value cut.",
          ];

      varianceCoaching = {
        widget_midpoint_cents: mid,
        widget_low_cents: lo,
        widget_high_cents: hi,
        widget_scope_summary: lead.widget_estimate_scope_summary,
        quote_total_cents: total,
        variance_pct: Number(variancePct.toFixed(1)),
        direction,
        reasons,
        talking_points,
        computed_at: new Date().toISOString(),
      };
    }

    await db.query(
      `UPDATE leads
         SET rep_quote_total_cents       = $1,
             rep_quote_entered_at        = now(),
             rep_quote_entered_by_user_id = $2,
             variance_coaching           = $3::jsonb,
             updated_at                  = now()
       WHERE id = $4 AND tenant_id = $5`,
      [total, req.rep.id, varianceCoaching ? JSON.stringify(varianceCoaching) : null, leadId, req.rep.tenant_id]
    );

    await repAuth.logRepEvent(req, {
      user_id: req.rep.id,
      tenant_id: req.rep.tenant_id,
      event_type: "rep_quote_entered",
      metadata: {
        lead_id: leadId,
        total_cents: total,
        variance_pct: varianceCoaching?.variance_pct ?? null,
        direction: varianceCoaching?.direction ?? null,
      },
    });

    res.json({ status: "ok", variance_coaching: varianceCoaching });
  } catch (e) {
    console.error("[rep/leads/:id/quote-entered]", e);
    res.status(500).json({ error: "Server error" });
  }
});

// ── POST /api/rep/leads/:id/send-briefing ───────────────────────────────────
// Spec: "SMS briefing to rep's phone (Phase 8 C)". The Phase 8 C SMS endpoint
// doesn't exist yet, and dashboard_users has no phone column. Return 501
// with a clear code so the rep app can grey-out the button until it ships.
// ────────────────────────────────────────────────────────────────────────────
router.post("/:id/send-briefing", ...repAuthChain, async (req, res) => {
  // Confirm the lead exists + is in this tenant before responding so we don't
  // leak that 501 differs from 404 on a guessed UUID.
  const r = await db.query(
    "SELECT id FROM leads WHERE id = $1 AND tenant_id = $2",
    [req.params.id, req.rep.tenant_id]
  );
  if (!r.rows[0]) return res.status(404).json({ error: "Lead not found" });
  res.status(501).json({
    error: "SMS briefing not yet available — depends on Phase 8 C delivery.",
    code: "PHASE_8C_NOT_READY",
  });
});

module.exports = router;
