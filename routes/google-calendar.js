"use strict";

const express = require("express");
const { google } = require("googleapis");
const db = require("../lib/db");
const router = express.Router();

const SCOPES = ["https://www.googleapis.com/auth/calendar"];

function getOAuth2Client() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const baseUrl = (process.env.BASE_URL || "").replace(/\/$/, "");
  const redirectUri = `${baseUrl}/auth/google/calendar/callback`;

  if (!clientId || !clientSecret) return null;

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

// ─── Initiate OAuth2 ───────────────────────────────────────────────────────────
// GET /auth/google/calendar/initiate?tenantId=<uuid>
// Redirects browser to Google consent screen
router.get("/initiate", (req, res) => {
  const tenantId = req.query.tenantId;
  if (!tenantId) return res.status(400).json({ error: "Missing tenantId" });

  const oauth2 = getOAuth2Client();
  if (!oauth2) {
    return res.status(500).json({ error: "Google OAuth2 credentials not configured on this server." });
  }

  const url = oauth2.generateAuthUrl({
    access_type: "offline",
    prompt: "consent", // Force consent to always get refresh_token
    scope: SCOPES,
    state: tenantId,    // Pass tenantId through OAuth state
  });

  res.redirect(url);
});

// ─── OAuth2 Callback ────────────────────────────────────────────────────────────
// GET /auth/google/calendar/callback?code=...&state=<tenantId>
// Google redirects here after user consents
router.get("/callback", async (req, res) => {
  const code = req.query.code;
  const tenantId = req.query.state;
  const error = req.query.error;

  if (error) {
    console.error("[Google Calendar] OAuth error:", error);
    return res.redirect(`/settings?tab=integrations&gcal=error&reason=${encodeURIComponent(error)}`);
  }

  if (!code || !tenantId) {
    return res.status(400).send("Missing authorization code or tenant ID.");
  }

  const oauth2 = getOAuth2Client();
  if (!oauth2) {
    return res.status(500).send("Google OAuth2 credentials not configured.");
  }

  try {
    // Exchange code for tokens
    const { tokens } = await oauth2.getToken(code);
    const refreshToken = tokens.refresh_token;

    if (!refreshToken) {
      console.error("[Google Calendar] No refresh_token received. User may have already authorized without revoking.");
      return res.redirect("/settings?tab=integrations&gcal=error&reason=no_refresh_token");
    }

    // Get the user's email from the token info
    oauth2.setCredentials(tokens);
    const oauth2Api = google.oauth2({ version: "v2", auth: oauth2 });
    let calendarEmail = "";
    try {
      const userInfo = await oauth2Api.userinfo.get();
      calendarEmail = userInfo.data.email || "";
    } catch (e) {
      console.warn("[Google Calendar] Could not fetch user email:", e.message);
    }

    // Save to tenant
    await db.query(
      `UPDATE tenants
       SET google_refresh_token = $1,
           google_calendar_linked = true,
           google_calendar_email = $2,
           google_calendar_id = 'primary',
           updated_at = now()
       WHERE id = $3`,
      [refreshToken, calendarEmail, tenantId]
    );

    console.log("[Google Calendar] Linked tenant=%s email=%s", tenantId, calendarEmail);

    // Redirect back to Settings
    res.redirect(`/settings?tab=integrations&gcal=success`);
  } catch (err) {
    console.error("[Google Calendar] Token exchange failed:", err.message);
    res.redirect(`/settings?tab=integrations&gcal=error&reason=${encodeURIComponent(err.message)}`);
  }
});

// ─── Disconnect ─────────────────────────────────────────────────────────────────
// POST /api/google-calendar/disconnect  (authed via dashboard middleware)
router.post("/disconnect", async (req, res) => {
  const tenantId = req.query.tenantId || req.body?.tenantId;
  if (!tenantId) return res.status(400).json({ error: "Missing tenantId" });

  try {
    // Optionally revoke the token with Google
    const row = await db.query("SELECT google_refresh_token FROM tenants WHERE id = $1", [tenantId]);
    const refreshToken = row.rows[0]?.google_refresh_token;
    if (refreshToken) {
      const oauth2 = getOAuth2Client();
      if (oauth2) {
        try {
          await oauth2.revokeToken(refreshToken);
        } catch (e) {
          console.warn("[Google Calendar] Token revocation failed (non-fatal):", e.message);
        }
      }
    }

    await db.query(
      `UPDATE tenants
       SET google_refresh_token = NULL,
           google_calendar_linked = false,
           google_calendar_email = NULL,
           updated_at = now()
       WHERE id = $1`,
      [tenantId]
    );

    console.log("[Google Calendar] Disconnected tenant=%s", tenantId);
    res.json({ ok: true });
  } catch (err) {
    console.error("[Google Calendar] Disconnect error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
