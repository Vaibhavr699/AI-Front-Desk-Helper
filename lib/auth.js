"use strict";

// ── ROLES defined first to avoid circular dependency issues ──────────────────
const ROLES = {
  OWNER: 'owner',
  ADMIN: 'admin',
  MANAGER: 'manager',
  STAFF: 'staff'
};

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
    ? `SELECT u.*, t.business_type as tenant_business_type 
       FROM dashboard_users u 
       LEFT JOIN tenants t ON u.tenant_id = t.id 
       WHERE u.email = $1 AND (u.tenant_id = $2 OR u.tenant_id IS NULL) 
       LIMIT 1`
    : `SELECT u.*, t.business_type as tenant_business_type 
       FROM dashboard_users u 
       LEFT JOIN tenants t ON u.tenant_id = t.id 
       WHERE u.email = $1 
       LIMIT 1`;
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

    if (decoded.tenant_id && !decoded.is_super_admin) {
      const r = await db.query("SELECT is_suspended, business_type, parent_id FROM tenants WHERE id = $1", [decoded.tenant_id]);
      const tenant = r.rows[0];
      if (tenant?.is_suspended) {
        const isBilling = req.originalUrl && req.originalUrl.includes("/api/billing");
        const isSelf = req.originalUrl && (req.originalUrl.includes("/api/auth/me") || req.originalUrl.includes("/api/dashboard/me"));
        if (!isBilling && !isSelf) {
          return res.status(403).json({
            error: "Your account is suspended. Please contact support or update your billing information.",
            code: "TENANT_SUSPENDED"
          });
        }
      }
      if (tenant) {
        req.user.tenant_business_type = tenant.business_type;
        req.user.tenant_parent_id = tenant.parent_id;
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

function getTenantIdFromQuery(req) {
  const userTenantId = req.user?.tenant_id;
  const requestedId = req.query.tenant_id || req.query.tenantId || req.headers["x-tenant-id"] || req.body?.tenant_id || req.body?.tenantId;

  if (req.user?.is_super_admin && requestedId) {
    return requestedId;
  }
  if (req.user?.tenant_business_type === 'parent' && requestedId) {
    return requestedId;
  }
  return userTenantId || requestedId || null;
}

function getGuaranteedTenantId(req) {
  const id = getTenantIdFromQuery(req);
  if (id === "all") return req.user?.tenant_id;
  return id;
}

async function getTargetTenantIds(req) {
  const tenantId = getTenantIdFromQuery(req);
  if (!tenantId) return [];

  const isRollupRequested = req.query.rollup === 'true' || req.query.tenant_id === 'all' || req.query.tenantId === 'all';

  if (req.user?.tenant_business_type === 'parent' && (isRollupRequested || tenantId === req.user.tenant_id)) {
    const parentId = req.user.tenant_id;
    const r = await db.query("SELECT id FROM tenants WHERE id = $1 OR parent_id = $1", [parentId]);
    return r.rows.map(row => row.id);
  }

  if (req.user?.is_super_admin && tenantId === 'all') {
    const r = await db.query("SELECT id FROM tenants ORDER BY name ASC");
    return r.rows.map(row => row.id);
  }

  if (tenantId === 'all') {
    return req.user?.tenant_id ? [req.user.tenant_id] : [];
  }

  return [tenantId];
}

function requireRole(allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: "Forbidden — insufficient permissions", code: "INSUFFICIENT_PERMISSIONS" });
    }
    next();
  };
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
  requireRole,
  ROLES,
  getTenantIdFromQuery,
  getGuaranteedTenantId,
  getTargetTenantIds,
};
