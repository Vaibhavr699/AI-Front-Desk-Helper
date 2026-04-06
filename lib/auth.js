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

    // Check for tenant suspension and hierarchy
    if (decoded.tenant_id && !decoded.is_super_admin) {
      const r = await db.query("SELECT is_suspended, business_type, parent_id FROM tenants WHERE id = $1", [decoded.tenant_id]);
      const tenant = r.rows[0];
      if (tenant?.is_suspended) {
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
      // Enrich user with tenant info
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

/** Unified helper to resolve which tenant a request is targeting.
 *  Supports impersonation for super admins and hierarchical access for parents.
 */
function getTenantIdFromQuery(req) {
  const userTenantId = req.user?.tenant_id;
  const requestedId = req.query.tenant_id || req.query.tenantId || req.headers["x-tenant-id"] || req.body?.tenant_id || req.body?.tenantId;

  // 1. Super Admin Impersonation
  if (req.user?.is_super_admin && requestedId) {
    return requestedId;
  }

  // 2. Parent accessing Child
  // Special value 'all' can be used for roll-up reporting
  if (req.user?.tenant_business_type === 'parent' && requestedId) {
    return requestedId;
  }

  // 3. Regular lockdown to assigned tenant
  return userTenantId || requestedId || null;
}

/** Unified helper to resolve a list of tenant IDs for querying.
 *  Supports roll-up for parents.
 */
async function getTargetTenantIds(req) {
  const tenantId = getTenantIdFromQuery(req);
  if (!tenantId) return [];

  const isRollup = req.query.rollup === 'true' || req.query.tenant_id === 'all' || req.query.tenantId === 'all';
  
  // If user is a parent and is either requesting rollup OR viewing their own HQ dashboard
  if (req.user?.tenant_business_type === 'parent' && (isRollup || tenantId === req.user.tenant_id)) {
    const r = await db.query("SELECT id FROM tenants WHERE id = $1 OR parent_id = $1", [req.user.tenant_id]);
    return r.rows.map(row => row.id);
  }

  // Otherwise just return the single resolved ID
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

const ROLES = {
  OWNER: 'owner',
  ADMIN: 'admin',
  MANAGER: 'manager',
  STAFF: 'staff'
};

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
  getTargetTenantIds,
};
