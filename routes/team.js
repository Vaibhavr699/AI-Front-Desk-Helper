"use strict";

const express = require("express");
const crypto = require("crypto");
const db = require("../lib/db");
const emailService = require("../services/email");
const auth = require("../lib/auth");
const { logAction } = require("../lib/auditLogger");

const router = express.Router();

// Middleware: Only allow access if the user is an admin of a parent tenant
// OR a manager/admin/owner of a specific branch
function requireTeamManager(req, res, next) {
  const isParentAdmin =
    req.user?.tenant_business_type === "parent" &&
    (req.user?.role === "admin" || req.user?.role === "owner");

  const isLocalManager =
    req.user?.role === "manager" ||
    req.user?.role === "admin" ||
    req.user?.role === "owner";

  if (!isParentAdmin && !isLocalManager) {
    return res.status(403).json({
      error: "Insufficient permissions to manage teams",
      code: "INSUFFICIENT_PERMISSIONS",
    });
  }

  next();
}

function getRoleDisplayName(role) {
  if (role === "owner" || role === "admin") return "Business Owner";
  if (role === "manager") return "Business Manager";
  if (role === "staff") return "Staff/Technician";
  return "Team Member";
}

async function safeLogAction(payload) {
  try {
    await logAction(payload);
  } catch (err) {
    console.error("[team.js] Audit log failed:", err);
  }
}

/**
 * GET /api/team
 * List all users for the current parent tenant and all its child locations.
 */
router.get("/", requireTeamManager, async (req, res) => {
  try {
    const parentId = req.user.tenant_id;
    const isParentAdmin = req.user?.tenant_business_type === "parent";
    const targetTenantId = auth.getTenantIdFromQuery(req);

    let query;
    let params;

    if (targetTenantId && targetTenantId !== "all") {
      query = `
        SELECT u.id, u.email, u.role, u.tenant_id, t.name as tenant_name, t.business_type, u.created_at
        FROM dashboard_users u
        JOIN tenants t ON u.tenant_id = t.id
        WHERE t.id = $1 AND (t.id = $2 OR t.parent_id = $2)
        ORDER BY 
          CASE 
            WHEN u.role IN ('owner', 'admin') THEN 1
            WHEN u.role = 'manager' THEN 2
            ELSE 3
          END,
          u.email ASC
      `;
      params = [targetTenantId, parentId];
    } else if (isParentAdmin) {
      query = `
        SELECT u.id, u.email, u.role, u.tenant_id, t.name as tenant_name, t.business_type, u.created_at
        FROM dashboard_users u
        JOIN tenants t ON u.tenant_id = t.id
        WHERE t.id = $1 OR t.parent_id = $1
        ORDER BY 
          CASE WHEN t.id = $1 THEN 0 ELSE 1 END,
          t.name ASC, 
          CASE 
            WHEN u.role IN ('owner', 'admin') THEN 1
            WHEN u.role = 'manager' THEN 2
            ELSE 3
          END,
          u.email ASC
      `;
      params = [parentId];
    } else {
      query = `
        SELECT u.id, u.email, u.role, u.tenant_id, t.name as tenant_name, t.business_type, u.created_at
        FROM dashboard_users u
        JOIN tenants t ON u.tenant_id = t.id
        WHERE t.id = $1
        ORDER BY 
          CASE 
            WHEN u.role IN ('owner', 'admin') THEN 1
            WHEN u.role = 'manager' THEN 2
            ELSE 3
          END,
          u.email ASC
      `;
      params = [req.user.tenant_id];
    }

    const r = await db.query(query, params);

    await safeLogAction({
      organization_id: req.user.tenant_id,
      user_id: req.user.id,
      action: "team_viewed",
      entity_type: "team",
      entity_id: targetTenantId && targetTenantId !== "all" ? String(targetTenantId) : String(req.user.tenant_id),
      new_value: {
        viewed_tenant_id: targetTenantId || req.user.tenant_id,
        viewed_scope: targetTenantId && targetTenantId !== "all" ? "single_location" : "organization",
        result_count: r.rows.length,
      },
      ip_address: req.ip,
      user_agent: req.get("user-agent"),
    });

    res.json({ team: r.rows });
  } catch (err) {
    console.error("GET /api/team error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * POST /api/team/invite
 * Invite a new user to a specific location or to the HQ.
 */
router.post("/invite", requireTeamManager, async (req, res) => {
  try {
    const { email, role, location_id } = req.body;

    if (!email || !role || !location_id) {
      return res.status(400).json({
        error: "Email, role, and location_id are required",
      });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const parentId = req.user.tenant_id;
    const isParentAdmin = req.user?.tenant_business_type === "parent";

    let authorizedLocationId = location_id;

    if (!isParentAdmin) {
      authorizedLocationId = parentId;
    }

    const rCheck = await db.query(
      "SELECT id, name FROM tenants WHERE (id = $1 OR parent_id = $1) AND id = $2",
      [parentId, authorizedLocationId]
    );

    if (rCheck.rows.length === 0) {
      return res.status(403).json({
        error: "Invalid location. You can only invite users to your authorized branch.",
      });
    }

    const locationName = rCheck.rows[0].name;

    const existing = await auth.findUserByEmail(normalizedEmail);
    if (existing) {
      return res.status(409).json({
        error: "A user with this email already exists.",
      });
    }

    const rPlan = await db.query("SELECT plan FROM tenants WHERE id = $1", [parentId]);
    const plan = (rPlan.rows[0]?.plan || "basic").toLowerCase();

    let seatLimit = 2;
    if (plan === "pro") seatLimit = 5;
    if (plan === "elite" || plan === "growth") seatLimit = 10;

    const rCount = await db.query(
      `SELECT count(*) as count
       FROM dashboard_users u
       JOIN tenants t ON u.tenant_id = t.id
       WHERE t.id = $1 OR t.parent_id = $1`,
      [parentId]
    );

    const currentUserCount = parseInt(rCount.rows[0].count, 10);

    if (currentUserCount >= seatLimit) {
      return res.status(403).json({
        error: `Your current ${plan.charAt(0).toUpperCase() + plan.slice(1)} plan limits you to ${seatLimit} team members. Please upgrade your plan to invite more users.`,
      });
    }

    const tempPassword = crypto.randomBytes(32).toString("hex");
    const hash = await auth.hashPassword(tempPassword);

    const rInsert = await db.query(
      `INSERT INTO dashboard_users (email, password_hash, tenant_id, role)
       VALUES ($1, $2, $3, $4)
       RETURNING id, email, tenant_id, role`,
      [normalizedEmail, hash, authorizedLocationId, role]
    );

    const newUser = rInsert.rows[0];

    const resetToken = auth.generateResetToken();
    const expires = new Date(Date.now() + 7 * 24 * 3600 * 1000);
    await auth.saveResetToken(newUser.email, resetToken, expires);

    const base = (process.env.DASHBOARD_URL || process.env.BASE_URL || "").replace(/\/$/, "");
    const setPasswordLink = base ? `${base}/reset-password?token=${resetToken}` : "";

    if (setPasswordLink) {
      const roleName = getRoleDisplayName(role);
      await emailService.sendTeamInviteEmail(
        newUser.email,
        setPasswordLink,
        locationName,
        roleName
      );
    } else {
      console.warn("[Team] Not sending invite email because BASE_URL is unset.");
    }

    await safeLogAction({
      organization_id: req.user.tenant_id,
      user_id: req.user.id,
      action: "user_invited",
      entity_type: "user",
      entity_id: String(newUser.id),
      new_value: {
        invited_user_id: newUser.id,
        invited_email: newUser.email,
        invited_role: newUser.role,
        invited_tenant_id: newUser.tenant_id,
        invited_location_name: locationName,
      },
      ip_address: req.ip,
      user_agent: req.get("user-agent"),
    });

    res.status(201).json({
      message: "User invited successfully",
      user: {
        id: newUser.id,
        email: newUser.email,
        role: newUser.role,
        tenant_id: newUser.tenant_id,
      },
    });
  } catch (err) {
    console.error("POST /api/team/invite error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * DELETE /api/team/:id
 * Remove a user
 */
router.delete("/:id", requireTeamManager, async (req, res) => {
  try {
    const targetUserId = req.params.id;
    const parentId = req.user.tenant_id;
    const isParentAdmin = req.user?.tenant_business_type === "parent";

    const rCheck = await db.query(
      `
      SELECT u.id, u.email, u.role, u.tenant_id, t.name as tenant_name
      FROM dashboard_users u
      JOIN tenants t ON u.tenant_id = t.id
      WHERE u.id = $1 AND (t.id = $2 OR t.parent_id = $2)
      `,
      [targetUserId, parentId]
    );

    if (rCheck.rows.length === 0) {
      return res.status(403).json({
        error: "User not found in your organization.",
      });
    }

    const targetUser = rCheck.rows[0];
    const targetUserTenantId = targetUser.tenant_id;

    if (!isParentAdmin && targetUserTenantId !== parentId) {
      return res.status(403).json({
        error: "You can only remove members from your own branch.",
      });
    }

    await db.query("DELETE FROM dashboard_users WHERE id = $1", [targetUserId]);

    await safeLogAction({
      organization_id: req.user.tenant_id,
      user_id: req.user.id,
      action: "user_removed",
      entity_type: "user",
      entity_id: String(targetUser.id),
      old_value: {
        removed_user_id: targetUser.id,
        removed_email: targetUser.email,
        removed_role: targetUser.role,
        removed_tenant_id: targetUser.tenant_id,
        removed_tenant_name: targetUser.tenant_name,
      },
      ip_address: req.ip,
      user_agent: req.get("user-agent"),
    });

    res.json({ message: "User removed successfully" });
  } catch (err) {
    console.error("DELETE /api/team/:id error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
