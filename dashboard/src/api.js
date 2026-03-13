// Must be a full URL (e.g. http://localhost:3001). Fix missing scheme or "http:" typo (no "//").
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
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    window.location.href = "/";
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

export function logout() {
  localStorage.removeItem("token");
  localStorage.removeItem("user");
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

export function getCalls(tenantId, params = {}) {
  const q = new URLSearchParams({ tenant_id: tenantId, ...params });
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

export function getMetrics(tenantId) {
  return api(`/api/metrics?tenant_id=${tenantId}`);
}

export function getUsage(tenantId) {
  return api(`/api/billing/usage?tenant_id=${tenantId}`);
}

export function getConversations(tenantId) {
  return api(`/api/conversations?tenant_id=${tenantId}`);
}

export function getConversationTimeline(leadId) {
  return api(`/api/conversations/${leadId}/timeline`);
}

export function getActivityFeed(tenantId) {
  return api(`/api/activity-feed?tenant_id=${tenantId}`);
}

export async function getBookings(tenantId) {
  return api(`/api/bookings?tenant_id=${tenantId}`);
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

export function addPhoneNumber(tenantId, phone) {
  return api("/api/phone-numbers", {
    method: "POST",
    body: JSON.stringify({ phone, tenant_id: tenantId }),
  });
}

export function deletePhoneNumber(phoneId) {
  return api(`/api/phone-numbers/${phoneId}`, { method: "DELETE" });
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

export function createCheckout(tenantId, planId) {
  return api("/api/stripe/checkout", {
    method: "POST",
    body: JSON.stringify({ tenant_id: tenantId, plan_id: planId, return_url: window.location.origin + "/plans" }),
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

export function removeTenantPricing(id) {
  return api(`/api/admin/tenants/${id}/pricing`, { method: "DELETE" });
}

