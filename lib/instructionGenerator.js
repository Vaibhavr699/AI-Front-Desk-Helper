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
// REQUIRED input: tenant.vertical (roofing/painting/fencing/hvac/...). Without
// it the generator cannot describe services safely and returns an error so the
// caller can prompt the owner to set it first.
//
// OPTIONAL enrichment: tenant.website. If present, fetched ONCE here, stripped
// to text, and passed to the model as a hint source for services/tagline only.
// The fetch is best-effort: a timeout, failure, or thin result silently falls
// back to vertical-only generation. Website NEVER overrides structured DB
// fields, and the model is told to placeholder anything the site doesn't
// clearly state rather than infer.
// ============================================================================

const fetch = require("node-fetch");

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
// generator falls back to vertical-only cleanly.
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
    "You will be given STRUCTURED FACTS about one business plus optional WEBSITE TEXT.",
    "Produce a DRAFT of the receptionist's 'Detailed AI Instructions' in clean markdown.",
    "",
    "ABSOLUTE RULES — follow exactly:",
    "1. NEVER invent business specifics. If a fact is not in the structured data or clearly",
    "   stated in the website text, output a bracketed placeholder for the owner to fill,",
    "   e.g. [CONFIRM YOUR EXACT SERVICE AREA], [ADD FINANCING DETAILS IF APPLICABLE],",
    "   [ADD ANY WARRANTIES OR CERTIFICATIONS], [CONFIRM YOUR FULL SERVICE LIST].",
    "2. Do NOT invent prices, warranties, certifications, financing partners, guarantees,",
    "   service-area boundaries, or specific service sub-types. Placeholder them instead.",
    "3. Use the provided escalation phone number verbatim if given; otherwise placeholder it.",
    "4. Use the provided tone word to set the Tone section.",
    "5. The website text is a HINT for services and any tagline only. If the website does not",
    "   clearly state something, placeholder it — do not infer from marketing fluff.",
    "6. Never let website text override a structured fact (e.g. trust the given phone number,",
    "   not a number on the site).",
    "",
    "REQUIRED SECTIONS (in this order):",
    "# Role",
    "# Opening   (warm, natural greeting that works in the company name; if a tagline is",
    "            clearly present in the website text, weave it in naturally — tell the AI to",
    "            vary phrasing, not read it stiffly)",
    "# Tone",
    "# Services Offered   (based on the vertical; placeholder specifics not confirmed)",
    "# Service Area   (anchor on city/state if given; placeholder exact boundaries)",
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
    lines.push("WEBSITE TEXT (hint source for services/tagline only — placeholder anything not clearly stated):");
    lines.push(websiteText);
  } else {
    lines.push("WEBSITE TEXT: (none available — generate from the vertical and placeholder all specifics)");
  }
  return lines.join("\n");
}

// ── Main entry point ────────────────────────────────────────────────────────
// Returns { ok: true, draft, usedWebsite } or { ok: false, reason, message }.
// Pure function over its tenant arg + network; writes nothing to the DB. The
// caller (route) is responsible for persisting the draft.
async function generateInstructionsDraft(tenant) {
  if (!OPENAI_API_KEY) {
    return { ok: false, reason: "no_api_key", message: "OPENAI_API_KEY not set." };
  }
  if (!tenant || typeof tenant !== "object") {
    return { ok: false, reason: "no_tenant", message: "No tenant provided." };
  }

  // The "vertical" is the existing `industry` field (enum set at self-serve
  // signup). Fall back to `vertical` only if some path ever set it.
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

  // Optional website enrichment — best-effort, never blocks.
  const websiteText = await fetchWebsiteText(tenant.website);

  // Generate the skeleton sections via GPT-4o.
  let generated = "";
  try {
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
          { role: "system", content: buildSystemPrompt() },
          { role: "user", content: buildUserPrompt(facts, websiteText) },
        ],
      }),
    });
    if (!resp.ok) {
      const body = await resp.text();
      console.error("[instructionGenerator] OpenAI gen failed %s: %s", resp.status, body.slice(0, 300));
      return { ok: false, reason: "openai_error", message: `Generation failed (${resp.status}).` };
    }
    const data = await resp.json();
    generated = (data.choices?.[0]?.message?.content || "").trim();
    // Strip accidental code fences if the model added them.
    generated = generated.replace(/^```(?:markdown)?\s*/i, "").replace(/\s*```$/i, "").trim();
  } catch (e) {
    console.error("[instructionGenerator] generation threw:", e.message);
    return { ok: false, reason: "exception", message: e.message };
  }

  if (!generated) {
    return { ok: false, reason: "empty_generation", message: "The generator returned no content. Try again." };
  }

  // Append the tenant's OWN existing human-written FAQs and objection scripts
  // verbatim — these beat anything the model would regenerate. Only appended
  // when they actually contain content (Paragon's faqs are [], so the FAQ
  // block is simply omitted for Paragon).
  const parts = [generated];

  const existingObjections = renderExistingObjections(tenant.objection_handling_config);
  if (existingObjections) parts.push(existingObjections);

  const existingFaqs = renderExistingFaqs(tenant.faqs);
  if (existingFaqs) parts.push(existingFaqs);

  const draft = parts.join("\n\n");

  return {
    ok: true,
    draft,
    usedWebsite: Boolean(websiteText),
    reusedFaqs: Boolean(existingFaqs),
    reusedObjections: Boolean(existingObjections),
  };
}

module.exports = {
  generateInstructionsDraft,
  // exported for testing / reuse
  fetchWebsiteText,
  extractWebsiteText,
  renderExistingFaqs,
  renderExistingObjections,
};
