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
