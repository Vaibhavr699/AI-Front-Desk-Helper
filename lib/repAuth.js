"use strict";

// ── Rep App auth helpers ────────────────────────────────────────────────────
// The rep mobile app reuses the existing dashboard_users table + JWT signer,
// but adds:
//   • TOTP-based MFA enrollment + verification (otpauth library)
//   • Trusted-device tokens (skip TOTP for 30 days on a known device)
//   • Short-lived challenge JWTs between password-OK and TOTP-OK
//   • Rep-scoped session JWTs (carry scope=rep + seat_tier so requireRep
//     can gate downstream Pro/Elite features without re-querying the user)
//   • A thin wrapper to append to rep_app_events
//
// The TOTP secret is stored in plaintext in dashboard_users.totp_secret to
// match the existing repo's approach to reset_token (also plaintext). A
// future migration can envelope-encrypt with KMS — schema doesn't change.
// ────────────────────────────────────────────────────────────────────────────

const crypto = require("crypto");
const { TOTP, Secret } = require("otpauth");
const auth = require("./auth");
const db = require("./db");

const REP_SESSION_TTL = "30d";      // Long-lived session JWT (rotated on re-login)
const REP_CHALLENGE_TTL = "5m";     // Between password-OK and TOTP-OK
const TRUSTED_DEVICE_TTL_DAYS = 30; // Spec: trusted_device_token valid for 30 days
const TOTP_ISSUER = "AI Front Desk Helper";

// ── TOTP ────────────────────────────────────────────────────────────────────
function newTotpSecret() {
  return new Secret({ size: 20 }).base32;
}

function totpUri(secretBase32, email) {
  const totp = new TOTP({
    issuer: TOTP_ISSUER,
    label: email,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secretBase32),
  });
  return totp.toString();
}

function verifyTotp(secretBase32, code) {
  if (!secretBase32 || !code) return false;
  const totp = new TOTP({
    issuer: TOTP_ISSUER,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secretBase32),
  });
  // window=1 → accept previous + current + next 30s slot; survives ~30s clock skew.
  const delta = totp.validate({ token: String(code).replace(/\s/g, ""), window: 1 });
  return delta !== null;
}

// ── Challenge + session JWTs ────────────────────────────────────────────────
function signChallenge(user) {
  return auth.signToken(
    { sub: user.id, email: user.email, tenant_id: user.tenant_id, scope: "rep_totp_pending" },
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
  if (decoded.scope !== "rep_totp_pending") {
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
  // TOTP
  newTotpSecret,
  totpUri,
  verifyTotp,
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
};
