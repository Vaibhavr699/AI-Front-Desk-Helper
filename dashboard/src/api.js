let API_BASE = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");
if (API_BASE && !/^https?:\/\//i.test(API_BASE)) {
  API_BASE = API_BASE.replace(/^https?:(?!\/\/)/i, "").replace(/^\/+/, "");
  API_BASE = "http://" + API_BASE;
}

function getToken() {
  return localStorage.getItem("token");
}

export async function api(path, options = {}) {
  const token = getToken();
  const headers = { "Content-Type": "application/json", ...options.headers };
  if (token) headers.Authorization = `Bearer ${token}`;

  // Apr 29, 2026 — superadmin impersonation. When impersonating a tenant
  // from the admin console, send the impersonated tenant ID as a header so
  // the backend (lib/auth.js getTenantIdFromQuery) can scope every request
  // to that tenant. Backend only honors this header when req.user.is_super_admin
  // is true — non-superadmins setting this manually will be ignored.
  const impersonatedTenantId = localStorage.getItem("impersonate_tenant_id");
  if (impersonatedTenantId) {
    headers["x-impersonate-tenant-id"] = impersonatedTenantId;
  }

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (res.status === 401) {
    const isAuthAttempt = path === "/api/auth/login" || path === "/api/auth/signup";
     if (!isAuthAttempt) {
      console.warn(`[auth] 401 bounce triggered by ${path}`, { status: res.status }); 
      localStorage.removeItem("token");
      localStorage.removeItem("user");
       window.location.href = "/";
    }
    throw new Error("Unauthorized");
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    const message =
      res.status === 404
        ? "Not found. It may have been removed or you don't have access."
        : err.error || res.statusText;
    throw new Error(message);
  }
  return res.json();
}

export function get(path, params = {}) {
  const q = new URLSearchParams(params);
  const fullPath = q.toString() ? `${path}?${q}` : path;
  return api(fullPath, { method: "GET" });
}

export function post(path, body = {}) {
  return api(path, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function patch(path, body = {}) {
  return api(path, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function del(path) {
  return api(path, { method: "DELETE" });
}

export async function postFormData(path, formData) {
  const token = getToken();
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers,
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

export async function login(email, password) {
  const data = await api("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  localStorage.setItem("token", data.token);
  localStorage.setItem("user", JSON.stringify(data.user));
  return data;
}

export async function signup(email, password) {
  const data = await api("/api/auth/signup", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  localStorage.setItem("token", data.token);
  localStorage.setItem("user", JSON.stringify(data.user));
  return data;
}

export async function logout() {
  try {
    await api("/api/auth/logout", { method: "POST" });
  } catch (_) {}
  localStorage.removeItem("token");
  localStorage.removeItem("user");
  localStorage.removeItem("tenantId");
}

export function getUser() {
  try {
    return JSON.parse(localStorage.getItem("user"));
  } catch {
    return null;
  }
}

// Apr 29, 2026 — superadmin impersonation aware.
// When impersonating, the backend's /api/tenants list still returns only the
// real user's accessible tenants (Drew's tenants, not Demo Painting Co). To
// make pages like RollupV5 + HqLocations resolve correctly, we fetch the
// impersonated tenant directly and prepend it to the list.
//
// Non-impersonation path is unchanged — single API call, same response shape.
export async function getTenants() {
  const data = await api("/api/tenants");
  const list = Array.isArray(data?.tenants) ? data.tenants : [];

  const impersonatedId = localStorage.getItem("impersonate_tenant_id");
  if (impersonatedId && !list.some((t) => t.id === impersonatedId)) {
    try {
      const impersonatedTenant = await api(`/api/tenants/${impersonatedId}`);
      // Prepend so list[0] resolves to the impersonated tenant in pages
      // that rely on getTenants()[0] as the "primary".
      return { ...data, tenants: [impersonatedTenant, ...list] };
    } catch (e) {
      // Couldn't fetch — fall through with original list. Pages will
      // fall back to list[0] (the user's own primary tenant).
      console.warn("[api] Failed to fetch impersonated tenant:", e.message);
    }
  }
  return data;
}

export async function createTenant(body) {
  const res = await fetch(`${API_BASE}/api/tenants`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: getToken() ? `Bearer ${getToken()}` : "",
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || res.statusText);
  }
  if (data.token) localStorage.setItem("token", data.token);
  if (data.user) localStorage.setItem("user", JSON.stringify(data.user));
  return data;
}

export function getTenant(id) {
  return api(`/api/tenants/${id}`);
}

export function getPlans() {
  return api("/api/plans");
}

export function updateTenant(id, body) {
  return api(`/api/tenants/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

// ── Service area (mig 068, May 14, 2026) ──────────────────────────────────
// PATCH the tenant's service area boundary. Three shapes accepted on the
// backend (states / radius / zips). Pass null to clear.
export function updateServiceArea(tenantId, serviceArea) {
  return api(`/api/tenants/${tenantId}/service-area`, {
    method: "PATCH",
    body: JSON.stringify({ service_area: serviceArea }),
  });
}

export function resetApiKey(id) {
  return api(`/api/tenants/${id}/reset-api-key`, {
    method: "POST",
  });
}

// ── Location rollup (Apr 20, 2026) ──
// Powers the Businesses page. One-shot endpoint that returns:
// { parent, summary, locations, insights }
// See GET /tenants/:parentId/rollup in routes/dashboard.js.
export function getTenantRollup(parentId) {
  return api(`/api/tenants/${parentId}/rollup`);
}

// ── Rollup V5 (Apr 23, 2026) ──────────────────────────────────────────────
// New parent tenant dashboard that replaces the V4 Businesses page.
// One-shot endpoint returning everything the page needs:
// { parent, meta, tiles, contact_method_donut, reviews_alerts, locations }.
// Backend: routes/rollupV5.js (mounted at /api/rollup-v5).

/**
 * Fetch the full Rollup V5 dashboard payload for a parent tenant.
 * @param {string} parentId - UUID of the parent tenant
 * @param {object} options  - { period?: '7d'|'30d'|'90d', sort?: string, dir?: 'asc'|'desc' }
 */
export function getRollupV5(parentId, options = {}) {
  const params = new URLSearchParams();
  if (options.period) params.set("period", options.period);
  if (options.sort)   params.set("sort", options.sort);
  if (options.dir)    params.set("dir", options.dir);
  const qs = params.toString();
  return api(`/api/rollup-v5/${parentId}${qs ? `?${qs}` : ""}`);
}

// ── HQ Full Rollup Dashboard (Apr 21, 2026) ──
// Three-tab dashboard: Overview / Activity / Alerts.
// Backend routes: routes/rollup.js (mounted at /api/rollup).
// Separate from getTenantRollup above (that one is the simpler Businesses page).

/**
 * Overview tab — aggregated KPIs + per-location cards for a parent tenant.
 * Returns { parent, locationCount, kpis, locations }.
 */
export function getRollupOverview(parentId) {
  return api(`/api/rollup/${parentId}/overview`);
}

/**
 * Activity tab — cross-location event feed from notifications.
 * options: { locationId?, before?, limit?, types? (array) }
 * Returns { events, nextCursor }.
 */
export function getRollupActivity(parentId, options = {}) {
  const params = new URLSearchParams();
  if (options.locationId) params.set("locationId", options.locationId);
  if (options.before) params.set("before", options.before);
  if (options.limit) params.set("limit", String(options.limit));
  if (Array.isArray(options.types) && options.types.length) {
    params.set("types", options.types.join(","));
  }
  const qs = params.toString();
  return api(`/api/rollup/${parentId}/activity${qs ? `?${qs}` : ""}`);
}

/**
 * Alerts tab — health signals (stalled leads, missed calls, negative reviews,
 * high hangup rate) across all child locations.
 * Returns { alerts }.
 */
export function getRollupAlerts(parentId) {
  return api(`/api/rollup/${parentId}/alerts`);
}

export function getCalls(tenantId, params = {}) {
  const extra = tenantId === 'all' ? { tenant_id: 'all', rollup: 'true', ...params } : { tenant_id: tenantId, ...params };
  const q = new URLSearchParams(extra);
  return api(`/api/calls?${q}`);
}

export function getCall(id) {
  return api(`/api/calls/${id}`);
}

export function updateCall(id, body) {
  return api(`/api/calls/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function getMetrics(tenantId, period = '30d') {
  const query = tenantId === 'all' ? `tenant_id=all&rollup=true&period=${period}` : `tenant_id=${tenantId}&period=${period}`;
  return api(`/api/metrics?${query}`);
}

export function getUsage(tenantId) {
  return api(`/api/billing/usage?tenant_id=${tenantId}`);
}

export function updateUsageAlerts(tenantId, thresholds, enabled) {
  return api(`/api/billing/alerts?tenant_id=${tenantId}`, {
    method: "POST",
    body: JSON.stringify({ thresholds, enabled }),
  });
}

export function getConversations(tenantId) {
  return api(`/api/conversations?tenant_id=${tenantId}`);
}

export function getTeam(tenantId = null) {
  const url = tenantId ? `/api/team?tenant_id=${tenantId}` : "/api/team";
  return api(url);
}

export function inviteTeamMember(data) {
  return api(`/api/team/invite`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function removeTeamMember(id) {
  return api(`/api/team/${id}`, {
    method: "DELETE",
  });
}

export function updateRepSeat(id, { active, tier }) {
  return patch(`/api/team/${id}/rep-seat`, { active, tier });
}

export function updateRepCoachEnabled(enabled, tenantId = null) {
  return patch(`/api/team/rep-coach`, { enabled, tenant_id: tenantId });
}

export function getTechnicians(tenantId = null) {
  const url = tenantId ? `/api/technicians?tenant_id=${tenantId}` : "/api/technicians";
  return api(url);
}

export function createTechnician(data) {
  return post("/api/technicians", data);
}

export function updateTechnician(id, data) {
  return patch(`/api/technicians/${id}`, data);
}

export function deleteTechnician(id) {
  return del(`/api/technicians/${id}`);
}

export function getConversationTimeline(leadId) {
  return api(`/api/conversations/${leadId}/timeline`);
}

export function getActivityFeed(tenantId) {
  const query = tenantId === 'all' ? 'tenant_id=all&rollup=true' : `tenant_id=${tenantId}`;
  return api(`/api/activity-feed?${query}`);
}

export async function getBookings(tenantId, params = {}) {
  const extra = tenantId === 'all' ? { tenant_id: 'all', rollup: 'true', ...params } : { tenant_id: tenantId, ...params };
  const q = new URLSearchParams(extra);
  return api(`/api/bookings?${q}`);
}

export async function updateBooking(id, data) {
  return api(`/api/bookings/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

/**
 * Cancel a booking with optional reason.
 * Phase 1 Cancellation Flow (May 4, 2026) — fires owner email + bell on success.
 */
export async function cancelBooking(id, reason = null) {
  return api(`/api/bookings/${id}/cancel`, {
    method: "POST",
    body: JSON.stringify({ reason: reason || null }),
  });
}

export function getFollowups(tenantId) {
  return api(`/api/followups?tenant_id=${tenantId}`);
}

export function triggerFollowupSms(id) {
  return api(`/api/followups/${id}/sms`, { method: "POST" });
}

export function triggerFollowupCall(id) {
  return api(`/api/followups/${id}/call`, { method: "POST" });
}

export function updateFollowupStatus(id, status) {
  return api(`/api/followups/${id}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status })
  });
}

export function getSalesWins(tenantId) {
  return api(`/api/sales-wins?tenant_id=${tenantId}`);
}

/** CRM / Leads */
export function getLeadsByTenant(tenantId, limit = 50, offset = 0) {
  return api(`/api/leads?tenantId=${tenantId}&limit=${limit}&offset=${offset}`);
}

export function getLeadById(id) {
  return api(`/api/leads/${id}`);
}

export function getLeadHistory(id) {
  return api(`/api/leads/${id}/history`);
}

export function updateLead(id, data) {
  return api(`/api/leads/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data)
  });
}

/**
 * Toggle the do_not_contact flag on a lead — Migration 059 (May 8, 2026).
 *
 * value=true cascades: backend cancels any active estimate recoveries and
 * pending nurturing schedule rows for the lead. Returns:
 *   { lead, cancelled_recoveries, cancelled_nurtures }
 *
 * value=false reopens the lead to future automation but leaves
 * previously-cancelled sequences cancelled.
 */
export function setLeadDoNotContact(id, value, reason = null) {
  return api(`/api/leads/${id}/do-not-contact`, {
    method: 'PATCH',
    body: JSON.stringify({ value, reason }),
  });
}

// ── Owner messaging / human handoff (May 12, 2026) ────────────────────────
// Phase 8. Lets dashboard users send manual SMS replies to leads from the
// Conversations page. Two complementary endpoints:
//
//   sendOwnerMessage — POST /api/leads/:id/send
//     Dispatches SMS via Twilio, records the message with sent_by_user_id
//     populated (distinguishes from AI-sent), and sets human_handoff_at on
//     the lead (idempotent — only the FIRST owner message in a session
//     updates the timestamp). Returns { message, lead }.
//
//     Throws on failure. Common cases:
//       - 422 → lead is on do-not-contact list (TCPA gate)
//       - 502 → Twilio send failed (Twilio error in message)
//       - 400 → validation error (empty body, missing phone, etc.)
//
//   resumeAi — POST /api/leads/:id/resume-ai
//     Clears human_handoff_at so the AI orchestrator resumes auto-responding
//     to future inbound SMS from this lead. Idempotent — calling on a lead
//     that isn't currently in handoff returns { lead, no_change: true }.

export function sendOwnerMessage(leadId, body, channel = "sms") {
  return api(`/api/leads/${leadId}/send`, {
    method: "POST",
    body: JSON.stringify({ body, channel }),
  });
}

export function resumeAi(leadId) {
  return api(`/api/leads/${leadId}/resume-ai`, {
    method: "POST",
  });
}

// ── Phase 7 E (May 18, 2026) — Rep quote entry + variance coaching ────────
// Called when the rep enters their real in-home quote total. Backend writes
// rep_quote_total_cents, clears any stale variance_coaching, then awaits
// GPT-4o variance coaching generation (~2-5s) if the quote differs from
// the widget ballpark by >=15%.
//
// totalDollars: number — the rep's quote in dollars (e.g. 1800 or 2475.50)
// Backend accepts either total_dollars (decimal) or total_cents (integer).
//
// Returns: { lead, variance_coaching_generated }
//   - lead: updated lead row with rep_quote_* and variance_coaching fields
//   - variance_coaching_generated: true if GPT-4o coaching was generated
//     (false when within threshold, no widget estimate, or GPT-4o failed)
//
// Throws on 4xx/5xx with the backend error message.
export function submitRepQuote(leadId, totalDollars) {
  return api(`/api/leads/${leadId}/quote-entered`, {
    method: "POST",
    body: JSON.stringify({ total_dollars: totalDollars }),
  });
}

// ── Phase 8E (May 19, 2026) — DISC Feedback Capture ───────────────────────
// Backs the Customer Intel card on LeadDetail. Owner/rep submits a verdict
// on whether the AI's DISC classification was accurate. Modal posts directly
// via the shared `post` helper; this helper is for reading prior feedback
// so the card can render the locked verdict state.
//
// Returns { feedback: [...] } — array of feedback rows, most recent first.
// Empty array if no feedback has been submitted yet.
export function getDiscFeedback(leadId) {
  return api(`/api/disc-feedback/leads/${leadId}`);
}

export function getPhoneNumbers(tenantId) {
  return api(`/api/phone-numbers?tenant_id=${tenantId}`);
}

export function addPhoneNumber(data) {
  return api("/api/phone-numbers", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function deletePhoneNumber(phoneId) {
  return api(`/api/phone-numbers/${phoneId}`, { method: "DELETE" });
}

export function updatePhoneNumber(phoneId, data) {
  return api(`/api/phone-numbers/${phoneId}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export function getAvailableNumbers(areaCode = "") {
  return api(`/api/twilio/available-numbers${areaCode ? `?area_code=${areaCode}` : ""}`);
}

export async function getRecordingAudioUrl(recordingId) {
  const token = getToken();
  const res = await fetch(`${API_BASE}/api/recordings/${recordingId}/audio`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error("Failed to load audio");
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

// ── Stripe ──

export function createCheckout(tenantId, planId, returnUrl, interval) {
  return api("/api/stripe/checkout", {
    method: "POST",
    body: JSON.stringify({ tenant_id: tenantId, plan_id: planId, return_url: returnUrl || window.location.origin + "/plans", interval }),
  });
}

export function createAddonNumberCheckout(tenantId) {
  return api("/api/stripe/checkout-addon-number", {
    method: "POST",
    body: JSON.stringify({ tenant_id: tenantId, return_url: window.location.origin + "/settings?tab=numbers" }),
  });
}

// ── Estimator Add-On (May 1, 2026) ────────────────────────────────────────
// Phase 7. Initiates Stripe Checkout for the $15/mo Estimator Add-On.
// Only relevant for Basic/Pro tier tenants — Elite/Franchise/HQ get it
// included by default. Returns { url, type } where url is the Stripe
// checkout URL — redirect window.location to it.
export function createEstimatorAddonCheckout(tenantId) {
  return api("/api/stripe/checkout-estimator-addon", {
    method: "POST",
    body: JSON.stringify({
      tenant_id: tenantId,
      return_url: window.location.origin + "/settings?tab=plans",
    }),
  });
}

export function cancelEstimatorAddon(tenantId) {
  return api(`/api/billing/cancel-estimator${tenantId ? `?tenant_id=${tenantId}` : ""}`, {
    method: "POST",
  });
}

// ── Per-service rate overrides (May 4, 2026) ──────────────────────────────
// Phase 7 V1.5. Lets tenants tune their estimator rates from Settings without
// SQL access. Each override is a percentage adjustment applied to default rates.

/**
 * Get all per-service rate overrides for a tenant.
 * Returns { overrides: { interior: { percentage_adjustment, updated_at }, ... } }
 * Empty object if no overrides set.
 */
export function getServiceRateOverrides(tenantId) {
  return api(`/api/estimator/rate-overrides/${tenantId}`);
}

/**
 * Get the services in the tenant's vertical (Phase 7 V2, May 12, 2026).
 * Used by the Estimator tab to render the correct rate-adjustment rows
 * per vertical (painting → 4 painting services, home_exterior → siding/
 * roofing/gutters/fence). Returns { services: [...] }.
 */
export function getVerticalServices(tenantId) {
  return api(`/api/vertical-services/${tenantId}`);
}

/**
 * Set or reset a single service rate override.
 * @param {string} tenantId
 * @param {string} serviceSlug - 'interior' | 'exterior' | 'cabinets' | 'deck_fence'
 * @param {number|null} percentageAdjustment - decimal (0.20 = +20%) or null to reset
 */
export function updateServiceRateOverride(tenantId, serviceSlug, percentageAdjustment) {
  return api(`/api/estimator/rate-overrides/${tenantId}`, {
    method: "PATCH",
    body: JSON.stringify({
      service_slug: serviceSlug,
      percentage_adjustment: percentageAdjustment,
    }),
  });
}

// ── Owner scope toggles (May 5, 2026) ─────────────────────────────────────
// Phase V2. Backs the "Standard Scope" section in Settings → Estimator tab.
// Owners configure what's included by default in their estimates (trim,
// ceilings, doors, etc.). Affects both estimator pricing AND the customer-
// facing "What's included" strip on the chat widget result screen.

/**
 * Get all services + scope toggles for the calling tenant.
 */
export function getScopeOptions() {
  return api("/api/scope-options");
}

/**
 * Bulk upsert scope toggle state.
 */
export function updateScopeOptions(changes) {
  return api("/api/scope-options", {
    method: "PUT",
    body: JSON.stringify({ changes }),
  });
}

// ── Recovery Toggle System (May 16, 2026) ─────────────────────────────────
// Phase 10. Backs the Configure Follow-ups drawer on the Follow-ups tab
// and the Recovery section on LeadDetail. Tenant-level toggles are gated
// by plan tier on the backend — Basic gets only master_enabled, Pro gets
// channels/triggers/cadence/quiet hours/auto-pause, Elite gets analytics.

/**
 * Load current recovery settings + tier allow-list for the calling tenant.
 * Returns { settings, tier_allowed_fields, presets, plan }.
 */
export function getRecoverySettings() {
  return api("/api/recovery/settings");
}

/**
 * Update one or more recovery_settings fields.
 * Fields not in tier_allowed_fields are silently rejected by the backend
 * and returned in the `rejected` array of the response.
 * Returns { settings, rejected }.
 */
export function updateRecoverySettings(updates) {
  return api("/api/recovery/settings", {
    method: "PATCH",
    body: JSON.stringify(updates),
  });
}

/**
 * Manually pause recovery sends for a single lead.
 * Cron + estimateRecovery service will skip this lead until resumed.
 */
export function pauseLeadRecovery(leadId, reason = "manual") {
  return api(`/api/recovery/leads/${leadId}/pause`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

export function resumeLeadRecovery(leadId) {
  return api(`/api/recovery/leads/${leadId}/resume`, {
    method: "POST",
  });
}

/**
 * Override the tenant cadence preset for a single lead.
 * Valid values: 'aggressive' | 'standard' | 'gentle' | 'single' | 'off' | null
 * Passing null clears the override (lead reverts to tenant default).
 */
export function updateLeadCadence(leadId, cadence) {
  return api(`/api/recovery/leads/${leadId}/cadence`, {
    method: "PATCH",
    body: JSON.stringify({ cadence }),
  });
}

// ── Phase 8B (May 20, 2026) — assign an estimator to a lead's booking ─────
// Writes bookings.technician_id for the lead's most recent active booking.
// The assigned technician receives the pre-visit briefing SMS.
// technicianId = a technicians.id, or null to unassign.
export function assignLeadTech(leadId, technicianId) {
  return patch(`/api/leads/${leadId}/assign-tech`, { technician_id: technicianId });
}

// ── Franchise zee subscribe (Apr 29, 2026) ────────────────────────────────
// Phase 6 Franchise. Initiates Stripe Checkout for a zee paying their own
// subscription. Returns { url, type } where url is the Stripe checkout URL
// (or billing portal URL if already subscribed) — redirect window.location.
// Throws on attempt to call when zee is on manual billing.
export function createFranchiseCheckout(tenantId, returnUrl) {
  return api("/api/stripe/franchise-checkout", {
    method: "POST",
    body: JSON.stringify({
      tenant_id: tenantId,
      return_url: returnUrl || window.location.origin + "/dashboard",
    }),
  });
}

export function openBillingPortal(tenantId) {
  return api("/api/stripe/portal", {
    method: "POST",
    body: JSON.stringify({ tenant_id: tenantId, return_url: window.location.origin + "/plans" }),
  });
}

export function getSubscriptionStatus(tenantId) {
  return api(`/api/stripe/status?tenant_id=${tenantId}`);
}

// ── Admin (Super Admin) ──

export function getAdminStats() {
  return api("/api/admin/stats");
}

export function getAdminTenants() {
  return api("/api/admin/tenants");
}

export function getAdminTenant(id) {
  return api(`/api/admin/tenants/${id}`);
}

export function updateTenantPricing(id, data) {
  return api(`/api/admin/tenants/${id}/pricing`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export function updateTenantBranding(id, brandMode) {
  return api(`/api/admin/tenants/${id}/branding`, {
    method: "PATCH",
    body: JSON.stringify({ brand_mode: brandMode }),
  });
}

/**
 * Custom domain (white-label DNS) API helpers — May 13, 2026.
 * Backs the Custom Domain section of the Branding tab.
 */

export function getCustomDomain(tenantId) {
  return api(`/api/branding/custom-domain`, {
    method: "GET",
    headers: { "x-tenant-id": tenantId },
  });
}

export function submitCustomDomain(tenantId, hostname) {
  return api(`/api/branding/custom-domain`, {
    method: "POST",
    headers: { "x-tenant-id": tenantId, "Content-Type": "application/json" },
    body: JSON.stringify({ hostname }),
  });
}

export function verifyCustomDomain(tenantId) {
  return api(`/api/branding/custom-domain/verify`, {
    method: "POST",
    headers: { "x-tenant-id": tenantId, "Content-Type": "application/json" },
  });
}

export function disconnectCustomDomain(tenantId) {
  return api(`/api/branding/custom-domain`, {
    method: "DELETE",
    headers: { "x-tenant-id": tenantId },
  });
}

export function removeTenantPricing(id) {
  return api(`/api/admin/tenants/${id}/pricing`, { method: "DELETE" });
}

export function suspendTenant(id, isSuspended, reason) {
  return api(`/api/admin/tenants/${id}/suspend`, {
    method: "PATCH",
    body: JSON.stringify({ is_suspended: isSuspended, suspended_reason: reason }),
  });
}

export function getAdmins() {
  return api("/api/admin/admins");
}

export function inviteAdmin(email) {
  return api("/api/admin/invite", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export function removeAdmin(id) {
  return api(`/api/admin/admins/${id}`, {
    method: "DELETE",
  });
}

// ── Admin: create franchise zee (Apr 29, 2026) ────────────────────────────
// Phase 6 Franchise. Provisions a zee tenant under an existing HQ.
// body: { hq_tenant_id, company_name, owner_email, monthly_override_cents? }
// Returns { success, tenant, hq, invite_link }.
export function createFranchiseZee(body) {
  return api("/api/admin/tenants/franchise-zee", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// List all franchise zees under a given HQ tenant.
// Returns { zees: [...] } — each zee includes effective_monthly,
// override_active, outbound_*_enabled, outbound_daily_max, billing_mode
// for the HQ Locations table UI.
export function listFranchiseZees(hqId) {
  return api(`/api/admin/tenants/${hqId}/zees`);
}

// Update a franchise zee's outbound gates (Apr 29, 2026 — Phase 6).
// body: { outbound_followup?, outbound_lists?, outbound_daily_max? }
// All fields optional — only provided fields get updated.
// Returns { success, addons } with the post-update gate state.
export function updateZeeOutboundGates(zeeId, body) {
  return api(`/api/admin/tenants/${zeeId}/outbound-gates`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

// Update a franchisor's shared-number routing (Jun 9, 2026 — Phase 6).
// Writes the master toggle + neutral ZIP-capture opener on the parent row.
// body: { enabled?, neutral_opener? } — both optional, only provided fields update.
// Returns { success, tenant } with the post-update values.
export function updateFranchiseSharedNumber(parentId, body) {
  return api(`/api/admin/tenants/${parentId}/franchise-shared-number`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

// List HQ-eligible tenants (paying for an HQ tier plan).
// Apr 29, 2026 — switched from parent_mode filter to HQ plan filter.
// parent_mode defaults to 'operating_hq' on every tenant row, so it's
// not a reliable HQ signal. Plan tier is the authoritative source —
// an HQ is a tenant that pays for hq_starter / hq_growth / hq_enterprise.
//
// Powers the HQ dropdown in CreateZeeModal. Filters client-side from the
// existing /api/admin/tenants response — no new backend endpoint needed.
const HQ_PLAN_IDS = ["hq_starter", "hq_growth", "hq_enterprise"];
export async function listHqTenants() {
  const data = await api("/api/admin/tenants");
  const tenants = Array.isArray(data?.tenants) ? data.tenants : [];
  return tenants.filter((t) => HQ_PLAN_IDS.includes(t.plan));
}

export function forgotPassword(email) {
  return api("/api/auth/forgot-password", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export function resetPassword(token, password) {
  return api("/api/auth/reset-password", {
    method: "POST",
    body: JSON.stringify({ token, password }),
  });
}

export function disconnectGoogleCalendar(tenantId) {
  return api(`/api/google-calendar/disconnect?tenantId=${tenantId}`, {
    method: "POST",
  });
}

/** Notifications */
export function getNotifications(tenantId, limit = 20) {
  return api(`/api/notifications?tenant_id=${tenantId}&limit=${limit}`);
}

export function markNotificationRead(id, tenantId) {
  return api(`/api/notifications/${id}/read?tenant_id=${tenantId}`, {
    method: "POST",
  });
}

export function markAllNotificationsRead(tenantId) {
  return api(`/api/notifications/mark-all-read?tenant_id=${tenantId}`, {
    method: "POST",
  });
}

// ── Reseller (authenticated) ── Phase 2 WL Reseller Account Type (Apr 20, 2026)
// Powers Reseller.jsx dashboard, AddCustomerSheet, ResellerPlans, ResellerWelcome.
// Backend routes: routes/reseller.js (mounted at /api/reseller).

export function getResellerOverview() {
  return api("/api/reseller/overview");
}

export function listResellerCustomers() {
  return api("/api/reseller/customers");
}

export function getResellerUsage() {
  return api("/api/reseller/usage");
}

/**
 * Preview adding a customer — dry-run cap check.
 * Returns { can_add, tier, customer_count, customer_limit, slots_remaining }
 * OR on 402 cap: { can_add: false, code: 'RESELLER_AT_CAP', current, limit, tier, next_tier }
 *
 * Uses direct fetch (not api() helper) because the shared helper throws on 402,
 * but we want the structured cap data so UI can render an upgrade CTA.
 */
export async function previewAddResellerCustomer() {
  const token = getToken();
  const res = await fetch(`${API_BASE}/api/reseller/customers/preview`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok && res.status !== 402) {
    throw new Error(data.error || res.statusText);
  }
  return data;
}

export function createResellerCustomer(body) {
  return api("/api/reseller/customers", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function getResellerCustomer(customerId) {
  return api(`/api/reseller/customers/${customerId}`);
}

export function updateResellerCustomer(customerId, body) {
  return api(`/api/reseller/customers/${customerId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function removeResellerCustomer(customerId) {
  return api(`/api/reseller/customers/${customerId}`, {
    method: "DELETE",
  });
}

export function resendResellerCustomerInvite(customerId) {
  return api(`/api/reseller/customers/${customerId}/resend-invite`, {
    method: "POST",
  });
}

export function getResellerTier() {
  return api("/api/reseller/tier");
}

/**
 * Initiate Stripe Checkout for initial subscription or tier change.
 * Returns { checkout_url, session_id } — redirect window.location to checkout_url.
 */
export function createResellerCheckout(tier, interval = "monthly") {
  return api("/api/reseller/checkout", {
    method: "POST",
    body: JSON.stringify({ tier, interval }),
  });
}

/**
 * Open Stripe Billing Portal for payment method / cancel / tier change.
 * Returns { portal_url }.
 */
export function openResellerBillingPortal() {
  return api("/api/reseller/billing-portal", {
    method: "POST",
    body: JSON.stringify({}),
  });
}

// ── Reseller (PUBLIC — no auth) ──
// These use direct fetch (NOT the api() helper) so the 401-redirect handler
// doesn't trigger on the public signup page where the user isn't logged in.

/**
 * Fetch branded info for the public signup page.
 * Returns { reseller: {...}, accepting_signups, at_cap, inactive }.
 */
export async function getResellerPublicInfo(code) {
  const res = await fetch(
    `${API_BASE}/api/reseller-public/${encodeURIComponent(code)}`
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

// ── Admin: create reseller tenant (Step 8) ────────────────────────────────
export function createResellerTenant(body) {
  return api("/api/admin/tenants/reseller", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/**
 * Submit public self-signup form.
 * body: { business_name, primary_email, phone }
 * Returns { success, message, customer: { id, name, primary_email } }.
 * May throw structured errors with .code set to one of:
 *   EMAIL_EXISTS, RESELLER_AT_CAP, RESELLER_INACTIVE,
 *   MISSING_FIELDS, INVALID_EMAIL, INVALID_NAME, RESELLER_NOT_FOUND.
 */
export async function submitResellerPublicSignup(code, body) {
  const res = await fetch(
    `${API_BASE}/api/reseller-public/${encodeURIComponent(code)}/signup`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || res.statusText);
    err.code = data.code || null;
    err.status = res.status;
    throw err;
  }
  return data;
}
