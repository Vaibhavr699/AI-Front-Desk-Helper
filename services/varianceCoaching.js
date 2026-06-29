"use strict";

// ═══════════════════════════════════════════════════════════════════════════
// services/varianceCoaching.js
//
// Phase 7 E (May 18, 2026) — Widget-to-Quote Variance Coaching v2.
//
// When a rep enters their real in-home quote total via the dashboard or
// rep mobile app, this service compares it against the widget's ballpark
// estimate (captured at lead conversion). If the variance is >15% from
// the widget midpoint, GPT-4o generates:
//   - likely_reasons: 2-4 specific causes of the gap
//   - suggested_talking_points: 1-2 concrete phrases the rep can use
//
// The output goes into leads.variance_coaching (JSONB) and the dashboard
// + rep app surface it prominently so the rep can defend price confidently.
//
// Failure modes: returns null on any error (missing data, GPT-4o failure,
// etc.). Never throws — caller treats null as "no coaching available."
//
// Public API:
//   computeVarianceCoaching({ leadId })
//     Loads lead, computes variance, runs GPT-4o if threshold met, persists.
//
//   generateCoachingPrompt({ ...inputs })
//     Pure function — builds GPT-4o messages. Exported for tests.
// ═══════════════════════════════════════════════════════════════════════════

const OpenAI = require("openai");
const db = require("../lib/db");

let _openai = null;
function getOpenAI() {
  if (!_openai) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY not configured");
    }
    _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _openai;
}

const VARIANCE_MODEL = "gpt-4o-2024-08-06";
const VARIANCE_THRESHOLD = 0.15; // 15% — below this, no coaching generated

// Structured outputs schema. OpenAI strict mode requires every property in
// `required` and additionalProperties:false everywhere.
const VARIANCE_COACHING_SCHEMA = {
  type: "object",
  properties: {
    likely_reasons: {
      type: "array",
      description: "2-4 specific likely causes of the gap between widget ballpark and rep's real quote. Each reason must be concrete and trade-specific.",
      items: { type: "string" },
    },
    suggested_talking_points: {
      type: "array",
      description: "1-2 concrete phrases the rep can borrow when explaining the price to the customer. Conversational, not robotic.",
      items: { type: "string" },
    },
  },
  required: ["likely_reasons", "suggested_talking_points"],
  additionalProperties: false,
};

// ──── Pure: build GPT-4o messages ──────────────────────────────────────────
function generateCoachingPrompt({
  tenantIndustry,
  widgetScope,
  widgetLowCents,
  widgetHighCents,
  repQuoteCents,
  variancePercent,
  varianceDirection,
}) {
  const tradeLabel = tenantIndustry || "home services";
  const widgetLow = formatDollars(widgetLowCents);
  const widgetHigh = formatDollars(widgetHighCents);
  const widgetMid = formatDollars((widgetLowCents + widgetHighCents) / 2);
  const repQuote = formatDollars(repQuoteCents);
  const directionWord = varianceDirection === "above_ballpark" ? "above" : "below";

  const systemPrompt = `You are an expert sales coach for ${tradeLabel} contractors who use an AI receptionist platform.

A customer used the company's website estimator and was shown a ballpark price range. The customer then booked an in-home estimate. When the rep arrived and assessed the actual scope, their real quote came out significantly different from the website ballpark.

Your job: help the rep explain this gap to the customer confidently. Be specific to ${tradeLabel}. Be honest — do NOT suggest apologizing, discounting, or undermining the rep's real quote. The widget is a ballpark tool; the rep's quote is the real assessment.

Output two arrays:

1. likely_reasons (2-4 items) — concrete reasons the rep's quote differs from the ballpark. Examples of good reasons (adapt to the trade):
   - "Real room/area dimensions are larger than the 'medium' tier the customer selected on the widget"
   - "Customer didn't account for prep work like wall repair / surface treatment"
   - "Additional scope items the customer noted in-person (e.g. cabinet refresh, trim, ceiling)"
   - "Higher-grade materials selected during the walkthrough"
   - "Site access or complexity factors visible only in person"

2. suggested_talking_points (1-2 items) — conversational phrases the rep can use. NOT robotic scripts. Examples:
   - "The website is a great starting point but it can't see your actual space. The main differences here are X and Y."
   - "I'm seeing about 30% more square footage than the medium-room tier covers, plus the wall repair adds about $300."

Keep talking points natural and trade-specific.`;

  const userPrompt = `Widget ballpark shown to customer: $${widgetLow} – $${widgetHigh} (midpoint $${widgetMid})
Widget scope they entered: ${widgetScope || "(not recorded)"}
Rep's real quote: $${repQuote}
Variance: ${Math.abs(variancePercent)}% ${directionWord} ballpark midpoint

Generate likely_reasons + suggested_talking_points for this rep.`;

  return [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];
}

function formatDollars(cents) {
  if (cents == null || !Number.isFinite(cents)) return "0";
  const dollars = Math.round(cents / 100);
  return dollars.toLocaleString("en-US");
}

// ──── PUBLIC: computeVarianceCoaching ──────────────────────────────────────
async function computeVarianceCoaching({ leadId }) {
  try {
    if (!leadId) {
      return { ok: false, reason: "missing_lead_id" };
    }

    // Load lead with all relevant data + tenant industry for prompt
    const leadRes = await db.query(
      `SELECT l.id, l.tenant_id,
              l.widget_estimate_low_cents, l.widget_estimate_high_cents,
              l.widget_estimate_scope_summary, l.widget_estimated_at,
              l.rep_quote_total_cents, l.rep_quote_entered_at,
              t.industry AS tenant_industry,
              v.name AS vertical_name
         FROM leads l
         JOIN tenants t ON t.id = l.tenant_id
         LEFT JOIN verticals v ON v.id = t.vertical_id
        WHERE l.id = $1
        LIMIT 1`,
      [leadId]
    );

    if (leadRes.rows.length === 0) {
      return { ok: false, reason: "lead_not_found" };
    }

    const lead = leadRes.rows[0];

    // Both data points required to compute variance
    if (lead.widget_estimate_low_cents == null || lead.widget_estimate_high_cents == null) {
      return { ok: true, skipped: true, reason: "no_widget_estimate" };
    }
    if (lead.rep_quote_total_cents == null) {
      return { ok: true, skipped: true, reason: "no_rep_quote" };
    }

    const widgetMidpoint = (lead.widget_estimate_low_cents + lead.widget_estimate_high_cents) / 2;
    if (widgetMidpoint <= 0) {
      return { ok: true, skipped: true, reason: "invalid_widget_midpoint" };
    }

    const variance = (lead.rep_quote_total_cents - widgetMidpoint) / widgetMidpoint;
    const variancePercent = Math.round(variance * 100);

    // Below threshold → no coaching needed, clear any stale coaching
    if (Math.abs(variance) < VARIANCE_THRESHOLD) {
      await db.query(
        `UPDATE leads
            SET variance_coaching = NULL
          WHERE id = $1`,
        [leadId]
      );
      console.log(
        "[varianceCoaching] Lead %s within threshold (%d%%) — no coaching generated",
        leadId, variancePercent
      );
      return {
        ok: true,
        skipped: true,
        reason: "within_threshold",
        variance_percent: variancePercent,
      };
    }

    const varianceDirection = variance > 0 ? "above_ballpark" : "below_ballpark";

    // GPT-4o call
    const openai = getOpenAI();
    const messages = generateCoachingPrompt({
      tenantIndustry: lead.vertical_name || lead.tenant_industry,
      widgetScope: lead.widget_estimate_scope_summary,
      widgetLowCents: lead.widget_estimate_low_cents,
      widgetHighCents: lead.widget_estimate_high_cents,
      repQuoteCents: lead.rep_quote_total_cents,
      variancePercent,
      varianceDirection,
    });

    const completion = await openai.chat.completions.create({
      model: VARIANCE_MODEL,
      messages,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "variance_coaching",
          strict: true,
          schema: VARIANCE_COACHING_SCHEMA,
        },
      },
      temperature: 0.4,
      max_tokens: 800,
    });

    const content = completion.choices?.[0]?.message?.content;
    if (!content) {
      console.warn("[varianceCoaching] Empty GPT-4o response for lead=%s", leadId);
      return { ok: false, reason: "empty_response" };
    }

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (err) {
      console.warn("[varianceCoaching] JSON parse failed for lead=%s: %s", leadId, err.message);
      return { ok: false, reason: "malformed_response" };
    }

    if (!Array.isArray(parsed.likely_reasons) || !Array.isArray(parsed.suggested_talking_points)) {
      console.warn("[varianceCoaching] Invalid schema in response for lead=%s", leadId);
      return { ok: false, reason: "invalid_schema" };
    }

    // Assemble coaching JSONB payload
    const coaching = {
      computed_at: new Date().toISOString(),
      variance_percent: variancePercent,
      variance_direction: varianceDirection,
      midpoint_widget: Math.round(widgetMidpoint),
      rep_quote: lead.rep_quote_total_cents,
      widget_low: lead.widget_estimate_low_cents,
      widget_high: lead.widget_estimate_high_cents,
      likely_reasons: parsed.likely_reasons.slice(0, 5),
      suggested_talking_points: parsed.suggested_talking_points.slice(0, 3),
    };

    await db.query(
      `UPDATE leads
          SET variance_coaching = $1::jsonb
        WHERE id = $2`,
      [JSON.stringify(coaching), leadId]
    );

    console.log(
      "[varianceCoaching] Generated coaching lead=%s variance=%d%% direction=%s",
      leadId, variancePercent, varianceDirection
    );

    return {
      ok: true,
      variance_percent: variancePercent,
      variance_direction: varianceDirection,
      coaching,
    };
  } catch (err) {
    console.error("[varianceCoaching] computeVarianceCoaching error:", err.message);
    return { ok: false, error: err.message };
  }
}

module.exports = {
  computeVarianceCoaching,
  generateCoachingPrompt, // exported for tests
  VARIANCE_THRESHOLD,
};
