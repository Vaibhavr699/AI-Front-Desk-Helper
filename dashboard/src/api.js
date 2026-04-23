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

export function getTenants() {
  return api("/api/tenants");
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

export async function getTechnicians(tenantId) {
  return api(`/api/technicians?tenant_id=${tenantId}`);
}

export async function createTechnician(tenantId, data) {
  return api(`/api/technicians?tenant_id=${tenantId}`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateTechnician(id, data) {
  return api(`/api/technicians/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function deleteTechnician(id) {
  return api(`/api/technicians/${id}`, { method: "DELETE" });
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
