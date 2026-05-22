"use strict";

const express = require("express");
const crypto = require("crypto");
const db = require("../lib/db");
const emailService = require("../services/email");
const auth = require("../lib/auth");
const { logAction } = require("../lib/auditLogger");

const router = express.Router();

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

function getRequestIp(req) {
  return (
    req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.ip ||
    null
  );
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
        SELECT
          u.id, u.email, u.role, u.tenant_id,
          u.rep_seat_active, u.rep_seat_tier, u.rep_seat_activated_at,
          t.name AS tenant_name, t.business_type, u.created_at
        FROM dashboard_users u
        JOIN tenants t ON u.tenant_id = t.id
        WHERE t.id = $1 AND (t.id = $2 OR t.parent_id = $2)
        ORDER BY
          CASE WHEN u.role IN ('owner','admin') THEN 1 WHEN u.role='manager' THEN 2 ELSE 3 END,
          u.email ASC
      `;
      params = [targetTenantId, parentId];
    } else if (isParentAdmin) {
      query = `
        SELECT
          u.id, u.email, u.role, u.tenant_id,
          u.rep_seat_active, u.rep_seat_tier, u.rep_seat_activated_at,
          t.name AS tenant_name, t.business_type, u.created_at
        FROM dashboard_users u
        JOIN tenants t ON u.tenant_id = t.id
        WHERE t.id = $1 OR t.parent_id = $1
        ORDER BY
          CASE WHEN t.id = $1 THEN 0 ELSE 1 END,
          t.name ASC,
          CASE WHEN u.role IN ('owner','admin') THEN 1 WHEN u.role='manager' THEN 2 ELSE 3 END,
          u.email ASC
      `;
      params = [parentId];
    } else {
      query = `
        SELECT
          u.id, u.email, u.role, u.tenant_id,
          u.rep_seat_active, u.rep_seat_tier, u.rep_seat_activated_at,
          t.name AS tenant_name, t.business_type, u.created_at
        FROM dashboard_users u
        JOIN tenants t ON u.tenant_id = t.id
        WHERE t.id = $1
        ORDER BY
          CASE WHEN u.role IN ('owner','admin') THEN 1 WHEN u.role='manager' THEN 2 ELSE 3 END,
          u.email ASC
      `;
      params = [req.user.tenant_id];
    }

    const r = await db.query(query, params);

    await safeLogAction({
      tenant_id: String(req.user.tenant_id),
      user_id: String(req.user.sub),
      action: "team_viewed",
      entity_type: "team",
      entity_id: targetTenantId && targetTenantId !== "all"
        ? String(targetTenantId)
        : String(req.user.tenant_id),
      new_value: {
        viewed_tenant_id: String(targetTenantId || req.user.tenant_id),
        viewed_scope: targetTenantId && targetTenantId !== "all"
          ? "single_location"
          : "organization",
        result_count: r.rows.length,
      },
      ip_address: getRequestIp(req),
      user_agent: req.get("user-agent") || null,
    });

    res.json({ team: r.rows });
  } catch (err) {
    console.error("GET /api/team error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * POST /api/team/invite
 */
router.post("/invite", requireTeamManager, async (req, res) => {
  try {
    const { email, role, location_id } = req.body;

    if (!email || !role || !location_id) {
      return res.status(400).json({ error: "Email, role, and location_id are required" });
    }

    const allowedRoles = ["owner", "admin", "manager", "staff"];
    if (!allowedRoles.includes(role)) {
      return res.status(400).json({ error: "Invalid role" });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const parentId = req.user.tenant_id;
    const isParentAdmin = req.user?.tenant_business_type === "parent";

    let authorizedLocationId = location_id;
    if (!isParentAdmin) {
      authorizedLocationId = parentId;
    }

    const rCheck = await db.query(
      `SELECT id, name FROM tenants WHERE (id = $1 OR parent_id = $1) AND id = $2`,
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
      return res.status(409).json({ error: "A user with this email already exists." });
    }

    const rPlan = await db.query("SELECT plan FROM tenants WHERE id = $1", [parentId]);
    const plan = (rPlan.rows[0]?.plan || "basic").toLowerCase();

    let seatLimit = 2;
    if (plan === "pro") seatLimit = 5;
    if (plan === "elite" || plan === "growth") seatLimit = 10;

    const rCount = await db.query(
      `SELECT count(*) AS count FROM dashboard_users u
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
      await emailService.sendTeamInviteEmail(newUser.email, setPasswordLink, locationName, roleName);
    } else {
      console.warn("[Team] Not sending invite email because BASE_URL/DASHBOARD_URL is unset.");
    }

    await safeLogAction({
      tenant_id: String(req.user.tenant_id),
      user_id: String(req.user.sub),
      action: "user_invited",
      entity_type: "user",
      entity_id: String(newUser.id),
      new_value: {
        invited_user_id: String(newUser.id),
        invited_email: newUser.email,
        invited_role: newUser.role,
        invited_tenant_id: String(newUser.tenant_id),
        invited_location_name: locationName,
      },
      ip_address: getRequestIp(req),
      user_agent: req.get("user-agent") || null,
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

// PATCH /api/team/:id/rep-seat — Phase 6C
// Activates or deactivates a rep seat on a team member. Body:
//   { active: boolean, tier?: "standard" | "pro" | "elite" }
// Manager/owner only, and only for users within the caller's tenant scope.
router.patch("/:id/rep-seat", requireTeamManager, async (req, res) => {
  try {
    const targetUserId = req.params.id;
    const { active, tier } = req.body || {};
    if (typeof active !== "boolean") {
      return res.status(400).json({ error: "active (boolean) required" });
    }
    const allowedTiers = ["standard", "pro", "elite"];
    if (active && tier && !allowedTiers.includes(tier)) {
      return res.status(400).json({ error: "Invalid tier" });
    }

    const parentId = req.user.tenant_id;
    const isParentAdmin = req.user?.tenant_business_type === "parent";

    const scope = isParentAdmin
      ? `(u.tenant_id = $2 OR t.parent_id = $2)`
      : `u.tenant_id = $2`;
    const rCheck = await db.query(
      `SELECT u.id, u.email, u.tenant_id, u.rep_seat_active, u.rep_seat_tier
         FROM dashboard_users u
         JOIN tenants t ON u.tenant_id = t.id
        WHERE u.id = $1 AND ${scope}`,
      [targetUserId, parentId],
    );
    if (rCheck.rows.length === 0) {
      return res.status(404).json({ error: "User not found in your scope" });
    }
    const before = rCheck.rows[0];

    const finalTier = active ? (tier || before.rep_seat_tier || "standard") : before.rep_seat_tier;
    const result = await db.query(
      `UPDATE dashboard_users
          SET rep_seat_active = $1,
              rep_seat_tier = $2,
              rep_seat_activated_at = CASE WHEN $1 AND rep_seat_activated_at IS NULL THEN now() ELSE rep_seat_activated_at END,
              updated_at = now()
        WHERE id = $3
        RETURNING id, email, rep_seat_active, rep_seat_tier, rep_seat_activated_at`,
      [active, finalTier, targetUserId],
    );

    await safeLogAction({
      tenant_id: String(req.user.tenant_id),
      user_id: String(req.user.sub),
      action: "rep_seat_updated",
      entity_type: "user",
      entity_id: String(targetUserId),
      old_value: { active: before.rep_seat_active, tier: before.rep_seat_tier },
      new_value: { active, tier: finalTier },
      ip_address: getRequestIp(req),
      user_agent: req.get("user-agent") || null,
    });

    res.json({ user: result.rows[0] });
  } catch (err) {
    console.error("PATCH /api/team/:id/rep-seat error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * DELETE /api/team/:id
 */
router.delete("/:id", requireTeamManager, async (req, res) => {
  try {
    const targetUserId = req.params.id;
    const parentId = req.user.tenant_id;
    const isParentAdmin = req.user?.tenant_business_type === "parent";

    if (String(targetUserId) === String(req.user.sub)) {
      return res.status(400).json({ error: "You cannot remove your own account." });
    }

    const rCheck = await db.query(
      `SELECT u.id, u.email, u.role, u.tenant_id, t.name AS tenant_name
       FROM dashboard_users u
       JOIN tenants t ON u.tenant_id = t.id
       WHERE u.id = $1 AND (t.id = $2 OR t.parent_id = $2)`,
      [targetUserId, parentId]
    );

    if (rCheck.rows.length === 0) {
      return res.status(403).json({ error: "User not found in your organization." });
    }

    const targetUser = rCheck.rows[0];

    if (!isParentAdmin && String(targetUser.tenant_id) !== String(parentId)) {
      return res.status(403).json({ error: "You can only remove members from your own branch." });
    }

    if (targetUser.role === "owner") {
      return res.status(403).json({ error: "Owner accounts cannot be removed from this route." });
    }

    await db.query("DELETE FROM dashboard_users WHERE id = $1", [targetUserId]);

    await safeLogAction({
      tenant_id: String(req.user.tenant_id),
      user_id: String(req.user.sub),
      action: "user_removed",
      entity_type: "user",
      entity_id: String(targetUser.id),
      old_value: {
        removed_user_id: String(targetUser.id),
        removed_email: targetUser.email,
        removed_role: targetUser.role,
        removed_tenant_id: String(targetUser.tenant_id),
        removed_tenant_name: targetUser.tenant_name,
      },
      ip_address: getRequestIp(req),
      user_agent: req.get("user-agent") || null,
    });

    res.json({ message: "User removed successfully" });
  } catch (err) {
    console.error("DELETE /api/team/:id error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// GET /api/team/sharing-risks — Phase 6C anti-sharing
// Lists rep accounts in this tenant whose sharing_risk_score is at or above
// the v0 threshold. Owners review flagged accounts manually — nothing is
// auto-revoked.
router.get("/sharing-risks", requireTeamManager, async (req, res) => {
  try {
    const threshold = Math.max(parseInt(req.query.threshold, 10) || 4, 1);
    const r = await db.query(
      `SELECT id, email, role, rep_seat_tier,
              sharing_risk_score, sharing_risk_signals, sharing_risk_computed_at,
              last_app_open_at
         FROM dashboard_users
        WHERE tenant_id = $1
          AND rep_seat_active = true
          AND sharing_risk_score IS NOT NULL
          AND sharing_risk_score >= $2
        ORDER BY sharing_risk_score DESC, sharing_risk_computed_at DESC NULLS LAST`,
      [req.user.tenant_id, threshold],
    );
    res.json({
      threshold,
      flagged: r.rows.map((row) => ({
        id: row.id,
        email: row.email,
        role: row.role,
        seat_tier: row.rep_seat_tier || "standard",
        score: row.sharing_risk_score,
        signals: row.sharing_risk_signals || {},
        computed_at: row.sharing_risk_computed_at,
        last_app_open_at: row.last_app_open_at,
      })),
    });
  } catch (err) {
    console.error("GET /api/team/sharing-risks error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
