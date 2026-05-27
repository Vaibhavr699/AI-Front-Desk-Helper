"use strict";

// ═══════════════════════════════════════════════════════════════════════
// Phase 9B step 1 — per-vertical brand lists
// May 27, 2026
//
// Brand-name lookup tables for the brand_mention_count signal in
// conversation_linguistic_signals. Keyed by tenant.vertical_id (the same
// id used across the platform — painting=1, roofing=2, fence=4, exterior=6
// per the Paragon launch context).
//
// Why this lives in its own file:
//   - Brand lists will grow over time as we learn what customers actually
//     name. Keeping them isolated means the deterministic extractor itself
//     never changes.
//   - Per-vertical means a roofing tenant never gets credit for a customer
//     saying "Sherwin-Williams" in passing.
//
// Matching is whole-word, case-insensitive (see deterministic.js). Multi-
// word brands are fine — "Benjamin Moore" matches as one occurrence with
// flexible whitespace between the words.
//
// What NOT to include:
//   - Generic product categories ("paint", "shingles") — those are price
//     markers or sentence content, not brand precision cues.
//   - The tenant's own company name — irrelevant for DISC signal.
//   - Color names — too noisy ("white", "navy") and customers say them
//     constantly regardless of personality.
// ═══════════════════════════════════════════════════════════════════════

// Vertical 1 — Painting
// Starter list. Add more as we see what Gladiators customers actually name.
const PAINTING_BRANDS = [
  "Sherwin-Williams",
  "Sherwin Williams",
  "Benjamin Moore",
  "Behr",
  "Valspar",
  "PPG",
  "Dunn-Edwards",
  "Dunn Edwards",
  "Farrow & Ball",
  "Farrow and Ball",
  "Kilz",
  "Zinsser",
];

// Vertical 2 — Roofing
const ROOFING_BRANDS = [
  "GAF",
  "Owens Corning",
  "CertainTeed",
  "IKO",
  "Tamko",
  "Atlas",
  "Malarkey",
  "DaVinci",
  "Boral",
];

// Vertical 4 — Fence
const FENCE_BRANDS = [
  "Trex",
  "Veranda",
  "CertainTeed",
  "Bufftech",
  "ActiveYards",
  "Master Halco",
];

// Vertical 6 — Home Exterior (Paragon)
// Combines roofing brands (most overlap) with siding-specific names.
const EXTERIOR_BRANDS = [
  ...ROOFING_BRANDS,
  "James Hardie",
  "LP SmartSide",
  "Mastic",
  "CertainTeed Cedar Impressions",
  "Royal Building",
  "Ply Gem",
];

// Map from vertical_id → brand array.
const BRANDS_BY_VERTICAL = {
  1: PAINTING_BRANDS,
  2: ROOFING_BRANDS,
  4: FENCE_BRANDS,
  6: EXTERIOR_BRANDS,
};

/**
 * Return the brand list for a tenant's vertical, or [] if the vertical
 * has no list (yet). Never returns null — callers can pass the result
 * straight into extractBrandMentions.
 */
function getBrandListForVertical(verticalId) {
  if (!verticalId) return [];
  return BRANDS_BY_VERTICAL[verticalId] || [];
}

module.exports = {
  getBrandListForVertical,
  // Exported for tests + future tooling. Don't import these directly from
  // app code — go through getBrandListForVertical so future renames /
  // restructures stay in this file.
  PAINTING_BRANDS,
  ROOFING_BRANDS,
  FENCE_BRANDS,
  EXTERIOR_BRANDS,
  BRANDS_BY_VERTICAL,
};
