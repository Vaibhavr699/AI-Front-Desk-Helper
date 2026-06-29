"use strict";

// ============================================================================
// lib/websiteExtractor.js — Website Intelligence, Phase 1 (Jun 26, 2026)
//   + FAQ extraction (Phase A, Jun 2026): also pulls Q&A pairs off the site so
//     GBP post generation can ground FAQ-category posts in the tenant's OWN
//     answers (rephrased, never copied) instead of generic industry filler.
//     FAQs ride inside the existing website_audits.facts JSONB — NO migration.
// ============================================================================
//
// Crawls a tenant's website (homepage + value-scored inner pages, hard 8-page
// cap) and runs the combined text through one LLM pass to pull a STRUCTURED
// FACTS object. Those facts feed the inbound + outbound instruction generators
// so the AI tells the same story the site tells. Owner-triggered, occasional —
// NOT run on a live call, and NOT run on every draft (the generators read the
// last stored facts; this crawler is its own button).
//
// DESIGN MIRRORS services/gbpAudit.js:
//   - one entry point: runExtraction({ url })
//   - structured snapshot output (here: a "facts" object)
//   - graceful per-fetch error handling — a dead/JS-rendered page never throws
//   - returns enough audit trail (fetched_pages + meta) that the persistence
//     layer can store WHY a fact was or wasn't found, without re-running.
//
// SAFETY: the extraction prompt is told to include ONLY facts clearly stated
// on the site and to leave arrays empty / fields null when something isn't
// there. It must NOT infer or invent. The downstream generators keep their own
// "[bracketed placeholder]" discipline for anything still missing.
// ============================================================================

const fetch = require("node-fetch");

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
// Reuse the generator's model env so ops only configures one knob; allow a
// dedicated override if we ever want a cheaper model just for extraction.
const EXTRACT_MODEL =
  process.env.WEBSITE_EXTRACT_MODEL ||
  process.env.INSTRUCTION_GEN_MODEL ||
  "gpt-4o";

const PAGE_CAP            = 8;     // homepage + up to 7 inner pages
const PER_PAGE_TIMEOUT_MS = 7000;
const PER_PAGE_MAX_CHARS  = 5000;  // cap each page's text before combining
const TOTAL_MAX_CHARS     = 24000; // overall cap on combined text sent to LLM
const MIN_USEFUL_CHARS    = 200;   // below this a page counts as "empty/thin"

const MAX_FAQS         = 12;   // cap stored FAQ pairs
const FAQ_Q_MAX_CHARS  = 200;  // trim absurdly long "questions"
const FAQ_A_MAX_CHARS  = 600;  // trim long answers (we rephrase anyway)

// Canonical empty facts shape — returned on total failure so callers always
// get a stable object to persist and read.
function emptyFacts() {
  return {
    services: [],
    service_area_mentions: [],
    pricing_cues: [],
    trust_signals: [],
    differentiators: [],
    booking_path: { present: false, location: null, note: null },
    contact_methods: [],
    faqs: [], // [{ q, a }] — Q&A pairs found on the site (Phase A)
  };
}

// ── HTML → text (same stripping approach as instructionGenerator) ──────────
function extractWebsiteText(html) {
  return String(html || "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function extractTitle(html) {
  const m = String(html || "").match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? extractWebsiteText(m[1]).slice(0, 200) : "";
}

function normalizeUrl(url) {
  let u = String(url || "").trim();
  if (!u) return "";
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  return u;
}

// Strip a leading www. so "www.foo.com" and "foo.com" are the same host.
function normHost(host) {
  return String(host || "").replace(/^www\./i, "").toLowerCase();
}

// File extensions we never want to crawl (assets, docs, media).
const SKIP_EXT = /\.(jpg|jpeg|png|gif|webp|svg|ico|css|js|pdf|zip|mp4|mov|avi|mp3|woff2?|ttf|eot|xml|json)(\?|#|$)/i;

// Path/segment keywords that mark a link as HIGH value to crawl, with weights.
// FAQ is boosted to 5 (was 2) now that we extract Q&A from it — an FAQ page is
// one of the most valuable pages to reach when it exists.
const HIGH_VALUE = [
  ["service", 5], ["estimate", 5], ["faq", 5], ["quote", 4], ["about", 4],
  ["review", 4], ["testimonial", 4], ["contact", 4], ["area", 4],
  ["pricing", 4], ["financ", 3], ["price", 3], ["location", 3],
  ["question", 3], ["help", 3],
  ["gallery", 2], ["portfolio", 2], ["work", 2], ["project", 2],
];

// Keywords that mark a link as NOISE — never crawl these.
const NOISE = [
  "blog", "news", "privacy", "terms", "career", "login", "signin",
  "sign-in", "account", "cart", "checkout", "policy", "sitemap", "feed",
  "wp-admin", "wp-login", "/tag/", "/category/", "/author/", "wp-content",
];

// Pull same-domain, crawlable links out of homepage HTML.
function extractLinks(html, baseUrl) {
  const out = new Set();
  let baseHost;
  try { baseHost = normHost(new URL(baseUrl).hostname); } catch { return []; }

  const re = /href\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html))) {
    const raw = (m[1] || "").trim();
    if (!raw) continue;
    if (/^(mailto:|tel:|javascript:|#|data:)/i.test(raw)) continue;

    let abs;
    try { abs = new URL(raw, baseUrl); } catch { continue; }
    if (abs.protocol !== "http:" && abs.protocol !== "https:") continue;
    if (normHost(abs.hostname) !== baseHost) continue;
    if (SKIP_EXT.test(abs.pathname)) continue;

    abs.hash = "";
    out.add(abs.toString());
  }
  return [...out];
}

// Score a URL by the value keywords in its path. Returns -1 if it's noise
// (should be excluded entirely), else a non-negative weight sum.
function scoreLink(url, homepageUrl) {
  let path;
  try { path = new URL(url).pathname.toLowerCase(); } catch { return -1; }

  // Never re-crawl the homepage itself (it's always page 1).
  try {
    if (new URL(url).pathname.replace(/\/+$/, "") ===
        new URL(homepageUrl).pathname.replace(/\/+$/, "")) {
      return -1;
    }
  } catch { /* fall through */ }

  for (const n of NOISE) {
    if (path.includes(n)) return -1;
  }

  let score = 0;
  for (const [kw, w] of HIGH_VALUE) {
    if (path.includes(kw)) score += w;
  }
  // Shallow pages (one path segment) get a small nudge — top-level pages like
  // /services, /about tend to be the substantive ones vs deep nested URLs.
  const depth = path.split("/").filter(Boolean).length;
  if (depth <= 1) score += 1;

  return score;
}

// Fetch one page. Never throws — returns a per-page record with status.
async function fetchPage(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PER_PAGE_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: { "User-Agent": "AIFDH-WebsiteExtractor/1.0 (+https://aifrontdeskhelper.com)" },
    });
    if (!resp.ok) {
      return { url, title: "", status: "error", chars: 0, reason: `http_${resp.status}`, text: "" };
    }
    const html = await resp.text();
    const title = extractTitle(html);
    const text = extractWebsiteText(html).slice(0, PER_PAGE_MAX_CHARS);
    if (text.length < MIN_USEFUL_CHARS) {
      return { url, title, status: "empty", chars: text.length, reason: "thin_or_js_rendered", text: "" };
    }
    return { url, title, status: "ok", chars: text.length, reason: null, text };
  } catch (e) {
    const reason = e.name === "AbortError" ? "timeout" : (e.message || "fetch_error");
    return { url, title: "", status: "error", chars: 0, reason, text: "" };
  } finally {
    clearTimeout(timer);
  }
}

// ── LLM extraction ─────────────────────────────────────────────────────────
function buildExtractionSystemPrompt() {
  return [
    "You extract STRUCTURED FACTS from a home-service contractor's website text.",
    "You are given the visible text of several pages from one company's site.",
    "Return ONLY a JSON object (no prose, no code fences) with EXACTLY these keys:",
    "",
    "{",
    '  "services": [],               // specific services/trades the site offers, short labels',
    '  "service_area_mentions": [],  // city/town/county/region names the site says it serves',
    '  "pricing_cues": [],           // short phrases like "free estimates", "financing available", "starting at $X"',
    '  "trust_signals": [],          // e.g. "18 years in business", "licensed & insured", "500+ jobs", "BBB A+", warranties',
    '  "differentiators": [],        // what they emphasize, e.g. "family-owned", "eco-friendly paint", "same-day quotes"',
    '  "booking_path": { "present": false, "location": null, "note": null },  // is there a clear book/schedule/contact CTA?',
    '  "contact_methods": [],        // e.g. "phone", "contact form", "live chat", "click-to-call", "email"',
    '  "faqs": []                    // array of { "q": "...", "a": "..." } question/answer pairs found on the site',
    "}",
    "",
    "STRICT RULES:",
    "1. Include ONLY facts the text clearly states. If something isn't there, leave the array",
    "   empty or the field null. NEVER infer, guess, or invent.",
    "2. Keep each item short (a few words). Deduplicate.",
    '3. For booking_path: set "present" true only if the site clearly has a way to book/schedule/',
    '   request service (a Book/Schedule/Get-a-Quote button, a contact form, or a booking link).',
    '   "location" is a short hint of where it appears (e.g. "header button", "contact page"),',
    '   "note" is optional extra detail or null.',
    "4. Do NOT include marketing fluff that isn't a concrete fact.",
    "",
    "FAQ EXTRACTION (the \"faqs\" key):",
    '5. Pull genuine question/answer pairs the site presents — FAQ sections, "Common',
    '   Questions", "Frequently Asked", or clear Q-then-A patterns. Each entry is',
    '   { "q": "the question", "a": "the answer as stated on the site" }.',
    "6. Only include a pair if BOTH a real question AND its answer appear on the site.",
    "   Do NOT invent answers, do NOT turn a heading into a Q&A, do NOT pad. If the",
    "   site has no FAQ-style content, return an empty array.",
    "7. Keep answers concise — capture the substance, not every word. Max ~12 pairs.",
    "",
    "8. Output must be valid JSON and nothing else.",
  ].join("\n");
}

function buildExtractionUserPrompt(pages) {
  const blocks = [];
  let budget = TOTAL_MAX_CHARS;
  for (const p of pages) {
    if (p.status !== "ok" || !p.text) continue;
    if (budget <= 0) break;
    const slice = p.text.slice(0, Math.max(0, budget));
    budget -= slice.length;
    blocks.push(`--- PAGE: ${p.title || p.url} (${p.url}) ---\n${slice}`);
  }
  return "WEBSITE PAGES:\n\n" + blocks.join("\n\n");
}

async function callOpenAIJson(systemPrompt, userPrompt) {
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: EXTRACT_MODEL,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`openai_${resp.status}: ${body.slice(0, 200)}`);
  }
  const data = await resp.json();
  const content = data.choices?.[0]?.message?.content || "";
  return JSON.parse(content);
}

// Coerce the model's FAQ array into clean { q, a } pairs. Drops anything
// missing either side, trims, dedupes on the question, and caps the count.
function normalizeFaqs(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const q = String(item.q || item.question || "").trim().slice(0, FAQ_Q_MAX_CHARS);
    const a = String(item.a || item.answer || "").trim().slice(0, FAQ_A_MAX_CHARS);
    if (!q || !a) continue;
    const key = q.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ q, a });
    if (out.length >= MAX_FAQS) break;
  }
  return out;
}

// Coerce the model's JSON into the canonical facts shape so downstream code
// can trust the structure even if the model drifts.
function normalizeFacts(raw) {
  const f = emptyFacts();
  if (!raw || typeof raw !== "object") return f;

  const asArr = (v) =>
    Array.isArray(v)
      ? v.map((x) => String(x || "").trim()).filter(Boolean).slice(0, 40)
      : [];

  f.services              = asArr(raw.services);
  f.service_area_mentions = asArr(raw.service_area_mentions);
  f.pricing_cues          = asArr(raw.pricing_cues);
  f.trust_signals         = asArr(raw.trust_signals);
  f.differentiators       = asArr(raw.differentiators);
  f.contact_methods       = asArr(raw.contact_methods);
  f.faqs                  = normalizeFaqs(raw.faqs);

  const bp = raw.booking_path;
  if (bp && typeof bp === "object") {
    f.booking_path = {
      present: bp.present === true,
      location: bp.location ? String(bp.location).trim().slice(0, 120) : null,
      note: bp.note ? String(bp.note).trim().slice(0, 200) : null,
    };
  }
  return f;
}

// ── Main entry point ────────────────────────────────────────────────────────
// runExtraction({ url }) → { ok, facts, fetched_pages, meta, reason? }
// Never throws. On total failure returns ok:false with empty facts plus an
// audit trail so the caller can still persist the attempt.
async function runExtraction({ url }) {
  const warnings = [];
  const homepage = normalizeUrl(url);

  if (!OPENAI_API_KEY) {
    return {
      ok: false, reason: "no_api_key",
      facts: emptyFacts(), fetched_pages: [],
      meta: { pages_fetched: 0, pages_capped: false, homepage_thin: false, model: EXTRACT_MODEL, warnings: ["OPENAI_API_KEY not set"] },
    };
  }
  if (!homepage) {
    return {
      ok: false, reason: "no_url",
      facts: emptyFacts(), fetched_pages: [],
      meta: { pages_fetched: 0, pages_capped: false, homepage_thin: false, model: EXTRACT_MODEL, warnings: ["No URL provided"] },
    };
  }

  // 1) Homepage first.
  const home = await fetchPage(homepage);
  const fetched = [home];

  if (home.status !== "ok") {
    warnings.push(
      home.status === "empty"
        ? "Homepage returned little/no text — the site may be JavaScript-rendered, so facts will be limited."
        : `Homepage could not be fetched (${home.reason}).`
    );
  }

  // 2) Pick inner pages from homepage links (only if homepage gave us HTML to
  //    parse — if it was empty/error we have no link source, so we just work
  //    with whatever the homepage yielded, which may be nothing).
  let capped = false;
  if (home.status === "ok") {
    // Re-fetch raw HTML for link parsing? We already consumed text in fetchPage.
    // Re-fetch once for links (cheap vs. the LLM call) so we get hrefs.
    let homeHtml = "";
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), PER_PAGE_TIMEOUT_MS);
      const r = await fetch(homepage, { method: "GET", signal: controller.signal, headers: { "User-Agent": "AIFDH-WebsiteExtractor/1.0" } });
      clearTimeout(timer);
      if (r.ok) homeHtml = await r.text();
    } catch { /* links just won't be found; not fatal */ }

    const links = extractLinks(homeHtml, homepage);
    const scored = links
      .map((u) => ({ url: u, score: scoreLink(u, homepage) }))
      .filter((x) => x.score >= 0)
      .sort((a, b) => b.score - a.score);

    const slots = PAGE_CAP - 1; // homepage already used one
    if (scored.length > slots) capped = true;
    const chosen = scored.slice(0, slots).map((x) => x.url);

    for (const u of chosen) {
      const page = await fetchPage(u);
      fetched.push(page);
    }
  }

  const usablePages = fetched.filter((p) => p.status === "ok" && p.text);
  if (usablePages.length === 0) {
    return {
      ok: false, reason: "no_usable_content",
      facts: emptyFacts(),
      // strip the heavy text field off fetched_pages before persisting
      fetched_pages: fetched.map(({ text, ...rest }) => rest),
      meta: {
        pages_fetched: fetched.length,
        pages_capped: capped,
        homepage_thin: home.status !== "ok",
        model: EXTRACT_MODEL,
        warnings: warnings.concat("No page returned usable text — nothing to extract."),
      },
    };
  }

  if (usablePages.length === 1 && home.status === "ok") {
    warnings.push("Only the homepage had usable text — inner pages were empty or missing.");
  }

  // 3) One extraction pass over the combined usable text.
  let facts = emptyFacts();
  let ok = true;
  let reason = null;
  try {
    const raw = await callOpenAIJson(
      buildExtractionSystemPrompt(),
      buildExtractionUserPrompt(usablePages)
    );
    facts = normalizeFacts(raw);
  } catch (e) {
    ok = false;
    reason = "extraction_failed";
    warnings.push(`Fact extraction failed: ${e.message}`);
    console.error("[websiteExtractor] extraction failed url=%s: %s", homepage, e.message);
  }

  return {
    ok,
    reason,
    facts,
    fetched_pages: fetched.map(({ text, ...rest }) => rest), // drop raw text from the stored trail
    meta: {
      pages_fetched: fetched.length,
      pages_used: usablePages.length,
      pages_capped: capped,
      homepage_thin: home.status !== "ok",
      model: EXTRACT_MODEL,
      faqs_found: facts.faqs.length,
      warnings,
    },
  };
}

module.exports = {
  runExtraction,
  // exported for testing / reuse
  extractWebsiteText,
  extractLinks,
  scoreLink,
  normalizeFacts,
  normalizeFaqs,
  emptyFacts,
};
