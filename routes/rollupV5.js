"use strict";

/**
 * Rollup V5 — Parent Tenant Dashboard
 * Mounted at /api/rollup-v5
 */

const express = require("express");
const db      = require("../lib/db");
const router  = express.Router();

// ── Period handling ────────────────────────────────────────────────────────
const PERIOD_TO_DAYS = { "7d": 7, "30d": 30, "90d": 90 };

function resolvePeriod(raw) {
  const normalized = String(raw || "30d").toLowerCase();
  const days = PERIOD_TO_DAYS[normalized];
  if (!days) return { period: "30d", days: 30 };
  return { period: normalized, days };
}

// ── Sort handling ─────────────────────────────────────────────────────────
// open_leads added Apr 24 — users can sort locations by pipeline size.
const ALLOWED_SORT_COLUMNS = new Set([
  "tenant_name",
  "calls_total",
  "bookings_total",
  "booking_rate_pct",
  "revenue_cents",
  "avg_rating",
  "review_count",
  "pending_alerts_count",
  "open_leads",
]);

function resolveSort(rawSort, rawDir) {
  const sort = ALLOWED_SORT_COLUMNS.has(rawSort) ? rawSort : "revenue_cents";
  const dir = String(rawDir || "").toLowerCase() === "asc" ? "ASC" : "DESC";
  return { sort, dir };
}

// ── Timeout helper ────────────────────────────────────────────────────────
function withTimeout(label, promise, ms = 10000) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ]);
}

// ── Parent validation ─────────────────────────────────────────────────────
async function validateParentAccess(req, res, parentId) {
  if (!parentId || !/^[0-9a-f-]{36}$/i.test(parentId)) {
    res.status(400).json({ error: "Invalid parent tenant ID" });
    return null;
  }

  const parentRes = await db.query(
    `SELECT id, name, company_name, parent_id, parent_mode, brand_mode,
            timezone, brand_color, logo_url, created_at
       FROM tenants
      WHERE id = $1
      LIMIT 1`,
    [parentId]
  );
  const parent = parentRes.rows[0];

  if (!parent) {
    res.status(404).json({ error: "Parent tenant not found" });
    return null;
  }

  if (!parent.parent_mode) {
    res.status(400).json({ error: "This tenant is not a parent / rollup tenant" });
    return null;
  }

  if (req.user?.is_super_admin) return parent;

  const membershipRes = await db.query(
    `SELECT 1 FROM team_members
      WHERE user_id = $1 AND tenant_id = $2
      LIMIT 1`,
    [req.user.id, parentId]
  );
  if (membershipRes.rows.length === 0) {
    res.status(403).json({ error: "You do not have access to this parent tenant" });
    return null;
  }

  return parent;
}

// ── Scope resolver ────────────────────────────────────────────────────────
async function getRollupScopeIds(parent) {
  const { rows } = await db.query(
    `SELECT id
       FROM tenants
      WHERE parent_id = $1
        AND location_removed_at IS NULL
        AND (is_suspended IS NULL OR is_suspended = false)
        AND deleted_at IS NULL`,
    [parent.id]
  );
  const childIds = rows.map((r) => r.id);

  if (parent.parent_mode === "operating_hq") {
    return { all_ids: [parent.id, ...childIds], child_ids: childIds };
  }
  return { all_ids: childIds, child_ids: childIds };
}

// ═══════════════════════════════════════════════════════════════════════════
// TILE 1 — AI ACTIVITY
// ═══════════════════════════════════════════════════════════════════════════
async function getAiActivityTile(tenantIds, days) {
  if (tenantIds.length === 0) {
    return { calls_total: 0, bookings_total: 0, booking_rate_pct: null };
  }

  const result = await db.query(
    `SELECT
       (SELECT COUNT(*)::int FROM calls
         WHERE tenant_id = ANY($1::uuid[])
           AND direction = 'inbound'
           AND started_at > now() - ($2::int * interval '1 day'))
         AS calls_total,
       (SELECT COUNT(*)::int FROM bookings
         WHERE tenant_id = ANY($1::uuid[])
           AND created_at > now() - ($2::int * interval '1 day'))
         AS bookings_total`,
    [tenantIds, days]
  );

  const { calls_total, bookings_total } = result.rows[0];
  const booking_rate_pct =
    calls_total > 0
      ? Math.round((bookings_total / calls_total) * 1000) / 10
      : null;

  return { calls_total, bookings_total, booking_rate_pct };
}

// ═══════════════════════════════════════════════════════════════════════════
// TILE 2 — AFTER-HOURS REVENUE
// ═══════════════════════════════════════════════════════════════════════════
async function getAfterHoursRevenueTile(tenantIds, days) {
  if (tenantIds.length === 0) {
    return {
      after_hours_revenue_cents: 0,
      after_hours_booking_count: 0,
      total_revenue_cents:       0,
      after_hours_pct_of_total:  null,
    };
  }

  const result = await db.query(
    `SELECT
       b.actual_revenue_cents,
       b.created_at,
       COALESCE(t.timezone, 'America/Chicago') AS tz,
       t.business_hours
     FROM bookings b
     JOIN tenants t ON t.id = b.tenant_id
     WHERE b.tenant_id = ANY($1::uuid[])
       AND b.created_at > now() - ($2::int * interval '1 day')
       AND b.actual_revenue_cents IS NOT NULL
       AND b.actual_revenue_cents > 0`,
    [tenantIds, days]
  );

  let after_hours_revenue_cents = 0;
  let after_hours_booking_count = 0;
  let total_revenue_cents       = 0;

  for (const row of result.rows) {
    const cents = Number(row.actual_revenue_cents);
    total_revenue_cents += cents;

    if (isAfterHours(row.created_at, row.tz, row.business_hours)) {
      after_hours_revenue_cents += cents;
      after_hours_booking_count += 1;
    }
  }

  const after_hours_pct_of_total =
    total_revenue_cents > 0
      ? Math.round((after_hours_revenue_cents / total_revenue_cents) * 1000) / 10
      : null;

  return {
    after_hours_revenue_cents,
    after_hours_booking_count,
    total_revenue_cents,
    after_hours_pct_of_total,
  };
}

const DAY_KEYS_JS = [
  "sunday", "monday", "tuesday", "wednesday",
  "thursday", "friday", "saturday",
];
const WEEKDAY_SHORT_ORDER = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function isAfterHours(createdAt, tz, businessHours) {
  const d = new Date(createdAt);

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);

  const weekdayShort = parts.find((p) => p.type === "weekday")?.value;
  let hour   = parts.find((p) => p.type === "hour")?.value;
  const minute = parts.find((p) => p.type === "minute")?.value;

  if (hour === "24") hour = "00";

  const dowIndex = WEEKDAY_SHORT_ORDER.indexOf(weekdayShort);
  if (dowIndex < 0 || !hour || !minute) return true;

  const localTime = `${hour}:${minute}`;
  const dayKey = DAY_KEYS_JS[dowIndex];

  if (!businessHours || typeof businessHours !== "object") {
    const isWeekend = dowIndex === 0 || dowIndex === 6;
    if (isWeekend) return true;
    return localTime < "08:00" || localTime >= "18:00";
  }

  const dayConfig = businessHours[dayKey];
  if (!dayConfig || dayConfig.closed === true) return true;

  const open  = dayConfig.open  || "08:00";
  const close = dayConfig.close || "18:00";

  return localTime < open || localTime >= close;
}

// ═══════════════════════════════════════════════════════════════════════════
// TILE 3 — NETWORK REVENUE
// ═══════════════════════════════════════════════════════════════════════════
async function getNetworkRevenueTile(tenantIds, days, parentCreatedAt) {
  if (tenantIds.length === 0) {
    return {
      current_cents:     0,
      previous_cents:    0,
      delta_cents:       0,
      delta_pct:         null,
      delta_direction:   "flat",
      confidence:        "low",
      parent_age_days:   0,
    };
  }

  const result = await db.query(
    `SELECT
       COALESCE(SUM(CASE
         WHEN created_at > now() - ($2::int * interval '1 day') THEN actual_revenue_cents
         ELSE 0
       END), 0)::bigint AS current_cents,
       COALESCE(SUM(CASE
         WHEN created_at <= now() - ($2::int * interval '1 day')
          AND created_at >  now() - (($2::int * 2) * interval '1 day')
         THEN actual_revenue_cents
         ELSE 0
       END), 0)::bigint AS previous_cents
     FROM bookings
     WHERE tenant_id = ANY($1::uuid[])
       AND created_at > now() - (($2::int * 2) * interval '1 day')
       AND actual_revenue_cents IS NOT NULL
       AND actual_revenue_cents > 0`,
    [tenantIds, days]
  );

  const current_cents  = Number(result.rows[0].current_cents);
  const previous_cents = Number(result.rows[0].previous_cents);
  const delta_cents    = current_cents - previous_cents;

  const delta_pct =
    previous_cents > 0
      ? Math.round((delta_cents / previous_cents) * 1000) / 10
      : null;

  let delta_direction = "flat";
  if (delta_cents > 0) delta_direction = "up";
  else if (delta_cents < 0) delta_direction = "down";

  const parent_age_days = parentCreatedAt
    ? Math.floor((Date.now() - new Date(parentCreatedAt).getTime()) / (1000 * 60 * 60 * 24))
    : 0;
  const required_days_for_high_confidence = days * 2;
  const confidence =
    parent_age_days >= required_days_for_high_confidence ? "high" : "low";

  return {
    current_cents,
    previous_cents,
    delta_cents,
    delta_pct,
    delta_direction,
    confidence,
    parent_age_days,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// TILE 4 — REVIEWS HEALTH
// ═══════════════════════════════════════════════════════════════════════════
async function getReviewsHealthTile(tenantIds) {
  if (tenantIds.length === 0) {
    return {
      avg_rating_lifetime:   null,
      total_review_count:    0,
      prominent_alert_count: 0,
      oauth_connected_count: 0,
      total_tenant_count:    0,
    };
  }

  const result = await db.query(
    `SELECT
       AVG(r.rating)::numeric(3,2) AS avg_rating_lifetime,
       COUNT(r.id)::int AS total_review_count,
       COUNT(r.id) FILTER (
         WHERE r.rating <= 3
           AND r.status = 'pending'
           AND r.review_date > now() - interval '90 days'
       )::int AS prominent_alert_count,
       (SELECT COUNT(*)::int FROM tenants
         WHERE id = ANY($1::uuid[])
           AND google_access_token IS NOT NULL
           AND google_location_id IS NOT NULL
       ) AS oauth_connected_count,
       $2::int AS total_tenant_count
     FROM google_reviews r
     WHERE r.tenant_id = ANY($1::uuid[])`,
    [tenantIds, tenantIds.length]
  );

  const row = result.rows[0];

  const avg_rating_lifetime =
    row.avg_rating_lifetime === null
      ? null
      : Number(row.avg_rating_lifetime);

  return {
    avg_rating_lifetime,
    total_review_count:    Number(row.total_review_count),
    prominent_alert_count: Number(row.prominent_alert_count),
    oauth_connected_count: Number(row.oauth_connected_count),
    total_tenant_count:    Number(row.total_tenant_count),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// TILE 5 — MISSED OPPORTUNITIES (NEW Apr 24)
// ═══════════════════════════════════════════════════════════════════════════
// Shows calls where caller connected with the AI but didn't convert. This
// is the "AI value recovery opportunity" tile — frames what might have
// been lost without AI, or what's still slipping through.
//
// Definition based on Gladiators disposition values (completed/booked/
// transferred/spam/NULL):
//   missed = calls where
//     - disposition IN ('completed', NULL)  (connected but didn't definitively win)
//     - AND disposition != 'booked'         (exclude wins)
//     - AND transferred != true             (exclude human handoffs)
//     - AND duration_minutes > 0.1          (exclude sub-6-sec misdials)
//
// Dollar estimate = missed_count × avg_job_value.
// avg_job_value = total actual_revenue_cents / count of revenue-positive
// bookings in same period. Scales with each tenant's real economics.
//
// Data quality flag: if >30% of calls have NULL disposition, we set
// `data_quality_warning: true` so the frontend can hint the estimate
// is less reliable. Spam calls are always excluded so they don't inflate
// the denominator.
async function getMissedOppsTile(tenantIds, days) {
  if (tenantIds.length === 0) {
    return {
      missed_count:            0,
      estimated_lost_cents:    0,
      total_calls:             0,
      null_disposition_count:  0,
      data_quality_warning:    false,
      avg_job_value_cents:     0,
    };
  }

  const result = await db.query(
    `WITH period_calls AS (
      SELECT disposition, transferred, duration_minutes
        FROM calls
       WHERE tenant_id = ANY($1::uuid[])
         AND direction = 'inbound'
         AND started_at > now() - ($2::int * interval '1 day')
    ),
    period_bookings AS (
      SELECT COALESCE(SUM(actual_revenue_cents), 0)::bigint AS total_revenue,
             COUNT(*) FILTER (WHERE actual_revenue_cents > 0)::int AS booked_count
        FROM bookings
       WHERE tenant_id = ANY($1::uuid[])
         AND created_at > now() - ($2::int * interval '1 day')
         AND actual_revenue_cents IS NOT NULL
         AND actual_revenue_cents > 0
    )
    SELECT
      (SELECT COUNT(*)::int FROM period_calls
         WHERE COALESCE(disposition, '') != 'spam'
      ) AS total_calls,

      (SELECT COUNT(*)::int FROM period_calls
        WHERE (disposition = 'completed' OR disposition IS NULL)
          AND (transferred IS NULL OR transferred = false)
          AND COALESCE(duration_minutes, 0) > 0.1
      ) AS missed_count,

      (SELECT COUNT(*)::int FROM period_calls
        WHERE disposition IS NULL
      ) AS null_disposition_count,

      (SELECT CASE
        WHEN booked_count > 0 THEN (total_revenue / booked_count)::bigint
        ELSE 0
      END FROM period_bookings) AS avg_job_value_cents`,
    [tenantIds, days]
  );

  const row = result.rows[0];
  const missed_count           = Number(row.missed_count);
  const total_calls            = Number(row.total_calls);
  const null_disposition_count = Number(row.null_disposition_count);
  const avg_job_value_cents    = Number(row.avg_job_value_cents);

  const data_quality_warning =
    total_calls > 0 && (null_disposition_count / total_calls) > 0.3;

  const estimated_lost_cents = missed_count * avg_job_value_cents;

  return {
    missed_count,
    estimated_lost_cents,
    total_calls,
    null_disposition_count,
    data_quality_warning,
    avg_job_value_cents,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// CONTACT-METHOD DONUT
// ═══════════════════════════════════════════════════════════════════════════
const DONUT_METHOD_ORDER = ["voice", "sms", "web_form", "facebook", "crm", "unknown"];

async function getContactMethodDonut(tenantIds, days) {
  if (tenantIds.length === 0) {
    return {
      total_leads:   0,
      unknown_count: 0,
      buckets:       DONUT_METHOD_ORDER.map((method) => ({
        method,
        count: 0,
        pct:   0,
      })),
    };
  }

  const result = await db.query(
    `SELECT contact_method, COUNT(*)::int AS count
       FROM leads
      WHERE tenant_id = ANY($1::uuid[])
        AND created_at > now() - ($2::int * interval '1 day')
      GROUP BY contact_method`,
    [tenantIds, days]
  );

  const countMap = {};
  let total_leads = 0;
  for (const row of result.rows) {
    const count = Number(row.count);
    countMap[row.contact_method] = count;
    total_leads += count;
  }

  const buckets = DONUT_METHOD_ORDER.map((method) => {
    const count = countMap[method] || 0;
    const pct =
      total_leads > 0
        ? Math.round((count / total_leads) * 1000) / 10
        : 0;
    return { method, count, pct };
  });

  const unknown_count = countMap["unknown"] || 0;

  return {
    total_leads,
    unknown_count,
    buckets,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// LEAD SOURCE DONUT
// ═══════════════════════════════════════════════════════════════════════════
const SOURCE_BUCKETS = [
  "Google Ads", "LSA", "Facebook", "Website",
  "Yelp", "Angi", "Thumbtack", "Houzz",
  "Phone", "CRM", "Referral", "Other", "Unknown",
];

function normalizeLeadSource(row) {
  if (row.facebook_id) return "Facebook";
  if (row.web_id)      return "Website";

  const raw = (row.lead_source || "").trim();
  if (!raw) return "Unknown";

  const lower = raw.toLowerCase();

  if (lower.includes("google ads") || lower.includes("google_ads")) return "Google Ads";
  if (lower.includes("lsa") || lower.includes("local service")) return "LSA";
  if (lower.includes("facebook") || lower.includes("meta") || lower === "fb") return "Facebook";
  if (lower.includes("website") || lower.includes("web form") || lower.includes("web_form")) return "Website";
  if (lower.includes("yelp")) return "Yelp";
  if (lower.includes("angi") || lower.includes("homeadvisor")) return "Angi";
  if (lower.includes("thumbtack")) return "Thumbtack";
  if (lower.includes("houzz")) return "Houzz";
  if (lower.includes("referral") || lower.includes("repeat")) return "Referral";
  if (lower === "phone" || lower === "call" || lower.includes("inbound call")) return "Phone";
  if (lower.includes("dripjobs") || lower.includes("crm") || lower.includes("webhook") || lower.includes("zapier")) return "CRM";

  return "Other";
}

async function getLeadSourceDonut(tenantIds, days) {
  if (tenantIds.length === 0) {
    return {
      total_leads:   0,
      unknown_count: 0,
      buckets:       SOURCE_BUCKETS.map((source) => ({
        source,
        count: 0,
        pct:   0,
      })),
    };
  }

  const result = await db.query(
    `SELECT lead_source, facebook_id, web_id
       FROM leads
      WHERE tenant_id = ANY($1::uuid[])
        AND created_at > now() - ($2::int * interval '1 day')`,
    [tenantIds, days]
  );

  const countMap = {};
  let total_leads = 0;
  for (const row of result.rows) {
    const bucket = normalizeLeadSource(row);
    countMap[bucket] = (countMap[bucket] || 0) + 1;
    total_leads += 1;
  }

  const buckets = SOURCE_BUCKETS.map((source) => {
    const count = countMap[source] || 0;
    const pct =
      total_leads > 0
        ? Math.round((count / total_leads) * 1000) / 10
        : 0;
    return { source, count, pct };
  });

  const unknown_count = countMap["Unknown"] || 0;

  return {
    total_leads,
    unknown_count,
    buckets,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// REVIEWS ALERTS LIST
// ═══════════════════════════════════════════════════════════════════════════
async function getReviewsAlertsList(tenantIds) {
  if (tenantIds.length === 0) {
    return { alerts: [], total_count_14d: 0 };
  }

  const result = await db.query(
    `
    WITH candidate_alerts AS (
      SELECT
        r.id                          AS review_id,
        r.google_review_id,
        r.tenant_id,
        COALESCE(t.company_name, t.name, 'Unknown') AS tenant_name,
        r.rating,
        r.reviewer_name,
        r.review_text,
        r.review_date,
        r.ai_draft,
        (r.ai_draft IS NOT NULL AND length(r.ai_draft) > 0) AS has_ai_draft
      FROM google_reviews r
      JOIN tenants t ON t.id = r.tenant_id
      WHERE r.tenant_id = ANY($1::uuid[])
        AND r.rating <= 3
        AND r.status = 'pending'
        AND r.review_date > now() - interval '14 days'
    )
    SELECT
      review_id,
      google_review_id,
      tenant_id,
      tenant_name,
      rating,
      reviewer_name,
      review_text,
      review_date,
      ai_draft,
      has_ai_draft,
      (SELECT COUNT(*)::int FROM candidate_alerts) AS total_count_14d
    FROM candidate_alerts
    ORDER BY review_date DESC
    LIMIT 2
    `,
    [tenantIds]
  );

  if (result.rows.length === 0) {
    return { alerts: [], total_count_14d: 0 };
  }

  const total_count_14d = Number(result.rows[0].total_count_14d);

  const alerts = result.rows.map((row) => ({
    review_id:        row.review_id,
    google_review_id: row.google_review_id,
    tenant_id:        row.tenant_id,
    tenant_name:      row.tenant_name,
    rating:           Number(row.rating),
    reviewer_name:    row.reviewer_name,
    review_text:      row.review_text,
    review_date:      row.review_date,
    has_ai_draft:     Boolean(row.has_ai_draft),
    ai_draft:         row.ai_draft,
  }));

  return { alerts, total_count_14d };
}

// ═══════════════════════════════════════════════════════════════════════════
// LOCATION TABLE
// ═══════════════════════════════════════════════════════════════════════════
// Apr 24 addition: new lead_stats CTE adds per-location open_leads count.
// "Open" = status NOT IN ('Won', 'Lost') — matches Gladiators status values
// (New Lead, FollowUp, Estimate Sent, Won).
async function getLocationTable(tenantIds, days, sort, dir) {
  if (tenantIds.length === 0) {
    return { locations: [], sort, dir };
  }

  const nullsPosition = dir === "DESC" ? "NULLS LAST" : "NULLS FIRST";
  const orderByClause = `${sort} ${dir} ${nullsPosition}, tenant_name ASC`;

  const result = await db.query(
    `
    WITH
    location_info AS (
      SELECT
        t.id AS tenant_id,
        COALESCE(t.company_name, t.name, 'Unknown') AS tenant_name,
        (t.google_access_token IS NOT NULL AND t.google_location_id IS NOT NULL) AS oauth_connected
      FROM tenants t
      WHERE t.id = ANY($1::uuid[])
    ),
    call_stats AS (
      SELECT
        tenant_id,
        COUNT(*)::int AS calls_total
      FROM calls
      WHERE tenant_id = ANY($1::uuid[])
        AND direction = 'inbound'
        AND started_at > now() - ($2::int * interval '1 day')
      GROUP BY tenant_id
    ),
    booking_stats AS (
      SELECT
        tenant_id,
        COUNT(*)::int AS bookings_total,
        COALESCE(SUM(actual_revenue_cents), 0)::bigint AS revenue_cents
      FROM bookings
      WHERE tenant_id = ANY($1::uuid[])
        AND created_at > now() - ($2::int * interval '1 day')
      GROUP BY tenant_id
    ),
    review_stats AS (
      SELECT
        tenant_id,
        AVG(rating)::numeric(3,2) AS avg_rating,
        COUNT(*)::int AS review_count,
        COUNT(*) FILTER (
          WHERE rating <= 3
            AND status = 'pending'
            AND review_date > now() - interval '90 days'
        )::int AS pending_alerts_count
      FROM google_reviews
      WHERE tenant_id = ANY($1::uuid[])
      GROUP BY tenant_id
    ),
    lead_stats AS (
      -- Open leads = anything not yet won or lost. Case-insensitive match
      -- on status so 'Won' vs 'won' vs 'WON' all exclude correctly.
      SELECT
        tenant_id,
        COUNT(*) FILTER (
          WHERE LOWER(COALESCE(status, '')) NOT IN ('won', 'lost', 'archived')
        )::int AS open_leads
      FROM leads
      WHERE tenant_id = ANY($1::uuid[])
      GROUP BY tenant_id
    ),
    rows_assembled AS (
      SELECT
        li.tenant_id,
        li.tenant_name,
        li.oauth_connected,
        COALESCE(cs.calls_total,      0)    AS calls_total,
        COALESCE(bs.bookings_total,   0)    AS bookings_total,
        COALESCE(bs.revenue_cents,    0)    AS revenue_cents,
        CASE
          WHEN COALESCE(cs.calls_total, 0) > 0
          THEN ROUND(
            (COALESCE(bs.bookings_total, 0)::numeric /
             cs.calls_total::numeric) * 1000
          ) / 10
          ELSE NULL
        END AS booking_rate_pct,
        rs.avg_rating,
        COALESCE(rs.review_count,         0) AS review_count,
        COALESCE(rs.pending_alerts_count, 0) AS pending_alerts_count,
        COALESCE(ls.open_leads,           0) AS open_leads
      FROM location_info li
      LEFT JOIN call_stats    cs ON cs.tenant_id = li.tenant_id
      LEFT JOIN booking_stats bs ON bs.tenant_id = li.tenant_id
      LEFT JOIN review_stats  rs ON rs.tenant_id = li.tenant_id
      LEFT JOIN lead_stats    ls ON ls.tenant_id = li.tenant_id
    ),
    rows_ranked AS (
      SELECT
        *,
        DENSE_RANK() OVER (ORDER BY revenue_cents DESC)::int AS rank_revenue
      FROM rows_assembled
    )
    SELECT *
    FROM rows_ranked
    ORDER BY ${orderByClause}
    `,
    [tenantIds, days]
  );

  const locations = result.rows.map((row) => ({
    tenant_id:            row.tenant_id,
    tenant_name:          row.tenant_name,
    oauth_connected:      Boolean(row.oauth_connected),
    calls_total:          Number(row.calls_total),
    bookings_total:       Number(row.bookings_total),
    booking_rate_pct:     row.booking_rate_pct === null ? null : Number(row.booking_rate_pct),
    revenue_cents:        Number(row.revenue_cents),
    avg_rating:           row.avg_rating === null ? null : Number(row.avg_rating),
    review_count:         Number(row.review_count),
    pending_alerts_count: Number(row.pending_alerts_count),
    open_leads:           Number(row.open_leads),
    rank_revenue:         Number(row.rank_revenue),
  }));

  return { locations, sort, dir };
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN ENDPOINT
// ═══════════════════════════════════════════════════════════════════════════
router.get("/:parentId", async (req, res) => {
  const t0 = Date.now();
  const log = (msg) => console.error(`[RollupV5] ${msg} @ ${Date.now() - t0}ms`);

  try {
    log("HIT /api/rollup-v5");
    const { parentId } = req.params;
    const { period, days } = resolvePeriod(req.query.period);
    const { sort, dir } = resolveSort(req.query.sort, req.query.dir);

    const parent = await withTimeout("validateParentAccess", validateParentAccess(req, res, parentId));
    if (!parent) return;

    const scope = await withTimeout("getRollupScopeIds", getRollupScopeIds(parent));

    const timed = (name, fn) => {
      const qStart = Date.now();
      return withTimeout(name, fn()).then(
        (result) => { console.error(`[RollupV5] ${name} ✓ ${Date.now() - qStart}ms`); return result; },
        (err) => { console.error(`[RollupV5] ${name} ✗ ${Date.now() - qStart}ms: ${err.message}`); throw err; }
      );
    };

    const [
      aiActivity,
      afterHoursRevenue,
      networkRevenue,
      reviewsHealth,
      missedOpps,
      contactDonut,
      leadSourceDonut,
      reviewsAlerts,
      locationTable,
    ] = await Promise.all([
      timed("ai_activity",         () => getAiActivityTile(scope.all_ids, days)),
      timed("after_hours_revenue", () => getAfterHoursRevenueTile(scope.all_ids, days)),
      timed("network_revenue",     () => getNetworkRevenueTile(scope.all_ids, days, parent.created_at)),
      timed("reviews_health",      () => getReviewsHealthTile(scope.all_ids)),
      timed("missed_opps",         () => getMissedOppsTile(scope.all_ids, days)),
      timed("contact_donut",       () => getContactMethodDonut(scope.all_ids, days)),
      timed("lead_source_donut",   () => getLeadSourceDonut(scope.all_ids, days)),
      timed("reviews_alerts",      () => getReviewsAlertsList(scope.all_ids)),
      timed("location_table",      () => getLocationTable(scope.all_ids, days, sort, dir)),
    ]);

    const displayed_location_count = scope.all_ids.length;

    res.json({
      parent: {
        id:           parent.id,
        name:         parent.name,
        company_name: parent.company_name,
        brand_mode:   parent.brand_mode,
        parent_mode:  parent.parent_mode,
        timezone:     parent.timezone,
        brand_color:  parent.brand_color,
        logo_url:     parent.logo_url,
      },
      meta: {
        period,
        days,
        sort,
        dir:                 dir.toLowerCase(),
        location_count:      displayed_location_count,
        child_count:         scope.child_ids.length,
        includes_parent:     parent.parent_mode === "operating_hq",
        rollup_tenant_count: scope.all_ids.length,
        generated_at:        new Date().toISOString(),
      },
      tiles: {
        ai_activity:         aiActivity,
        after_hours_revenue: afterHoursRevenue,
        network_revenue:     networkRevenue,
        reviews_health:      reviewsHealth,
        missed_opps:         missedOpps,
      },
      contact_method_donut: contactDonut,
      lead_source_donut:    leadSourceDonut,
      reviews_alerts:       reviewsAlerts,
      locations:            locationTable.locations,
    });

    log("response sent");
  } catch (err) {
    console.error(`[RollupV5] ERROR @ ${Date.now() - t0}ms:`, err.message, err.stack);
    res.status(500).json({
      error: "Server error",
      detail: err.message,
      elapsed_ms: Date.now() - t0,
    });
  }
});

module.exports = router;
