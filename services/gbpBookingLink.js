"use strict";

/**
 * services/gbpBookingLink.js
 *
 * GBP Booking-Link management — point a tenant's Google Business Profile
 * "Appointments" link at their OWN branded booking page (book.<domain>)
 * instead of a generic CRM/provider URL.
 *
 * Why this exists: high-intent customers click the "Appointments" link on the
 * Google listing. If that points anywhere but the tenant's conversion-
 * optimized booking page, bookings leak. This sets it to the page the tenant
 * controls (and which runs the full AIFDH booking + qualification flow).
 *
 * API: Google Business Profile "Place Actions" — a DIFFERENT host from the v4
 * endpoints used elsewhere, but the SAME OAuth scope (business.manage), so it
 * reuses reviewsHelper.authedRequest unchanged.
 *
 *   Host:  https://mybusinessplaceactions.googleapis.com/v1
 *   List:  GET  {host}/{location}/placeActionLinks
 *   Create:POST {host}/{location}/placeActionLinks
 *   Patch: PATCH {host}/{placeActionLink.name}?updateMask=uri,isPreferred
 *   Delete:DELETE {host}/{placeActionLink.name}
 *
 * IMPORTANT capability notes (learned from Google docs, confirm via Gladiators):
 *  - This sets the APPOINTMENT *link* (shows as "Appointments: yoursite.com"),
 *    NOT the blue "Reserve with Google" CTA button (that's a partner program).
 *  - A link added by a THIRD-PARTY PROVIDER (providerType=PROVIDER) may be
 *    NOT editable/deletable by us (isEditable=false). getBookingLinkStatus
 *    surfaces this so the UI can fall back to "remove it in GBP manually".
 *  - On the NEW LLC GCP project, the placeactions API may be gated until the
 *    Business Profile API access request (Gate 2) is approved; calls there can
 *    return api_not_enabled. We surface that cleanly → UI falls back to the
 *    copy-paste guide. On the OLD project (Gladiators) it should work today.
 */

const db = require("../lib/db");
const reviewsHelper = require("../lib/reviewsHelper");

const PLACE_ACTIONS_BASE = "https://mybusinessplaceactions.googleapis.com/v1";

// We only manage APPOINTMENT links here.
const APPOINTMENT_TYPE = "APPOINTMENT";

// ── Tenant loader (mirrors gbpPosting.getTenantContext shape) ───────────────

async function getTenantContext(tenantId) {
  const res = await db.query(
    `SELECT id, name, company_name,
            booking_domain, booking_domain_status,
            google_access_token, google_refresh_token, google_token_expiry,
            google_account_id, google_location_id
       FROM tenants WHERE id = $1`,
    [tenantId]
  );
  return res.rows[0] || null;
}

// Resolve the tenant's own booking URL — prefer the active branded domain,
// fall back to the public backend booking page. (Same logic as
// gbpPosting.resolveCtaUrl so the CTA and the appointment link agree.)
function resolveBookingUrl(tenant) {
  if (tenant.booking_domain && tenant.booking_domain_status === "active") {
    return `https://${tenant.booking_domain}`;
  }
  const base = (process.env.PUBLIC_BACKEND_URL || "https://ai-front-desk-backend.onrender.com").replace(/\/+$/, "");
  return `${base}/book/${tenant.id}`;
}

// Classify an axios error from the place-actions API into a stable reason the
// UI can branch on, instead of leaking raw Google payloads.
function classifyApiError(e) {
  const status = e.response?.status;
  const data = e.response?.data;
  const reasonStr = JSON.stringify(data || {}).toLowerCase();

  if (status === 403 || status === 404) {
    // PERMISSION_DENIED / SERVICE_DISABLED / API not enabled on this project.
    if (reasonStr.includes("disabled") || reasonStr.includes("has not been used") || reasonStr.includes("not enabled")) {
      return { reason: "api_not_enabled" };
    }
    if (reasonStr.includes("permission")) {
      return { reason: "permission_denied" };
    }
  }
  return { reason: "api_error", message: data ? JSON.stringify(data) : e.message };
}

/**
 * getBookingLinkStatus(tenantId)
 *
 * Reads the current APPOINTMENT place-action link(s) on the tenant's location
 * and reports what's there, so the UI can show:
 *   - "currently points to dripjobs.com (provider-set, not editable here)"
 *   - "points to your booking page already ✓"
 *   - "no appointment link set"
 *
 * Returns one of:
 *   { ok:true, connected:true, currentUri, isProvider, isEditable, isOurs, links:[...] }
 *   { ok:true, connected:true, currentUri:null, links:[] }   (none set)
 *   { ok:false, reason:"not_connected" }
 *   { ok:false, reason:"api_not_enabled" }                   (Gate-2 gated)
 *   { ok:false, reason:"permission_denied" | "api_error", message }
 */
async function getBookingLinkStatus(tenantId) {
  const tenant = await getTenantContext(tenantId);
  if (!tenant) return { ok: false, reason: "tenant_not_found" };
  if (!(tenant.google_location_id && (tenant.google_access_token || tenant.google_refresh_token))) {
    return { ok: false, reason: "not_connected" };
  }

  const url = `${PLACE_ACTIONS_BASE}/${tenant.google_location_id}/placeActionLinks`;

  let res;
  try {
    res = await reviewsHelper.authedRequest(tenant, "GET", url);
  } catch (e) {
    const c = classifyApiError(e);
    console.error("[GBP BookingLink] list failed tenant=%s: %s", tenantId,
      e.response?.data ? JSON.stringify(e.response.data) : e.message);
    return { ok: false, ...c };
  }

  const all = res.data?.placeActionLinks || [];
  const appts = all.filter(l => l.placeActionType === APPOINTMENT_TYPE);

  const ourUrl = resolveBookingUrl(tenant);
  const normalize = (u) => String(u || "").replace(/\/+$/, "").toLowerCase();

  // Prefer the "preferred" link if multiple appointment links exist.
  const primary = appts.find(l => l.isPreferred) || appts[0] || null;

  const links = appts.map(l => ({
    name:        l.name,                    // resource name for patch/delete
    uri:         l.uri,
    isEditable:  l.isEditable !== false,    // default true if unspecified
    isPreferred: !!l.isPreferred,
    providerType: l.providerType || null,   // "MERCHANT" | "AGGREGATOR" | unset
    isProvider:  l.providerType && l.providerType !== "MERCHANT",
  }));

  return {
    ok: true,
    connected: true,
    currentUri: primary ? primary.uri : null,
    isProvider: primary ? (primary.providerType && primary.providerType !== "MERCHANT") : false,
    isEditable: primary ? (primary.isEditable !== false) : true,
    isOurs:     primary ? normalize(primary.uri) === normalize(ourUrl) : false,
    ourBookingUrl: ourUrl,
    links,
  };
}

/**
 * setBookingLink(tenantId, { url? })
 *
 * Points the GBP APPOINTMENT link at the tenant's booking page (defaults to
 * their resolved booking URL). Strategy:
 *   1. List existing appointment links.
 *   2. If a MERCHANT (self) link already exists and is editable → PATCH its uri.
 *   3. Else → CREATE a new APPOINTMENT link, marked preferred.
 *   4. If a PROVIDER link (e.g. dripjobs.com) exists and blocks us, we still
 *      create our own preferred link; report that the provider link remains so
 *      the UI can tell the tenant to remove it in GBP if it still shows.
 *
 * Returns:
 *   { ok:true, action:"created"|"updated", uri, providerStillPresent:bool }
 *   { ok:false, reason:"not_connected"|"api_not_enabled"|"permission_denied"|"api_error", message }
 */
async function setBookingLink(tenantId, { url } = {}) {
  const tenant = await getTenantContext(tenantId);
  if (!tenant) return { ok: false, reason: "tenant_not_found" };
  if (!(tenant.google_location_id && (tenant.google_access_token || tenant.google_refresh_token))) {
    return { ok: false, reason: "not_connected" };
  }

  const targetUrl = (url && /^https?:\/\//i.test(url)) ? url : resolveBookingUrl(tenant);
  const listUrl = `${PLACE_ACTIONS_BASE}/${tenant.google_location_id}/placeActionLinks`;

  // 1. List current appointment links.
  let existing = [];
  let providerStillPresent = false;
  try {
    const res = await reviewsHelper.authedRequest(tenant, "GET", listUrl);
    const all = res.data?.placeActionLinks || [];
    existing = all.filter(l => l.placeActionType === APPOINTMENT_TYPE);
    providerStillPresent = existing.some(l => l.providerType && l.providerType !== "MERCHANT");
  } catch (e) {
    const c = classifyApiError(e);
    console.error("[GBP BookingLink] pre-list failed tenant=%s: %s", tenantId,
      e.response?.data ? JSON.stringify(e.response.data) : e.message);
    return { ok: false, ...c };
  }

  // 2. Find an editable self (MERCHANT) link to PATCH.
  const editableSelf = existing.find(
    l => l.isEditable !== false && (!l.providerType || l.providerType === "MERCHANT")
  );

  if (editableSelf) {
    const patchUrl = `${PLACE_ACTIONS_BASE}/${editableSelf.name}?updateMask=uri,isPreferred`;
    try {
      await reviewsHelper.authedRequest(tenant, "PATCH", patchUrl, {
        data: { uri: targetUrl, isPreferred: true },
      });
      console.log("[GBP BookingLink] UPDATED appointment link tenant=%s → %s", tenantId, targetUrl);
      return { ok: true, action: "updated", uri: targetUrl, providerStillPresent };
    } catch (e) {
      const c = classifyApiError(e);
      console.error("[GBP BookingLink] patch failed tenant=%s: %s", tenantId,
        e.response?.data ? JSON.stringify(e.response.data) : e.message);
      return { ok: false, ...c };
    }
  }

  // 3. No editable self link → CREATE one (preferred).
  try {
    await reviewsHelper.authedRequest(tenant, "POST", listUrl, {
      data: {
        placeActionType: APPOINTMENT_TYPE,
        uri: targetUrl,
        isPreferred: true,
      },
    });
    console.log("[GBP BookingLink] CREATED appointment link tenant=%s → %s", tenantId, targetUrl);
    return { ok: true, action: "created", uri: targetUrl, providerStillPresent };
  } catch (e) {
    const c = classifyApiError(e);
    console.error("[GBP BookingLink] create failed tenant=%s: %s", tenantId,
      e.response?.data ? JSON.stringify(e.response.data) : e.message);
    return { ok: false, ...c };
  }
}

/**
 * deleteBookingLink(tenantId, linkName)
 *
 * Remove a specific appointment link by resource name (e.g. to clear a stale
 * self-link). Provider links generally cannot be deleted via API — the call
 * will return permission_denied, which we surface for the UI.
 */
async function deleteBookingLink(tenantId, linkName) {
  if (!linkName) return { ok: false, reason: "link_name_required" };
  const tenant = await getTenantContext(tenantId);
  if (!tenant) return { ok: false, reason: "tenant_not_found" };
  if (!(tenant.google_location_id && (tenant.google_access_token || tenant.google_refresh_token))) {
    return { ok: false, reason: "not_connected" };
  }

  const url = `${PLACE_ACTIONS_BASE}/${linkName}`;
  try {
    await reviewsHelper.authedRequest(tenant, "DELETE", url);
    console.log("[GBP BookingLink] DELETED link tenant=%s name=%s", tenantId, linkName);
    return { ok: true };
  } catch (e) {
    const c = classifyApiError(e);
    console.error("[GBP BookingLink] delete failed tenant=%s: %s", tenantId,
      e.response?.data ? JSON.stringify(e.response.data) : e.message);
    return { ok: false, ...c };
  }
}

module.exports = {
  getBookingLinkStatus,
  setBookingLink,
  deleteBookingLink,
  // exported for reuse/testing
  resolveBookingUrl,
};
