"use strict";

// ── /api/rep/auth — Rep mobile app authentication ──────────────────────────
// Flow:
//
//   1. POST /login
//      Body: { email, password, device_fingerprint, trusted_device_token? }
//      • Verifies password
//      • If valid trusted_device_token matches this fingerprint → returns a
//        full rep session immediately (skip the email code)
//      • Otherwise emails a 6-digit one-time code and returns a challenge token
//        (carrying a rotating otp session nonce)
//
//   2. POST /verify-otp
//      Body: { challenge_token, code, device_fingerprint, biometric_type?,
//              trust_this_device? }
//      • Verifies the emailed code against the stored hash
//      • If trust_this_device → issues a 30-day trusted_device_token
//      • Returns the rep session JWT + user payload
//
//   3. POST /resend-otp
//      Body: { challenge_token }
//      • Re-emails a fresh code (throttled per OTP_RESEND_COOLDOWN_MS)
//
//   4. POST /biometric-verify
//      Audit-only ping; requireRep has already validated the session JWT.
//
//   5. POST /logout
//      Optionally revokes the trusted_device_token for this fingerprint.
//
// Brute force is bounded three ways: a per-IP rate limiter on each public
// endpoint, a per-code attempt cap, and a persistent per-account failed-count
// that triggers a lockout and is NOT reset when a new code is issued.
// ────────────────────────────────────────────────────────────────────────────

const express = require("express");
const auth = require("../../lib/auth");
const repAuth = require("../../lib/repAuth");
const { logAction } = require("../../lib/auditLogger");
const { sendRepLoginOtp } = require("../../services/email");
const db = require("../../lib/db");
const { repAuthChain } = require("../../lib/requireRep");
const repSeats = require("../../lib/repSeats");
const { rateLimit } = require("../../lib/rateLimit");

const SEAT_LIMIT_ERROR = {
  error: "Your team has exceeded its seat limit. Contact your admin.",
  code: "REP_SEAT_LIMIT_EXCEEDED",
};

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  message: "Too many sign-in attempts. Please wait a minute and try again.",
});
const verifyLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  message: "Too many attempts. Please wait a minute and try again.",
});
const resendLimiter = rateLimit({
  windowMs: 60_000,
  max: 5,
  message: "Too many code requests. Please wait a minute and try again.",
});

function clientIp(req) {
  return req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.ip || null;
}

function tenantFlags(row) {
  return {
    rep_coach_enabled: row?.rep_coach_enabled === true,
    aifdh_enabled: row?.aifdh_enabled !== false,
  };
}

// ── POST /api/rep/auth/login ────────────────────────────────────────────────
router.post("/login", loginLimiter, async (req, res) => {
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
    if (!(await repSeats.isWithinSeatLimit(user.tenant_id, user.id))) {
      return res.status(403).json(SEAT_LIMIT_ERROR);
    }

    // Trusted-device fast path — skip the email code if the device presents a valid token.
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
        const tf = await db.query("SELECT rep_coach_enabled, aifdh_enabled FROM tenants WHERE id = $1", [user.tenant_id]);
        return res.json({
          status: "ok",
          token: sessionToken,
          user: {
            id: user.id,
            email: user.email,
            tenant_id: user.tenant_id,
            role: user.role,
            seat_tier: user.rep_seat_tier || "standard",
            tenant_flags: tenantFlags(tf.rows[0]),
          },
        });
      }
    }

    // Refuse to issue a code while the account is in OTP lockout.
    const lock = await repAuth.isLoginLocked(user.id);
    if (lock.locked) {
      return res.status(429).json({
        error: "Too many attempts. Please try again later.",
        code: "OTP_LOCKED",
        retry_after_ms: lock.retryAfterMs,
      });
    }

    // Generate + EMAIL the code first; only persist it once the email is sent,
    // so a send failure never destroys a still-valid code or arms the cooldown.
    const sessionId = repAuth.newOtpSessionId();
    const code = repAuth.generateOtpCode();
    const sent = await sendRepLoginOtp(user.email, code);
    if (!sent || sent.ok === false) {
      console.error("[rep/auth/login] OTP email failed:", sent && sent.error);
      return res.status(502).json({
        error: "Could not send your verification code. Please try again.",
        code: "OTP_SEND_FAILED",
      });
    }
    await repAuth.storeLoginOtp(user.id, code, sessionId);

    const challenge = repAuth.signChallenge(user, sessionId);
    await repAuth.logRepEvent(req, {
      user_id: user.id,
      tenant_id: user.tenant_id,
      event_type: "rep_otp_challenge_issued",
      metadata: { device_fingerprint: device_fingerprint || null },
    });
    res.json({ status: "otp_required", challenge_token: challenge });
  } catch (e) {
    console.error("[rep/auth/login]", e);
    res.status(500).json({ error: "Server error" });
  }
});

// ── POST /api/rep/auth/verify-otp ───────────────────────────────────────────
router.post("/verify-otp", verifyLimiter, async (req, res) => {
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
      "SELECT id, email, tenant_id, role, rep_seat_active, rep_seat_tier FROM dashboard_users WHERE id = $1",
      [decoded.sub]
    );
    const user = r.rows[0];
    if (!user) return res.status(401).json({ error: "User not found" });
    if (!user.rep_seat_active) {
      return res.status(403).json({ error: "Rep seat inactive", code: "REP_SEAT_INACTIVE" });
    }
    if (!(await repSeats.isWithinSeatLimit(user.tenant_id, user.id))) {
      return res.status(403).json(SEAT_LIMIT_ERROR);
    }

    const result = await repAuth.verifyLoginOtp(user.id, code, decoded.otp_sid);
    if (!result.ok) {
      const map = {
        no_code: { s: 400, e: "No active code. Request a new one.", c: "OTP_NOT_FOUND" },
        expired: { s: 401, e: "That code expired. Request a new one.", c: "OTP_EXPIRED" },
        too_many: { s: 429, e: "Too many attempts on this code. Request a new one.", c: "OTP_TOO_MANY" },
        locked: { s: 429, e: "Too many attempts. Please try again later.", c: "OTP_LOCKED" },
        invalid: { s: 401, e: "Invalid code", c: "OTP_INVALID" },
      };
      const m = map[result.reason] || map.invalid;
      const body = { error: m.e, code: m.c };
      if (result.retryAfterMs) body.retry_after_ms = result.retryAfterMs;
      await repAuth.logRepEvent(req, {
        user_id: user.id,
        tenant_id: user.tenant_id,
        event_type: "rep_otp_bad_code",
        metadata: { reason: result.reason, device_fingerprint: device_fingerprint || null },
      });
      return res.status(m.s).json(body);
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
      event_type: "rep_login_otp_ok",
      metadata: { device_fingerprint: device_fingerprint || null, biometric_type: biometric_type || null },
    });

    const tf2 = await db.query("SELECT rep_coach_enabled, aifdh_enabled FROM tenants WHERE id = $1", [user.tenant_id]);
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
        tenant_flags: tenantFlags(tf2.rows[0]),
      },
    });
  } catch (e) {
    console.error("[rep/auth/verify-otp]", e);
    res.status(500).json({ error: "Server error" });
  }
});

// ── POST /api/rep/auth/resend-otp ───────────────────────────────────────────
router.post("/resend-otp", resendLimiter, async (req, res) => {
  try {
    const { challenge_token } = req.body || {};
    if (!challenge_token) {
      return res.status(400).json({ error: "challenge_token required" });
    }
    let decoded;
    try {
      decoded = repAuth.verifyChallenge(challenge_token);
    } catch (err) {
      return res.status(401).json({ error: "Challenge expired or invalid", code: "CHALLENGE_INVALID" });
    }
    const r = await db.query(
      "SELECT id, email, tenant_id, rep_seat_active FROM dashboard_users WHERE id = $1",
      [decoded.sub]
    );
    const user = r.rows[0];
    if (!user) return res.status(401).json({ error: "User not found" });
    if (!user.rep_seat_active) {
      return res.status(403).json({ error: "Rep seat inactive", code: "REP_SEAT_INACTIVE" });
    }

    const lock = await repAuth.isLoginLocked(user.id);
    if (lock.locked) {
      return res.status(429).json({
        error: "Too many attempts. Please try again later.",
        code: "OTP_LOCKED",
        retry_after_ms: lock.retryAfterMs,
      });
    }

    const gate = await repAuth.canResendLoginOtp(user.id);
    if (!gate.ok) {
      return res.status(429).json({
        error: "Please wait a moment before requesting another code.",
        code: "OTP_RESEND_COOLDOWN",
        retry_after_ms: gate.retryAfterMs,
      });
    }

    // Reuse the challenge's session nonce so the client's existing challenge
    // token still verifies the new code.
    const code = repAuth.generateOtpCode();
    const sent = await sendRepLoginOtp(user.email, code);
    if (!sent || sent.ok === false) {
      console.error("[rep/auth/resend-otp] OTP email failed:", sent && sent.error);
      return res.status(502).json({
        error: "Could not send your verification code. Please try again.",
        code: "OTP_SEND_FAILED",
      });
    }
    await repAuth.storeLoginOtp(user.id, code, decoded.otp_sid);
    await repAuth.logRepEvent(req, {
      user_id: user.id,
      tenant_id: user.tenant_id,
      event_type: "rep_otp_resent",
    });
    res.json({ status: "otp_required" });
  } catch (e) {
    console.error("[rep/auth/resend-otp]", e);
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
