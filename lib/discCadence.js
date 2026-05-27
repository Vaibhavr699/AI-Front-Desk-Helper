"use strict";

// ═══════════════════════════════════════════════════════════════════════
// Phase 10E — DISC-Adaptive Cadence helper
// May 27, 2026
//
// Scales the base delay between recovery touches based on the lead's
// DISC primary classification + tenant configuration. Called from every
// site in services/estimateRecovery.js that computes a `nextActionAt`
// timestamp via addHours(now, delayHours).
//
// Design contract:
//   - Pure read path. Never throws — every error path returns the base
//     delay unchanged so a hiccup never blocks a touch from firing.
//   - No-ops when toggle is off, lead is missing, DISC isn't classified,
//     or confidence is below the configured floor.
//   - Single DB roundtrip per call. The two reads (recovery_settings +
//     leads.disc_*) live in different rows so they can't be a single
//     join cheaply, but each is keyed on PK / unique index and cached
//     in Postgres anyway.
//
// Bounds:
//   - Minimum floor: 0.5h (30 min). Prevents a 0× / fat-finger multiplier
//     from collapsing a 24h delay to instant fire.
//   - Maximum ceiling: 30 days (720h). Prevents a misconfigured S/C
//     multiplier from pushing a touch off into next quarter.
//
// Logging:
//   - One [10E] log line per scale event so we can grep conversion
//     impact across DISC buckets without parsing structured payloads.
//   - No log when toggle is off or DISC is missing — those are no-ops
//     and would just create log noise.
// ═══════════════════════════════════════════════════════════════════════

const db = require("./db");

const VALID_BUCKETS = new Set(["D", "I", "S", "C"]);

// Safety clamps. The cadence math is base * multiplier, so a misconfigured
// 0 multiplier would collapse to instant fire and a 100× multiplier would
// push a touch 100× into the future. These bound the output regardless of
// what's in disc_cadence_multipliers, so a config typo can't break prod.
const MIN_DELAY_HOURS = 0.5;        // 30 minutes
const MAX_DELAY_HOURS = 30 * 24;    // 30 days

/**
 * Scale a base delay (in hours) based on the lead's DISC primary type and
 * the tenant's adaptive cadence settings.
 *
 * @param {number} baseDelayHours - The fixed delay defined in the sequence
 *   step (e.g., GHOST_SEQUENCE step's delayHours).
 * @param {string|null} leadId - The recovery's lead_id. May be null for
 *   recoveries created without a linked lead (rare — usually missed-call
 *   or webhook-sourced rows that didn't resolve a lead).
 * @param {string} tenantId - The recovery's tenant_id.
 * @returns {Promise<number>} The adjusted delay in hours, clamped to
 *   [MIN_DELAY_HOURS, MAX_DELAY_HOURS]. Returns baseDelayHours unchanged
 *   for any no-op condition (toggle off, no lead, no DISC, low confidence,
 *   DB error).
 */
async function applyDiscMultiplier(baseDelayHours, leadId, tenantId) {
  // Defensive: bad input → return base. Callers shouldn't pass NaN/0/null
  // for baseDelayHours but if they do, we don't want to throw or produce
  // a weird timestamp. The sequence's static values are always valid; this
  // guards against future callers misusing the helper.
  if (!Number.isFinite(baseDelayHours) || baseDelayHours <= 0) {
    return baseDelayHours;
  }

  // No tenant → no settings → no scaling. Shouldn't happen for real
  // recoveries (tenant_id is NOT NULL on estimate_recoveries) but be safe.
  if (!tenantId) return baseDelayHours;

  // No lead → can't look up DISC → no scaling. Common for missed-call
  // recoveries that fire before lead resolution. Returns base unchanged.
  if (!leadId) return baseDelayHours;

  try {
    // Read tenant's 10E settings. Phase 10 already populates recovery_settings
    // for every tenant that's touched recovery toggles, so this row usually
    // exists. When it doesn't (tenant has never opened the Recovery page),
    // mig 084's defaults don't apply — there's literally no row. Treat as
    // disabled.
    const settingsRes = await db.query(
      `SELECT disc_adaptive_cadence_enabled,
              disc_cadence_multipliers,
              disc_cadence_min_confidence
         FROM recovery_settings
        WHERE tenant_id = $1
        LIMIT 1`,
      [tenantId]
    );

    const settings = settingsRes.rows[0];
    if (!settings || !settings.disc_adaptive_cadence_enabled) {
      return baseDelayHours;
    }

    // Read lead's DISC fields. The mig 081 columns are nullable, so a lead
    // that hasn't been classified yet returns nulls — we treat that as the
    // "unknown" bucket below.
    const leadRes = await db.query(
      `SELECT disc_primary, disc_confidence
         FROM leads
        WHERE id = $1
        LIMIT 1`,
      [leadId]
    );

    const lead = leadRes.rows[0];
    if (!lead) return baseDelayHours;

    // Pick the bucket. Confidence floor gates whether we trust the primary
    // classification — below the floor, the inference is acting on noise
    // and we'd rather fall through to the unknown bucket (default 1.0×).
    const minConf = Number(settings.disc_cadence_min_confidence) || 0;
    const conf = Number(lead.disc_confidence) || 0;
    const primary = (lead.disc_primary || "").toUpperCase().trim();

    let bucket;
    if (VALID_BUCKETS.has(primary) && conf >= minConf) {
      bucket = primary;
    } else {
      bucket = "unknown";
    }

    // Resolve multiplier. JSONB column comes back as a plain object in pg.
    // If the bucket is missing from the JSON (tenant edited it to remove
    // a key), fall through to 1.0× rather than throwing on undefined.
    const multipliers = settings.disc_cadence_multipliers || {};
    const raw = multipliers[bucket];
    const multiplier = Number.isFinite(Number(raw)) ? Number(raw) : 1.0;

    // Apply + clamp. Clamp BEFORE the log so the log reflects the actual
    // delay that gets used, not the pre-clamp math.
    let adjusted = baseDelayHours * multiplier;
    if (adjusted < MIN_DELAY_HOURS) adjusted = MIN_DELAY_HOURS;
    if (adjusted > MAX_DELAY_HOURS) adjusted = MAX_DELAY_HOURS;

    // Skip log if the math is a no-op — 1.0× unknown bucket fires constantly
    // and would drown the real signal. Only log when we actually changed
    // the delay or when a real DISC bucket was applied.
    if (multiplier !== 1.0 || bucket !== "unknown") {
      console.log(
        "[10E] cadence scale leadId=%s tenant=%s bucket=%s conf=%s base=%sh mult=%s adjusted=%sh",
        leadId,
        tenantId,
        bucket,
        conf.toFixed(2),
        baseDelayHours,
        multiplier,
        adjusted.toFixed(2)
      );
    }

    return adjusted;
  } catch (err) {
    // Fail open: any DB error returns the base unchanged. Recovery system
    // is more important than adaptive cadence — a bad query should never
    // cause us to drop or mis-fire a touch.
    console.error(
      "[10E] applyDiscMultiplier failed leadId=%s tenant=%s err=%s — using base delay",
      leadId,
      tenantId,
      err.message
    );
    return baseDelayHours;
  }
}

module.exports = {
  applyDiscMultiplier,
  // Exported for tests + future tooling.
  MIN_DELAY_HOURS,
  MAX_DELAY_HOURS,
  VALID_BUCKETS,
};
