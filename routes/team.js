"use strict";

const express = require("express");
const db = require("../lib/db");
const emailService = require("../services/email");
const auth = require("../lib/auth");

const router = express.Router();

// Middleware: Only allow access if the user is an admin of a parent tenant
// Middleware: Only allow access if the user is an admin of a parent tenant OR a manager of a specific branch
function requireTeamManager(req, res, next) {
  const isParentAdmin = req.user?.tenant_business_type === 'parent' && (req.user?.role === 'admin' || req.user?.role === 'owner');
  const isLocalManager = (req.user?.role === 'manager' || req.user?.role === 'admin' || req.user?.role === 'owner');

  if (!isParentAdmin && !isLocalManager) {
    return res.status(403).json({ error: "Insufficient permissions to manage teams", code: "INSUFFICIENT_PERMISSIONS" });
  }
  next();
}

/**
 * GET /api/team
 * List all users for the current parent tenant and all its child locations.
 */
router.get("/", requireTeamManager, async (req, res) => {
  try {
    const parentId = req.user.tenant_id;
    const isParentAdmin = req.user?.tenant_business_type === 'parent';
    
    // Use helper to resolve which tenant is being viewed
    const targetTenantId = auth.getTenantIdFromQuery(req);
    
    let query;
    let params;

    if (targetTenantId && targetTenantId !== 'all') {
      // 1. Specific location requested - Only show members of THAT location
      query = `
        SELECT u.id, u.email, u.role, u.tenant_id, t.name as tenant_name, t.business_type, u.created_at
        FROM dashboard_users u
        JOIN tenants t ON u.tenant_id = t.id
        WHERE t.id = $1 AND (t.id = $2 OR t.parent_id = $2)
        ORDER BY u.email ASC
      `;
      params = [targetTenantId, parentId];
    } else if (isParentAdmin) {
      // 2. HQ Admin viewing all locations
      query = `
        SELECT u.id, u.email, u.role, u.tenant_id, t.name as tenant_name, t.business_type, u.created_at
        FROM dashboard_users u
        JOIN tenants t ON u.tenant_id = t.id
        WHERE t.id = $1 OR t.parent_id = $1
        ORDER BY 
          CASE WHEN t.id = $1 THEN 0 ELSE 1 END,
          t.name ASC, 
          u.email ASC
      `;
      params = [parentId];
    } else {
      // 3. Fallback for non-HQ users: Only show their own location team
      query = `
        SELECT u.id, u.email, u.role, u.tenant_id, t.name as tenant_name, t.business_type, u.created_at
        FROM dashboard_users u
        JOIN tenants t ON u.tenant_id = t.id
        WHERE t.id = $1
        ORDER BY u.email ASC
      `;
      params = [req.user.tenant_id];
    }

    const r = await db.query(query, params);
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
      return res.status(400).json({ error: "Email, role, and location_id are required" });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const parentId = req.user.tenant_id;
    const isParentAdmin = req.user?.tenant_business_type === 'parent';

    // Verify authorized location
    // HQ Admin can invite to any child or HQ. Branch Manager can only invite to their own branch.
    let authorizedLocationId = location_id;
    if (!isParentAdmin) {
       // Force the location to their own branch if they aren't HQ
       authorizedLocationId = parentId;
    }

    const rCheck = await db.query(
      "SELECT id, name FROM tenants WHERE (id = $1 OR parent_id = $1) AND id = $2",
      [parentId, authorizedLocationId]
    );
    if (rCheck.rows.length === 0) {
      return res.status(403).json({ error: "Invalid location. You can only invite users to your authorized branch." });
    }
    const locationName = rCheck.rows[0].name;

    // Check if user exists
    const existing = await auth.findUserByEmail(normalizedEmail);
    if (existing) {
      return res.status(409).json({ error: "A user with this email already exists." });
    }

    // Determine tenant plan and user seat limit
    const rPlan = await db.query("SELECT plan FROM tenants WHERE id = $1", [parentId]);
    const plan = (rPlan.rows[0]?.plan || "basic").toLowerCase();
    
    let seatLimit = 2; // basic
    if (plan === "pro") seatLimit = 5;
    if (plan === "elite" || plan === "growth") seatLimit = 10;
    
    // Count active dashboard_users in the organization (parent + all children)
    const rCount = await db.query(
      "SELECT count(*) as count FROM dashboard_users u JOIN tenants t ON u.tenant_id = t.id WHERE t.id = $1 OR t.parent_id = $1",
      [parentId]
    );
    const currentUserCount = parseInt(rCount.rows[0].count, 10);
    
    if (currentUserCount >= seatLimit) {
      return res.status(403).json({ 
        error: `Your current ${plan.charAt(0).toUpperCase() + plan.slice(1)} plan limits you to ${seatLimit} team members. Please upgrade your plan to invite more users.` 
      });
    }

    // Generate a temporary unguessable password hash
    const tempPassword = require('crypto').randomBytes(32).toString('hex');
    const hash = await auth.hashPassword(tempPassword);

    // Create user
    const rInsert = await db.query(
      "INSERT INTO dashboard_users (email, password_hash, tenant_id, role) VALUES ($1, $2, $3, $4) RETURNING id, email",
      [normalizedEmail, hash, location_id, role]
    );
    const newUser = rInsert.rows[0];

    // Generate a reset token for the invitation email
    const resetToken = auth.generateResetToken();
    const expires = new Date(Date.now() + 7 * 24 * 3600 * 1000); // 7 days expiration for invites
    await auth.saveResetToken(newUser.email, resetToken, expires);

    // Send the email
    const base = (process.env.DASHBOARD_URL || process.env.BASE_URL || "").replace(/\/$/, "");
    const setPasswordLink = base ? `${base}/reset-password?token=${resetToken}` : "";
    
    if (setPasswordLink) {
      let roleName = "Team Member";
      if (role === 'owner' || role === 'admin') roleName = "Business Owner";
      else if (role === 'manager') roleName = "Business Manager";
      else if (role === 'staff') roleName = "Staff/Technician";
      
      await emailService.sendTeamInviteEmail(newUser.email, setPasswordLink, locationName, roleName);
    } else {
      console.warn("[Team] Not sending invite email because BASE_URL is unset.");
    }

    res.status(201).json({ 
      message: "User invited successfully", 
      user: { id: newUser.id, email: newUser.email, role, tenant_id: location_id }
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
    const isParentAdmin = req.user?.tenant_business_type === 'parent';

    // Verify the target user belongs to the hierarchy AND is within the manager's scope
    const rCheck = await db.query(`
      SELECT u.id, u.tenant_id 
      FROM dashboard_users u 
      JOIN tenants t ON u.tenant_id = t.id 
      WHERE u.id = $1 AND (t.id = $2 OR t.parent_id = $2)
    `, [targetUserId, parentId]);

    if (rCheck.rows.length === 0) {
      return res.status(403).json({ error: "User not found in your organization." });
    }

    const targetUserTenantId = rCheck.rows[0].tenant_id;

    // Enforce scoping for non-HQ admins
    if (!isParentAdmin && targetUserTenantId !== parentId) {
      return res.status(403).json({ error: "You can only remove members from your own branch." });
    }

    // Delete user
    await db.query("DELETE FROM dashboard_users WHERE id = $1", [targetUserId]);
    
    res.json({ message: "User removed successfully" });
  } catch (err) {
    console.error("DELETE /api/team/:id error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
