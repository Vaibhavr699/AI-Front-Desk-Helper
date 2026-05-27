"use strict";

// ═══════════════════════════════════════════════════════════════════════
// Phase 9B step 1 — deterministic linguistic extractors
// May 27, 2026
//
// Pure functions. No DB, no LLM, no I/O. Given a list of customer-side
// utterances (one string per turn / per inbound SMS), return the
// deterministic columns of conversation_linguistic_signals:
//
//   customer_sentence_count
//   customer_avg_sentence_length
//   brand_mention_count
//   time_marker_count
//   price_marker_count
//
// The remaining columns (open/closed/detail question counts and
// specificity score) are filled in by linguisticExtractors/llmClassifier.js
// in step 2. This file deliberately ignores them.
//
// Inputs:
//   customerUtterances — string[] of customer-side text.
//                        Voice: one element per customer turn (parsed from
//                          calls.transcript "User: ..." lines).
//                        SMS:   one element per inbound message body.
//   brandList          — string[] of brand/product names to match against,
//                        case-insensitive, whole-word. Built per-tenant
//                        from brandLists.js based on tenant vertical_id.
//                        Pass [] for tenants with no brand list yet.
// ═══════════════════════════════════════════════════════════════════════

/**
 * Split a single utterance into sentences. Customers don't punctuate
 * carefully in SMS or in voice transcripts, so this is intentionally
 * lenient: split on .!? then drop empties. For SMS, the whole inbound
 * message is treated as one sentence if it has no terminal punctuation —
 * "yes" is one sentence, not zero.
 *
 * Returns string[] of trimmed non-empty sentences.
 */
function splitSentences(utterance) {
  const s = String(utterance || "").trim();
  if (!s) return [];
  // Split on terminal punctuation followed by whitespace OR end of string.
  // Keep the punctuation off the result (we don't need it).
  const parts = s.split(/[.!?]+\s*/).map((p) => p.trim()).filter(Boolean);
  // If splitting produced nothing (e.g. utterance was just "..."), but the
  // original had content, treat the whole utterance as one sentence.
  if (parts.length === 0 && s.length > 0) return [s];
  return parts;
}

/**
 * Count words in a sentence. "Word" = whitespace-delimited token after
 * stripping leading/trailing punctuation. Empty string → 0.
 */
function countWords(sentence) {
  const s = String(sentence || "").trim();
  if (!s) return 0;
  return s.split(/\s+/).filter((w) => /[a-zA-Z0-9]/.test(w)).length;
}

/**
 * Sentence-structure extractor.
 * Returns { customer_sentence_count, customer_avg_sentence_length }.
 *
 * customer_avg_sentence_length is null when sentence_count is 0 (avoid
 * 0/0 → NaN; the column is nullable per mig 073).
 */
function extractSentenceStructure(customerUtterances) {
  let totalSentences = 0;
  let totalWords = 0;

  for (const utterance of customerUtterances) {
    const sentences = splitSentences(utterance);
    totalSentences += sentences.length;
    for (const s of sentences) totalWords += countWords(s);
  }

  return {
    customer_sentence_count: totalSentences,
    customer_avg_sentence_length:
      totalSentences > 0 ? totalWords / totalSentences : null,
  };
}

// ── Marker regexes ────────────────────────────────────────────────────
// All matchers operate on the *joined customer text* (all utterances
// concatenated with spaces), case-insensitive. Counting is per-occurrence,
// not per-utterance, because "I have $500 budget, $200 max for paint"
// genuinely contains two price markers.
//
// IMPORTANT: regex word boundaries (\b) are used everywhere to avoid
// false positives — "tomorrow" should match but "atom" should not.

// Time markers: days, months, relative time, clock times.
const TIME_MARKER_PATTERNS = [
  // Relative
  /\b(today|tomorrow|tonight|yesterday)\b/gi,
  /\b(next|this|last)\s+(week|month|year|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi,
  // Days of week (standalone)
  /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi,
  // Months (standalone)
  /\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/gi,
  /\b(jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\b/gi,
  // Clock times: 3pm, 3:00pm, 15:00, 3 pm, 3:30 p.m.
  /\b\d{1,2}(:\d{2})?\s*(am|pm|a\.m\.|p\.m\.)\b/gi,
  // Numeric dates: 5/14, 5-14, 2026-05-14
  /\b\d{1,2}[\/\-]\d{1,2}([\/\-]\d{2,4})?\b/g,
  // "By Friday", "by the 15th", "before noon"
  /\b(by|before|after)\s+(noon|midnight|morning|afternoon|evening|the\s+\d{1,2}(st|nd|rd|th)?)\b/gi,
  // Bare ordinals when clearly date-ish: "the 15th", "on the 3rd"
  /\b(the|on the)\s+\d{1,2}(st|nd|rd|th)\b/gi,
];

// Price markers: currency, named cost concepts.
const PRICE_MARKER_PATTERNS = [
  // Currency: $500, $1,500, $1.5k
  /\$\s*\d+(,\d{3})*(\.\d+)?(k|K)?\b/g,
  // "500 dollars", "1500 bucks"
  /\b\d+(,\d{3})*(\.\d+)?\s*(dollars?|bucks?|usd)\b/gi,
  // Cost/budget/quote/estimate concepts. NOTE: "estimate" is intentionally
  // included even though it appears in non-price contexts ("can I get an
  // estimate"). In a home-services SMS conversation the word almost always
  // co-occurs with price discussion; the false-positive rate is acceptable
  // for v1, and 9C can learn to discount it.
  /\b(price|pricing|cost|costs|costing|budget|quote|estimate|expensive|cheap|affordable|how\s+much)\b/gi,
];

/**
 * Count regex matches across a joined string, summing across multiple patterns.
 * Each pattern is run independently with its own /g flag; matches are summed.
 */
function countMatches(text, patterns) {
  if (!text) return 0;
  let total = 0;
  for (const pattern of patterns) {
    // Defensive: re-create the regex from source+flags so we don't share
    // lastIndex across calls (matters because we use /g).
    const rx = new RegExp(pattern.source, pattern.flags);
    const matches = text.match(rx);
    if (matches) total += matches.length;
  }
  return total;
}

/**
 * Time-marker extractor. Returns { time_marker_count }.
 */
function extractTimeMarkers(customerUtterances) {
  const joined = customerUtterances.join(" ");
  return { time_marker_count: countMatches(joined, TIME_MARKER_PATTERNS) };
}

/**
 * Price-marker extractor. Returns { price_marker_count }.
 */
function extractPriceMarkers(customerUtterances) {
  const joined = customerUtterances.join(" ");
  return { price_marker_count: countMatches(joined, PRICE_MARKER_PATTERNS) };
}

/**
 * Brand-mention extractor. Returns { brand_mention_count }.
 *
 * Matching is case-insensitive whole-word. A brand name like "Sherwin-Williams"
 * is escaped for regex safety, and the hyphen is preserved (so "sherwin
 * williams" without the hyphen is a near-miss that we deliberately do NOT
 * count — different spellings carry slightly different signal, and we want
 * the C-cue strength to come from precise mentions).
 *
 * Multi-word brands ("Benjamin Moore") match as a single occurrence even
 * when the customer phrases them with extra whitespace.
 */
function extractBrandMentions(customerUtterances, brandList) {
  if (!brandList || brandList.length === 0) {
    return { brand_mention_count: 0 };
  }
  const joined = customerUtterances.join(" ");
  if (!joined) return { brand_mention_count: 0 };

  let total = 0;
  for (const brand of brandList) {
    const safe = String(brand || "").trim();
    if (!safe) continue;
    // Escape regex metacharacters in the brand name; normalize internal
    // whitespace so "Benjamin   Moore" matches "Benjamin Moore".
    const escaped = safe
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\s+/g, "\\s+");
    const rx = new RegExp(`\\b${escaped}\\b`, "gi");
    const matches = joined.match(rx);
    if (matches) total += matches.length;
  }
  return { brand_mention_count: total };
}

/**
 * Run all deterministic extractors and return the merged column set.
 *
 * Returns an object with these keys (all deterministic columns of
 * conversation_linguistic_signals):
 *   customer_sentence_count
 *   customer_avg_sentence_length
 *   time_marker_count
 *   price_marker_count
 *   brand_mention_count
 *
 * Does NOT return: customer_open_question_count, customer_closed_question_count,
 * customer_detail_question_count, customer_specificity_score. Those are
 * step 2 (LLM).
 */
function runDeterministicExtractors(customerUtterances, brandList) {
  const utterances = Array.isArray(customerUtterances) ? customerUtterances : [];
  return {
    ...extractSentenceStructure(utterances),
    ...extractTimeMarkers(utterances),
    ...extractPriceMarkers(utterances),
    ...extractBrandMentions(utterances, brandList || []),
  };
}

module.exports = {
  // Composite entry point — the only one linguisticExtraction.js calls.
  runDeterministicExtractors,
  // Individual extractors exported for unit testing only.
  splitSentences,
  countWords,
  extractSentenceStructure,
  extractTimeMarkers,
  extractPriceMarkers,
  extractBrandMentions,
};
