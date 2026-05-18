"use strict";

// ═══════════════════════════════════════════════════════════════════════════
// Coaching Rule Extractor — Phase 6 B1 + B1.5
// May 15, 2026 (B1 initial); May 18, 2026 (B1.5 tenant capability injection)
//
// Polls coaching_feedback every 5 minutes. For each pending feedback row
// with text content, runs GPT-4o (structured outputs) to extract zero or
// more coaching_rules. Stamps rules_extracted_at on every processed row
// so we never re-process.
//
// Two paths:
//   1. Rating-only feedback (no text) → stamped immediately with 0 rules.
//      Nothing for the model to extract from a star count alone.
//   2. Feedback with text → GPT-4o → 0..5 rules → INSERT INTO coaching_rules
//      with status='pending_approval'.
//
// Rules land in pending_approval. B2 surfaces them for owner review/edit/
// approve. B3 splices approved rules into voice + SMS prompts.
//
// Per-tenant scoped throughout — no cross-tenant rule leakage (Q4 decision).
//
// ═══ B1.5 (May 18) — Tenant Capability Injection ════════════════════════
// Before GPT-4o runs, load tenant capabilities (industry, vertical services,
// estimator enabled, active channels, business hours, service area, brand
// mode) and inject into the system prompt. This prevents the extractor
// from proposing rules that depend on features the tenant doesn't have.
//
// Example of the bug B1.5 fixes:
//   Owner feedback: "rep should send estimator link instead of quoting price"
//   BEFORE: Rule extracted = "Always send the estimator link for price questions"
//           — but tenant has estimator_enabled=false → rule is impossible
//   AFTER:  GPT-4o sees "Estimator: DISABLED" in tenant capabilities → rule
//           extracted = "Redirect price questions to in-home estimate booking"
//
// Tenant context load is best-effort. Failures degrade to no-context
// extraction (the original B1 behavior). Never blocks rule extraction.
// ═══════════════════════════════════════════════════════════════════════════

const db = require("../lib/db");
const OpenAI = require("openai");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const MAX_FEEDBACK_PER_RUN     = 20;
const MAX_RULES_PER_FEEDBACK   = 5;
const TRANSCRIPT_CONTEXT_CHARS = 3000;

const CATEGORIES = [
  "rapport", "property_walkthrough", "discovery", "education",
  "value_framing", "objection_handling", "close", "professionalism",
  "tone", "scripting", "pricing", "qualification", "other",
];

const RULE_TYPES = ["do", "dont", "when_then"];

// Structured outputs schema. OpenAI strict mode requires every property in
// `required` and additionalProperties:false everywhere.
const RULE_EXTRACTION_SCHEMA = {
  type: "object",
  properties: {
    rules: {
      type: "array",
      items: {
        type: "object",
        properties: {
          category:      { type: "string", enum: CATEGORIES },
          rule_type:     { type: "string", enum: RULE_TYPES },
          rule_text:     { type: "string", description: "Short imperative directive (1-2 sentences) the AI should follow on future calls." },
          rationale:     { type: "string", description: "Why this rule matters, derived from owner feedback." },
          example_quote: { type: ["string", "null"], description: "Optional verbatim phrase the AI should say (for 'do') or avoid (for 'dont'). Null if not applicable." },
        },
        required: ["category", "rule_type", "rule_text", "rationale", "example_quote"],
        additionalProperties: false,
      },
    },
  },
  required: ["rules"],
  additionalProperties: false,
};

function truncateTranscript(transcript) {
  if (!transcript) return "(no transcript)";
  let text;
  if (Array.isArray(transcript)) {
    text = transcript
      .map((t) => {
        const role = ["user", "customer", "caller"].includes((t.role || "").toLowerCase())
          ? "Customer"
          : "AI";
        return `${role}: ${t.text || t.content || ""}`;
      })
      .join("\n");
  } else if (typeof transcript === "string") {
    text = transcript;
  } else {
    text = JSON.stringify(transcript);
  }
  if (text.length <= TRANSCRIPT_CONTEXT_CHARS) return text;
  return text.slice(0, TRANSCRIPT_CONTEXT_CHARS) + "\n…(truncated)";
}

// ──── B1.5: Load tenant capabilities for prompt injection ──────────────────
//
// Returns a normalized tenant context object, or null on any failure.
// Uses SELECT * so missing/renamed columns don't break the query — the
// prompt builder then conditionally includes only the sections it has data
// for. Belt-and-suspenders: every property access has an OR fallback for
// known column-name variations across deploys.
async function loadTenantContext(tenantId) {
  if (!tenantId) return null;
  try {
    // Pull tenant row + vertical name in a single round trip.
    // SELECT * is intentional: we don't want a column rename to break
    // rule extraction. Each field is defensively read below.
    const tenantRes = await db.query(
      `SELECT t.*,
              v.name AS vertical_name,
              v.slug AS vertical_slug
         FROM tenants t
         LEFT JOIN verticals v ON v.id = t.vertical_id
        WHERE t.id = $1
        LIMIT 1`,
      [tenantId]
    );

    if (tenantRes.rows.length === 0) return null;
    const tenant = tenantRes.rows[0];

    // Services offered — pulled from vertical_services if vertical_id present.
    // Wrapped in its own try so a schema variation here doesn't lose the
    // entire tenant context (which is much more valuable than the service
    // list alone).
    let services = [];
    if (tenant.vertical_id) {
      try {
        const svcRes = await db.query(
          `SELECT name
             FROM vertical_services
            WHERE vertical_id = $1
            ORDER BY name ASC
            LIMIT 20`,
          [tenant.vertical_id]
        );
        services = svcRes.rows.map((r) => r.name).filter(Boolean);
      } catch (svcErr) {
        console.warn(
          "[ruleExtractor] vertical_services lookup failed (non-fatal):",
          svcErr.message
        );
      }
    }

    return {
      industry: tenant.industry || null,
      vertical_name: tenant.vertical_name || null,
      vertical_slug: tenant.vertical_slug || null,
      brand_mode: tenant.brand_mode || null,
      // Estimator capability (memory line 14)
      estimator_enabled: tenant.estimator_enabled === true,
      // Channel capabilities — try multiple known column names
      voice_enabled:
        tenant.voice_enabled === true ||
        tenant.inbound_voice_enabled === true ||
        tenant.ai_voice_enabled === true,
      sms_enabled:
        tenant.sms_enabled === true ||
        tenant.inbound_sms_enabled === true ||
        tenant.ai_sms_enabled === true,
      outbound_enabled:
        tenant.outbound_enabled === true ||
        tenant.outbound_calls_enabled === true ||
        tenant.outbound_ai_enabled === true,
      // Business hours — could be JSONB, text, or split fields
      business_hours:
        tenant.business_hours ||
        tenant.hours_of_operation ||
        tenant.operating_hours ||
        null,
      // Service area — could be array, JSONB, or text summary
      service_area:
        tenant.service_area ||
        tenant.service_zip_codes ||
        tenant.service_area_description ||
        null,
      services_offered: services,
    };
  } catch (err) {
    console.warn(
      "[ruleExtractor] tenant context load failed, falling back to no-context extraction:",
      err.message
    );
    return null;
  }
}

// ──── B1.5: Format tenant capabilities into a prompt block ─────────────────
//
// Returns a string block ready to splice into the system prompt, or empty
// string if no usable data. Each capability is its own line — easy for
// GPT-4o to parse and reference. ENABLED vs DISABLED phrasing is explicit
// because GPT-4o follows positive-framed constraints better than negatives.
function formatTenantCapabilitiesBlock(ctx) {
  if (!ctx) return "";

  const lines = [];

  // Industry + vertical
  const tradeLabel = ctx.vertical_name || ctx.industry || null;
  if (tradeLabel) {
    lines.push(`- Industry / trade: ${tradeLabel}`);
  }

  // Services offered (the actual products/services this tenant sells)
  if (ctx.services_offered && ctx.services_offered.length > 0) {
    lines.push(`- Services offered: ${ctx.services_offered.join(", ")}`);
  }

  // Estimator capability — the original bug B1.5 was built to fix
  if (ctx.estimator_enabled) {
    lines.push(
      `- Estimator widget: ENABLED — rules MAY reference sending the estimator link when customer asks about price`
    );
  } else {
    lines.push(
      `- Estimator widget: DISABLED — do NOT propose rules that involve sending estimator links. Price questions should redirect to scheduling an in-home estimate.`
    );
  }

  // Channel capabilities
  const channels = [];
  if (ctx.voice_enabled) channels.push("inbound voice");
  if (ctx.sms_enabled) channels.push("SMS");
  if (ctx.outbound_enabled) channels.push("outbound voice");
  if (channels.length > 0) {
    lines.push(
      `- Active channels: ${channels.join(", ")} — rules apply to ${channels.join(" and ")} conversations`
    );
  }

  // Business hours
  if (ctx.business_hours) {
    let hoursDisplay;
    if (typeof ctx.business_hours === "string") {
      hoursDisplay = ctx.business_hours;
    } else if (typeof ctx.business_hours === "object") {
      hoursDisplay = JSON.stringify(ctx.business_hours);
    } else {
      hoursDisplay = String(ctx.business_hours);
    }
    lines.push(
      `- Business hours: ${hoursDisplay} — after-hours rules apply outside this window`
    );
  }

  // Service area
  if (ctx.service_area) {
    let areaDisplay;
    if (Array.isArray(ctx.service_area)) {
      const count = ctx.service_area.length;
      areaDisplay = count > 0
        ? `${count} zip code${count === 1 ? "" : "s"} (${ctx.service_area.slice(0, 3).join(", ")}${count > 3 ? "…" : ""})`
        : null;
    } else if (typeof ctx.service_area === "object") {
      areaDisplay = JSON.stringify(ctx.service_area);
    } else {
      areaDisplay = String(ctx.service_area);
    }
    if (areaDisplay) {
      lines.push(
        `- Service area: ${areaDisplay} — rules about out-of-area handling apply outside this area`
      );
    }
  }

  // Brand mode — only relevant if white-label (don't add noise for AI-branded)
  if (ctx.brand_mode === "white_label") {
    lines.push(
      `- Branding: White-label — do NOT reference "AI Front Desk Helper" by name in rule text; keep proposed rules brand-agnostic`
    );
  }

  if (lines.length === 0) return "";

  return `\n\nTENANT CAPABILITIES (extract rules consistent with these — do NOT propose rules that depend on features the tenant doesn't have):\n\n${lines.join("\n")}\n`;
}

function buildSystemPrompt(conversation, tenantContext) {
  // B1.5: prefer vertical name / explicit industry from tenant over the
  // industry stored on the conversation row, which can lag if the tenant's
  // vertical changed since the call was scored.
  const trade =
    (tenantContext && (tenantContext.vertical_name || tenantContext.industry)) ||
    conversation?.industry ||
    "home services";

  const basePrompt = `You are an expert sales coach for ${trade} contractors who hire an AI receptionist to answer calls and book estimates.

The business owner has reviewed a recorded AI conversation and provided feedback. Your job is to extract specific, actionable coaching RULES that will be injected into the AI's system prompt on future calls.

Rules must be:
- Specific and actionable (not vague aspirations)
- Generalizable beyond this single call (apply to future similar situations)
- Concise — one or two sentences

Categories:
- The 8 scoring dimensions: rapport, property_walkthrough, discovery, education, value_framing, objection_handling, close, professionalism
- Plus: tone, scripting (exact phrases), pricing (when/how to give pricing), qualification (when to disqualify a lead), other

Rule types:
- "do"        — the AI SHOULD do this
- "dont"      — the AI should NOT do this
- "when_then" — when X happens, do Y

CRITICAL: If the feedback is vague, uninformative (e.g. "great job"), or about a spam/junk call where no meaningful rules apply, return an empty rules array. Do NOT invent rules to fill space. Quality over quantity. Hard maximum 5 rules per feedback.`;

  // B1.5: append tenant capabilities block (empty string if no context)
  return basePrompt + formatTenantCapabilitiesBlock(tenantContext);
}

function buildUserPrompt(feedback, conversation) {
  const parts = [];
  parts.push("=== CONVERSATION CONTEXT ===");
  parts.push(`Source: ${conversation.source_type || "unknown"}`);
  if (conversation.buyer_persona && conversation.buyer_persona !== "unknown") {
    parts.push(`Detected buyer persona: ${conversation.buyer_persona}`);
  }
  if (conversation.overall_score != null) {
    parts.push(`Overall AI score: ${conversation.overall_score}/10`);
  }
  parts.push("");
  parts.push("=== TRANSCRIPT ===");
  parts.push(truncateTranscript(conversation.transcript));
  parts.push("");
  parts.push("=== OWNER FEEDBACK ===");
  if (feedback.overall_rating != null) {
    parts.push(`Rating: ${feedback.overall_rating}/5 stars`);
  }
  if (feedback.what_went_right) {
    parts.push(`What the AI did well: ${feedback.what_went_right}`);
  }
  if (feedback.what_to_improve) {
    parts.push(`What the AI should do differently: ${feedback.what_to_improve}`);
  }
  return parts.join("\n");
}

async function extractRulesFromFeedback(feedback, conversation, tenantContext) {
  const systemPrompt = buildSystemPrompt(conversation, tenantContext);
  const userPrompt = buildUserPrompt(feedback, conversation);

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-2024-08-06",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user",   content: userPrompt },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "coaching_rules",
        strict: true,
        schema: RULE_EXTRACTION_SCHEMA,
      },
    },
    temperature: 0.2,
    max_tokens: 1500,
  });

  const content = completion.choices?.[0]?.message?.content;
  if (!content) return [];

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    console.warn(`[ruleExtractor] JSON parse failed for feedback ${feedback.id}:`, err.message);
    return [];
  }

  const rules = Array.isArray(parsed?.rules) ? parsed.rules : [];
  return rules.slice(0, MAX_RULES_PER_FEEDBACK);
}

async function processOneFeedback(feedbackRow) {
  // Load the parent conversation for context
  const convoRes = await db.query(
    `SELECT id, source_type, transcript, buyer_persona, overall_score, industry
     FROM coaching_conversations
     WHERE id = $1 AND tenant_id = $2
     LIMIT 1`,
    [feedbackRow.conversation_id, feedbackRow.tenant_id]
  );

  if (convoRes.rows.length === 0) {
    // Orphaned feedback — conversation deleted. Stamp and move on.
    console.warn(`[ruleExtractor] feedback ${feedbackRow.id} has no parent conversation; stamping with 0 rules`);
    await db.query(
      "UPDATE coaching_feedback SET rules_extracted_at = now() WHERE id = $1",
      [feedbackRow.id]
    );
    return { rule_count: 0, error: null };
  }

  const conversation = convoRes.rows[0];

  // B1.5: load tenant context BEFORE calling GPT-4o. Best-effort — if this
  // returns null, the extractor still works (just without capability awareness).
  const tenantContext = await loadTenantContext(feedbackRow.tenant_id);

  let rules;
  try {
    rules = await extractRulesFromFeedback(feedbackRow, conversation, tenantContext);
  } catch (err) {
    // GPT-4o failure — leave rules_extracted_at NULL so next cron retries.
    console.error(`[ruleExtractor] GPT-4o error for feedback ${feedbackRow.id}:`, err.message);
    return { rule_count: 0, error: err.message };
  }

  // Insert rules sequentially. No transaction wrapper — db.query in our
  // setup pulls from a Pool so BEGIN/COMMIT wouldn't span queries anyway.
  // On partial failure we'd risk dupes on retry; accepted for now since the
  // approval queue surfaces them and the owner can reject duplicates.
  for (const rule of rules) {
    try {
      await db.query(
        `INSERT INTO coaching_rules
           (tenant_id, source_feedback_id, source_conversation_id,
            category, rule_type, rule_text, rationale, example_quote, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending_approval')`,
        [
          feedbackRow.tenant_id,
          feedbackRow.id,
          feedbackRow.conversation_id,
          rule.category,
          rule.rule_type,
          rule.rule_text,
          rule.rationale,
          rule.example_quote,
        ]
      );
    } catch (err) {
      console.error(`[ruleExtractor] rule insert failed for feedback ${feedbackRow.id}:`, err.message);
      return { rule_count: 0, error: err.message };
    }
  }

  // Stamp the feedback as processed (works for 0-rule extractions too)
  await db.query(
    "UPDATE coaching_feedback SET rules_extracted_at = now() WHERE id = $1",
    [feedbackRow.id]
  );

  return {
    rule_count: rules.length,
    error: null,
    used_tenant_context: !!tenantContext,
  };
}

async function runCoachingRuleExtractor() {
  const startedAt = Date.now();

  // PATH 1: Rating-only feedback (no text) — stamp immediately with 0 rules.
  // GPT-4o can't extract rules from a star count alone.
  const ratingOnlyRes = await db.query(
    `UPDATE coaching_feedback
     SET rules_extracted_at = now()
     WHERE rules_extracted_at IS NULL
       AND (what_went_right IS NULL OR what_went_right = '')
       AND (what_to_improve IS NULL OR what_to_improve = '')
     RETURNING id`
  );
  const ratingOnlyCount = ratingOnlyRes.rowCount || 0;

  // PATH 2: Pending text feedback — run through GPT-4o
  const pendingRes = await db.query(
    `SELECT id, conversation_id, tenant_id,
            what_went_right, what_to_improve, overall_rating
     FROM coaching_feedback
     WHERE rules_extracted_at IS NULL
       AND (
         (what_went_right IS NOT NULL AND what_went_right != '')
         OR (what_to_improve IS NOT NULL AND what_to_improve != '')
       )
     ORDER BY created_at ASC
     LIMIT $1`,
    [MAX_FEEDBACK_PER_RUN]
  );

  const pending = pendingRes.rows;

  if (pending.length === 0 && ratingOnlyCount === 0) {
    return; // Nothing to do — stay quiet to avoid log spam every 5 minutes
  }

  let totalRules = 0;
  let errors = 0;
  let withContext = 0;
  let withoutContext = 0;

  for (const feedback of pending) {
    const result = await processOneFeedback(feedback);
    if (result.error) {
      errors++;
    } else {
      totalRules += result.rule_count;
      if (result.used_tenant_context) withContext++;
      else withoutContext++;
    }
  }

  const elapsedMs = Date.now() - startedAt;
  console.log(
    `[ruleExtractor] processed ${pending.length} feedback (${totalRules} rules, ` +
    `${withContext} with-context, ${withoutContext} without-context), ` +
    `${ratingOnlyCount} rating-only stamped, ${errors} errors, ${elapsedMs}ms`
  );
}

module.exports = {
  runCoachingRuleExtractor,
  // Exported for tests / introspection
  loadTenantContext,
  formatTenantCapabilitiesBlock,
};
