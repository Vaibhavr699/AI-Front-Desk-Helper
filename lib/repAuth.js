"use strict";

// ── Rep App auth helpers ────────────────────────────────────────────────────
// The rep mobile app reuses the existing dashboard_users table + JWT signer,
// but adds:
//   • Email one-time-code MFA (a 6-digit code emailed on each untrusted login)
//   • Brute-force protection: a per-code attempt cap plus a persistent
//     failed-count + lockout that survives code re-issuance
//   • Trusted-device tokens (skip the email code for 30 days on a known device)
//   • Short-lived challenge JWTs (carrying a rotating otp session nonce) between
//     password-OK and code-OK
//   • Rep-scoped session JWTs (carry scope=rep + seat_tier so requireRep
//     can gate downstream Pro/Elite features without re-querying the user)
//   • A thin wrapper to append to rep_app_events
//
// The login code is stored only as a sha256 hash with a short expiry. Verify is
// a single atomic UPDATE so concurrent guesses can't race past the attempt cap.
// ────────────────────────────────────────────────────────────────────────────

const crypto = require("crypto");
const auth = require("./auth");
const db = require("./db");

const REP_SESSION_TTL = "30d";      // Long-lived session JWT (rotated on re-login)
const REP_CHALLENGE_TTL = "15m";    // Between password-OK and code-OK; outlives the code TTL
const TRUSTED_DEVICE_TTL_DAYS = 30; // Spec: trusted_device_token valid for 30 days

const OTP_LENGTH = 6;
const OTP_TTL_MS = 10 * 60 * 1000;          // Code valid for 10 minutes
const OTP_MAX_ATTEMPTS = 5;                 // Wrong guesses against a single code
const OTP_MAX_FAILED = 10;                  // Wrong guesses across codes before lockout
const OTP_LOCKOUT_MS = 15 * 60 * 1000;      // Lockout duration once the threshold trips
const OTP_RESEND_COOLDOWN_MS = 30 * 1000;   // Min gap between resend requests

// ── Email one-time code ─────────────────────────────────────────────────────
function generateOtpCode() {
  return String(crypto.randomInt(0, 10 ** OTP_LENGTH)).padStart(OTP_LENGTH, "0");
}

function hashOtp(code) {
  return crypto.createHash("sha256").update(String(code)).digest("hex");
}

// Fresh nonce per /login; embedded in the challenge token and required by
// verify, so a stale challenge can't be used to verify a newly issued code.
function newOtpSessionId() {
  return crypto.randomBytes(16).toString("hex");
}

// Returns { locked: true, retryAfterMs } if the account is in OTP lockout.
async function isLoginLocked(userId) {
  const r = await db.query(
    "SELECT login_otp_locked_until FROM dashboard_users WHERE id = $1",
    [userId]
  );
  const until = r.rows[0]?.login_otp_locked_until;
  if (until && new Date(until).getTime() > Date.now()) {
    return { locked: true, retryAfterMs: new Date(until).getTime() - Date.now() };
  }
  return { locked: false };
}

// Stores the hash + expiry, resets the PER-CODE attempt counter, stamps sent_at,
// and binds the code to this login's session nonce. Does NOT touch the persistent
// failed-count or lockout (those only clear on a successful verify).
async function storeLoginOtp(userId, code, sessionId) {
  const expires = new Date(Date.now() + OTP_TTL_MS);
  await db.query(
    `UPDATE dashboard_users
        SET login_otp_hash = $1,
            login_otp_expires = $2,
            login_otp_attempts = 0,
            login_otp_sent_at = now(),
            login_otp_session_id = $3
      WHERE id = $4`,
    [hashOtp(code), expires.toISOString(), sessionId, userId]
  );
}

// Atomic verify. The success path is a single UPDATE that only matches when the
// hash + session are correct and the code is live, unlocked, and under the cap —
// so two concurrent correct submissions can't both win, and the code is consumed
// exactly once. On failure we classify the reason and atomically bump the
// counters (tripping the lockout in SQL) only for a genuine wrong guess.
// Returns { ok: true } or { ok: false, reason, retryAfterMs? } where reason is
// one of: locked | no_code | expired | too_many | invalid.
async function verifyLoginOtp(userId, code, sessionId) {
  const providedHash = hashOtp(String(code).replace(/\s/g, ""));

  const success = await db.query(
    `UPDATE dashboard_users
        SET login_otp_hash = NULL, login_otp_expires = NULL,
            login_otp_attempts = 0, login_otp_failed_count = 0,
            login_otp_locked_until = NULL, login_otp_session_id = NULL
      WHERE id = $1
        AND login_otp_hash = $2
        AND login_otp_session_id = $3
        AND login_otp_expires > now()
        AND login_otp_attempts < $4
        AND (login_otp_locked_until IS NULL OR login_otp_locked_until <= now())
      RETURNING id`,
    [userId, providedHash, sessionId, OTP_MAX_ATTEMPTS]
  );
  if (success.rowCount === 1) return { ok: true };

  const r = await db.query(
    `SELECT (login_otp_hash IS NOT NULL) AS has_code, login_otp_expires,
            login_otp_attempts, login_otp_locked_until, login_otp_session_id
       FROM dashboard_users WHERE id = $1`,
    [userId]
  );
  const row = r.rows[0];
  if (!row) return { ok: false, reason: "no_code" };

  const now = Date.now();
  if (row.login_otp_locked_until && new Date(row.login_otp_locked_until).getTime() > now) {
    return { ok: false, reason: "locked", retryAfterMs: new Date(row.login_otp_locked_until).getTime() - now };
  }
  if (!row.has_code) return { ok: false, reason: "no_code" };
  if (!row.login_otp_expires || new Date(row.login_otp_expires).getTime() <= now) {
    return { ok: false, reason: "expired" };
  }
  if (row.login_otp_session_id !== sessionId) return { ok: false, reason: "expired" };
  if ((row.login_otp_attempts || 0) >= OTP_MAX_ATTEMPTS) return { ok: false, reason: "too_many" };

  const inc = await db.query(
    `UPDATE dashboard_users
        SET login_otp_attempts = login_otp_attempts + 1,
            login_otp_failed_count = login_otp_failed_count + 1,
            login_otp_locked_until = CASE
              WHEN login_otp_failed_count + 1 >= $2 THEN now() + make_interval(secs => $3)
              ELSE login_otp_locked_until END
      WHERE id = $1
        AND login_otp_hash IS NOT NULL
        AND login_otp_expires > now()
        AND (login_otp_locked_until IS NULL OR login_otp_locked_until <= now())
      RETURNING login_otp_locked_until`,
    [userId, OTP_MAX_FAILED, Math.floor(OTP_LOCKOUT_MS / 1000)]
  );
  const lockedUntil = inc.rows[0]?.login_otp_locked_until;
  if (lockedUntil && new Date(lockedUntil).getTime() > now) {
    return { ok: false, reason: "locked", retryAfterMs: new Date(lockedUntil).getTime() - now };
  }
  return { ok: false, reason: "invalid" };
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
function signChallenge(user, sessionId) {
  return auth.signToken(
    {
      sub: user.id,
      email: user.email,
      tenant_id: user.tenant_id,
      scope: "rep_otp_pending",
      otp_sid: sessionId,
    },
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
  // Constant-time compare of the (already hashed) device token, for consistency
  // with the OTP path. Both operands are fixed-length sha256 hex.
  const target = Buffer.from(tokenHash);
  return (
    devices.find(
      (d) =>
        d.fingerprint === fingerprint &&
        typeof d.token_hash === "string" &&
        d.token_hash.length === tokenHash.length &&
        crypto.timingSafeEqual(Buffer.from(d.token_hash), target)
    ) || null
  );
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
  newOtpSessionId,
  isLoginLocked,
  storeLoginOtp,
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
