"use strict";

/**
 * lib/reviewsHelper.js
 *
 * Google Business Profile (Reviews + GBP) integration helpers.
 *
 * Exports:
 *   getOAuthUrl(tenantId)
 *   handleOAuthCallback(tenantId, code)
 *   fetchGoogleReviews(tenant)
 *   generateAIDraft(tenant, review)
 *   postReplyToGoogle(tenant, googleReviewId, responseText)
 *   authedRequest(tenant, method, url, opts)
 *   listConnectableLocations(tenant)        ← multi-location
 *   setTenantLocation(tenantId, acct, loc)  ← multi-location
 *
 * ── Auth model ─────────────────────────────────────────────────────────────
 * Each tenant connects their own Google Business Profile via OAuth. We store
 * per-tenant tokens on the tenants row:
 *
 *   google_access_token   — short-lived bearer (1 hr typical)
 *   google_refresh_token  — long-lived; used to mint new access tokens
 *   google_token_expiry   — ISO timestamp; refresh proactively if past
 *   google_account_id     — Google's account name (e.g. "accounts/12345")
 *   google_location_id    — chosen location name (e.g. "locations/67890")
 *
 * Reviews uses GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET /
 * GOOGLE_REDIRECT_URI (separate from Calendar's GOOGLE_CLIENT_ID/SECRET).
 *
 * ── Multi-location ─────────────────────────────────────────────────────────
 * handleOAuthCallback auto-selects the location ONLY when the connected Google
 * account exposes exactly one. If more than one, it leaves google_location_id
 * NULL and the UI shows a picker (GET /locations → POST /select-location →
 * setTenantLocation). Single-location tenants are unaffected.
 */

const axios = require("axios");
const db    = require("./db");

const SCOPES = [
  "https://www.googleapis.com/auth/business.manage",
];

const GOOGLE_OAUTH_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_OAUTH_TOKEN_URL     = "https://oauth2.googleapis.com/token";

const ACCT_MGMT_BASE = "https://mybusinessaccountmanagement.googleapis.com/v1";
const BIZ_INFO_BASE  = "https://mybusinessbusinessinformation.googleapis.com/v1";
const LEGACY_V4_BASE = "https://mybusiness.googleapis.com/v4";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL   = process.env.OPENAI_REVIEWS_MODEL || "gpt-4o";

// ── Internal helpers ───────────────────────────────────────────────────────

function getOAuthClientCredentials() {
  const clientId     = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const redirectUri  = process.env.GOOGLE_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      "[Reviews] Missing OAuth env vars. Required: GOOGLE_OAUTH_CLIENT_ID, " +
      "GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_REDIRECT_URI"
    );
  }
  return { clientId, clientSecret, redirectUri };
}

/**
 * Refresh the tenant's access_token if missing/expired/within 60s of expiry.
 * Mutates the in-memory tenant object. Throws if no refresh_token (caller
 * should treat as "needs to re-OAuth").
 */
async function refreshAccessTokenIfNeeded(tenant) {
  if (!tenant) throw new Error("[Reviews] refreshAccessTokenIfNeeded: tenant is null");

  const expiry    = tenant.google_token_expiry ? new Date(tenant.google_token_expiry) : null;
  const expiresIn = expiry ? (expiry.getTime() - Date.now()) : -1;
  const stillFresh = tenant.google_access_token && expiry && expiresIn > 60_000;

  if (stillFresh) return tenant.google_access_token;

  if (!tenant.google_refresh_token) {
    throw new Error(
      "[Reviews] Tenant has no refresh_token — needs to re-connect Google Reviews"
    );
  }

  const { clientId, clientSecret } = getOAuthClientCredentials();

  console.log("[Reviews] Refreshing access token for tenant=%s", tenant.id);

  let tokenRes;
  try {
    tokenRes = await axios.post(
      GOOGLE_OAUTH_TOKEN_URL,
      new URLSearchParams({
        client_id:     clientId,
        client_secret: clientSecret,
        refresh_token: tenant.google_refresh_token,
        grant_type:    "refresh_token",
      }).toString(),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );
  } catch (err) {
    const detail = err.response?.data || err.message;
    console.error("[Reviews] Token refresh failed for tenant=%s:", tenant.id, detail);
    throw new Error("[Reviews] Token refresh failed: " + JSON.stringify(detail));
  }

  const { access_token, expires_in } = tokenRes.data;
  if (!access_token) {
    throw new Error("[Reviews] Token refresh returned no access_token");
  }

  const newExpiry = new Date(Date.now() + (expires_in - 30) * 1000).toISOString();

  await db.query(
    `UPDATE tenants
        SET google_access_token = $1,
            google_token_expiry = $2,
            updated_at          = now()
      WHERE id = $3`,
    [access_token, newExpiry, tenant.id]
  );

  tenant.google_access_token = access_token;
  tenant.google_token_expiry = newExpiry;

  console.log("[Reviews] Token refreshed for tenant=%s (expires in %ds)", tenant.id, expires_in);
  return access_token;
}

/**
 * Request helper that auto-refreshes the token and includes Authorization.
 * Retries once on a 401.
 */
async function authedRequest(tenant, method, url, { params, data } = {}) {
  await refreshAccessTokenIfNeeded(tenant);

  const config = {
    method,
    url,
    headers: {
      Authorization: `Bearer ${tenant.google_access_token}`,
      "Content-Type": "application/json",
    },
  };
  if (params) config.params = params;
  if (data)   config.data   = data;

  try {
    return await axios(config);
  } catch (err) {
    if (err.response?.status === 401) {
      console.warn("[Reviews] 401 from Google — forcing token refresh and retrying once");
      tenant.google_token_expiry = new Date(Date.now() - 60_000).toISOString();
      await refreshAccessTokenIfNeeded(tenant);
      config.headers.Authorization = `Bearer ${tenant.google_access_token}`;
      return await axios(config);
    }
    throw err;
  }
}

// Build a short human-readable address line from Google's storefrontAddress.
function formatAddress(addr) {
  if (!addr) return "";
  const parts = [];
  if (Array.isArray(addr.addressLines) && addr.addressLines.length) {
    parts.push(addr.addressLines.join(" "));
  }
  if (addr.locality)           parts.push(addr.locality);
  if (addr.administrativeArea) parts.push(addr.administrativeArea);
  return parts.filter(Boolean).join(", ");
}

// ── Public: getOAuthUrl ────────────────────────────────────────────────────

function getOAuthUrl(tenantId) {
  if (!tenantId) throw new Error("[Reviews] getOAuthUrl: tenantId required");

  const { clientId, redirectUri } = getOAuthClientCredentials();

  const params = new URLSearchParams({
    client_id:     clientId,
    redirect_uri:  redirectUri,
    response_type: "code",
    scope:         SCOPES.join(" "),
    access_type:   "offline",
    prompt:        "consent",
    state:         tenantId,
    include_granted_scopes: "true",
  });

  return `${GOOGLE_OAUTH_AUTHORIZE_URL}?${params.toString()}`;
}

// ── Public: listConnectableLocations ────────────────────────────────────────
//
// Returns every location the authorized Google account(s) can manage, across
// ALL accounts:
//   [{ accountName, locationName, title, address }]

async function listConnectableLocations(tenant) {
  if (!tenant) throw new Error("[Reviews] listConnectableLocations: tenant required");

  const acctsRes = await authedRequest(tenant, "GET", `${ACCT_MGMT_BASE}/accounts`);
  const accounts = acctsRes.data?.accounts || [];
  if (accounts.length === 0) return [];

  const out = [];

  for (const acct of accounts) {
    const accountName = acct.name; // "accounts/12345"
    try {
      let pageToken = null;
      do {
        const params = { readMask: "name,title,storefrontAddress", pageSize: 100 };
        if (pageToken) params.pageToken = pageToken;

        const locsRes = await authedRequest(
          tenant,
          "GET",
          `${BIZ_INFO_BASE}/${accountName}/locations`,
          { params }
        );

        const locs = locsRes.data?.locations || [];
        for (const loc of locs) {
          out.push({
            accountName,
            locationName: loc.name, // "locations/67890"
            title: loc.title || "(unnamed location)",
            address: formatAddress(loc.storefrontAddress),
          });
        }
        pageToken = locsRes.data?.nextPageToken || null;
      } while (pageToken);
    } catch (err) {
      console.error(
        "[Reviews] locations.list failed for account=%s: status=%s data=%s",
        accountName,
        err.response?.status,
        JSON.stringify(err.response?.data || {})
      );
      // Skip this account, keep going with others.
    }
  }

  return out;
}

// ── Public: setTenantLocation ───────────────────────────────────────────────
//
// Persist the user's chosen account+location. Validates the chosen location
// belongs to one of the tenant's currently-authorized accounts before storing.

async function setTenantLocation(tenantId, accountName, locationName) {
  if (!tenantId)     throw new Error("[Reviews] setTenantLocation: tenantId required");
  if (!accountName)  throw new Error("[Reviews] setTenantLocation: accountName required");
  if (!locationName) throw new Error("[Reviews] setTenantLocation: locationName required");

  const res = await db.query(
    `SELECT id, google_access_token, google_refresh_token, google_token_expiry
       FROM tenants WHERE id = $1`,
    [tenantId]
  );
  const tenant = res.rows[0];
  if (!tenant) throw new Error("[Reviews] setTenantLocation: tenant not found");
  if (!tenant.google_refresh_token && !tenant.google_access_token) {
    throw new Error("[Reviews] setTenantLocation: tenant has no Google tokens — reconnect first");
  }

  const connectable = await listConnectableLocations(tenant);
  const match = connectable.find(
    (l) => l.locationName === locationName && l.accountName === accountName
  );
  if (!match) {
    throw new Error(
      "[Reviews] setTenantLocation: chosen location is not in the tenant's authorized accounts"
    );
  }

  await db.query(
    `UPDATE tenants
        SET google_account_id  = $1,
            google_location_id = $2,
            updated_at         = now()
      WHERE id = $3`,
    [accountName, locationName, tenantId]
  );

  console.log("[Reviews] tenant=%s location set to %s (%s)",
    tenantId, locationName, match.title);

  return { ok: true, location: match };
}

// ── Public: handleOAuthCallback ────────────────────────────────────────────
//
// Exchange the code for tokens, then resolve location(s):
//   - exactly one location  → auto-select (unchanged single-location behavior)
//   - more than one         → leave location null; UI shows the picker
//   - zero                  → tokens saved, location null, UI shows "none found"

async function handleOAuthCallback(tenantId, code) {
  if (!tenantId) throw new Error("[Reviews] handleOAuthCallback: tenantId required");
  if (!code)     throw new Error("[Reviews] handleOAuthCallback: code required");

  const { clientId, clientSecret, redirectUri } = getOAuthClientCredentials();

  // 1. Exchange auth code for tokens
  console.log("[Reviews] Exchanging auth code for tokens, tenant=%s", tenantId);
  let tokenRes;
  try {
    tokenRes = await axios.post(
      GOOGLE_OAUTH_TOKEN_URL,
      new URLSearchParams({
        client_id:     clientId,
        client_secret: clientSecret,
        code,
        redirect_uri:  redirectUri,
        grant_type:    "authorization_code",
      }).toString(),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );
  } catch (err) {
    const detail = err.response?.data || err.message;
    console.error("[Reviews] Code exchange failed:", detail);
    throw new Error("[Reviews] Code exchange failed: " + JSON.stringify(detail));
  }

  const { access_token, refresh_token, expires_in } = tokenRes.data;
  if (!access_token) throw new Error("[Reviews] Code exchange returned no access_token");
  if (!refresh_token) {
    console.warn(
      "[Reviews] Code exchange returned no refresh_token — Google omitted it. " +
      "Tenant=%s may need to revoke access at myaccount.google.com and reconnect.",
      tenantId
    );
  }

  const tokenExpiry = new Date(Date.now() + (expires_in - 30) * 1000).toISOString();

  // 2. Persist tokens immediately, clearing any stale account/location so a
  //    reconnect re-resolves cleanly.
  await db.query(
    `UPDATE tenants
        SET google_access_token  = $1,
            google_refresh_token = COALESCE($2, google_refresh_token),
            google_token_expiry  = $3,
            google_account_id    = NULL,
            google_location_id   = NULL,
            updated_at           = now()
      WHERE id = $4`,
    [access_token, refresh_token || null, tokenExpiry, tenantId]
  );

  const tenant = {
    id: tenantId,
    google_access_token:  access_token,
    google_refresh_token: refresh_token,
    google_token_expiry:  tokenExpiry,
  };

  // 3. Discover every connectable location.
  let locations = [];
  try {
    locations = await listConnectableLocations(tenant);
  } catch (err) {
    console.error(
      "[Reviews] location discovery failed during callback tenant=%s: %s",
      tenantId, err.message
    );
    return { status: "discovery_failed" };
  }

  // 4. Decide based on count.
  if (locations.length === 0) {
    console.warn("[Reviews] OAuth complete but tenant=%s has no GBP locations", tenantId);
    return { status: "no_locations" };
  }

  if (locations.length === 1) {
    const only = locations[0];
    await db.query(
      `UPDATE tenants
          SET google_account_id  = $1,
              google_location_id = $2,
              updated_at         = now()
        WHERE id = $3`,
      [only.accountName, only.locationName, tenantId]
    );
    console.log("[Reviews] Auto-selected sole location %s (%s) for tenant=%s",
      only.locationName, only.title, tenantId);
    return { status: "connected", location: only };
  }

  console.log("[Reviews] tenant=%s has %d locations — awaiting user selection",
    tenantId, locations.length);
  return { status: "needs_selection", locations };
}

// ── Public: fetchGoogleReviews ─────────────────────────────────────────────

async function fetchGoogleReviews(tenant) {
  if (!tenant) throw new Error("[Reviews] fetchGoogleReviews: tenant required");
  if (!tenant.google_account_id || !tenant.google_location_id) {
    throw new Error(
      "[Reviews] tenant " + tenant.id + " missing google_account_id or google_location_id"
    );
  }

  const url = `${LEGACY_V4_BASE}/${tenant.google_account_id}/${tenant.google_location_id}/reviews`;

  console.log("[Reviews] Fetching reviews for tenant=%s loc=%s", tenant.id, tenant.google_location_id);

  let res;
  try {
    res = await authedRequest(tenant, "GET", url, {
      params: { pageSize: 50 },
    });
  } catch (err) {
    const detail = err.response?.data || err.message;
    console.error("[Reviews] reviews.list failed for tenant=%s:", tenant.id, detail);
    throw new Error("[Reviews] reviews.list failed: " + JSON.stringify(detail));
  }

  const reviews = res.data?.reviews || [];
  console.log("[Reviews] Got %d reviews for tenant=%s", reviews.length, tenant.id);

  const STAR_MAP = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };

  return reviews.map((r) => ({
    reviewId:      r.reviewId,
    comment:       r.comment || "",
    starRating:    STAR_MAP[r.starRating] || 0,
    createTime:    r.createTime,
    updateTime:    r.updateTime,
    reviewer:      { displayName: r.reviewer?.displayName || "Anonymous" },
    hasOwnerReply: !!r.reviewReply,
    raw:           r,
  }));
}

// ── Public: generateAIDraft ────────────────────────────────────────────────

async function generateAIDraft(tenant, review) {
  if (!OPENAI_API_KEY) throw new Error("[Reviews] OPENAI_API_KEY not configured");
  if (!tenant) throw new Error("[Reviews] generateAIDraft: tenant required");
  if (!review) throw new Error("[Reviews] generateAIDraft: review required");

  const businessName = tenant.company_name || tenant.name || "our team";
  const rating       = review.starRating || 0;
  const reviewerName = review.reviewer?.displayName || "the reviewer";
  const firstName    = reviewerName.split(/\s+/)[0];
  const reviewText   = (review.comment || "").trim();

  const city  = (tenant.city  || "").trim();
  const state = (tenant.state || "").trim();
  const localArea =
    city && state ? `${city}, ${state}` :
    city ? city :
    "";

  const systemPrompt =
    "You are a small-business owner replying to a Google review. " +
    "Write in first person. Be warm, sincere, and concise (2-4 sentences max). " +
    "Use the reviewer's first name if available. Do NOT use exclamation points more than once. " +
    "Do NOT use emojis. Do NOT use marketing phrases like 'we strive to'. " +
    "If the rating is 4-5 stars, thank them genuinely and mention something specific from " +
    "their review. If 1-3 stars, acknowledge their concern without being defensive, " +
    "apologize briefly, and invite them to contact the business directly to make it right. " +
    "Never promise refunds or specific actions. Sign off with the business name or a team member. " +
    (localArea
      ? "LOCAL SEO: Work in ONE natural, conversational reference to the business's local area " +
        `(${localArea}) — for example 'here in ${city}' or 'serving the ${city} area'. ` +
        "Use it at most once, woven in naturally. NEVER keyword-stuff, repeat the location, " +
        "or list it awkwardly. If it doesn't fit naturally, omit it entirely. Also feel free to " +
        "reference the service type (painting) once where it reads naturally."
      : "");

  const userPrompt =
    `Business name: ${businessName}\n` +
    (localArea ? `Business location: ${localArea}\n` : "") +
    `Reviewer first name: ${firstName}\n` +
    `Rating: ${rating} stars\n` +
    `Review text: ${reviewText || "(no text, just a star rating)"}\n\n` +
    `Write the reply.`;

  let res;
  try {
    res = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: OPENAI_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user",   content: userPrompt   },
        ],
        temperature: 0.7,
        max_tokens:  300,
      },
      {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (err) {
    const detail = err.response?.data || err.message;
    console.error("[Reviews] OpenAI draft failed:", detail);
    throw new Error("[Reviews] OpenAI draft failed: " + JSON.stringify(detail));
  }

  const draft = res.data?.choices?.[0]?.message?.content?.trim();
  if (!draft) throw new Error("[Reviews] OpenAI returned empty draft");

  console.log("[Reviews] Generated %d-char draft for review=%s tenant=%s",
    draft.length, review.reviewId, tenant.id);

  return draft;
}

// ── Public: postReplyToGoogle ──────────────────────────────────────────────

async function postReplyToGoogle(tenant, googleReviewId, responseText) {
  if (!tenant) throw new Error("[Reviews] postReplyToGoogle: tenant required");
  if (!googleReviewId) throw new Error("[Reviews] postReplyToGoogle: googleReviewId required");
  if (!responseText)   throw new Error("[Reviews] postReplyToGoogle: responseText required");
  if (!tenant.google_account_id || !tenant.google_location_id) {
    throw new Error(
      "[Reviews] tenant " + tenant.id + " missing google_account_id or google_location_id"
    );
  }

  const url = `${LEGACY_V4_BASE}/${tenant.google_account_id}/${tenant.google_location_id}/reviews/${googleReviewId}/reply`;

  console.log("[Reviews] Posting reply to review=%s tenant=%s", googleReviewId, tenant.id);

  try {
    await authedRequest(tenant, "PUT", url, {
      data: { comment: responseText },
    });
  } catch (err) {
    const detail = err.response?.data || err.message;
    console.error("[Reviews] reply.update failed:", detail);
    throw new Error("[Reviews] reply.update failed: " + JSON.stringify(detail));
  }

  console.log("[Reviews] Reply posted for review=%s tenant=%s", googleReviewId, tenant.id);
  return { success: true };
}

// ── Exports ────────────────────────────────────────────────────────────────

module.exports = {
  getOAuthUrl,
  handleOAuthCallback,
  fetchGoogleReviews,
  generateAIDraft,
  postReplyToGoogle,
  authedRequest,
  listConnectableLocations,
  setTenantLocation,
};
