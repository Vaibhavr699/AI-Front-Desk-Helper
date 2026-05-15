"use strict";

const db = require("./db");

// ═══════════════════════════════════════════════════════════════════════════
// Coaching Prompt Injection — Phase 6 B3 (May 15, 2026)
//
// Fetches owner-approved coaching_rules for a tenant and formats them as
// system-prompt text. Used by both voice (server.js Realtime session.update)
// and SMS (buildSmsSystemPrompt in server.js).
//
// Defensive design:
//   - Returns "" if no tenantId provided
//   - Returns "" if no approved rules exist
//   - Returns "" on any DB error (logs warning, never throws)
//   - Caps at 50 rules to prevent prompt bloat
//
// Approved rules persist in the prompt until manually Rejected via the
// dashboard B2 queue. Pending/rejected rules are NEVER included.
// ═══════════════════════════════════════════════════════════════════════════

const MAX_RULES_PER_INJECTION = 50;

const CATEGORY_LABELS = {
  rapport:              "Rapport & Connection",
  property_walkthrough: "Property Walkthrough",
  discovery:            "Discovery Questions",
  education:            "Customer Education",
  value_framing:        "Value Framing",
  objection_handling:   "Objection Handling",
  close:                "Closing & Booking",
  professionalism:      "Professionalism",
  tone:                 "Tone of Voice",
  scripting:            "Specific Phrases",
  pricing:              "Pricing Conversations",
  qualification:        "Lead Qualification",
  other:                "Other",
};

const RULE_TYPE_PREFIX = {
  do:        "DO",
  dont:      "DON'T",
  when_then: "WHEN-THEN",
};

// Ordering for the prompt — flow-of-conversation order, not alphabetical
const CATEGORY_ORDER = [
  "rapport", "discovery", "qualification", "property_walkthrough",
  "education", "value_framing", "pricing", "objection_handling",
  "close", "professionalism", "tone", "scripting", "other",
];

async function buildCoachingPromptInjection(tenantId) {
  if (!tenantId) return "";

  let rows;
  try {
    const result = await db.query(
      `SELECT category, rule_type, rule_text, example_quote
       FROM coaching_rules
       WHERE tenant_id = $1
         AND status = 'approved'
       ORDER BY approved_at DESC
       LIMIT $2`,
      [tenantId, MAX_RULES_PER_INJECTION]
    );
    rows = result.rows;
  } catch (err) {
    console.warn(
      "[coachingInjection] DB query failed tenant=%s err=%s — returning empty",
      tenantId, err.message
    );
    return "";
  }

  if (!rows || rows.length === 0) return "";

  // Group rules by category
  const byCategory = {};
  for (const rule of rows) {
    const cat = rule.category || "other";
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(rule);
  }

  // Order categories with explicit priority list; unknowns drift to the end
  const orderedCats = Object.keys(byCategory).sort((a, b) => {
    const ai = CATEGORY_ORDER.indexOf(a);
    const bi = CATEGORY_ORDER.indexOf(b);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });

  const lines = [];
  lines.push("═══ COACHING RULES (owner-approved) ═══");
  lines.push(
    "The business owner has reviewed past conversations and provided these specific rules. " +
    "Follow them on every call/message. These override generic defaults if they conflict."
  );
  lines.push("");

  for (const cat of orderedCats) {
    const label = CATEGORY_LABELS[cat] || cat;
    lines.push(`[${label}]`);
    for (const rule of byCategory[cat]) {
      const prefix = RULE_TYPE_PREFIX[rule.rule_type] || "RULE";
      lines.push(`  ${prefix}: ${rule.rule_text}`);
      if (rule.example_quote) {
        lines.push(`     Example: "${rule.example_quote}"`);
      }
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

module.exports = { buildCoachingPromptInjection };
