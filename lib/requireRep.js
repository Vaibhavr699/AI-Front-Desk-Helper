"use strict";

// ── requireRep middleware ───────────────────────────────────────────────────
// Composes on top of the existing authMiddleware (lib/auth.js). Runs after
// JWT verification and enforces:
//
//   1. Token was issued via the rep login flow (scope === "rep") — a regular
//      dashboard JWT can't access /api/rep/* even if the user happens to have
//      a seat. Keeps the two surfaces cleanly separated.
//   2. The user still has rep_seat_active = true at request time (admin may
//      have revoked since the JWT was issued).
//
// Attaches:
//   req.rep = {
//     id, tenant_id, email, seat_tier, coaching_delivery_prefs,
//     expo_push_token, role
//   }
//
// Downstream handlers gate Pro/Elite features by checking req.rep.seat_tier.
// ────────────────────────────────────────────────────────────────────────────

const { authMiddleware } = require("./auth");
const db = require("./db");

async function requireRep(req, res, next) {
  if (req.user?.scope !== "rep") {
    return res.status(403).json({
      error: "Rep app token required",
      code: "REP_SCOPE_REQUIRED",
    });
  }

  const userId = req.user.sub;
  if (!userId) {
    return res.status(401).json({ error: "Invalid rep token", code: "REP_TOKEN_INVALID" });
  }

  try {
    const r = await db.query(
      `SELECT id, tenant_id, email, role, rep_seat_active, rep_seat_tier,
              coaching_delivery_prefs, expo_push_token
         FROM dashboard_users
        WHERE id = $1
        LIMIT 1`,
      [userId]
    );
    const user = r.rows[0];
    if (!user) {
      return res.status(401).json({ error: "Rep user not found", code: "REP_USER_NOT_FOUND" });
    }
    if (!user.rep_seat_active) {
      return res.status(403).json({
        error: "Rep seat is not active",
        code: "REP_SEAT_INACTIVE",
      });
    }
    req.rep = {
      id: user.id,
      tenant_id: user.tenant_id,
      email: user.email,
      role: user.role,
      seat_tier: user.rep_seat_tier || "standard",
      coaching_delivery_prefs: user.coaching_delivery_prefs || {},
      expo_push_token: user.expo_push_token || null,
    };
    next();
  } catch (e) {
    console.error("[requireRep] lookup failed:", e);
    res.status(500).json({ error: "Server error" });
  }
}

// Feature-flag helper — Pro = audio coaching, Elite = watch + manager view.
// Use in route handlers like:   requireRepTier("pro")   or   requireRepTier("elite")
const TIER_RANK = { standard: 0, pro: 1, elite: 2 };

function requireRepTier(minTier) {
  const min = TIER_RANK[minTier] ?? 0;
  return (req, res, next) => {
    const have = TIER_RANK[req.rep?.seat_tier] ?? 0;
    if (have < min) {
      return res.status(403).json({
        error: `This feature requires the ${minTier} seat tier`,
        code: "REP_TIER_REQUIRED",
        required_tier: minTier,
        current_tier: req.rep?.seat_tier || "standard",
      });
    }
    next();
  };
}

// Convenience: the full chain. Mount the rep router with this.
const repAuthChain = [authMiddleware, requireRep];

module.exports = { requireRep, requireRepTier, repAuthChain, TIER_RANK };
