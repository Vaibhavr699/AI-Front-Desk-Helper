"use strict";

// ============================================================================
// services/competitorAudit.js — competitive benchmark persistence (Phase 3.2)
// Jun 26, 2026
// ============================================================================
//
// Thin wrapper around lib/placesCompetitors (the fetch) that:
//   1. resolves WHICH search to run for this tenant (layered precedence),
//   2. runs the Places competitor pull,
//   3. (Phase 3.3 will benchmark here; for now it persists the raw pull so the
//      first real run can be verified before the scorer exists),
//   4. PERSISTS every run into competitor_audits (history kept).
//
// Mirrors services/websiteAudit.js (load → run → insert), one row per run.
//
// ── Search resolution (layered, agreed with Drew) ───────────────────────────
//   1. CUSTOM override  — tenant.competitor_search_term (+ radius) wins if set.
//   2. GBP category     — tenant's GBP primary_category (from gbp_audit
//                         snapshot) + their location → "<Category> near <city>".
//   3. CITY text        — fallback: "<industry> near <city>" / "painters near
//                         <city>" using tenant.city.
// Coordinates come from the GBP storefront if available, else null (Places
// still works on text alone, just less location-biased).
//
// Self-exclusion: we pass the tenant's own GBP place_id + business name so the
// fetch drops the tenant's own listing from the competitor set.
// ============================================================================

const db = require("../lib/db");
const placesCompetitors = require("../lib/placesCompetitors");

// Pull everything we need to resolve a search + exclude self, in one query.
// gbp_audit.profile_snapshot carries primary_category; tenants carries city/
// industry/override + (if your schema has them) lat/lng. We read defensively.
async function loadTenantForCompetitorSearch(tenantId) {
  const res = await db.query(
    `SELECT t.id,
            t.name,
            t.company_name,
            t.city,
            t.state,
            t.industry,
            t.competitor_search_term,
            t.competitor_search_radius_m,
            t.google_location_id,
            ga.profile_snapshot
       FROM tenants t
       LEFT JOIN gbp_audit ga ON ga.tenant_id = t.id
      WHERE t.id = $1`,
    [tenantId]
  );
  return res.rows[0] || null;
}

// Resolve the search term + strategy from the layered precedence.
// Returns { strategy, term, radiusM }.
function resolveSearch(tenant) {
  const city = String(tenant.city || "").trim();
  const radiusM = Number(tenant.competitor_search_radius_m) || undefined;

  // 1. Custom override.
  const custom = String(tenant.competitor_search_term || "").trim();
  if (custom) {
    return { strategy: "custom", term: custom, radiusM };
  }

  // 2. GBP primary category + city.
  let snapshot = tenant.profile_snapshot;
  if (typeof snapshot === "string") {
    try { snapshot = JSON.parse(snapshot); } catch { snapshot = null; }
  }
  const primaryCategory = snapshot && snapshot.primary_category
    ? String(snapshot.primary_category).trim()
    : "";
  if (primaryCategory && city) {
    return { strategy: "gbp_category", term: `${primaryCategory} near ${city}`, radiusM };
  }
  if (primaryCategory && !city) {
    return { strategy: "gbp_category", term: primaryCategory, radiusM };
  }

  // 3. City text fallback, using the tenant's trade where available.
  const trade = String(tenant.industry || "").trim();
  if (city) {
    const noun = trade ? `${trade}` : "painters";
    return { strategy: "city_text", term: `${noun} near ${city}`, radiusM };
  }

  // Nothing to search on.
  return { strategy: "none", term: "", radiusM };
}

// Coordinates for location bias, if the schema exposes them. Best-effort: we
// look for common column names but never fail if they're absent.
function resolveCoords(tenant) {
  const lat = Number(tenant.lat ?? tenant.latitude);
  const lng = Number(tenant.lng ?? tenant.longitude);
  if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  return { lat: null, lng: null };
}

// Run a fresh competitor pull for one tenant and persist the result.
// Returns { ok, reason, search, competitors, meta, audit_id }.
async function runCompetitorAuditForTenant(tenantId) {
  if (!tenantId) return { ok: false, reason: "no_tenant" };

  const tenant = await loadTenantForCompetitorSearch(tenantId);
  if (!tenant) return { ok: false, reason: "tenant_not_found" };

  const search = resolveSearch(tenant);
  if (!search.term) {
    return {
      ok: false,
      reason: "no_search_term",
      message: "Add the business city (or a custom competitor search term) before benchmarking.",
    };
  }

  const { lat, lng } = resolveCoords(tenant);

  const pull = await placesCompetitors.runCompetitorSearch({
    term: search.term,
    lat,
    lng,
    radiusM: search.radiusM,
    limit: 10,
    selfPlaceId: tenant.google_location_id || null,
    selfName: tenant.company_name || tenant.name || null,
  });

  // The benchmark scorer lands in Phase 3.3 — for now we persist the raw pull
  // so the first live run is verifiable (which API answered, which painters
  // came back) before any scoring logic depends on it. benchmark stays {}.
  const searchRecord = {
    strategy: search.strategy,
    term: search.term,
    lat,
    lng,
    radius_m: search.radiusM || null,
    api_used: pull.api_used || null,
  };

  const meta = {
    competitor_count: Array.isArray(pull.competitors) ? pull.competitors.length : 0,
    api_used: pull.api_used || null,
    warnings: pull.warnings || [],
    // tenant's own numbers at run time, for the benchmark to compare against later
    tenant_snapshot: tenantSnapshotFor(tenant),
  };

  let auditId = null;
  try {
    const ins = await db.query(
      `INSERT INTO competitor_audits (tenant_id, search, competitors, benchmark, meta)
            VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
      [
        tenantId,
        JSON.stringify(searchRecord),
        JSON.stringify(pull.competitors || []),
        JSON.stringify({}), // benchmark filled in Phase 3.3
        JSON.stringify(meta),
      ]
    );
    auditId = ins.rows[0]?.id || null;
  } catch (e) {
    console.error("[competitorAudit] persist failed tenant=%s: %s", tenantId, e.message);
  }

  console.log(
    "[competitorAudit] tenant=%s ok=%s api=%s competitors=%d strategy=%s reason=%s audit=%s",
    tenantId, pull.ok, pull.api_used || "none",
    meta.competitor_count, search.strategy, pull.reason || "none", auditId || "none"
  );

  return {
    ok: pull.ok,
    reason: pull.reason || null,
    search: searchRecord,
    competitors: pull.competitors || [],
    meta,
    audit_id: auditId,
  };
}

// Pull the tenant's own GBP numbers from the snapshot for later benchmarking.
function tenantSnapshotFor(tenant) {
  let snap = tenant.profile_snapshot;
  if (typeof snap === "string") {
    try { snap = JSON.parse(snap); } catch { snap = null; }
  }
  if (!snap || typeof snap !== "object") return null;
  return {
    review_total: snap.review_total ?? null,
    review_avg_rating: snap.review_avg_rating ?? null,
    photo_count: snap.photo_count ?? null,
    newest_photo_days: snap.newest_photo_days ?? null,
    days_since_last_post: snap.days_since_last_post ?? null,
  };
}

async function getLatestCompetitorAudit(tenantId) {
  if (!tenantId) return null;
  const res = await db.query(
    `SELECT id, search, competitors, benchmark, meta, created_at
       FROM competitor_audits
      WHERE tenant_id = $1
      ORDER BY created_at DESC
      LIMIT 1`,
    [tenantId]
  );
  return res.rows[0] || null;
}

module.exports = {
  runCompetitorAuditForTenant,
  getLatestCompetitorAudit,
  // exported for testing
  resolveSearch,
};
