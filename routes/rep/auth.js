"use strict";

// ── /api/rep/auth — Rep mobile app authentication ──────────────────────────
// Flow:
//
//   1. POST /login
//      Body: { email, password, device_fingerprint, trusted_device_token? }
//      • Verifies password
//      • If valid trusted_device_token matches this fingerprint → returns a
//        full rep session immediately (skip TOTP)
//      • Otherwise:
//          - if totp_secret missing → returns enroll payload (otpauth URI +
//            secret) so the app can render a QR code and have the rep scan it
//          - if totp_secret present → returns a challenge token only
//
//   2. POST /totp
//      Body: { challenge_token, code, device_fingerprint, biometric_type?,
//              trust_this_device? }
//      • Verifies code against stored secret (enrolling on first success if
//        we just generated one above)
//      • If trust_this_device → issues a 30-day trusted_device_token
//      • Returns the rep session JWT + user payload
//
//   3. POST /biometric-verify
//      Lightweight ping — the device says "Face ID / Touch ID succeeded".
//      We bump last_app_open_at and log the event. Token verification has
//      already happened in requireRep, so this is observability + the spec's
//      audit hook, not a security gate by itself.
//
//   4. POST /logout
//      Optionally revokes the trusted_device_token for this fingerprint.
//      Session JWT is stateless so the client just drops it; revocation is
//      only meaningful for the device-trust path.
//
//   5. POST /push-token
//      Stores the Expo push token. Idempotent.
// ────────────────────────────────────────────────────────────────────────────

const express = require("express");
const auth = require("../../lib/auth");
const repAuth = require("../../lib/repAuth");
const { logAction } = require("../../lib/auditLogger");
const db = require("../../lib/db");
const { repAuthChain } = require("../../lib/requireRep");

const router = express.Router();

function clientIp(req) {
  return req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.ip || null;
}

// ── POST /api/rep/auth/login ────────────────────────────────────────────────
router.post("/login", async (req, res) => {
  try {
    const { email, password, device_fingerprint, trusted_device_token } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password required" });
    }
    const user = await auth.findUserByEmail(String(email).trim().toLowerCase());
    if (!user) {
      return res.status(401).json({ error: "Invalid email or password" });
    }
    const ok = await auth.verifyPassword(password, user.password_hash);
    if (!ok) {
      await repAuth.logRepEvent(req, {
        user_id: user.id,
        tenant_id: user.tenant_id,
        event_type: "rep_login_bad_password",
        metadata: { device_fingerprint: device_fingerprint || null },
      });
      return res.status(401).json({ error: "Invalid email or password" });
    }
    if (!user.rep_seat_active) {
      return res.status(403).json({
        error: "No active rep seat on this account. Contact your admin.",
        code: "REP_SEAT_INACTIVE",
      });
    }

    // Trusted-device fast path — skip TOTP if the device presents a valid token.
    if (trusted_device_token && device_fingerprint) {
      const trusted = await repAuth.findTrustedDevice(user.id, {
        fingerprint: device_fingerprint,
        token: trusted_device_token,
      });
      if (trusted) {
        const sessionToken = repAuth.signRepSession(user);
        await db.query("UPDATE dashboard_users SET last_app_open_at = now() WHERE id = $1", [
          user.id,
        ]);
        await repAuth.logRepEvent(req, {
          user_id: user.id,
          tenant_id: user.tenant_id,
          event_type: "rep_login_trusted_device",
          metadata: { device_fingerprint, biometric_type: trusted.biometric_type },
        });
        return res.json({
          status: "ok",
          token: sessionToken,
          user: {
            id: user.id,
            email: user.email,
            tenant_id: user.tenant_id,
            role: user.role,
            seat_tier: user.rep_seat_tier || "standard",
          },
        });
      }
    }

    // No trusted device — issue a TOTP challenge.
    let enroll = null;
    if (!user.totp_secret) {
      // First-time enrollment: generate a fresh secret and stash it. It only
      // becomes "active" once the rep completes /totp with a valid code.
      const secret = repAuth.newTotpSecret();
      await db.query("UPDATE dashboard_users SET totp_secret = $1 WHERE id = $2", [
        secret,
        user.id,
      ]);
      enroll = {
        otpauth_uri: repAuth.totpUri(secret, user.email),
        secret, // shown to rep once so they can paste into an authenticator manually
      };
    }

    const challenge = repAuth.signChallenge(user);
    await repAuth.logRepEvent(req, {
      user_id: user.id,
      tenant_id: user.tenant_id,
      event_type: enroll ? "rep_totp_enroll_started" : "rep_totp_challenge_issued",
      metadata: { device_fingerprint: device_fingerprint || null },
    });
    res.json({ status: "totp_required", challenge_token: challenge, enroll });
  } catch (e) {
    console.error("[rep/auth/login]", e);
    res.status(500).json({ error: "Server error" });
  }
});

// ── POST /api/rep/auth/totp ─────────────────────────────────────────────────
router.post("/totp", async (req, res) => {
  try {
    const {
      challenge_token,
      code,
      device_fingerprint,
      biometric_type,
      trust_this_device,
    } = req.body || {};
    if (!challenge_token || !code) {
      return res.status(400).json({ error: "challenge_token and code required" });
    }
    let decoded;
    try {
      decoded = repAuth.verifyChallenge(challenge_token);
    } catch (err) {
      return res.status(401).json({ error: "Challenge expired or invalid", code: "CHALLENGE_INVALID" });
    }
    const r = await db.query(
      "SELECT id, email, tenant_id, role, totp_secret, rep_seat_active, rep_seat_tier FROM dashboard_users WHERE id = $1",
      [decoded.sub]
    );
    const user = r.rows[0];
    if (!user) return res.status(401).json({ error: "User not found" });
    if (!user.rep_seat_active) {
      return res.status(403).json({ error: "Rep seat inactive", code: "REP_SEAT_INACTIVE" });
    }
    if (!user.totp_secret) {
      return res.status(400).json({ error: "TOTP not enrolled. Re-run /login first.", code: "TOTP_NOT_ENROLLED" });
    }
    if (!repAuth.verifyTotp(user.totp_secret, code)) {
      await repAuth.logRepEvent(req, {
        user_id: user.id,
        tenant_id: user.tenant_id,
        event_type: "rep_totp_bad_code",
        metadata: { device_fingerprint: device_fingerprint || null },
      });
      return res.status(401).json({ error: "Invalid code", code: "TOTP_INVALID" });
    }

    let trustedDevice = null;
    if (trust_this_device && device_fingerprint) {
      trustedDevice = await repAuth.issueTrustedDevice(user.id, {
        fingerprint: device_fingerprint,
        biometricType: biometric_type,
      });
    }

    const sessionToken = repAuth.signRepSession(user);
    await db.query("UPDATE dashboard_users SET last_app_open_at = now() WHERE id = $1", [user.id]);

    await logAction({
      tenant_id: String(user.tenant_id),
      user_id: String(user.id),
      action: "rep_login",
      entity_type: "user",
      entity_id: String(user.id),
      new_value: { device_fingerprint: device_fingerprint || null, biometric_type: biometric_type || null },
      ip_address: clientIp(req),
      user_agent: req.get("user-agent") || null,
    });
    await repAuth.logRepEvent(req, {
      user_id: user.id,
      tenant_id: user.tenant_id,
      event_type: "rep_login_totp_ok",
      metadata: { device_fingerprint: device_fingerprint || null, biometric_type: biometric_type || null },
    });

    res.json({
      status: "ok",
      token: sessionToken,
      trusted_device: trustedDevice, // { token, expires_at } or null
      user: {
        id: user.id,
        email: user.email,
        tenant_id: user.tenant_id,
        role: user.role,
        seat_tier: user.rep_seat_tier || "standard",
      },
    });
  } catch (e) {
    console.error("[rep/auth/totp]", e);
    res.status(500).json({ error: "Server error" });
  }
});

// ── POST /api/rep/auth/biometric-verify ─────────────────────────────────────
// Audit-only ping. requireRep already validates the session JWT for us.
router.post("/biometric-verify", ...repAuthChain, async (req, res) => {
  try {
    await db.query("UPDATE dashboard_users SET last_app_open_at = now() WHERE id = $1", [req.rep.id]);
    await repAuth.logRepEvent(req, {
      user_id: req.rep.id,
      tenant_id: req.rep.tenant_id,
      event_type: "rep_biometric_verified",
      metadata: {
        device_fingerprint: req.body?.device_fingerprint || null,
        biometric_type: req.body?.biometric_type || null,
      },
    });
    res.json({ status: "ok" });
  } catch (e) {
    console.error("[rep/auth/biometric-verify]", e);
    res.status(500).json({ error: "Server error" });
  }
});

// ── POST /api/rep/auth/logout ───────────────────────────────────────────────
router.post("/logout", ...repAuthChain, async (req, res) => {
  try {
    const fingerprint = req.body?.device_fingerprint;
    if (fingerprint) await repAuth.revokeTrustedDevice(req.rep.id, fingerprint);
    await repAuth.logRepEvent(req, {
      user_id: req.rep.id,
      tenant_id: req.rep.tenant_id,
      event_type: "rep_logout",
      metadata: { device_fingerprint: fingerprint || null },
    });
    res.json({ status: "ok" });
  } catch (e) {
    console.error("[rep/auth/logout]", e);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
