"use strict";

// ============================================================================
// lib/websiteScore.js — Website Intelligence scorecard (Phase 2.1, Jun 26 2026)
// ============================================================================
//
// PURE FUNCTION. No I/O, no DB, no network. Takes the structured facts produced
// by lib/websiteExtractor.normalizeFacts and returns a scorecard:
//
//   {
//     score,            // 0–100 overall (the blend, after the booking dent)
//     discovery,        // 0–100 sub-score: "can a customer FIND this business?"
//     conversion,       // 0–100 sub-score: "once here, can they SECURE the lead?"
//     dimensions: [ { key, label, half, weight, raw, status, detail } ... ],
//     gaps: [ { key, label, severity, advice } ... ],   // weak dimensions only
//   }
//
// DESIGN (decided with Drew, Jun 26):
//   • Two halves, not one ranked list — because "get found" (SEO/discovery) and
//     "secure the lead" (conversion) are different funnel stages and a site
//     needs BOTH; acing one can't paper over failing the other.
//       - Discovery  = service_area (heaviest) + services (heavy, keyword
//         surface) + differentiators/trust as supporting search content.
//       - Conversion = booking_path (heaviest) + contact_methods (heavy) +
//         trust_signals (hesitation reducers) + pricing_cues (light; many
//         trades quote in person, so absence isn't a defect).
//   • Each dimension scores on SIGNAL STRENGTH, not mere presence (4 cities >
//     1 city, 8 services > 2) with diminishing returns so the rubric can't be
//     gamed by keyword-stuffing 30 services.
//   • Overall is a weighted blend of the two halves. A missing booking path
//     DENTS (not caps) the conversion half — Drew's call: a found-but-can't-book
//     site takes a real hit but isn't artificially crushed.
//   • Every dimension emits a severity-tagged gap when weak, mirroring
//     gbpAudit.js, so the card can surface the full detail regardless of the
//     number. Severity vocabulary matches GoogleBusinessProfile.jsx SEV_STYLE
//     (high | medium | low) so the merged Phase 2 card styles them identically.
//
// This is intentionally separable from the extractor + persistence: the scorer
// runs over already-extracted facts, so re-scoring (e.g. a rubric tweak) never
// requires re-crawling. services/websiteAudit.js calls scoreWebsiteFacts() on
// each run and stores { score, discovery, conversion, dimensions, gaps } into
// the website_audits.meta jsonb (no migration — jsonb grows).
// ============================================================================

// ── Half weights (how much each half contributes to the overall blend) ──────
// Slight tilt toward conversion: a found-but-leaky site wins fewer jobs than a
// harder-to-find site that converts the visits it does get. Kept close to even
// so neither half is ignorable. Sum = 1.0.
const HALF_WEIGHTS = { discovery: 0.48, conversion: 0.52 };

// ── Per-dimension weights WITHIN each half (each half's weights sum to 1.0) ──
const DISCOVERY_WEIGHTS = {
  service_area: 0.50, // heaviest — named cities are the #1 local + AI-search lever
  services:     0.38, // heavy — each named service is keyword surface (Drew's SEO point)
  search_trust: 0.12, // light — differentiators/trust as supporting search content
};
const CONVERSION_WEIGHTS = {
  booking_path:    0.46, // heaviest — the last inch; turns intent into a lead
  contact_methods: 0.26, // heavy — reachability (phone / form / click-to-call)
  trust_signals:   0.18, // medium — reduces hesitation at the decision moment
  pricing_cues:    0.10, // light — "free estimates" helps; absence isn't a defect
};

// ── Booking-path DENT ───────────────────────────────────────────────────────
// Applied to the conversion sub-score (NOT a hard cap). If there's no clear
// booking/contact path, multiply the conversion half by this factor. ~0.78
// knocks a strong conversion half down by roughly a fifth — a real, visible
// hit that drags the overall without flooring the site to the 50s.
const NO_BOOKING_DENT = 0.78;

// ── Diminishing-returns scorer ──────────────────────────────────────────────
// Maps a count of signals to a 0–1 strength. `full` is the count at which a
// dimension is considered fully satisfied; beyond it, returns stay ~1 (no
// reward for stuffing). Uses a concave curve so the first item is worth the
// most and each additional one adds less.
//   count 0           → 0
//   count >= full     → ~1
//   in between        → concave ramp
function strengthFromCount(count, full) {
  const n = Math.max(0, Number(count) || 0);
  if (n <= 0) return 0;
  if (n >= full) return 1;
  // 1 - (1 - n/full)^2  → concave: big jump for the first signals, tapering.
  const r = n / full;
  return 1 - (1 - r) * (1 - r);
}

// Count "meaningful" entries in a string array (non-empty, trimmed, deduped).
function cleanCount(arr) {
  if (!Array.isArray(arr)) return 0;
  const seen = new Set();
  for (const v of arr) {
    const s = String(v || "").trim().toLowerCase();
    if (s) seen.add(s);
  }
  return seen.size;
}

// Clamp + round to an integer 0–100.
function pct(x) {
  return Math.max(0, Math.min(100, Math.round(x * 100)));
}

// Severity from a 0–1 dimension strength + that dimension's importance weight.
// Heavier dimensions that are weak are more severe — a missing booking path is
// a bigger deal than missing pricing cues.
function severityFor(strength, weight) {
  if (strength >= 0.6) return null;            // healthy enough — no gap
  // Weak. Heavier dimensions escalate faster.
  if (strength <= 0.15 && weight >= 0.30) return "high";
  if (strength < 0.4 && weight >= 0.30) return "high";
  if (strength < 0.4) return "medium";
  return "low";                                 // 0.4–0.6, lighter weight
}

// ── Main entry point ────────────────────────────────────────────────────────
function scoreWebsiteFacts(facts) {
  const f = facts && typeof facts === "object" ? facts : {};

  const serviceAreaN   = cleanCount(f.service_area_mentions);
  const servicesN      = cleanCount(f.services);
  const differN        = cleanCount(f.differentiators);
  const trustN         = cleanCount(f.trust_signals);
  const contactN       = cleanCount(f.contact_methods);
  const pricingN       = cleanCount(f.pricing_cues);
  const bookingPresent = !!(f.booking_path && f.booking_path.present === true);
  const bookingLoc     = f.booking_path && f.booking_path.location ? String(f.booking_path.location) : null;

  // ── DISCOVERY dimensions ──────────────────────────────────────────────────
  // service_area: a local trade really wants ≥4 named towns; cap reward there.
  const serviceAreaStr = strengthFromCount(serviceAreaN, 4);
  // services: ≥6 named services reads as a full, keyword-rich offering.
  const servicesStr    = strengthFromCount(servicesN, 6);
  // search_trust: supporting search content = differentiators + trust combined;
  // 3 combined signals is plenty of "about us" substance for crawlers/AI.
  const searchTrustStr = strengthFromCount(differN + trustN, 3);

  const discoveryRaw =
    DISCOVERY_WEIGHTS.service_area * serviceAreaStr +
    DISCOVERY_WEIGHTS.services     * servicesStr +
    DISCOVERY_WEIGHTS.search_trust * searchTrustStr;

  // ── CONVERSION dimensions ─────────────────────────────────────────────────
  // booking_path: binary by nature — present is full credit, absent is zero
  // (the dent below adds an additional penalty to the whole half).
  const bookingStr  = bookingPresent ? 1 : 0;
  // contact_methods: 2 distinct methods (e.g. phone + form) = solid reachability.
  const contactStr  = strengthFromCount(contactN, 2);
  // trust_signals: ≥3 credibility cues meaningfully lower hesitation.
  const trustStr    = strengthFromCount(trustN, 3);
  // pricing_cues: even 1 cue ("free estimates") is most of the value here.
  const pricingStr  = strengthFromCount(pricingN, 2);

  let conversionRaw =
    CONVERSION_WEIGHTS.booking_path    * bookingStr +
    CONVERSION_WEIGHTS.contact_methods * contactStr +
    CONVERSION_WEIGHTS.trust_signals   * trustStr +
    CONVERSION_WEIGHTS.pricing_cues    * pricingStr;

  // Booking-path DENT: if no clear booking/contact path, knock the whole
  // conversion half down (real hit, not a floor).
  const dentApplied = !bookingPresent;
  if (dentApplied) conversionRaw *= NO_BOOKING_DENT;

  const discovery  = pct(discoveryRaw);
  const conversion = pct(conversionRaw);

  // ── Overall blend ─────────────────────────────────────────────────────────
  const overall = pct(
    HALF_WEIGHTS.discovery  * (discovery  / 100) +
    HALF_WEIGHTS.conversion * (conversion / 100)
  );

  // ── Dimension report (everything surfaced, healthy or not) ────────────────
  const dimensions = [
    {
      key: "service_area", label: "Service area", half: "discovery",
      weight: DISCOVERY_WEIGHTS.service_area, raw: serviceAreaStr,
      status: statusFromStrength(serviceAreaStr),
      detail: serviceAreaN > 0 ? `${serviceAreaN} city/area name${serviceAreaN === 1 ? "" : "s"} named` : "No service-area cities named",
    },
    {
      key: "services", label: "Services clarity", half: "discovery",
      weight: DISCOVERY_WEIGHTS.services, raw: servicesStr,
      status: statusFromStrength(servicesStr),
      detail: servicesN > 0 ? `${servicesN} service${servicesN === 1 ? "" : "s"} named` : "No specific services named",
    },
    {
      key: "search_trust", label: "About / trust content", half: "discovery",
      weight: DISCOVERY_WEIGHTS.search_trust, raw: searchTrustStr,
      status: statusFromStrength(searchTrustStr),
      detail: (differN + trustN) > 0 ? `${differN + trustN} differentiator/trust signal${(differN + trustN) === 1 ? "" : "s"}` : "Little about-us / credibility content",
    },
    {
      key: "booking_path", label: "Booking path", half: "conversion",
      weight: CONVERSION_WEIGHTS.booking_path, raw: bookingStr,
      status: bookingPresent ? "strong" : "missing",
      detail: bookingPresent ? `Clear booking/contact path${bookingLoc ? ` · ${bookingLoc}` : ""}` : "No clear way to book or contact found",
    },
    {
      key: "contact_methods", label: "Contact methods", half: "conversion",
      weight: CONVERSION_WEIGHTS.contact_methods, raw: contactStr,
      status: statusFromStrength(contactStr),
      detail: contactN > 0 ? `${contactN} contact method${contactN === 1 ? "" : "s"}` : "No contact methods detected",
    },
    {
      key: "trust_signals", label: "Trust signals", half: "conversion",
      weight: CONVERSION_WEIGHTS.trust_signals, raw: trustStr,
      status: statusFromStrength(trustStr),
      detail: trustN > 0 ? `${trustN} trust signal${trustN === 1 ? "" : "s"}` : "No trust signals (licensed, insured, warranty…)",
    },
    {
      key: "pricing_cues", label: "Pricing & offers", half: "conversion",
      weight: CONVERSION_WEIGHTS.pricing_cues, raw: pricingStr,
      status: statusFromStrength(pricingStr),
      detail: pricingN > 0 ? `${pricingN} pricing/offer cue${pricingN === 1 ? "" : "s"}` : "No pricing or offer cues",
    },
  ];

  // ── Gaps (weak dimensions only, severity-tagged, with advice) ─────────────
  const gaps = [];
  for (const d of dimensions) {
    // booking_path has bespoke handling so the advice names the dent.
    if (d.key === "booking_path") {
      if (!bookingPresent) {
        gaps.push({
          key: "booking_path",
          label: "No clear booking path",
          severity: "high",
          advice:
            "Visitors who are ready to buy can't find an obvious way to book or contact you. " +
            "Add a clear, repeated call-to-action (a header \"Book\"/\"Get a quote\" button and a contact link in the footer). " +
            "This is the single biggest lever for turning website visits into leads.",
        });
      }
      continue;
    }
    const sev = severityFor(d.raw, d.weight);
    if (!sev) continue;
    gaps.push({ key: d.key, label: gapLabel(d.key), severity: sev, advice: gapAdvice(d.key) });
  }

  // Order gaps high → medium → low so the card lists the most important first.
  const sevRank = { high: 0, medium: 1, low: 2 };
  gaps.sort((a, b) => (sevRank[a.severity] ?? 3) - (sevRank[b.severity] ?? 3));

  return {
    score: overall,
    discovery,
    conversion,
    dent_applied: dentApplied,
    dimensions,
    gaps,
    // light explanation block the card can show under the two sub-scores
    summary: {
      discovery_label: bandLabel(discovery),
      conversion_label: bandLabel(conversion),
      headline: headlineFor(discovery, conversion, bookingPresent),
    },
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function statusFromStrength(strength) {
  if (strength >= 0.8) return "strong";
  if (strength >= 0.6) return "ok";
  if (strength >= 0.3) return "weak";
  return "missing";
}

function bandLabel(score) {
  if (score >= 85) return "strong";
  if (score >= 65) return "solid";
  if (score >= 45) return "needs work";
  return "weak";
}

// A one-line read of the two halves so the owner instantly knows WHICH stage
// is leaking — far more actionable than a single mystery number.
function headlineFor(discovery, conversion, bookingPresent) {
  const d = discovery, c = conversion;
  if (d >= 70 && c >= 70) return "Strong on both getting found and securing the lead.";
  if (d >= 70 && c < 55) {
    return bookingPresent
      ? "You're easy to find, but the site could do more to convert visitors into leads."
      : "You're easy to find, but visitors are leaking — there's no clear way to book or contact you.";
  }
  if (d < 55 && c >= 70) return "Good at converting visitors, but the site is hard to find in local & AI search.";
  if (d < 55 && c < 55) return "The site needs work on both being found and securing the lead.";
  return "A solid base — a few targeted fixes would lift both discovery and conversion.";
}

function gapLabel(key) {
  return {
    service_area: "Service-area cities are thin",
    services: "Services aren't spelled out",
    search_trust: "Light on about-us / credibility content",
    contact_methods: "Few ways to get in touch",
    trust_signals: "Few trust signals",
    pricing_cues: "No pricing or offers mentioned",
  }[key] || key;
}

function gapAdvice(key) {
  return {
    service_area:
      "Name the specific towns and cities you serve, in text, on the site. This is the strongest lever for ranking in local search and for showing up when customers ask AI assistants \"who serves my area?\"",
    services:
      "List your services explicitly with their own words (e.g. \"cabinet painting\", \"deck staining\"). Each named service is a search term customers type — vague \"we do painting\" gets found for far less.",
    search_trust:
      "Add more about-us substance — years in business, what makes you different, affiliations. This gives search engines and AI assistants real content to surface about you.",
    contact_methods:
      "Offer more than one way to reach you — a click-to-call phone number and a contact form at minimum. Different visitors prefer different channels; missing one loses those leads.",
    trust_signals:
      "Surface credibility cues prominently — licensed & insured, warranty, years in business, brand affiliations. These reduce the hesitation that stops a visitor from reaching out.",
    pricing_cues:
      "Even without exact prices, a cue like \"free estimates\" or \"financing available\" lowers the barrier to making contact. Optional, but it nudges on-the-fence visitors.",
  }[key] || "";
}

module.exports = { scoreWebsiteFacts };
