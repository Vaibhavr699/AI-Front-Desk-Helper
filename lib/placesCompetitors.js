"use strict";

// ============================================================================
// lib/placesCompetitors.js — competitor pull via Google Places (Phase 3.1)
// Jun 26, 2026
// ============================================================================
//
// Finds the top painters (or any trade) near a tenant and returns a NORMALIZED
// list of public listing signals: name, rating, review_count,
// newest_review_days, photo_bucket, place_id. This is the ONLY place the
// Places API surface lives — the benchmark scorer downstream works on the
// normalized shape and never touches Google.
//
// ── DUAL-MODE (New + legacy auto-detect) ────────────────────────────────────
// "Places API" and "Places API (New)" are different products with different
// endpoints, auth, and response shapes. Rather than make the owner verify
// which one their key has, we TRY the New API first and fall back to legacy on
// an auth/not-enabled error, logging which one answered. The first real run
// tells us which API the key is provisioned for, via meta.api_used.
//
// ── HONEST SIGNALS ONLY ─────────────────────────────────────────────────────
// Places returns rating, review_count, up-to-5 recent reviews (→ newest-review
// age), and a (capped) photos array. It does NOT expose competitors'
// service lists or booking links, so those are deliberately absent here — the
// benchmark only compares on what Places can defensibly return.
//
// Never throws. On total failure returns { ok:false, reason, competitors:[] }
// plus warnings, so the caller can persist the attempt like the other audits.
// ============================================================================

const fetch = require("node-fetch");

const PLACES_KEY =
  process.env.GOOGLE_PLACES_API_KEY ||
  process.env.PLACES_API_KEY ||
  process.env.GOOGLE_MAPS_API_KEY ||
  "";

const NEW_BASE    = "https://places.googleapis.com/v1";
const LEGACY_BASE = "https://maps.googleapis.com/maps/api/place";

const DEFAULT_RADIUS_M = 25000; // ~15 miles
const FETCH_TIMEOUT_MS = 8000;
const DETAILS_TIMEOUT_MS = 7000;

// Photo presence is bucketed, not exact — Places caps the photos array, so a
// precise count past the cap would be a false number. Buckets are honest.
function photoBucket(n) {
  if (!n || n <= 0) return "none";
  if (n <= 3) return "sparse";
  if (n <= 8) return "moderate";
  return "healthy";
}

function daysSince(iso) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.round((Date.now() - t) / (1000 * 60 * 60 * 24));
}

function withTimeout(ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, done: () => clearTimeout(timer) };
}

// ── NEW API (places.googleapis.com/v1) ──────────────────────────────────────
// Text Search: POST /places:searchText with X-Goog-Api-Key + X-Goog-FieldMask.
async function searchTextNew(term, lat, lng, radiusM) {
  const t = withTimeout(FETCH_TIMEOUT_MS);
  try {
    const body = {
      textQuery: term,
      maxResultCount: 20,
    };
    // Bias toward the tenant's location when we have coordinates.
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      body.locationBias = {
        circle: { center: { latitude: lat, longitude: lng }, radius: radiusM || DEFAULT_RADIUS_M },
      };
    }
    const resp = await fetch(`${NEW_BASE}/places:searchText`, {
      method: "POST",
      signal: t.signal,
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": PLACES_KEY,
        // Field mask drives billing — request only what we score on.
        "X-Goog-FieldMask": [
          "places.id",
          "places.displayName",
          "places.rating",
          "places.userRatingCount",
          "places.photos",
          "places.reviews",
        ].join(","),
      },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const txt = await resp.text();
      return { ok: false, status: resp.status, body: txt.slice(0, 300) };
    }
    const data = await resp.json();
    return { ok: true, places: Array.isArray(data.places) ? data.places : [] };
  } catch (e) {
    return { ok: false, status: 0, body: e.name === "AbortError" ? "timeout" : e.message };
  } finally {
    t.done();
  }
}

// Normalize one New-API place object → our shape.
function normalizeNew(p) {
  // Reviews in the New API: publishTime on each; pick the newest.
  let newestDays = null;
  if (Array.isArray(p.reviews) && p.reviews.length) {
    for (const r of p.reviews) {
      const d = daysSince(r.publishTime);
      if (d != null && (newestDays == null || d < newestDays)) newestDays = d;
    }
  }
  const photoCount = Array.isArray(p.photos) ? p.photos.length : 0;
  return {
    place_id: p.id || null,
    name: p.displayName?.text || p.displayName || "(unnamed)",
    rating: Number.isFinite(p.rating) ? p.rating : null,
    review_count: Number.isFinite(p.userRatingCount) ? p.userRatingCount : 0,
    newest_review_days: newestDays,
    photo_bucket: photoBucket(photoCount),
    _photo_count_seen: photoCount, // capped; kept for debugging, not scored precisely
  };
}

// ── LEGACY API (maps.googleapis.com/maps/api/place) ─────────────────────────
// Text Search: GET /textsearch/json?query=...&key=...  then Details per place
// for review timestamps (textsearch doesn't return individual reviews).
async function searchTextLegacy(term, lat, lng, radiusM) {
  const t = withTimeout(FETCH_TIMEOUT_MS);
  try {
    const params = new URLSearchParams({ query: term, key: PLACES_KEY });
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      params.set("location", `${lat},${lng}`);
      params.set("radius", String(radiusM || DEFAULT_RADIUS_M));
    }
    const resp = await fetch(`${LEGACY_BASE}/textsearch/json?${params.toString()}`, {
      method: "GET",
      signal: t.signal,
    });
    if (!resp.ok) {
      const txt = await resp.text();
      return { ok: false, status: resp.status, body: txt.slice(0, 300) };
    }
    const data = await resp.json();
    // Legacy signals status in the body, not HTTP code.
    if (data.status && data.status !== "OK" && data.status !== "ZERO_RESULTS") {
      return { ok: false, status: data.status, body: data.error_message || data.status };
    }
    return { ok: true, places: Array.isArray(data.results) ? data.results : [] };
  } catch (e) {
    return { ok: false, status: 0, body: e.name === "AbortError" ? "timeout" : e.message };
  } finally {
    t.done();
  }
}

// Legacy textsearch gives rating + user_ratings_total + photos[] but NOT review
// timestamps. One Details call per competitor fills newest-review age. Best
// effort — a failed Details call just leaves newest_review_days null.
async function detailsLegacy(placeId) {
  if (!placeId) return null;
  const t = withTimeout(DETAILS_TIMEOUT_MS);
  try {
    const params = new URLSearchParams({
      place_id: placeId,
      key: PLACES_KEY,
      fields: "review",
    });
    const resp = await fetch(`${LEGACY_BASE}/details/json?${params.toString()}`, {
      method: "GET",
      signal: t.signal,
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    if (data.status !== "OK") return null;
    const reviews = data.result?.reviews || [];
    let newestDays = null;
    for (const r of reviews) {
      // legacy review.time is a unix seconds timestamp
      const d = r.time ? Math.round((Date.now() - r.time * 1000) / 86400000) : null;
      if (d != null && (newestDays == null || d < newestDays)) newestDays = d;
    }
    return newestDays;
  } catch {
    return null;
  } finally {
    t.done();
  }
}

function normalizeLegacy(p) {
  const photoCount = Array.isArray(p.photos) ? p.photos.length : 0;
  return {
    place_id: p.place_id || null,
    name: p.name || "(unnamed)",
    rating: Number.isFinite(p.rating) ? p.rating : null,
    review_count: Number.isFinite(p.user_ratings_total) ? p.user_ratings_total : 0,
    newest_review_days: null, // filled by detailsLegacy
    photo_bucket: photoBucket(photoCount),
    _photo_count_seen: photoCount,
  };
}

// Drop the tenant's own listing from the competitor set (match on place_id if
// known, else fuzzy name match) and any obvious non-competitors (no reviews
// at all are usually not real competitors / are noise).
function filterCompetitors(list, opts) {
  const selfId = opts.selfPlaceId ? String(opts.selfPlaceId) : null;
  const selfName = opts.selfName ? String(opts.selfName).toLowerCase().trim() : null;
  return list.filter((c) => {
    if (selfId && c.place_id === selfId) return false;
    if (selfName && c.name && c.name.toLowerCase().trim() === selfName) return false;
    return true;
  });
}

// ── Main entry point ─────────────────────────────────────────────────────────
// runCompetitorSearch({ term, lat, lng, radiusM, limit, selfPlaceId, selfName })
//   → { ok, api_used, competitors: [...], warnings: [], reason? }
// Tries New API first; on auth/not-enabled error falls back to legacy.
async function runCompetitorSearch(opts = {}) {
  const warnings = [];
  const term = String(opts.term || "").trim();
  const lat = Number(opts.lat);
  const lng = Number(opts.lng);
  const radiusM = Number(opts.radiusM) || DEFAULT_RADIUS_M;
  const limit = Math.max(1, Math.min(20, Number(opts.limit) || 10));

  if (!PLACES_KEY) {
    return { ok: false, reason: "no_api_key", api_used: null, competitors: [],
      warnings: ["No Places API key set (GOOGLE_PLACES_API_KEY)."] };
  }
  if (!term) {
    return { ok: false, reason: "no_search_term", api_used: null, competitors: [],
      warnings: ["No search term resolved for this tenant."] };
  }

  // 1) Try NEW API.
  let apiUsed = "new";
  let searchRes = await searchTextNew(term, lat, lng, radiusM);

  // Auth/not-enabled style failures → fall back to legacy. (403/404, or a
  // PERMISSION_DENIED-ish body.) Other errors (timeout, 5xx) we don't retry on
  // the other API since they're not "wrong product" signals.
  const looksLikeWrongProduct =
    !searchRes.ok &&
    (searchRes.status === 403 || searchRes.status === 404 ||
     /SERVICE_DISABLED|not enabled|PERMISSION_DENIED|API_KEY/i.test(String(searchRes.body || "")));

  if (looksLikeWrongProduct) {
    warnings.push(`Places API (New) unavailable (${searchRes.status}) — falling back to legacy.`);
    apiUsed = "legacy";
    searchRes = await searchTextLegacy(term, lat, lng, radiusM);
  }

  if (!searchRes.ok) {
    return {
      ok: false,
      reason: "search_failed",
      api_used: apiUsed,
      competitors: [],
      warnings: warnings.concat(`Competitor search failed (${apiUsed}): ${searchRes.status} ${searchRes.body || ""}`.trim()),
    };
  }

  // 2) Normalize.
  let competitors;
  if (apiUsed === "new") {
    competitors = (searchRes.places || []).map(normalizeNew);
  } else {
    competitors = (searchRes.places || []).map(normalizeLegacy);
    // Legacy needs a Details call per place for review freshness. Cap the
    // number of Details calls to the limit (after filtering) to control cost.
  }

  // 3) Drop self + noise, sort by review_count desc (proxy for prominence),
  //    take the top `limit`.
  competitors = filterCompetitors(competitors, opts)
    .filter((c) => c.review_count > 0 || c.rating != null)
    .sort((a, b) => (b.review_count || 0) - (a.review_count || 0))
    .slice(0, limit);

  // 4) Legacy freshness backfill (bounded to the chosen set).
  if (apiUsed === "legacy") {
    for (const c of competitors) {
      c.newest_review_days = await detailsLegacy(c.place_id);
    }
  }

  if (competitors.length === 0) {
    warnings.push("No competitors found for this search — the area may be sparse or the term too narrow.");
  }

  // Strip the debug-only photo count before returning the clean set.
  const clean = competitors.map(({ _photo_count_seen, ...rest }) => rest);

  return {
    ok: competitors.length > 0,
    reason: competitors.length > 0 ? null : "no_competitors",
    api_used: apiUsed,
    competitors: clean,
    warnings,
  };
}

module.exports = {
  runCompetitorSearch,
  // exported for testing
  photoBucket,
  normalizeNew,
  normalizeLegacy,
  filterCompetitors,
};
