"use strict";

const crypto = require("crypto");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const db = require("./db");

const JWT_SECRET = process.env.JWT_SECRET || "change-me-in-production";
const SALT_ROUNDS = 10;

async function hashPassword(password) {
  return bcrypt.hash(password, SALT_ROUNDS);
}

async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

function signToken(payload, expiresIn = "7d") {
  return jwt.sign(payload, JWT_SECRET, { expiresIn });
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

async function findUserByEmail(email, tenantId = null) {
  const q = tenantId
    ? "SELECT * FROM dashboard_users WHERE email = $1 AND (tenant_id = $2 OR tenant_id IS NULL) LIMIT 1"
    : "SELECT * FROM dashboard_users WHERE email = $1 LIMIT 1";
  const params = tenantId ? [email, tenantId] : [email];
  const r = await db.query(q, params);
  return r.rows[0] || null;
}

function generateResetToken() {
  return crypto.randomBytes(32).toString("hex");
}

async function saveResetToken(email, token, expires) {
  await db.query(
    "UPDATE dashboard_users SET reset_token = $1, reset_token_expires = $2 WHERE email = $3",
    [token, expires, email]
  );
}

async function findUserByResetToken(token) {
  const r = await db.query(
    "SELECT * FROM dashboard_users WHERE reset_token = $1 AND reset_token_expires > now() LIMIT 1",
    [token]
  );
  return r.rows[0] || null;
}

async function updatePassword(userId, newPasswordHash) {
  await db.query(
    "UPDATE dashboard_users SET password_hash = $1, reset_token = NULL, reset_token_expires = NULL WHERE id = $2",
    [newPasswordHash, userId]
  );
}

async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: "Unauthorized", code: "NO_TOKEN" });
  }
  try {
    const decoded = verifyToken(token);
    req.user = decoded;

    // Check for tenant suspension
    if (decoded.tenant_id && !decoded.is_super_admin) {
      const r = await db.query("SELECT is_suspended FROM tenants WHERE id = $1", [decoded.tenant_id]);
      if (r.rows[0]?.is_suspended) {
        // Allow access to billing so they can update CC
        const isBilling = req.originalUrl && req.originalUrl.includes("/api/billing");
        const isSelf = req.originalUrl && (req.originalUrl.includes("/api/auth/me") || req.originalUrl.includes("/api/dashboard/me"));

        if (!isBilling && !isSelf) {
          return res.status(403).json({
            error: "Your account is suspended. Please contact support or update your billing information.",
            code: "TENANT_SUSPENDED"
          });
        }
      }
    }

    next();
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({ error: "Token expired", code: "TOKEN_EXPIRED" });
    }
    return res.status(403).json({ error: "Invalid token", code: "TOKEN_INVALID" });
  }
}

function requireSuperAdmin(req, res, next) {
  if (!req.user || !req.user.is_super_admin) {
    return res.status(403).json({ error: "Forbidden — super admin access required", code: "NOT_SUPER_ADMIN" });
  }
  next();
}

module.exports = {
  hashPassword,
  verifyPassword,
  signToken,
  verifyToken,
  findUserByEmail,
  generateResetToken,
  saveResetToken,
  findUserByResetToken,
  updatePassword,
  authMiddleware,
  requireSuperAdmin,
};
