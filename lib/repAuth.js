"use strict";

// ── Rep App auth helpers ────────────────────────────────────────────────────
// The rep mobile app reuses the existing dashboard_users table + JWT signer,
// but adds:
//   • Email one-time-code MFA (a 6-digit code emailed on each untrusted login)
//   • Trusted-device tokens (skip the email code for 30 days on a known device)
//   • Short-lived challenge JWTs between password-OK and code-OK
//   • Rep-scoped session JWTs (carry scope=rep + seat_tier so requireRep
//     can gate downstream Pro/Elite features without re-querying the user)
//   • A thin wrapper to append to rep_app_events
//
// The login code is stored only as a sha256 hash with a short expiry and a
// per-code attempt counter, mirroring how trusted-device tokens are stored.
// ────────────────────────────────────────────────────────────────────────────

const crypto = require("crypto");
const auth = require("./auth");
const db = require("./db");

const REP_SESSION_TTL = "30d";      // Long-lived session JWT (rotated on re-login)
const REP_CHALLENGE_TTL = "10m";    // Between password-OK and code-OK; matches code TTL
const TRUSTED_DEVICE_TTL_DAYS = 30; // Spec: trusted_device_token valid for 30 days

const OTP_LENGTH = 6;
const OTP_TTL_MS = 10 * 60 * 1000;          // Code valid for 10 minutes
const OTP_MAX_ATTEMPTS = 5;                 // Wrong guesses per code before lockout
const OTP_RESEND_COOLDOWN_MS = 30 * 1000;   // Min gap between resend requests

// ── Email one-time code ─────────────────────────────────────────────────────
function generateOtpCode() {
  return String(crypto.randomInt(0, 10 ** OTP_LENGTH)).padStart(OTP_LENGTH, "0");
}

function hashOtp(code) {
  return crypto.createHash("sha256").update(String(code)).digest("hex");
}

// Generates a fresh code, stores its hash + expiry, resets the attempt counter,
// and stamps sent_at for resend throttling. Returns the raw code so the caller
// can email it (the raw code is never persisted).
async function issueLoginOtp(userId) {
  const code = generateOtpCode();
  const expires = new Date(Date.now() + OTP_TTL_MS);
  await db.query(
    `UPDATE dashboard_users
        SET login_otp_hash = $1,
            login_otp_expires = $2,
            login_otp_attempts = 0,
            login_otp_sent_at = now()
      WHERE id = $3`,
    [hashOtp(code), expires.toISOString(), userId]
  );
  return code;
}

// Returns { ok: true } on a valid, unexpired, within-attempt-limit match and
// clears the code. On failure returns { ok: false, reason } where reason is one
// of: no_code | expired | too_many | invalid. A wrong guess increments attempts.
async function verifyLoginOtp(userId, code) {
  const r = await db.query(
    "SELECT login_otp_hash, login_otp_expires, login_otp_attempts FROM dashboard_users WHERE id = $1",
    [userId]
  );
  const row = r.rows[0];
  if (!row || !row.login_otp_hash || !row.login_otp_expires) {
    return { ok: false, reason: "no_code" };
  }
  if (new Date(row.login_otp_expires).getTime() < Date.now()) {
    return { ok: false, reason: "expired" };
  }
  if ((row.login_otp_attempts || 0) >= OTP_MAX_ATTEMPTS) {
    return { ok: false, reason: "too_many" };
  }
  const provided = hashOtp(String(code).replace(/\s/g, ""));
  const matches =
    provided.length === row.login_otp_hash.length &&
    crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(row.login_otp_hash));
  if (!matches) {
    await db.query(
      "UPDATE dashboard_users SET login_otp_attempts = COALESCE(login_otp_attempts, 0) + 1 WHERE id = $1",
      [userId]
    );
    return { ok: false, reason: "invalid" };
  }
  await db.query(
    "UPDATE dashboard_users SET login_otp_hash = NULL, login_otp_expires = NULL, login_otp_attempts = 0 WHERE id = $1",
    [userId]
  );
  return { ok: true };
}

// Throttle resends so a single challenge can't spray emails.
async function canResendLoginOtp(userId) {
  const r = await db.query(
    "SELECT login_otp_sent_at FROM dashboard_users WHERE id = $1",
    [userId]
  );
  const sentAt = r.rows[0]?.login_otp_sent_at;
  if (!sentAt) return { ok: true };
  const elapsed = Date.now() - new Date(sentAt).getTime();
  if (elapsed < OTP_RESEND_COOLDOWN_MS) {
    return { ok: false, retryAfterMs: OTP_RESEND_COOLDOWN_MS - elapsed };
  }
  return { ok: true };
}

// ── Challenge + session JWTs ────────────────────────────────────────────────
function signChallenge(user) {
  return auth.signToken(
    { sub: user.id, email: user.email, tenant_id: user.tenant_id, scope: "rep_otp_pending" },
    REP_CHALLENGE_TTL
  );
}

function signRepSession(user) {
  return auth.signToken(
    {
      sub: user.id,
      email: user.email,
      tenant_id: user.tenant_id,
      role: user.role,
      scope: "rep",
      seat_tier: user.rep_seat_tier || "standard",
    },
    REP_SESSION_TTL
  );
}

function verifyChallenge(token) {
  const decoded = auth.verifyToken(token);
  if (decoded.scope !== "rep_otp_pending") {
    const err = new Error("Not a rep challenge token");
    err.code = "WRONG_SCOPE";
    throw err;
  }
  return decoded;
}

// ── Trusted devices ─────────────────────────────────────────────────────────
// Stored as JSONB array on dashboard_users.trusted_devices:
//   [{ fingerprint, token_hash, biometric_type, registered_at, expires_at }, ...]
// The raw token is returned ONCE to the client, who keeps it in SecureStore.
// Server only ever sees the sha256 hash. Expired entries are pruned on read.
function hashDeviceToken(raw) {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

function pruneExpired(devices) {
  const now = Date.now();
  return (devices || []).filter((d) => {
    if (!d || !d.expires_at) return false;
    return new Date(d.expires_at).getTime() > now;
  });
}

async function issueTrustedDevice(userId, { fingerprint, biometricType }) {
  const raw = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashDeviceToken(raw);
  const now = new Date();
  const expires = new Date(now.getTime() + TRUSTED_DEVICE_TTL_DAYS * 24 * 60 * 60 * 1000);

  const r = await db.query("SELECT trusted_devices FROM dashboard_users WHERE id = $1", [userId]);
  const existing = pruneExpired(r.rows[0]?.trusted_devices || []);
  // One entry per fingerprint — replace if present (re-enrollment renews TTL).
  const filtered = existing.filter((d) => d.fingerprint !== fingerprint);
  filtered.push({
    fingerprint,
    token_hash: tokenHash,
    biometric_type: biometricType || null,
    registered_at: now.toISOString(),
    expires_at: expires.toISOString(),
  });

  await db.query("UPDATE dashboard_users SET trusted_devices = $1::jsonb WHERE id = $2", [
    JSON.stringify(filtered),
    userId,
  ]);
  return { token: raw, expires_at: expires.toISOString() };
}

async function findTrustedDevice(userId, { fingerprint, token }) {
  if (!fingerprint || !token) return null;
  const r = await db.query("SELECT trusted_devices FROM dashboard_users WHERE id = $1", [userId]);
  const devices = pruneExpired(r.rows[0]?.trusted_devices || []);
  const tokenHash = hashDeviceToken(token);
  return devices.find((d) => d.fingerprint === fingerprint && d.token_hash === tokenHash) || null;
}

async function revokeTrustedDevice(userId, fingerprint) {
  const r = await db.query("SELECT trusted_devices FROM dashboard_users WHERE id = $1", [userId]);
  const remaining = pruneExpired(r.rows[0]?.trusted_devices || []).filter(
    (d) => d.fingerprint !== fingerprint
  );
  await db.query("UPDATE dashboard_users SET trusted_devices = $1::jsonb WHERE id = $2", [
    JSON.stringify(remaining),
    userId,
  ]);
}

// ── Event firehose ──────────────────────────────────────────────────────────
// Best-effort. Never blocks the request — failures log and swallow so an
// event-table outage can't take down login.
async function logRepEvent(req, { user_id, tenant_id, event_type, metadata = {} }) {
  try {
    const ipRaw = req?.headers?.["x-forwarded-for"]?.split(",")[0]?.trim() || req?.ip || null;
    const ip = ipRaw && ipRaw !== "::1" ? ipRaw : null;
    await db.query(
      `INSERT INTO rep_app_events
         (user_id, tenant_id, event_type, event_metadata, device_fingerprint, device_type, ip_address, app_version)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8)`,
      [
        user_id || null,
        tenant_id || null,
        event_type,
        JSON.stringify(metadata || {}),
        metadata?.device_fingerprint || null,
        metadata?.device_type || null,
        ip,
        req?.headers?.["x-app-version"] || metadata?.app_version || null,
      ]
    );
  } catch (e) {
    console.error("[repAuth] logRepEvent failed:", e.message);
  }
}

module.exports = {
  // Email one-time code
  generateOtpCode,
  hashOtp,
  issueLoginOtp,
  verifyLoginOtp,
  canResendLoginOtp,
  // Challenge + session
  signChallenge,
  signRepSession,
  verifyChallenge,
  // Trusted device
  issueTrustedDevice,
  findTrustedDevice,
  revokeTrustedDevice,
  // Events
  logRepEvent,
  // Constants (for tests + downstream)
  TRUSTED_DEVICE_TTL_DAYS,
  OTP_RESEND_COOLDOWN_MS,
};
