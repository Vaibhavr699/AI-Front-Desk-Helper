"use strict";

// ============================================================================
// lib/presenceCrossRef.js — Website ⇄ GBP consistency check (Phase 2.2)
// Jun 26, 2026
// ============================================================================
//
// Reads the latest website_audits row (the extractor's facts) and the latest
// gbp_audit row (services / category / description-local signal) and produces a
// severity-tagged GAP LIST of the places the two sources DISAGREE — same shape
// as gbpAudit.gaps and websiteScore.gaps so all three render in one styled
// column when the Phase 2.3 card merge lands.
//
// ── Source-of-truth (decided with Drew) ─────────────────────────────────────
//   WEBSITE WINS for the AI's working facts (services, service area,
//   differentiators) — the site is the source the owner controls, so the AI
//   already speaks from it (see instructionGenerator.resolveWebsiteHint).
//   This module therefore does NOT re-resolve facts; it SURFACES the deltas so
//   the owner can bring the *Google-side* into line. Each gap's action is a
//   coaching nudge into an existing flow (Rewrite-with-AI for the description,
//   See-suggested-services for the list) — never an automated overwrite of the
//   tenant's Google profile.
//
// ── What it compares ────────────────────────────────────────────────────────
//   1. SERVICES delta — website facts.services[] vs gbp snapshot.service_names[]
//      Both sides are real lists, so this is precise: "5 services on your site
//      aren't on your Google profile: …". Strongest, fully-available comparison.
//   2. SERVICE-AREA signal — website facts.service_area_mentions[] vs the GBP
//      description's local signal. Two precision levels, auto-selected:
//        • PRECISE (preferred): if the GBP snapshot carries
//          service_area_places[] (added to gbpAudit.js in the same change),
//          name the exact cities the site lists that GBP's area is missing.
//        • COARSE (fallback): if that field isn't present yet (snapshot
//          predates the gbpAudit change), fall back to the boolean
//          description_is_local — "your site names N cities; your Google
//          description doesn't clearly name your area."
//      So it works the moment it deploys and sharpens after the next GBP audit.
//
// Pure-ish: one DB read per source, no network, no writes. Never throws — on
// any missing input it returns a structured "can't compare yet" reason so the
// card can show a calm empty state instead of an error.
// ============================================================================

const db = require("./db");

// ── Loaders ─────────────────────────────────────────────────────────────────

async function loadLatestWebsiteFacts(tenantId) {
  const res = await db.query(
    `SELECT facts, created_at FROM website_audits
      WHERE tenant_id = $1
      ORDER BY created_at DESC
      LIMIT 1`,
    [tenantId]
  );
  const row = res.rows[0];
  if (!row) return null;
  const facts = typeof row.facts === "string" ? safeParse(row.facts) : row.facts;
  return facts && typeof facts === "object" ? { facts, created_at: row.created_at } : null;
}

async function loadLatestGbpAudit(tenantId) {
  const res = await db.query(
    `SELECT health_score, gaps, profile_snapshot, generated_at
       FROM gbp_audit
      WHERE tenant_id = $1
      LIMIT 1`,
    [tenantId]
  );
  const row = res.rows[0];
  if (!row) return null;
  const snapshot =
    typeof row.profile_snapshot === "string"
      ? safeParse(row.profile_snapshot)
      : row.profile_snapshot;
  return {
    health_score: row.health_score,
    snapshot: snapshot && typeof snapshot === "object" ? snapshot : {},
    generated_at: row.generated_at,
  };
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}

// ── Normalization helpers ───────────────────────────────────────────────────

// Lowercased, trimmed, de-duped string set for comparison. Keeps a map back to
// the original-cased label so output reads naturally ("Cabinet Painting", not
// "cabinet painting").
function toLabelMap(arr) {
  const map = new Map(); // key(lower) -> original label
  if (Array.isArray(arr)) {
    for (const v of arr) {
      const orig = String(v || "").trim();
      if (!orig) continue;
      const key = orig.toLowerCase();
      if (!map.has(key)) map.set(key, orig);
    }
  }
  return map;
}

// Loose service matching: GBP and a website often phrase the same service
// slightly differently ("Interior Painting" vs "interior house painting").
// Treat them as the same if one label's key contains the other's, after
// stripping a few generic words. This avoids false "missing" flags.
const SERVICE_STOPWORDS = /\b(services?|painting|painters?|repair|installation|professional|residential|commercial)\b/g;

function serviceCore(key) {
  return key.replace(SERVICE_STOPWORDS, " ").replace(/\s+/g, " ").trim();
}

function siteServiceCoveredByGbp(siteKey, gbpKeys) {
  if (gbpKeys.has(siteKey)) return true;
  const siteCore = serviceCore(siteKey);
  if (!siteCore) return false;
  for (const gk of gbpKeys.keys()) {
    if (gk === siteKey) return true;
    const gCore = serviceCore(gk);
    if (!gCore) continue;
    if (gCore === siteCore) return true;
    // containment either direction (one is a fuller phrasing of the other)
    if (gCore.includes(siteCore) || siteCore.includes(gCore)) return true;
  }
  return false;
}

// City matching: compare on the first comma-segment, lowercased (the GBP
// place names can be "Papillion, NE"; site mentions are usually bare cities).
function cityKey(name) {
  return String(name || "").split(",")[0].trim().toLowerCase();
}

// ── Main entry point ─────────────────────────────────────────────────────────
// Returns:
//   {
//     ok: true,
//     gaps: [ { key, severity, label, advice, actionable?, ... } ],
//     compared: { website_at, gbp_at },
//     deltas: { services_missing_on_gbp: [...], cities_site: [...],
//               cities_missing_on_gbp: [...]|null, gbp_services: [...] }
//   }
// or { ok: false, reason } when one side isn't available yet.
async function buildPresenceCrossRef(tenantId) {
  if (!tenantId) return { ok: false, reason: "no_tenant", gaps: [] };

  let website, gbp;
  try {
    [website, gbp] = await Promise.all([
      loadLatestWebsiteFacts(tenantId),
      loadLatestGbpAudit(tenantId),
    ]);
  } catch (e) {
    console.error("[presenceCrossRef] load failed tenant=%s: %s", tenantId, e.message);
    return { ok: false, reason: "load_error", gaps: [] };
  }

  if (!website) return { ok: false, reason: "no_website_audit", gaps: [] };
  if (!gbp)     return { ok: false, reason: "no_gbp_audit", gaps: [] };

  const facts = website.facts || {};
  const snap = gbp.snapshot || {};
  const gaps = [];

  // ── 1. SERVICES delta ──────────────────────────────────────────────────────
  const siteServices = toLabelMap(facts.services);
  const gbpServices = toLabelMap(snap.service_names);

  const servicesMissingOnGbp = [];
  if (siteServices.size > 0) {
    for (const [key, label] of siteServices.entries()) {
      if (!siteServiceCoveredByGbp(key, gbpServices)) {
        servicesMissingOnGbp.push(label);
      }
    }
  }

  if (servicesMissingOnGbp.length > 0 && siteServices.size > 0) {
    // Severity scales with how much is missing: most of the site's services
    // absent from GBP is a real keyword-surface miss; one or two is a nudge.
    const missingRatio = servicesMissingOnGbp.length / siteServices.size;
    const severity = missingRatio >= 0.5 ? "medium" : "low";
    const shown = servicesMissingOnGbp.slice(0, 8);
    const more = servicesMissingOnGbp.length - shown.length;
    gaps.push({
      key: "xref_services_gap",
      severity,
      label:
        gbpServices.size === 0
          ? `Your site lists ${siteServices.size} services; your Google profile lists none`
          : `${servicesMissingOnGbp.length} service${servicesMissingOnGbp.length === 1 ? "" : "s"} on your site aren't on your Google profile`,
      advice:
        `Your website names ${shown.join(", ")}${more > 0 ? `, and ${more} more` : ""}. ` +
        `Adding these to your Google Business Profile creates more keyword surface for local and AI search — ` +
        `they're services you already do, just not listed where Google can rank them.`,
      actionable: "suggest_services",
      missing: servicesMissingOnGbp,
    });
  }

  // ── 2. SERVICE-AREA signal ──────────────────────────────────────────────────
  const siteCities = [];
  const seenCity = new Set();
  for (const c of Array.isArray(facts.service_area_mentions) ? facts.service_area_mentions : []) {
    const k = cityKey(c);
    if (k && !seenCity.has(k)) { seenCity.add(k); siteCities.push(String(c).trim()); }
  }

  let citiesMissingOnGbp = null; // null = couldn't compute precisely

  // PRECISE path: gbpAudit snapshot carries service_area_places[] (added in the
  // companion gbpAudit.js change). Name the exact cities GBP's area is missing.
  if (Array.isArray(snap.service_area_places)) {
    const gbpCityKeys = new Set(snap.service_area_places.map(cityKey).filter(Boolean));
    citiesMissingOnGbp = siteCities.filter((c) => !gbpCityKeys.has(cityKey(c)));

    if (siteCities.length > 0 && citiesMissingOnGbp.length > 0) {
      gaps.push({
        key: "xref_service_area_precise",
        severity: "medium",
        label: `Your Google profile's service area is missing ${citiesMissingOnGbp.length} cit${citiesMissingOnGbp.length === 1 ? "y" : "ies"} your site names`,
        advice:
          `Your website serves ${citiesMissingOnGbp.join(", ")}, but your Google Business Profile's service area / description doesn't reflect ${citiesMissingOnGbp.length === 1 ? "it" : "them"}. ` +
          `Naming your towns where Google can read them is the strongest lever for showing up in local and AI search for those areas. Use "Rewrite with AI" to fold them into your description.`,
        actionable: "rewrite_description",
        cities: citiesMissingOnGbp,
      });
    }
  } else {
    // COARSE path: only the boolean description_is_local is available. If the
    // site names cities but GBP's description doesn't clearly name the area,
    // surface a softer gap. (description_is_local comes from gbpAudit.)
    const gbpDescIsLocal = snap.description_is_local === true;
    if (siteCities.length > 0 && !gbpDescIsLocal) {
      gaps.push({
        key: "xref_service_area_coarse",
        severity: "low",
        label: `Your site names your service area; your Google description doesn't`,
        advice:
          `Your website names ${siteCities.slice(0, 4).join(", ")}${siteCities.length > 4 ? ", and more" : ""}, ` +
          `but your Google Business Profile description doesn't clearly name your city or service area. ` +
          `Adding your towns to the description helps you rank locally and in AI search. Use "Rewrite with AI".`,
        actionable: "rewrite_description",
        cities: siteCities,
      });
    }
  }

  // Order high → medium → low so the merged column lists the most important first.
  const sevRank = { high: 0, medium: 1, low: 2 };
  gaps.sort((a, b) => (sevRank[a.severity] ?? 3) - (sevRank[b.severity] ?? 3));

  return {
    ok: true,
    gaps,
    compared: {
      website_at: website.created_at || null,
      gbp_at: gbp.generated_at || null,
    },
    deltas: {
      gbp_services: [...gbpServices.values()],
      site_services: [...siteServices.values()],
      services_missing_on_gbp: servicesMissingOnGbp,
      cities_site: siteCities,
      cities_missing_on_gbp: citiesMissingOnGbp, // null in coarse mode
    },
    // surfaced so the card can show a one-line "in sync" state when empty
    in_sync: gaps.length === 0,
  };
}

module.exports = {
  buildPresenceCrossRef,
  // exported for testing
  siteServiceCoveredByGbp,
  toLabelMap,
  cityKey,
};
