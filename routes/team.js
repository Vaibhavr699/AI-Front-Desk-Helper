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

// ─────────────────────────────────────────────────────────────────────────
// Phone normalization (Phase 8B tech-routing — May 20, 2026)
//
// The pre-visit briefing SMS sends to E.164 numbers. We store whatever the
// user types but normalize to E.164 (+1XXXXXXXXXX) when it's a plain 10- or
// 11-digit US number. If it's already E.164 or non-US we keep it verbatim.
// Empty string → null (clears the field).
// ─────────────────────────────────────────────────────────────────────────
function normalizePhone(raw) {
  if (raw == null) return undefined;          // field absent — caller skips update
  const trimmed = String(raw).trim();
  if (trimmed === "") return null;            // explicit clear

  if (trimmed.startsWith("+")) {
    // Already E.164-ish — strip spaces/dashes/parens, keep the +.
    const cleaned = "+" + trimmed.slice(1).replace(/[^\d]/g, "");
    return cleaned.length >= 8 ? cleaned : trimmed;
  }

  const digits = trimmed.replace(/[^\d]/g, "");
  if (digits.length === 10) return "+1" + digits;
  if (digits.length === 11 && digits.startsWith("1")) return "+" + digits;

  // Unrecognized shape — store as typed; the SMS layer will reject if invalid.
  return trimmed;
}

/**
 * GET /api/team
 *
 * Phase 8B: now returns `phone` so the Team tab can display + edit it.
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
          u.id, u.email, u.role, u.tenant_id, u.phone,
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
          u.id, u.email, u.role, u.tenant_id, u.phone,
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
          u.id, u.email, u.role, u.tenant_id, u.phone,
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
 *
 * Phase 8B: accepts an optional `phone` so an estimator's cell can be set
 * at invite time. Phone is normalized to E.164 when it's a plain US number.
 */
router.post("/invite", requireTeamManager, async (req, res) => {
  try {
    const { email, role, location_id, phone } = req.body;

    if (!email || !role || !location_id) {
      return res.status(400).json({ error: "Email, role, and location_id are required" });
    }

    const allowedRoles = ["owner", "admin", "manager", "staff"];
    if (!allowedRoles.includes(role)) {
      return res.status(400).json({ error: "Invalid role" });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const normalizedPhone = normalizePhone(phone); // undefined if not supplied
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

    // phone column added in migration 084. normalizedPhone is `undefined`
    // when the caller omitted it (defaults to NULL) or a string/null.
    const rInsert = await db.query(
      `INSERT INTO dashboard_users (email, password_hash, tenant_id, role, phone)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, email, tenant_id, role, phone`,
      [normalizedEmail, hash, authorizedLocationId, role, normalizedPhone ?? null]
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
        invited_has_phone: !!newUser.phone,
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
        phone: newUser.phone,
      },
    });
  } catch (err) {
    console.error("POST /api/team/invite error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * PATCH /api/team/:id
 *
 * Phase 8B (May 20, 2026) — edit an existing team member. Currently used
 * to set/clear a member's `phone` so they can receive pre-visit briefing
 * SMS when assigned to a booking. Scoped to the caller's organization with
 * the same authorization model as DELETE.
 *
 * Body: { phone?: string }   — empty string clears the phone.
 */
router.patch("/:id", requireTeamManager, async (req, res) => {
  try {
    const targetUserId = req.params.id;
    const parentId = req.user.tenant_id;
    const isParentAdmin = req.user?.tenant_business_type === "parent";

    // Confirm the target user belongs to the caller's org.
    const rCheck = await db.query(
      `SELECT u.id, u.email, u.role, u.tenant_id, u.phone, t.name AS tenant_name
         FROM dashboard_users u
         JOIN tenants t ON u.tenant_id = t.id
        WHERE u.id = $1 AND (t.id = $2 OR t.parent_id = $2)`,
      [targetUserId, parentId]
    );

    if (rCheck.rows.length === 0) {
      return res.status(403).json({ error: "User not found in your organization." });
    }

    const targetUser = rCheck.rows[0];

    // Branch managers can only edit members of their own branch.
    if (!isParentAdmin && String(targetUser.tenant_id) !== String(parentId)) {
      return res.status(403).json({ error: "You can only edit members of your own branch." });
    }

    // Build the update set. Only `phone` is editable for now.
    const updates = [];
    const params = [];
    let idx = 1;

    if (Object.prototype.hasOwnProperty.call(req.body, "phone")) {
      const normalizedPhone = normalizePhone(req.body.phone); // string | null
      updates.push(`phone = $${idx++}`);
      params.push(normalizedPhone);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: "No editable fields provided." });
    }

    updates.push(`updated_at = now()`);
    params.push(targetUserId);

    const rUpdate = await db.query(
      `UPDATE dashboard_users
          SET ${updates.join(", ")}
        WHERE id = $${idx}
        RETURNING id, email, role, tenant_id, phone`,
      params
    );

    const updatedUser = rUpdate.rows[0];

    await safeLogAction({
      tenant_id: String(req.user.tenant_id),
      user_id: String(req.user.sub),
      action: "settings_updated",
      entity_type: "user",
      entity_id: String(updatedUser.id),
      old_value: { phone: targetUser.phone || null },
      new_value: {
        updated_user_id: String(updatedUser.id),
        updated_email: updatedUser.email,
        phone: updatedUser.phone || null,
      },
      ip_address: getRequestIp(req),
      user_agent: req.get("user-agent") || null,
    });

    res.json({
      message: "User updated successfully",
      user: updatedUser,
    });
  } catch (err) {
    console.error("PATCH /api/team/:id error:", err);
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

module.exports = router;
