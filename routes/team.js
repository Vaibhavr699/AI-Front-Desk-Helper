"use strict";

const express = require("express");
const db = require("../lib/db");
const emailService = require("../services/email");
const auth = require("../lib/auth");

const router = express.Router();

// Middleware: Only allow access if the user is an admin of a parent tenant
function requireParentAdmin(req, res, next) {
  if (req.user?.tenant_business_type !== 'parent') {
    return res.status(403).json({ error: "Only HQ Admins can access team management" });
  }
  // Optional: check if they actually have role='admin'. Assuming owner=admin for now.
  next();
}

/**
 * GET /api/team
 * List all users for the current parent tenant and all its child locations.
 */
router.get("/", requireParentAdmin, async (req, res) => {
  try {
    const parentId = req.user.tenant_id;
    // Get all users assigned to the parent, OR any child of the parent
    const query = `
      SELECT u.id, u.email, u.role, u.tenant_id, t.name as tenant_name, t.business_type, u.created_at
      FROM dashboard_users u
      JOIN tenants t ON u.tenant_id = t.id
      WHERE t.id = $1 OR t.parent_id = $1
      ORDER BY 
        CASE WHEN t.id = $1 THEN 0 ELSE 1 END,
        t.name ASC, 
        u.email ASC
    `;
    const r = await db.query(query, [parentId]);
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
router.post("/invite", requireParentAdmin, async (req, res) => {
  try {
    const { email, role, location_id } = req.body;
    
    if (!email || !role || !location_id) {
      return res.status(400).json({ error: "Email, role, and location_id are required" });
    }

    const normalizedEmail = email.trim().toLowerCase();
    
    // Verify the requested location is either the parent or a valid child of this parent
    const parentId = req.user.tenant_id;
    const rCheck = await db.query(
      "SELECT id, name FROM tenants WHERE (id = $1 OR parent_id = $1) AND id = $2",
      [parentId, location_id]
    );
    if (rCheck.rows.length === 0) {
      return res.status(403).json({ error: "Invalid location. You can only invite users to your own branch locations." });
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
router.delete("/:id", requireParentAdmin, async (req, res) => {
  try {
    const targetUserId = req.params.id;
    const parentId = req.user.tenant_id;

    // Verify the target user belongs to the parent's hierarchy
    const rCheck = await db.query(`
      SELECT u.id 
      FROM dashboard_users u 
      JOIN tenants t ON u.tenant_id = t.id 
      WHERE u.id = $1 AND (t.id = $2 OR t.parent_id = $2)
    `, [targetUserId, parentId]);

    if (rCheck.rows.length === 0) {
      return res.status(403).json({ error: "User not found in your organization." });
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
