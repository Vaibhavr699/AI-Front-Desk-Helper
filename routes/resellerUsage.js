"use strict";

/**
 * Reseller Usage Endpoint
 * Mounted at /api/reseller/usage
 *
 * Aggregates voice minutes + SMS counts across all child customer tenants
 * for the current calendar month. Returns cap info + overage projection.
 *
 * Computes live from `calls` + `messages` tables — no separate metering
 * table because (a) zero current resellers, (b) on-demand SQL is fast
 * enough at our scale, (c) eliminates drift from missed event hooks.
 *
 * Apr 27, 2026: Switched import from lib/resellerTiers (deleted) to
 * lib/resellerPlans (merged). The merged file re-exports getTier as an
 * alias so this file's contract is unchanged. Caps + overage rates still
 * come from the DB (override) first, then fall back to the tier defaults.
 */

const express  = require("express");
const db       = require("../lib/db");
const { getTier } = require("../lib/resellerPlans");

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // Find the reseller tenant this user belongs to.
    // Resellers are tenants where reseller_tier IS NOT NULL.
    const resellerRes = await db.query(
      `SELECT t.id, t.company_name, t.reseller_tier,
              t.usage_cap_voice_minutes, t.usage_cap_sms,
              t.overage_rate_voice_cents, t.overage_rate_sms_cents,
              t.hard_cap_enabled
         FROM tenants t
         JOIN team_members tm ON tm.tenant_id = t.id
        WHERE tm.user_id = $1
          AND t.reseller_tier IS NOT NULL
        LIMIT 1`,
      [userId]
    );

    const reseller = resellerRes.rows[0];
    if (!reseller) {
      return res.status(404).json({
        error: "No reseller account found for this user"
      });
    }

    // Find the tier config (caps from DB take precedence over defaults)
    const tierConfig = getTier(reseller.reseller_tier) || {};
    const cap_voice_minutes = reseller.usage_cap_voice_minutes
      || tierConfig.cap_voice_minutes
      || 0;
    const cap_sms = reseller.usage_cap_sms
      || tierConfig.cap_sms
      || 0;
    const overage_voice_cents = reseller.overage_rate_voice_cents
      || tierConfig.overage_voice_cents
      || 0;
    const overage_sms_cents = reseller.overage_rate_sms_cents
      || tierConfig.overage_sms_cents
      || 0;

    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;

    // Aggregate usage across all child customers + the reseller itself.
    // Voice: SUM duration_minutes from calls table, both directions.
    // SMS: COUNT messages where channel = 'sms', both directions.
    //
    // Single query returns network total + per-customer breakdown so the
    // dashboard doesn't need a second roundtrip.
    const usageRes = await db.query(
      `WITH child_tenants AS (
        SELECT id, COALESCE(company_name, name, 'Unknown') AS name
          FROM tenants
         WHERE reseller_id = $1
            OR id = $1
      ),
      voice_usage AS (
        SELECT c.tenant_id,
               COALESCE(SUM(c.duration_minutes), 0)::numeric AS voice_minutes
          FROM calls c
         WHERE c.tenant_id IN (SELECT id FROM child_tenants)
           AND EXTRACT(YEAR  FROM c.started_at) = $2
           AND EXTRACT(MONTH FROM c.started_at) = $3
         GROUP BY c.tenant_id
      ),
      sms_usage AS (
        SELECT m.tenant_id,
               COUNT(*)::int AS sms_count
          FROM messages m
         WHERE m.tenant_id IN (SELECT id FROM child_tenants)
           AND m.channel = 'sms'
           AND EXTRACT(YEAR  FROM m.created_at) = $2
           AND EXTRACT(MONTH FROM m.created_at) = $3
         GROUP BY m.tenant_id
      )
      SELECT ct.id   AS tenant_id,
             ct.name AS tenant_name,
             COALESCE(vu.voice_minutes, 0)::numeric AS voice_minutes,
             COALESCE(su.sms_count, 0)::int         AS sms_count
        FROM child_tenants ct
        LEFT JOIN voice_usage vu ON vu.tenant_id = ct.id
        LEFT JOIN sms_usage   su ON su.tenant_id = ct.id
       ORDER BY voice_minutes DESC NULLS LAST`,
      [reseller.id, year, month]
    );

    // Network totals
    let total_voice_minutes = 0;
    let total_sms = 0;
    const per_customer = [];

    for (const row of usageRes.rows) {
      const voice = Number(row.voice_minutes);
      const sms   = Number(row.sms_count);
      total_voice_minutes += voice;
      total_sms += sms;
      per_customer.push({
        tenant_id:     row.tenant_id,
        tenant_name:   row.tenant_name,
        voice_minutes: voice,
        sms_count:     sms,
      });
    }

    // Overage projection
    const overage_voice_minutes = Math.max(0, total_voice_minutes - cap_voice_minutes);
    const overage_sms           = Math.max(0, total_sms - cap_sms);

    const overage_voice_charge_cents = Math.round(overage_voice_minutes * overage_voice_cents);
    const overage_sms_charge_cents   = overage_sms * overage_sms_cents;
    const total_overage_cents        = overage_voice_charge_cents + overage_sms_charge_cents;

    // Cap utilization for warning thresholds
    const voice_pct = cap_voice_minutes > 0
      ? Math.round((total_voice_minutes / cap_voice_minutes) * 1000) / 10
      : 0;
    const sms_pct = cap_sms > 0
      ? Math.round((total_sms / cap_sms) * 1000) / 10
      : 0;

    // Days remaining helps the user/dashboard understand pacing
    const lastDay = new Date(year, month, 0).getDate();
    const days_remaining = Math.max(0, lastDay - now.getDate());

    res.json({
      reseller: {
        id:           reseller.id,
        company_name: reseller.company_name,
        tier:         reseller.reseller_tier,
        hard_cap_enabled: Boolean(reseller.hard_cap_enabled),
      },
      caps: {
        voice_minutes:    cap_voice_minutes,
        sms:              cap_sms,
        overage_voice_cents,
        overage_sms_cents,
      },
      usage: {
        total_voice_minutes: Math.round(total_voice_minutes * 10) / 10,
        total_sms,
        voice_pct_of_cap:    voice_pct,
        sms_pct_of_cap:      sms_pct,
      },
      overage: {
        voice_minutes:        Math.round(overage_voice_minutes * 10) / 10,
        sms:                  overage_sms,
        voice_charge_cents:   overage_voice_charge_cents,
        sms_charge_cents:     overage_sms_charge_cents,
        total_charge_cents:   total_overage_cents,
      },
      meta: {
        billing_year:   year,
        billing_month:  month,
        days_remaining,
        customer_count: per_customer.length,
        generated_at:   new Date().toISOString(),
      },
      per_customer,
    });
  } catch (err) {
    console.error("[ResellerUsage] ERROR:", err.message, err.stack);
    res.status(500).json({ error: "Server error", detail: err.message });
  }
});

module.exports = router;
