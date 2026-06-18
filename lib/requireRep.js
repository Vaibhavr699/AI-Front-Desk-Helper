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
      `SELECT u.id, u.tenant_id, u.email, u.role, u.rep_seat_active, u.rep_seat_tier,
              u.seat_type, u.rep_coach_account_type, u.trial_ends_at,
              u.coaching_delivery_prefs, u.expo_push_token,
              t.rep_coach_enabled, t.aifdh_enabled
         FROM dashboard_users u
         LEFT JOIN tenants t ON u.tenant_id = t.id
        WHERE u.id = $1
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
      seat_type: user.seat_type || null,
      account_type: user.rep_coach_account_type || null,
      trial_ends_at: user.trial_ends_at || null,
      coaching_delivery_prefs: user.coaching_delivery_prefs || {},
      expo_push_token: user.expo_push_token || null,
      tenant_flags: {
        rep_coach_enabled: user.rep_coach_enabled === true,
        aifdh_enabled: user.aifdh_enabled !== false,
      },
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

// Recording capability gate. A 'manager' seat is review-only and must be
// physically unable to start a recording or live-coaching session, even with a
// tampered client. 'rep' and legacy NULL seat_type are allowed (a NULL-seat-type
// user with an active rep seat predates the seat_type split and is a rep).
function requireRepSeat(req, res, next) {
  if (req.rep?.seat_type === "manager") {
    return res.status(403).json({
      error: "Manager seats are review-only and cannot record sessions",
      code: "REP_SEAT_TYPE_REQUIRED",
    });
  }
  next();
}

// Same check, callable outside Express (e.g. the WS handshake). Returns true if
// the seat may record.
function repSeatCanRecord(seatType) {
  return seatType !== "manager";
}

// Convenience: the full chain. Mount the rep router with this.
const repAuthChain = [authMiddleware, requireRep];

module.exports = {
  requireRep,
  requireRepTier,
  requireRepSeat,
  repSeatCanRecord,
  repAuthChain,
  TIER_RANK,
};
