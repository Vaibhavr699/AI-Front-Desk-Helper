"use strict";

// ════════════════════════════════════════════════════════════════════════
// routes/technicians.js — Phase 8B Tech Assignment (May 20, 2026)
// ════════════════════════════════════════════════════════════════════════
//
// The `technicians` table and the frontend api.js helpers (getTechnicians,
// createTechnician, updateTechnician, deleteTechnician) already existed —
// but this backend route file did not, so those helpers were 404ing.
// This file implements the missing /api/technicians API.
//
// `technicians` columns: id, tenant_id, name, email, phone, created_at,
//                        updated_at
// Constraints: PK(id), FK tenant_id -> tenants. No unique on email — so
// duplicate-email is handled as a soft check, not a DB constraint.
//
// A technician is a person who performs estimate visits. This is a
// SEPARATE population from dashboard_users (login accounts). A technician
// need not have a dashboard login; the `phone` here is what the Phase 8B
// pre-visit briefing SMS routes to when the technician is assigned to a
// booking.
//
// Auth model mirrors routes/team.js — manager-or-above only. Tenant
// scoping uses auth.getTenantIdFromQuery so the superadmin impersonation
// header (x-impersonate-tenant-id) is honored consistently.
// ════════════════════════════════════════════════════════════════════════

const express = require("express");
const db = require("../lib/db");
const auth = require("../lib/auth");
const { logAction } = require("../lib/auditLogger");

const router = express.Router();

// ─────────────────────────────────────────────────────────────────────────
// Auth — same gate as team management. Owner / admin / manager only.
// ─────────────────────────────────────────────────────────────────────────
function requireTechManager(req, res, next) {
  const role = req.user?.role;
  if (role === "owner" || role === "admin" || role === "manager") {
    return next();
  }
  return res.status(403).json({
    error: "Insufficient permissions to manage technicians",
    code: "INSUFFICIENT_PERMISSIONS",
  });
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
    console.error("[technicians.js] Audit log failed:", err);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Phone normalization — pre-visit briefing SMS needs E.164. Plain 10- or
// 11-digit US numbers are upgraded to +1XXXXXXXXXX; already-E.164 or
// non-US numbers are kept verbatim. Empty/absent → null.
// ─────────────────────────────────────────────────────────────────────────
function normalizePhone(raw) {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  if (trimmed === "") return null;

  if (trimmed.startsWith("+")) {
    const cleaned = "+" + trimmed.slice(1).replace(/[^\d]/g, "");
    return cleaned.length >= 8 ? cleaned : trimmed;
  }

  const digits = trimmed.replace(/[^\d]/g, "");
  if (digits.length === 10) return "+1" + digits;
  if (digits.length === 11 && digits.startsWith("1")) return "+" + digits;

  return trimmed; // unrecognized shape — store as typed
}

// ─────────────────────────────────────────────────────────────────────────
// Resolve the tenant this request operates on. Mirrors team.js: a request
// is scoped to the caller's tenant, with optional ?tenant_id= honored when
// it's the caller's own tenant or (for parent admins) a child branch, or
// when set via the superadmin impersonation header.
//
// Returns the tenant id string, or throws { status, error } for the caller
// to translate into an HTTP response.
// ─────────────────────────────────────────────────────────────────────────
async function resolveTenantId(req) {
  const callerTenantId = req.user?.tenant_id;
  if (!callerTenantId) {
    throw { status: 400, error: "Missing tenant context" };
  }

  const requested = auth.getTenantIdFromQuery(req);
  if (!requested || requested === "all" || String(requested) === String(callerTenantId)) {
    return String(callerTenantId);
  }

  // A different tenant was requested — only allow if it's a child branch
  // of the caller's parent tenant.
  if (req.user?.tenant_business_type === "parent") {
    const check = await db.query(
      "SELECT 1 FROM tenants WHERE id = $1 AND parent_id = $2",
      [requested, callerTenantId]
    );
    if (check.rows.length > 0) return String(requested);
  }

  if (req.user?.is_super_admin) return String(requested);

  throw { status: 403, error: "You can only manage technicians for your own location." };
}

// All routes require auth + manager-or-above.
router.use(function (req, res, next) { return auth.authMiddleware(req, res, next); });
router.use(requireTechManager);

// ─────────────────────────────────────────────────────────────────────────
// GET /api/technicians
// Returns { technicians: [...] } for the resolved tenant.
// ─────────────────────────────────────────────────────────────────────────
router.get("/", async (req, res) => {
  try {
    const tenantId = await resolveTenantId(req);

    const r = await db.query(
      `SELECT id, tenant_id, name, email, phone, created_at, updated_at
         FROM technicians
        WHERE tenant_id = $1
        ORDER BY name ASC`,
      [tenantId]
    );

    res.json({ technicians: r.rows });
  } catch (err) {
    if (err?.status) return res.status(err.status).json({ error: err.error });
    console.error("GET /api/technicians error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// POST /api/technicians
// Body: { name (required), email?, phone? }
// ─────────────────────────────────────────────────────────────────────────
router.post("/", async (req, res) => {
  try {
    const tenantId = await resolveTenantId(req);
    const { name, email, phone } = req.body || {};

    const trimmedName = (typeof name === "string" ? name.trim() : "");
    if (!trimmedName) {
      return res.status(400).json({ error: "Technician name is required" });
    }
    if (trimmedName.length > 120) {
      return res.status(400).json({ error: "Name must be 120 characters or less" });
    }

    const normalizedEmail = (typeof email === "string" ? email.trim().toLowerCase() : "") || null;
    const normalizedPhone = normalizePhone(phone);

    // Soft duplicate check — the table has no unique constraint on email,
    // but a repeated email on the same tenant is almost always a mistake.
    if (normalizedEmail) {
      const dup = await db.query(
        `SELECT id FROM technicians WHERE tenant_id = $1 AND lower(email) = $2 LIMIT 1`,
        [tenantId, normalizedEmail]
      );
      if (dup.rows.length > 0) {
        return res.status(409).json({
          error: "A technician with this email already exists for this location.",
          code: "DUPLICATE_EMAIL",
        });
      }
    }

    const r = await db.query(
      `INSERT INTO technicians (tenant_id, name, email, phone)
       VALUES ($1, $2, $3, $4)
       RETURNING id, tenant_id, name, email, phone, created_at, updated_at`,
      [tenantId, trimmedName, normalizedEmail, normalizedPhone]
    );

    const tech = r.rows[0];

    await safeLogAction({
      tenant_id: String(tenantId),
      user_id: req.user?.sub ? String(req.user.sub) : null,
      action: "settings_updated",
      entity_type: "technician",
      entity_id: String(tech.id),
      new_value: {
        technician_id: String(tech.id),
        name: tech.name,
        email: tech.email,
        has_phone: !!tech.phone,
        change: "technician_created",
      },
      ip_address: getRequestIp(req),
      user_agent: req.get("user-agent") || null,
    });

    res.status(201).json({ technician: tech });
  } catch (err) {
    if (err?.status) return res.status(err.status).json({ error: err.error });
    console.error("POST /api/technicians error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// PATCH /api/technicians/:id
// Body: any of { name, email, phone }. Tenant-scoped.
// ─────────────────────────────────────────────────────────────────────────
router.patch("/:id", async (req, res) => {
  try {
    const tenantId = await resolveTenantId(req);
    const techId = req.params.id;

    // Confirm the technician belongs to the resolved tenant.
    const existing = await db.query(
      `SELECT id, tenant_id, name, email, phone FROM technicians WHERE id = $1 LIMIT 1`,
      [techId]
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: "Technician not found" });
    }
    if (String(existing.rows[0].tenant_id) !== String(tenantId)) {
      return res.status(403).json({ error: "Technician belongs to a different location." });
    }

    const body = req.body || {};
    const updates = [];
    const params = [];
    let idx = 1;

    if (Object.prototype.hasOwnProperty.call(body, "name")) {
      const trimmedName = (typeof body.name === "string" ? body.name.trim() : "");
      if (!trimmedName) {
        return res.status(400).json({ error: "Name cannot be empty" });
      }
      if (trimmedName.length > 120) {
        return res.status(400).json({ error: "Name must be 120 characters or less" });
      }
      updates.push(`name = $${idx++}`);
      params.push(trimmedName);
    }

    if (Object.prototype.hasOwnProperty.call(body, "email")) {
      const normalizedEmail = (typeof body.email === "string" ? body.email.trim().toLowerCase() : "") || null;
      if (normalizedEmail) {
        const dup = await db.query(
          `SELECT id FROM technicians
            WHERE tenant_id = $1 AND lower(email) = $2 AND id != $3
            LIMIT 1`,
          [tenantId, normalizedEmail, techId]
        );
        if (dup.rows.length > 0) {
          return res.status(409).json({
            error: "Another technician with this email already exists for this location.",
            code: "DUPLICATE_EMAIL",
          });
        }
      }
      updates.push(`email = $${idx++}`);
      params.push(normalizedEmail);
    }

    if (Object.prototype.hasOwnProperty.call(body, "phone")) {
      updates.push(`phone = $${idx++}`);
      params.push(normalizePhone(body.phone));
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: "No editable fields provided." });
    }

    updates.push(`updated_at = now()`);
    params.push(techId);

    const r = await db.query(
      `UPDATE technicians
          SET ${updates.join(", ")}
        WHERE id = $${idx}
        RETURNING id, tenant_id, name, email, phone, created_at, updated_at`,
      params
    );

    const tech = r.rows[0];

    await safeLogAction({
      tenant_id: String(tenantId),
      user_id: req.user?.sub ? String(req.user.sub) : null,
      action: "settings_updated",
      entity_type: "technician",
      entity_id: String(tech.id),
      old_value: {
        name: existing.rows[0].name,
        email: existing.rows[0].email,
        phone: existing.rows[0].phone || null,
      },
      new_value: {
        technician_id: String(tech.id),
        name: tech.name,
        email: tech.email,
        phone: tech.phone || null,
        change: "technician_updated",
      },
      ip_address: getRequestIp(req),
      user_agent: req.get("user-agent") || null,
    });

    res.json({ technician: tech });
  } catch (err) {
    if (err?.status) return res.status(err.status).json({ error: err.error });
    console.error("PATCH /api/technicians/:id error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// DELETE /api/technicians/:id
// Tenant-scoped. Any bookings.technician_id pointing at this technician are
// set to NULL first (the FK is ON DELETE not specified, so we clear manually
// to avoid a constraint error and to gracefully un-assign affected bookings).
// ─────────────────────────────────────────────────────────────────────────
router.delete("/:id", async (req, res) => {
  try {
    const tenantId = await resolveTenantId(req);
    const techId = req.params.id;

    const existing = await db.query(
      `SELECT id, tenant_id, name FROM technicians WHERE id = $1 LIMIT 1`,
      [techId]
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: "Technician not found" });
    }
    if (String(existing.rows[0].tenant_id) !== String(tenantId)) {
      return res.status(403).json({ error: "Technician belongs to a different location." });
    }

    // Un-assign this technician from any bookings before deleting, so the
    // FK constraint doesn't block the delete and affected bookings simply
    // fall back to the tenant-default pre-visit briefing recipient.
    const cleared = await db.query(
      `UPDATE bookings SET technician_id = NULL
        WHERE technician_id = $1
        RETURNING id`,
      [techId]
    );

    await db.query("DELETE FROM technicians WHERE id = $1", [techId]);

    await safeLogAction({
      tenant_id: String(tenantId),
      user_id: req.user?.sub ? String(req.user.sub) : null,
      action: "settings_updated",
      entity_type: "technician",
      entity_id: String(techId),
      old_value: {
        technician_id: String(techId),
        name: existing.rows[0].name,
        change: "technician_deleted",
        unassigned_bookings: cleared.rows.length,
      },
      ip_address: getRequestIp(req),
      user_agent: req.get("user-agent") || null,
    });

    res.json({
      message: "Technician removed successfully",
      unassigned_bookings: cleared.rows.length,
    });
  } catch (err) {
    if (err?.status) return res.status(err.status).json({ error: err.error });
    console.error("DELETE /api/technicians/:id error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
