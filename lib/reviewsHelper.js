"use strict";

/**
 * lib/reviewsHelper.js
 *
 * Google Business Profile (Reviews) integration helpers.
 *
 * Exports five functions called by routes/reviews.js and
 * services/reviewScheduler.js:
 *
 *   getOAuthUrl(tenantId)
 *   handleOAuthCallback(tenantId, code)
 *   fetchGoogleReviews(tenant)
 *   generateAIDraft(tenant, review)
 *   postReplyToGoogle(tenant, googleReviewId, responseText)
 *
 * ── Auth model ─────────────────────────────────────────────────────────────
 * Each tenant connects their own Google Business Profile via OAuth. We store
 * per-tenant tokens on the tenants row:
 *
 *   google_access_token   — short-lived bearer (1 hr typical)
 *   google_refresh_token  — long-lived; used to mint new access tokens
 *   google_token_expiry   — ISO timestamp; refresh proactively if past
 *   google_account_id     — Google's account name (e.g. "accounts/12345")
 *   google_location_id    — primary location name (e.g. "locations/67890")
 *
 * Note: Calendar OAuth uses GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET, while
 * Reviews uses GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET. They are
 * separate OAuth clients (different prefixes). The tokens stored on the
 * tenants row by *this* file are issued by the Reviews client and are not
 * interchangeable with Calendar tokens. If a tenant has both Calendar AND
 * Reviews connected, we'd need separate token columns — currently we share
 * the same columns, so connecting Reviews will overwrite Calendar tokens.
 * (Drew: revisit if this becomes a problem; for now Calendar uses a service
 * account in most flows so this isn't blocking.)
 *
 * ── Reviews API endpoints ──────────────────────────────────────────────────
 * Account/location discovery uses the new split APIs:
 *   - mybusinessaccountmanagement.googleapis.com/v1/accounts
 *   - mybusinessbusinessinformation.googleapis.com/v1/{account}/locations
 *
 * Review list/reply still use the legacy v4 endpoints:
 *   - mybusiness.googleapis.com/v4/{account}/{location}/reviews
 *   - mybusiness.googleapis.com/v4/.../reviews/{id}/reply
 *
 * The v4 API has been "deprecated but not shut off" for years. If Google
 * finally retires it, the calls in fetchGoogleReviews/postReplyToGoogle
 * will start 404ing and we'll need to migrate. Not our problem today.
 *
 * ── Dependencies ───────────────────────────────────────────────────────────
 * Requires axios. If `npm ls axios` returns nothing, run:
 *   npm install axios
 * (likely already a transitive dep via other packages)
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
 * Refresh the tenant's access_token if it's missing, expired, or expires
 * within the next 60 seconds. Mutates the in-memory tenant object so
 * subsequent calls in the same request see the new token.
 *
 * Throws if no refresh_token is available — caller should handle that as
 * "tenant needs to re-OAuth" and surface to the UI.
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

  // mutate so caller's tenant object is fresh
  tenant.google_access_token = access_token;
  tenant.google_token_expiry = newExpiry;

  console.log("[Reviews] Token refreshed for tenant=%s (expires in %ds)", tenant.id, expires_in);
  return access_token;
}

/**
 * GET helper that auto-refreshes the token and includes Authorization.
 * If we get a 401, attempt one refresh + retry before giving up.
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
    // One retry on 401 (token may have been revoked or rotated server-side)
    if (err.response?.status === 401) {
      console.warn("[Reviews] 401 from Google — forcing token refresh and retrying once");
      tenant.google_token_expiry = new Date(Date.now() - 60_000).toISOString(); // force expiry
      await refreshAccessTokenIfNeeded(tenant);
      config.headers.Authorization = `Bearer ${tenant.google_access_token}`;
      return await axios(config);
    }
    throw err;
  }
}

// ── Public: getOAuthUrl ────────────────────────────────────────────────────
//
// Build the consent URL the frontend redirects to. State carries tenantId
// so handleOAuthCallback knows which tenant to write tokens against.
//
// access_type=offline + prompt=consent guarantees we get a refresh_token
// back (otherwise Google omits it on subsequent consents).

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

// ── Public: handleOAuthCallback ────────────────────────────────────────────
//
// Google redirected back with ?code=...&state=tenantId. Exchange the code
// for tokens, then discover the user's first GBP account and primary
// location, then persist all 5 fields to the tenants row.
//
// If the user's Google account doesn't manage any GBP locations, we save
// tokens but leave location_id null — the UI should show "Connected but
// no business profile found, please add a location in Google Business
// Profile and reconnect."

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
    // This usually means the user has previously consented and Google
    // omitted the refresh_token. We force prompt=consent in getOAuthUrl
    // to avoid this, but log a clear error if it slips through.
    console.warn(
      "[Reviews] Code exchange returned no refresh_token — Google omitted it. " +
      "Tenant=%s may need to revoke access at myaccount.google.com and reconnect.",
      tenantId
    );
  }

  const tokenExpiry = new Date(Date.now() + (expires_in - 30) * 1000).toISOString();

  // 2. Persist tokens immediately (we may need them in the location lookup
  //    step below, and we want to be able to retry that step without
  //    losing the refresh_token)
  await db.query(
    `UPDATE tenants
        SET google_access_token  = $1,
            google_refresh_token = COALESCE($2, google_refresh_token),
            google_token_expiry  = $3,
            updated_at           = now()
      WHERE id = $4`,
    [access_token, refresh_token || null, tokenExpiry, tenantId]
  );

  // Build a temporary tenant-like object so authedRequest can use it
  const tenant = {
    id: tenantId,
    google_access_token:  access_token,
    google_refresh_token: refresh_token,
    google_token_expiry:  tokenExpiry,
  };

  // 3. Fetch GBP account ID
  let accountName = null;
  try {
    const acctsRes = await authedRequest(
      tenant,
      "GET",
      `${ACCT_MGMT_BASE}/accounts`
    );
    const accounts = acctsRes.data?.accounts || [];
    if (accounts.length === 0) {
      console.warn("[Reviews] OAuth complete but tenant=%s has no GBP accounts", tenantId);
    } else {
      // Prefer PERSONAL or LOCATION_GROUP type if multiple — for now grab first
      accountName = accounts[0].name; // e.g. "accounts/12345"
      console.log("[Reviews] Found GBP account %s for tenant=%s", accountName, tenantId);
    }
  } catch (err) {
    console.error("[Reviews] accounts.list failed:", err.response?.data || err.message);
    // Don't throw — let user retry, tokens are already saved
  }

  // 4. Fetch primary location
  let locationName = null;
  if (accountName) {
    try {
      const locsRes = await authedRequest(
        tenant,
        "GET",
        `${BIZ_INFO_BASE}/${accountName}/locations`,
        { params: { readMask: "name,title,storefrontAddress" } }
      );
      const locations = locsRes.data?.locations || [];
      if (locations.length === 0) {
        console.warn("[Reviews] tenant=%s account %s has no locations", tenantId, accountName);
      } else {
        locationName = locations[0].name; // e.g. "locations/67890"
        console.log("[Reviews] Using location %s (%s) for tenant=%s",
          locationName, locations[0].title, tenantId);
      }
    } catch (err) {
      console.error("[Reviews] locations.list failed:", err.response?.data || err.message);
    }
  }

  // 5. Persist account + location
  await db.query(
    `UPDATE tenants
        SET google_account_id  = $1,
            google_location_id = $2,
            updated_at         = now()
      WHERE id = $3`,
    [accountName, locationName, tenantId]
  );

  console.log("[Reviews] OAuth complete for tenant=%s (account=%s, location=%s)",
    tenantId, accountName, locationName);
}

// ── Public: fetchGoogleReviews ─────────────────────────────────────────────
//
// Returns an array of normalized review objects:
//   { reviewId, comment, starRating, createTime, reviewer: { displayName } }
//
// Caller (services/reviewScheduler.js) is responsible for upserting into
// the google_reviews table and triggering AI draft generation.
//
// Uses legacy v4 API. Endpoint requires both account_id and location_id
// (path: /accounts/{a}/locations/{l}/reviews), so both must be populated
// on the tenant row before this works.

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
      params: { pageSize: 50 }, // first page only; pagination can be added later
    });
  } catch (err) {
    const detail = err.response?.data || err.message;
    console.error("[Reviews] reviews.list failed for tenant=%s:", tenant.id, detail);
    throw new Error("[Reviews] reviews.list failed: " + JSON.stringify(detail));
  }

  const reviews = res.data?.reviews || [];
  console.log("[Reviews] Got %d reviews for tenant=%s", reviews.length, tenant.id);

  // Normalize. Google's starRating field is a string enum: "ONE" | "TWO" | etc.
  const STAR_MAP = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };

  return reviews.map((r) => ({
    reviewId:   r.reviewId,
    comment:    r.comment || "",
    starRating: STAR_MAP[r.starRating] || 0,
    createTime: r.createTime,
    updateTime: r.updateTime,
    reviewer:   { displayName: r.reviewer?.displayName || "Anonymous" },
    raw:        r, // keep original for debugging
  }));
}

// ── Public: generateAIDraft ────────────────────────────────────────────────
//
// Calls OpenAI to write a reply draft. Tone: warm, professional, brief,
// uses the reviewer's first name when present, addresses the rating.
// Returns the draft string only.

async function generateAIDraft(tenant, review) {
  if (!OPENAI_API_KEY) throw new Error("[Reviews] OPENAI_API_KEY not configured");
  if (!tenant) throw new Error("[Reviews] generateAIDraft: tenant required");
  if (!review) throw new Error("[Reviews] generateAIDraft: review required");

  const businessName = tenant.company_name || tenant.name || "our team";
  const rating       = review.starRating || 0;
  const reviewerName = review.reviewer?.displayName || "the reviewer";
  const firstName    = reviewerName.split(/\s+/)[0];
  const reviewText   = (review.comment || "").trim();

  const systemPrompt =
    "You are a small-business owner replying to a Google review. " +
    "Write in first person. Be warm, sincere, and concise (2-4 sentences max). " +
    "Use the reviewer's first name if available. Do NOT use exclamation points more than once. " +
    "Do NOT use emojis. Do NOT use marketing phrases like 'we strive to'. " +
    "If the rating is 4-5 stars, thank them genuinely and mention something specific from " +
    "their review. If 1-3 stars, acknowledge their concern without being defensive, " +
    "apologize briefly, and invite them to contact the business directly to make it right. " +
    "Never promise refunds or specific actions. Sign off with the business name or a team member.";

  const userPrompt =
    `Business name: ${businessName}\n` +
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
//
// PUT to the legacy v4 reply endpoint. Google's API is idempotent here —
// posting a reply on a review that already has one updates it.

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
};
