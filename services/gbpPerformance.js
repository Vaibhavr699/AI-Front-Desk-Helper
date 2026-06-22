"use strict";

/**
 * services/gbpPerformance.js
 *
 * GBP Traction G5 — performance metrics.
 *
 * Pulls daily metrics from the Business Profile Performance API
 * (businessprofileperformance.googleapis.com) via fetchMultiDailyMetricsTimeSeries
 * and upserts them into gbp_performance_daily (mig 107), one row per day.
 *
 * ── API surface note ───────────────────────────────────────────────────────
 * This is a DIFFERENT Google API host than reviews/posts/audit, but it's
 * covered by the SAME `business.manage` OAuth scope, so reviewsHelper's token
 * (refresh + 401 retry) works unchanged. The one thing that must be true: the
 * "Business Profile Performance API" must be ENABLED in the GCP project. If it
 * isn't, the first call 403s with a PERMISSION_DENIED / "API has not been used"
 * message — we surface that verbatim so the fix (enable the API in console) is
 * obvious.
 *
 * ── Data lag ───────────────────────────────────────────────────────────────
 * Google's performance data lags ~2-3 days and isn't returned for days with
 * no activity. So the nightly cron re-fetches a trailing window (default 10
 * days) rather than just yesterday — late-arriving data overwrites prior rows
 * via the (tenant_id, metric_date) upsert.
 *
 * Endpoint shape:
 *   GET https://businessprofileperformance.googleapis.com/v1/{location=locations/*}
 *        :fetchMultiDailyMetricsTimeSeries
 *     ?dailyMetrics=CALL_CLICKS&dailyMetrics=WEBSITE_CLICKS&...
 *     &dailyRange.startDate.year=YYYY&...month&...day
 *     &dailyRange.endDate.year=...
 *
 * NOTE: location id here must be the BARE "locations/123" — the performance API
 * does NOT take the account prefix. google_location_id is already stored that
 * way ("locations/8384556118429688584").
 */

const db = require("../lib/db");
const reviewsHelper = require("../lib/reviewsHelper");

const PERF_BASE = "https://businessprofileperformance.googleapis.com/v1";

// The metric types we request. Google returns one time series per metric.
// (BUSINESS_IMPRESSIONS_* are the split impression metrics; we sum them into
// one "impressions" column.)
const DAILY_METRICS = [
  "BUSINESS_IMPRESSIONS_DESKTOP_MAPS",
  "BUSINESS_IMPRESSIONS_DESKTOP_SEARCH",
  "BUSINESS_IMPRESSIONS_MOBILE_MAPS",
  "BUSINESS_IMPRESSIONS_MOBILE_SEARCH",
  "CALL_CLICKS",
  "WEBSITE_CLICKS",
  "BUSINESS_DIRECTION_REQUESTS",
  "BUSINESS_CONVERSATIONS",
];

const IMPRESSION_METRICS = new Set([
  "BUSINESS_IMPRESSIONS_DESKTOP_MAPS",
  "BUSINESS_IMPRESSIONS_DESKTOP_SEARCH",
  "BUSINESS_IMPRESSIONS_MOBILE_MAPS",
  "BUSINESS_IMPRESSIONS_MOBILE_SEARCH",
]);

async function loadTenant(tenantId) {
  const res = await db.query(
    `SELECT id, google_access_token, google_refresh_token, google_token_expiry,
            google_account_id, google_location_id
       FROM tenants WHERE id = $1`,
    [tenantId]
  );
  return res.rows[0] || null;
}

function ymdParts(d) {
  return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
}

function dateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Parse Google's DatedValue date object → "YYYY-MM-DD".
 */
function datedValueKey(dv) {
  const dt = dv.date || {};
  if (!dt.year || !dt.month || !dt.day) return null;
  return `${dt.year}-${String(dt.month).padStart(2, "0")}-${String(dt.day).padStart(2, "0")}`;
}

/**
 * Fetch metrics for a tenant over [startDate, endDate], upsert daily rows.
 * Returns { ok, days } or { ok:false, reason, message }.
 */
async function fetchForTenant(tenantId, { days = 10 } = {}) {
  const tenant = await loadTenant(tenantId);
  if (!tenant) return { ok: false, reason: "tenant_not_found" };
  if (!(tenant.google_access_token && tenant.google_location_id)) {
    return { ok: false, reason: "not_connected" };
  }

  const end = new Date();
  end.setDate(end.getDate() - 1); // yesterday — today's data isn't ready
  const start = new Date(end);
  start.setDate(start.getDate() - (days - 1));

  // Build the query. dailyMetrics repeats; dailyRange is nested dotted params.
  const params = {};
  // axios serializes arrays as repeated keys by default with paramsSerializer,
  // but to be safe we build a URLSearchParams manually below.
  const sp = new URLSearchParams();
  for (const m of DAILY_METRICS) sp.append("dailyMetrics", m);
  const sP = ymdParts(start), eP = ymdParts(end);
  sp.set("dailyRange.start_date.year", String(sP.year));
  sp.set("dailyRange.start_date.month", String(sP.month));
  sp.set("dailyRange.start_date.day", String(sP.day));
  sp.set("dailyRange.end_date.year", String(eP.year));
  sp.set("dailyRange.end_date.month", String(eP.month));
  sp.set("dailyRange.end_date.day", String(eP.day));

  const url = `${PERF_BASE}/${tenant.google_location_id}:fetchMultiDailyMetricsTimeSeries?${sp.toString()}`;

  let res;
  try {
    res = await reviewsHelper.authedRequest(tenant, "GET", url);
  } catch (e) {
    const detail = e.response?.data ? JSON.stringify(e.response.data) : e.message;
    console.error("[GBP Perf] fetch failed tenant=%s: %s", tenantId, detail);
    // Distinguish "API not enabled" so the UI can tell the owner exactly what to do.
    const notEnabled = /has not been used|is disabled|SERVICE_DISABLED|PERMISSION_DENIED/i.test(detail);
    return { ok: false, reason: notEnabled ? "api_not_enabled" : "fetch_failed", message: detail };
  }

  // Response: { multiDailyMetricTimeSeries: [ { dailyMetricTimeSeries:
  //   [ { dailyMetric, timeSeries:{ datedValues:[ {date,value} ] } } ] } ] }
  const byDate = {}; // "YYYY-MM-DD" → accumulator

  const groups = res.data?.multiDailyMetricTimeSeries || [];
  for (const g of groups) {
    const seriesList = g.dailyMetricTimeSeries || [];
    for (const series of seriesList) {
      const metric = series.dailyMetric;
      const datedValues = series.timeSeries?.datedValues || [];
      for (const dv of datedValues) {
        const key = datedValueKey(dv);
        if (!key) continue;
        const val = parseInt(dv.value || "0", 10) || 0;
        if (!byDate[key]) {
          byDate[key] = { impressions: 0, call_clicks: 0, website_clicks: 0, direction_requests: 0, conversations: 0, raw: {} };
        }
        byDate[key].raw[metric] = val;
        if (IMPRESSION_METRICS.has(metric)) byDate[key].impressions += val;
        else if (metric === "CALL_CLICKS") byDate[key].call_clicks += val;
        else if (metric === "WEBSITE_CLICKS") byDate[key].website_clicks += val;
        else if (metric === "BUSINESS_DIRECTION_REQUESTS") byDate[key].direction_requests += val;
        else if (metric === "BUSINESS_CONVERSATIONS") byDate[key].conversations += val;
      }
    }
  }

  const dateKeys = Object.keys(byDate);
  for (const key of dateKeys) {
    const d = byDate[key];
    await db.query(
      `INSERT INTO gbp_performance_daily
         (tenant_id, metric_date, business_impressions_search, business_conversations,
          call_clicks, website_clicks, direction_requests, raw_metrics, fetched_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
       ON CONFLICT (tenant_id, metric_date) DO UPDATE SET
         business_impressions_search = EXCLUDED.business_impressions_search,
         business_conversations      = EXCLUDED.business_conversations,
         call_clicks                 = EXCLUDED.call_clicks,
         website_clicks              = EXCLUDED.website_clicks,
         direction_requests          = EXCLUDED.direction_requests,
         raw_metrics                 = EXCLUDED.raw_metrics,
         fetched_at                  = now()`,
      [tenantId, key, d.impressions, d.conversations, d.call_clicks, d.website_clicks, d.direction_requests, JSON.stringify(d.raw)]
    );
  }

  console.log("[GBP Perf] tenant=%s upserted %d day(s) [%s..%s]", tenantId, dateKeys.length, dateKey(start), dateKey(end));
  return { ok: true, days: dateKeys.length };
}

/**
 * Read the stored time series for the UI. Returns { series, totals }.
 * range: number of days back from today.
 */
async function getSeries(tenantId, { range = 30 } = {}) {
  const since = new Date();
  since.setDate(since.getDate() - range);
  const res = await db.query(
    `SELECT metric_date,
            business_impressions_search AS impressions,
            call_clicks, website_clicks, direction_requests,
            business_conversations AS conversations
       FROM gbp_performance_daily
      WHERE tenant_id = $1 AND metric_date >= $2
      ORDER BY metric_date ASC`,
    [tenantId, since.toISOString().slice(0, 10)]
  );
  const series = res.rows.map(r => ({
    date: r.metric_date,
    impressions: r.impressions || 0,
    calls: r.call_clicks || 0,
    website: r.website_clicks || 0,
    directions: r.direction_requests || 0,
    conversations: r.conversations || 0,
  }));
  const totals = series.reduce((acc, d) => {
    acc.impressions += d.impressions;
    acc.calls += d.calls;
    acc.website += d.website;
    acc.directions += d.directions;
    acc.conversations += d.conversations;
    return acc;
  }, { impressions: 0, calls: 0, website: 0, directions: 0, conversations: 0 });
  return { series, totals };
}

/**
 * Nightly sweep — fetch the trailing window for every connected tenant.
 * Never throws out; per-tenant errors are logged.
 */
async function runPerformanceSweep() {
  let rows;
  try {
    const res = await db.query(
      `SELECT id FROM tenants
        WHERE google_access_token IS NOT NULL
          AND google_location_id IS NOT NULL
        LIMIT 500`
    );
    rows = res.rows;
  } catch (e) {
    console.error("[GBP Perf] sweep query failed:", e.message);
    return { ok: false };
  }
  let ok = 0, fail = 0;
  for (const r of rows) {
    const result = await fetchForTenant(r.id, { days: 10 });
    if (result.ok) ok++; else fail++;
  }
  console.log("[GBP Perf] sweep done: %d ok, %d failed", ok, fail);
  return { ok: true, succeeded: ok, failed: fail };
}

module.exports = {
  fetchForTenant,
  getSeries,
  runPerformanceSweep,
  DAILY_METRICS,
};
