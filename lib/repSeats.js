"use strict";

const db = require("./db");

async function getTenantRepSeatLimit(tenantId) {
  try {
    const r = await db.query(
      "SELECT rep_seat_limit FROM tenants WHERE id = $1",
      [tenantId],
    );
    const v = r.rows[0]?.rep_seat_limit;
    return typeof v === "number" ? v : null;
  } catch {
    return null;
  }
}

async function countActiveRepSeats(tenantId, excludeUserId = null) {
  const params = [tenantId];
  let sql =
    "SELECT count(*)::int AS n FROM dashboard_users WHERE tenant_id = $1 AND rep_seat_active = true";
  if (excludeUserId) {
    params.push(excludeUserId);
    sql += " AND id <> $2";
  }
  const r = await db.query(sql, params);
  return r.rows[0]?.n || 0;
}

async function canActivateRepSeat(tenantId, excludeUserId = null) {
  const limit = await getTenantRepSeatLimit(tenantId);
  if (limit == null) return { ok: true, limit: null, active: null };
  const active = await countActiveRepSeats(tenantId, excludeUserId);
  return { ok: active < limit, limit, active };
}

async function isWithinSeatLimit(tenantId, userId) {
  const limit = await getTenantRepSeatLimit(tenantId);
  if (limit == null) return true;
  const r = await db.query(
    `SELECT id FROM dashboard_users
      WHERE tenant_id = $1 AND rep_seat_active = true
      ORDER BY rep_seat_activated_at ASC NULLS LAST, id ASC
      LIMIT $2`,
    [tenantId, limit],
  );
  return r.rows.some((row) => String(row.id) === String(userId));
}

module.exports = {
  getTenantRepSeatLimit,
  countActiveRepSeats,
  canActivateRepSeat,
  isWithinSeatLimit,
};
