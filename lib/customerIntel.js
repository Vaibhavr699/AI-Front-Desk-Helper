// ═══════════════════════════════════════════════════════════════════════
// lib/customerIntel.js
// PHASE 8D — CUSTOMER INTEL  (DISC profile × conversion outcome)
//
// Read-only aggregate. Answers "which DISC type converts into paying jobs."
// Exposed inside the existing /metrics response as `metrics.customer_intel`.
// Coach-advice layer deferred to Phase 9.
//
// DESIGN NOTES
// ------------
// Source       : `leads` table only. mig 081 put disc_* columns directly on
//                leads, so this is a single-table aggregate — NO join to
//                coaching_conversations, NO fan-out from multi-call leads.
// Won signal   : leads.status = 'Won' (case-insensitive, trimmed). Confirmed
//                against server.js /webhooks/crm/job-completed — that webhook
//                sets status='Won' AND actual_revenue_cents together, so
//                status is the bucket key and revenue is secondary display.
// Lost signal  : leads.status = 'Closed'.
// Settled      : won + lost. Open leads (everything else) are counted and
//                shown but NEVER folded into the conversion rate.
// Time range   : ALWAYS all-time. Ignores the dashboard timeRange selector —
//                with a tiny settled-outcome count, 30d would zero it out.
// Thin-data    : a bucket reports a real rate only when settled >= MIN_SETTLED.
//                Otherwise it returns enough_data:false and the UI renders
//                "Collecting" instead of a meaningless percentage.
// Multi-tenant : accepts an ARRAY of tenant ids (tenant_id = ANY($1)) to
//                match the HQ-rollup pattern used everywhere in
//                routes/dashboard.js. A single-tenant request just passes a
//                one-element array.
// ═══════════════════════════════════════════════════════════════════════

const CUSTOMER_INTEL_MIN_SETTLED = 8; // per-bucket settled-outcome floor; tune as data grows

/**
 * Build the customer_intel block for one or more tenants.
 * @param {object} db          - the PG client/pool (../lib/db) — exposes .query()
 * @param {string|string[]} tenantIds - a tenant id, or array of tenant ids
 * @returns {Promise<object>} customer_intel payload
 */
async function buildCustomerIntel(db, tenantIds) {
  // Normalize to an array so a single id and a rollup list both work.
  const idList = Array.isArray(tenantIds) ? tenantIds : [tenantIds];

  // One aggregate query. disc_primary normalized to a single upper-case
  // letter; anything null/blank/unexpected collapses to 'UNKNOWN' so it is
  // surfaced honestly rather than silently dropped.
  const { rows } = await db.query(
    `
    SELECT
      CASE
        WHEN UPPER(LEFT(TRIM(COALESCE(disc_primary, '')), 1)) IN ('D','I','S','C')
          THEN UPPER(LEFT(TRIM(disc_primary), 1))
        ELSE 'UNKNOWN'
      END                                                        AS disc,
      COUNT(*)                                                   AS total,
      COUNT(*) FILTER (WHERE LOWER(TRIM(status)) = 'won')        AS won,
      COUNT(*) FILTER (WHERE LOWER(TRIM(status)) = 'closed')     AS lost,
      COALESCE(
        SUM(actual_revenue_cents)
          FILTER (WHERE LOWER(TRIM(status)) = 'won'),
        0
      )                                                          AS won_revenue_cents
    FROM leads
    WHERE tenant_id = ANY($1)
    GROUP BY 1
    `,
    [idList]
  );

  // Normalize into a stable D/I/S/C ordering. UNKNOWN is appended only if
  // it actually has leads, so a clean tenant never sees an empty 5th row.
  const order = ['D', 'I', 'S', 'C'];
  const byKey = {};
  for (const r of rows) {
    byKey[r.disc] = {
      total: Number(r.total) || 0,
      won: Number(r.won) || 0,
      lost: Number(r.lost) || 0,
      won_revenue_cents: Number(r.won_revenue_cents) || 0,
    };
  }
  if (byKey.UNKNOWN && byKey.UNKNOWN.total > 0) order.push('UNKNOWN');

  const DISC_LABELS = {
    D: 'Dominant',
    I: 'Influencer',
    S: 'Steady',
    C: 'Conscientious',
    UNKNOWN: 'Not yet profiled',
  };

  const buckets = order.map((key) => {
    const b = byKey[key] || { total: 0, won: 0, lost: 0, won_revenue_cents: 0 };
    const settled = b.won + b.lost;
    const open = b.total - settled;
    const enoughData = settled >= CUSTOMER_INTEL_MIN_SETTLED;
    return {
      disc: key,
      label: DISC_LABELS[key] || key,
      total: b.total,
      won: b.won,
      lost: b.lost,
      open,
      settled,
      // conversion_rate is null until the bucket clears the floor — the UI
      // must check enough_data, NOT treat a 0 as a real "0% converts".
      conversion_rate: enoughData
        ? Math.round((b.won / settled) * 100)
        : null,
      won_revenue_cents: b.won_revenue_cents,
      enough_data: enoughData,
    };
  });

  const totals = buckets.reduce(
    (acc, b) => {
      acc.total += b.total;
      acc.won += b.won;
      acc.lost += b.lost;
      acc.open += b.open;
      acc.settled += b.settled;
      acc.won_revenue_cents += b.won_revenue_cents;
      return acc;
    },
    { total: 0, won: 0, lost: 0, open: 0, settled: 0, won_revenue_cents: 0 }
  );

  return {
    min_settled: CUSTOMER_INTEL_MIN_SETTLED,
    // true when not a single bucket has cleared the floor — lets the UI show
    // one honest "still collecting data" banner instead of 4 repeated ones.
    any_bucket_ready: buckets.some((b) => b.enough_data),
    buckets,
    totals,
  };
}

module.exports = { buildCustomerIntel, CUSTOMER_INTEL_MIN_SETTLED };
