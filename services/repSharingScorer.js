"use strict";

const db = require("../lib/db");

const FINGERPRINT_WINDOW_DAYS = 7;
const IP_WINDOW_HOURS = 24;
const BIOMETRIC_WINDOW_DAYS = 7;
const FLAG_THRESHOLD = 4;

function ipBlock(ip) {
  if (typeof ip !== "string" || ip.length === 0) return null;
  if (ip.includes(":")) {
    const parts = ip.split(":");
    return parts.slice(0, 4).join(":");
  }
  const octets = ip.split(".");
  if (octets.length !== 4) return null;
  return `${octets[0]}.${octets[1]}.${octets[2]}.0/24`;
}

async function fetchRepUserIds() {
  const r = await db.query(
    `SELECT id, tenant_id
       FROM dashboard_users
      WHERE rep_seat_active = true`
  );
  return r.rows;
}

async function fetchSignals(userId) {
  const fp = await db.query(
    `SELECT DISTINCT device_fingerprint
       FROM rep_app_events
      WHERE user_id = $1
        AND device_fingerprint IS NOT NULL
        AND created_at >= now() - ($2::text || ' days')::interval`,
    [userId, String(FINGERPRINT_WINDOW_DAYS)],
  );

  const ipRows = await db.query(
    `SELECT DISTINCT ip_address
       FROM rep_app_events
      WHERE user_id = $1
        AND ip_address IS NOT NULL
        AND created_at >= now() - ($2::text || ' hours')::interval`,
    [userId, String(IP_WINDOW_HOURS)],
  );

  const bio = await db.query(
    `SELECT DISTINCT event_metadata->>'biometric_type' AS biometric_type
       FROM rep_app_events
      WHERE user_id = $1
        AND event_metadata->>'biometric_type' IS NOT NULL
        AND created_at >= now() - ($2::text || ' days')::interval`,
    [userId, String(BIOMETRIC_WINDOW_DAYS)],
  );

  const ipBlocks = new Set();
  for (const row of ipRows.rows) {
    const block = ipBlock(row.ip_address);
    if (block) ipBlocks.add(block);
  }

  return {
    distinct_fingerprints_7d: fp.rows
      .map((r) => r.device_fingerprint)
      .filter(Boolean).length,
    distinct_ip_blocks_24h: ipBlocks.size,
    distinct_biometric_types_7d: bio.rows
      .map((r) => r.biometric_type)
      .filter(Boolean).length,
  };
}

function scoreSignals(signals) {
  let score = 0;
  const reasons = [];

  if (signals.distinct_fingerprints_7d >= 3) {
    score += 3;
    reasons.push(
      `3+ distinct devices in last 7 days (${signals.distinct_fingerprints_7d})`,
    );
  } else if (signals.distinct_fingerprints_7d >= 2) {
    score += 2;
    reasons.push(
      `2 distinct devices in last 7 days`,
    );
  }

  if (signals.distinct_biometric_types_7d >= 2) {
    score += 2;
    reasons.push(
      `Multiple biometric types in last 7 days (${signals.distinct_biometric_types_7d})`,
    );
  }

  if (signals.distinct_ip_blocks_24h >= 10) {
    score += 3;
    reasons.push(
      `10+ distinct IP networks in last 24h (${signals.distinct_ip_blocks_24h})`,
    );
  } else if (signals.distinct_ip_blocks_24h >= 5) {
    score += 2;
    reasons.push(
      `5+ distinct IP networks in last 24h (${signals.distinct_ip_blocks_24h})`,
    );
  }

  return { score, reasons };
}

async function persistScore(userId, signals, score, reasons) {
  await db.query(
    `UPDATE dashboard_users
        SET sharing_risk_score = $1,
            sharing_risk_signals = $2::jsonb,
            sharing_risk_computed_at = now()
      WHERE id = $3`,
    [
      score,
      JSON.stringify({ ...signals, reasons }),
      userId,
    ],
  );
}

async function scoreOneUser(user) {
  try {
    const signals = await fetchSignals(user.id);
    const { score, reasons } = scoreSignals(signals);
    await persistScore(user.id, signals, score, reasons);
    return { user_id: user.id, score, flagged: score >= FLAG_THRESHOLD };
  } catch (err) {
    console.error(
      "[repSharingScorer] failed user=%s: %s",
      user.id,
      err.message,
    );
    return { user_id: user.id, score: null, flagged: false, error: err.message };
  }
}

async function runSharingRiskSweep() {
  const users = await fetchRepUserIds();
  let scored = 0;
  let flagged = 0;
  for (const u of users) {
    const result = await scoreOneUser(u);
    if (result.score != null) scored++;
    if (result.flagged) flagged++;
  }
  console.log(
    "[repSharingScorer] sweep complete users=%d scored=%d flagged=%d",
    users.length,
    scored,
    flagged,
  );
  return { users: users.length, scored, flagged };
}

module.exports = {
  runSharingRiskSweep,
  scoreSignals,
  ipBlock,
  FLAG_THRESHOLD,
};
