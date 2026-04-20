import { api } from "../api";

/**
 * Locations API helpers.
 * All paths under /api/tenants/:parentId/locations
 * (See routes/dashboard.js Apr 19 location billing endpoints)
 */

export function listLocations(parentId) {
  return api(`/api/tenants/${parentId}/locations`, { method: "GET" });
}

export function previewLocation(parentId, body) {
  return api(`/api/tenants/${parentId}/locations/preview`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function createLocation(parentId, body) {
  return api(`/api/tenants/${parentId}/locations`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function removeLocation(parentId, childId) {
  return api(`/api/tenants/${parentId}/locations/${childId}`, {
    method: "DELETE",
  });
}

export function updateLocation(parentId, childId, body) {
  return api(`/api/tenants/${parentId}/locations/${childId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function resendFranchiseeInvite(childId, franchiseeEmail) {
  return api(`/api/franchisee/invite/${childId}/resend`, {
    method: "POST",
    body: JSON.stringify({ franchisee_email: franchiseeEmail }),
  });
}

/**
 * Retry a failed Stripe sync for a parent_pays child location.
 * Hits POST /api/tenants/:parentId/locations/:childId/retry-sync
 * Returns { ok, location, sync_status, stripe } on success,
 * or { ok: false, error, sync_status: 'failed' } on another failure.
 * See routes/dashboard.js retry endpoint (Apr 20, 2026).
 */
export function retryLocationStripeSync(parentId, childId) {
  return api(`/api/tenants/${parentId}/locations/${childId}/retry-sync`, {
    method: "POST",
  });
}
