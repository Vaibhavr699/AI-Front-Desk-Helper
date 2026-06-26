"use strict";

// ============================================================================
// lib/instructionGenerator.js — Feature 1: draft-time AI instruction generator
// ============================================================================
//
// Produces a REVIEWABLE DRAFT of the Detailed AI Instructions for a tenant.
// This runs ONCE, at draft time — never on a live call. The live voice/SMS
// path is untouched. The owner reviews the draft and explicitly applies it
// (copies it into tenants.instructions) before anything goes live.
//
// SAFETY DESIGN (the whole point):
//   1. Structured DB data the system actually has  → filled in confidently.
//   2. Human-written content that already exists    → REUSED VERBATIM, not
//      regenerated (existing faqs / objection_handling_config are better than
//      anything a fresh generation produces — see Paragon's real data).
//   3. Facts the system cannot know (service-area boundaries, financing
//      partners, warranties, certifications, exact service lists) → emitted as
//      [BRACKETED PLACEHOLDERS] for the owner to fill. The model is explicitly
//      forbidden from inventing these.
//
// ── WEBSITE FACTS (Website Intelligence, Phase 1 — Jun 26, 2026) ─────────────
// The generators now prefer STRUCTURED website facts produced by the website
// analyzer (lib/websiteExtractor → services/websiteAudit, stored in
// website_audits) over a raw single-page homepage grab. When a tenant has run
// "Analyze my website", we load the latest stored facts and render them as the
// website hint block. When they HAVEN'T (no stored audit), we fall back to the
// original best-effort live homepage fetch so nothing regresses. Either way the
// model is told to placeholder anything not clearly supported.
//
// REQUIRED input: tenant.vertical (roofing/painting/fencing/hvac/...). Without
// it the generator cannot describe services safely and returns an error so the
// caller can prompt the owner to set it first.
//
// ── OUTBOUND VARIANT (Jun 26, 2026) ─────────────────────────────────────────
// generateOutboundInstructionsDraft() is the sibling of the inbound generator
// for the Settings → AI behavior → "Outbound AI Agent" section. Same safety
// design and return contract, DIFFERENT job: the AI is *placing an outbound
// call* to a warm-but-cooling lead (estimate sent and went quiet, missed call,
// inquiry that stalled). The framing is re-engagement + an outbound-SALES push.
// It reuses the tenant's objection scripts verbatim but deliberately does NOT
// append inbound FAQs, which are the wrong shape for an outbound call.
// ============================================================================

const fetch = require("node-fetch");
const db = require("./db");

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const GEN_MODEL = process.env.INSTRUCTION_GEN_MODEL || "gpt-4o";

const WEBSITE_FETCH_TIMEOUT_MS = 6000;
const WEBSITE_MAX_CHARS = 8000;
const WEBSITE_MIN_USEFUL_CHARS = 200; // below this, treat as "no usable site"

// Reuses the same stripping approach as server.js extractWebsiteText so the
// behavior is consistent. Kept local so this module has no server.js dependency.
function extractWebsiteText(html) {
  return String(html || "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

// Best-effort website fetch. Never throws — returns "" on any problem so the
// generator falls back to vertical-only cleanly. This is the FALLBACK path now
// (used only when a tenant has no stored website audit).
async function fetchWebsiteText(url) {
  if (!url || typeof url !== "string") return "";
  let normalized = url.trim();
  if (!/^https?:\/\//i.test(normalized)) normalized = "https://" + normalized;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEBSITE_FETCH_TIMEOUT_MS);
  try {
    const resp = await fetch(normalized, { method: "GET", signal: controller.signal });
    if (!resp.ok) {
      console.warn("[instructionGenerator] website fetch HTTP %s url=%s", resp.status, normalized);
      return "";
    }
    const html = await resp.text();
    const text = extractWebsiteText(html).slice(0, WEBSITE_MAX_CHARS);
    if (text.length < WEBSITE_MIN_USEFUL_CHARS) {
      console.warn("[instructionGenerator] website text too thin (%d chars) url=%s — ignoring", text.length, normalized);
      return "";
    }
    return text;
  } catch (e) {
    console.warn("[instructionGenerator] website fetch failed url=%s reason=%s", normalized, e.message);
    return "";
  } finally {
    clearTimeout(timer);
  }
}

// ── Stored website facts (preferred hint source) ────────────────────────────
// Load the latest structured facts the website analyzer produced for this
// tenant. Returns the facts object, or null if none stored / on any error.
async function loadLatestWebsiteFacts(tenantId) {
  if (!tenantId) return null;
  try {
    const res = await db.query(
      `SELECT facts FROM website_audits
        WHERE tenant_id = $1
        ORDER BY created_at DESC
        LIMIT 1`,
      [tenantId]
    );
    const facts = res.rows[0]?.facts;
    if (!facts) return null;
    return typeof facts === "string" ? JSON.parse(facts) : facts;
  } catch (e) {
    console.warn("[instructionGenerator] website facts load failed tenant=%s: %s", tenantId, e.message);
    return null;
  }
}

function arr(v) {
  return Array.isArray(v) ? v.filter((x) => x != null && String(x).trim()) : [];
}

// Render stored structured facts into a clean text hint block for the prompt.
// Returns "" when there's nothing usable, so callers can fall back cleanly.
function renderWebsiteFacts(facts) {
  if (!facts || typeof facts !== "object") return "";
  const lines = [];
  if (arr(facts.services).length)
    lines.push("Services found on the site: " + arr(facts.services).join("; "));
  if (arr(facts.service_area_mentions).length)
    lines.push("Service-area places named on the site: " + arr(facts.service_area_mentions).join("; "));
  if (arr(facts.pricing_cues).length)
    lines.push("Pricing / offer cues on the site: " + arr(facts.pricing_cues).join("; "));
  if (arr(facts.trust_signals).length)
    lines.push("Trust signals on the site: " + arr(facts.trust_signals).join("; "));
  if (arr(facts.differentiators).length)
    lines.push("Differentiators the site emphasizes: " + arr(facts.differentiators).join("; "));
  if (arr(facts.contact_methods).length)
    lines.push("Contact methods on the site: " + arr(facts.contact_methods).join("; "));
  if (facts.booking_path && facts.booking_path.present) {
    lines.push(
      "Booking/scheduling path on the site: present" +
      (facts.booking_path.location ? ` (${facts.booking_path.location})` : "")
    );
  }
  return lines.length ? lines.join("\n") : "";
}

// Resolve the website hint for a tenant: prefer stored structured facts, fall
// back to a live homepage grab. Returns { text, usedFacts }.
async function resolveWebsiteHint(tenant) {
  const storedFacts = await loadLatestWebsiteFacts(tenant.id);
  const rendered = renderWebsiteFacts(storedFacts);
  if (rendered) return { text: rendered, usedFacts: true };
  const live = await fetchWebsiteText(tenant.website);
  return { text: live, usedFacts: false };
}

// Normalize the JSONB blobs into clean arrays. Both faqs and
// objection_handling_config can be null, an empty array, a JSON string, or an
// array of objects — handle all of it, return [] on anything unusable.
function normalizeArrayField(value) {
  if (!value) return [];
  let v = value;
  if (typeof v === "string") {
    try { v = JSON.parse(v); } catch { return []; }
  }
  return Array.isArray(v) ? v.filter((x) => x && typeof x === "object") : [];
}

// Renders existing FAQs verbatim into a markdown section, or "" if none.
function renderExistingFaqs(faqs) {
  const list = normalizeArrayField(faqs)
    .map((f) => {
      const q = String(f.question || "").trim();
      const a = String(f.answer || "").trim();
      return q && a ? `Q: ${q}\nA: ${a}` : "";
    })
    .filter(Boolean);
  if (!list.length) return "";
  return "# Frequently Asked Questions\n" + list.join("\n\n");
}

// Renders existing objection scripts verbatim, or "" if none.
function renderExistingObjections(cfg) {
  const list = normalizeArrayField(cfg)
    .map((o) => {
      const t = String(o.trigger || "").trim();
      const s = String(o.script || "").trim();
      return t && s ? `- If they say ${t}: ${s}` : "";
    })
    .filter(Boolean);
  if (!list.length) return "";
  return "# Common Objections\n" + list.join("\n\n");
}

// Pull the first transfer number as the escalation number, if present.
function firstTransferNumber(transfer_numbers) {
  let v = transfer_numbers;
  if (typeof v === "string") {
    try { v = JSON.parse(v); } catch { v = null; }
  }
  if (Array.isArray(v) && v.length && v[0]) return String(v[0]).trim();
  return "";
}

function buildSystemPrompt() {
  return [
    "You are an expert at writing voice-receptionist AI instructions for home-service contractors.",
    "You will be given STRUCTURED FACTS about one business plus optional WEBSITE INFO.",
    "Produce a DRAFT of the receptionist's 'Detailed AI Instructions' in clean markdown.",
    "",
    "ABSOLUTE RULES — follow exactly:",
    "1. NEVER invent business specifics. If a fact is not in the structured data or clearly",
    "   stated in the website info, output a bracketed placeholder for the owner to fill,",
    "   e.g. [CONFIRM YOUR EXACT SERVICE AREA], [ADD FINANCING DETAILS IF APPLICABLE],",
    "   [ADD ANY WARRANTIES OR CERTIFICATIONS], [CONFIRM YOUR FULL SERVICE LIST].",
    "2. Do NOT invent prices, warranties, certifications, financing partners, guarantees,",
    "   service-area boundaries, or specific service sub-types. Placeholder them instead.",
    "3. Use the provided escalation phone number verbatim if given; otherwise placeholder it.",
    "4. Use the provided tone word to set the Tone section.",
    "5. The website info is a HINT for services, service area, and any tagline only. If the",
    "   website info does not clearly state something, placeholder it — do not infer from fluff.",
    "6. Never let website info override a structured fact (e.g. trust the given phone number,",
    "   not a number on the site).",
    "",
    "REQUIRED SECTIONS (in this order):",
    "# Role",
    "# Opening   (warm, natural greeting that works in the company name; if a tagline is",
    "            clearly present in the website info, weave it in naturally — tell the AI to",
    "            vary phrasing, not read it stiffly)",
    "# Tone",
    "# Services Offered   (based on the vertical + any services the website info confirms;",
    "                     placeholder specifics not confirmed)",
    "# Service Area   (anchor on city/state or any service-area places the website info names;",
    "                 placeholder exact boundaries if unclear)",
    "# Primary Goal   (book an in-person estimate/walkthrough)",
    "# Information to Collect Before Ending the Call",
    "# AI Disclosure   (answer honestly if asked whether AI; don't volunteer)",
    "# Escalation   (use the given phone number or placeholder)",
    "# Don'ts",
    "",
    "Keep it tight and usable. Output ONLY the markdown instructions — no preamble, no",
    "explanation, no code fences.",
  ].join("\n");
}

function buildUserPrompt(facts, websiteText) {
  const lines = [
    "STRUCTURED FACTS:",
    `- Company name: ${facts.companyName || "(unknown)"}`,
    `- Industry / vertical: ${facts.vertical}`,
    `- City/State: ${[facts.city, facts.state].filter(Boolean).join(", ") || "(not provided)"}`,
    `- Tone of voice: ${facts.tone || "professional"}`,
    `- Escalation phone number: ${facts.escalationPhone || "(not provided — use a placeholder)"}`,
    `- After-hours behavior: ${facts.afterhours || "(not provided)"}`,
    "",
  ];
  if (websiteText) {
    lines.push("WEBSITE INFO (hint source for services/service-area/tagline only — placeholder anything not clearly stated):");
    lines.push(websiteText);
  } else {
    lines.push("WEBSITE INFO: (none available — generate from the vertical and placeholder all specifics)");
  }
  return lines.join("\n");
}

// ── OUTBOUND prompt builders ────────────────────────────────────────────────
function buildOutboundSystemPrompt(agentName) {
  const who = agentName || "the assistant";
  return [
    `You are an expert at writing OUTBOUND-CALL AI instructions for home-service contractors.`,
    `The AI agent's name is "${who}". The AI is PLACING a call (outbound) to a lead who already`,
    "reached out to this business and then went quiet — e.g. requested an estimate that was sent",
    "but never accepted, left a missed call, or made an inquiry that stalled. This is NOT an",
    "inbound receptionist answering questions. It is a warm, purposeful re-engagement + sales",
    "follow-up call whose job is to rebuild momentum and move the lead toward booking an estimate",
    "or appointment.",
    "",
    "You will be given STRUCTURED FACTS about the business plus optional WEBSITE INFO.",
    "Produce a DRAFT of the agent's 'Outbound Personality & Instructions' in clean markdown.",
    "",
    "ABSOLUTE RULES — follow exactly:",
    "1. NEVER invent business specifics. If a fact is not in the structured data or clearly",
    "   stated in the website info, output a bracketed placeholder for the owner to fill,",
    "   e.g. [CONFIRM YOUR CURRENT PROMOTION IF ANY], [ADD FINANCING DETAILS IF APPLICABLE],",
    "   [CONFIRM YOUR FULL SERVICE LIST], [ADD ANY WARRANTIES OR GUARANTEES].",
    "2. Do NOT invent prices, discounts, warranties, financing, guarantees, or service-area",
    "   boundaries. Placeholder them instead.",
    "3. Use the provided escalation phone number verbatim if given; otherwise placeholder it.",
    "4. Use the provided tone word to set the Tone section.",
    "5. The website info is a HINT for services and any tagline only — placeholder anything the",
    "   site doesn't clearly state. Never let website info override a structured fact.",
    "6. This is an outbound sales-follow-up call. Be confident and proactive, but never pushy,",
    "   aggressive, or manipulative. Respect the person's time, take a clear no gracefully, and",
    "   honor any request to stop contact.",
    "",
    "REQUIRED SECTIONS (in this order):",
    `# Role   (you are ${who}, calling on behalf of the company to re-engage an existing lead)`,
    "# Opening   (natural outbound opener: greet by name if known, say who's calling and which",
    "            company, and reference that they'd reached out / requested an estimate. Tell the",
    "            AI to confirm it's a good moment to talk and to vary phrasing, not read a script",
    "            stiffly.)",
    "# Tone",
    "# Why You're Calling   (re-engage on the estimate/inquiry they already started)",
    "# Primary Goal   (re-book or confirm an in-person estimate/appointment; create gentle",
    "                 momentum toward a specific day/time)",
    "# Handling Reluctance   (briefly address the usual cooling-off reasons — still deciding,",
    "                        timing, budget, need to talk to a spouse — and steer back toward a",
    "                        concrete next step without pressure)",
    "# Information to Confirm or Collect   (verify name, project, best time for the estimate)",
    "# Voicemail   (if no answer, leave a short, warm voicemail that says who called, the company,",
    "              why, and how to reach back; keep it brief)",
    "# AI Disclosure   (answer honestly if asked whether AI; don't volunteer it)",
    "# Escalation   (use the given phone number or placeholder)",
    "# Don'ts   (no pressure/manipulation, don't invent offers, don't argue, stop on request)",
    "",
    "Keep it tight and usable. Output ONLY the markdown instructions — no preamble, no",
    "explanation, no code fences.",
  ].join("\n");
}

function buildOutboundUserPrompt(facts, websiteText) {
  const lines = [
    "STRUCTURED FACTS:",
    `- Company name: ${facts.companyName || "(unknown)"}`,
    `- Industry / vertical: ${facts.vertical}`,
    `- City/State: ${[facts.city, facts.state].filter(Boolean).join(", ") || "(not provided)"}`,
    `- AI caller name: ${facts.agentName || "(not provided — use a friendly first name placeholder)"}`,
    `- Tone of voice: ${facts.tone || "professional"}`,
    `- Escalation phone number: ${facts.escalationPhone || "(not provided — use a placeholder)"}`,
    "",
  ];
  if (websiteText) {
    lines.push("WEBSITE INFO (hint source for services/service-area/tagline only — placeholder anything not clearly stated):");
    lines.push(websiteText);
  } else {
    lines.push("WEBSITE INFO: (none available — generate from the vertical and placeholder all specifics)");
  }
  return lines.join("\n");
}

// Small helper so the two public entry points share the OpenAI call.
async function runGeneration({ systemPrompt, userPrompt }) {
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: GEN_MODEL,
      temperature: 0.4,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
  });
  if (!resp.ok) {
    const body = await resp.text();
    console.error("[instructionGenerator] OpenAI gen failed %s: %s", resp.status, body.slice(0, 300));
    return { ok: false, reason: "openai_error", message: `Generation failed (${resp.status}).` };
  }
  const data = await resp.json();
  let generated = (data.choices?.[0]?.message?.content || "").trim();
  generated = generated.replace(/^```(?:markdown)?\s*/i, "").replace(/\s*```$/i, "").trim();
  if (!generated) {
    return { ok: false, reason: "empty_generation", message: "The generator returned no content. Try again." };
  }
  return { ok: true, generated };
}

// ── Main entry point (INBOUND) ──────────────────────────────────────────────
async function generateInstructionsDraft(tenant) {
  if (!OPENAI_API_KEY) {
    return { ok: false, reason: "no_api_key", message: "OPENAI_API_KEY not set." };
  }
  if (!tenant || typeof tenant !== "object") {
    return { ok: false, reason: "no_tenant", message: "No tenant provided." };
  }

  const vertical = String(tenant.industry || tenant.vertical || "").trim();
  if (!vertical) {
    return {
      ok: false,
      reason: "missing_industry",
      message: "This location needs an industry set before a draft can be generated. Ask the owner to pick their trade (e.g. roofing, painting, fencing) in settings, then regenerate.",
    };
  }

  const facts = {
    companyName: tenant.company_name || tenant.name || "",
    vertical,
    city: tenant.city || "",
    state: tenant.state || "",
    tone: tenant.tone_of_voice || "professional",
    escalationPhone: firstTransferNumber(tenant.transfer_numbers),
    afterhours: tenant.afterhours_behavior || "",
  };

  // Website hint — prefer stored structured facts, fall back to live homepage.
  const { text: websiteText, usedFacts: usedWebsiteFacts } = await resolveWebsiteHint(tenant);

  let gen;
  try {
    gen = await runGeneration({
      systemPrompt: buildSystemPrompt(),
      userPrompt: buildUserPrompt(facts, websiteText),
    });
  } catch (e) {
    console.error("[instructionGenerator] generation threw:", e.message);
    return { ok: false, reason: "exception", message: e.message };
  }
  if (!gen.ok) return gen;

  const parts = [gen.generated];

  const existingObjections = renderExistingObjections(tenant.objection_handling_config);
  if (existingObjections) parts.push(existingObjections);

  const existingFaqs = renderExistingFaqs(tenant.faqs);
  if (existingFaqs) parts.push(existingFaqs);

  const draft = parts.join("\n\n");

  return {
    ok: true,
    draft,
    usedWebsite: Boolean(websiteText),
    usedWebsiteFacts,
    reusedFaqs: Boolean(existingFaqs),
    reusedObjections: Boolean(existingObjections),
  };
}

// ── Main entry point (OUTBOUND) ─────────────────────────────────────────────
async function generateOutboundInstructionsDraft(tenant) {
  if (!OPENAI_API_KEY) {
    return { ok: false, reason: "no_api_key", message: "OPENAI_API_KEY not set." };
  }
  if (!tenant || typeof tenant !== "object") {
    return { ok: false, reason: "no_tenant", message: "No tenant provided." };
  }

  const vertical = String(tenant.industry || tenant.vertical || "").trim();
  if (!vertical) {
    return {
      ok: false,
      reason: "missing_industry",
      message: "This location needs an industry set before a draft can be generated. Ask the owner to pick their trade (e.g. roofing, painting, fencing) in settings, then regenerate.",
    };
  }

  const facts = {
    companyName: tenant.company_name || tenant.name || "",
    vertical,
    city: tenant.city || "",
    state: tenant.state || "",
    tone: tenant.tone_of_voice || "professional",
    escalationPhone: firstTransferNumber(tenant.transfer_numbers),
    agentName: String(tenant.outbound_agent_name || "").trim(),
  };

  const { text: websiteText, usedFacts: usedWebsiteFacts } = await resolveWebsiteHint(tenant);

  let gen;
  try {
    gen = await runGeneration({
      systemPrompt: buildOutboundSystemPrompt(facts.agentName),
      userPrompt: buildOutboundUserPrompt(facts, websiteText),
    });
  } catch (e) {
    console.error("[instructionGenerator] outbound generation threw:", e.message);
    return { ok: false, reason: "exception", message: e.message };
  }
  if (!gen.ok) return gen;

  const parts = [gen.generated];

  const existingObjections = renderExistingObjections(tenant.objection_handling_config);
  if (existingObjections) parts.push(existingObjections);

  const draft = parts.join("\n\n");

  return {
    ok: true,
    draft,
    usedWebsite: Boolean(websiteText),
    usedWebsiteFacts,
    reusedFaqs: false,
    reusedObjections: Boolean(existingObjections),
  };
}

module.exports = {
  generateInstructionsDraft,
  generateOutboundInstructionsDraft,
  // exported for testing / reuse
  fetchWebsiteText,
  extractWebsiteText,
  loadLatestWebsiteFacts,
  renderWebsiteFacts,
  renderExistingFaqs,
  renderExistingObjections,
};
