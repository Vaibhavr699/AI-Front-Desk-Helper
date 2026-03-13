"use strict";

const { Readable } = require("stream");
const express = require("express");
const db = require("../lib/db");
const auth = require("../lib/auth");
const { getTenantById } = require("../lib/tenant");
const { listPlans } = require("../lib/plans");
const { configurePhoneWebhook, getClientForTenant, purchaseNewNumber, fetchAvailableNumbers } = require("../lib/twilio");

const router = express.Router();
const estimateRecovery = require("../services/estimateRecovery");

/** Normalize a US phone to E.164 (+1XXXXXXXXXX). Returns null if invalid. */
function normalizePhoneInput(raw) {
  if (!raw || typeof raw !== "string") return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (raw.startsWith("+") && digits.length >= 10) return `+${digits}`;
  return null;
}

function getTenantIdFromQuery(req) {
  const userTenantId = req.user?.tenant_id;
  if (userTenantId) return userTenantId;
  const id = req.query.tenant_id || req.headers["x-tenant-id"];
  return id || null;
}

router.get("/plans", (_req, res) => {
  try {
    res.json({ plans: listPlans() });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/calls", async (req, res) => {
  try {
    const tenantId = getTenantIdFromQuery(req);
    if (!tenantId) return res.status(400).json({ error: "tenant_id required" });
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
    const offset = parseInt(req.query.offset, 10) || 0;
    const status = req.query.status;
    let q = `
      SELECT c.*, 
             r.id as recording_id, 
             r.transcript as transcript_preview
      FROM calls c
      LEFT JOIN LATERAL (
        SELECT id, transcript 
        FROM recordings 
        WHERE call_id = c.id 
        ORDER BY created_at DESC 
        LIMIT 1
      ) r ON true
      WHERE c.tenant_id = $1
    `;
    const params = [tenantId];
    if (status) {
      params.push(status);
      q += " AND c.status = $2";
    }
    q += " ORDER BY c.started_at DESC LIMIT $" + (params.length + 1) + " OFFSET $" + (params.length + 2);
    params.push(limit, offset);
    const result = await db.query(q, params);
    res.json({ calls: result.rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/calls/:id", async (req, res) => {
  try {
    const r = await db.query(
      "SELECT c.*, (SELECT json_agg(r.*) FROM recordings r WHERE r.call_id = c.id) as recordings FROM calls c WHERE c.id = $1",
      [req.params.id]
    );
    const call = r.rows[0];
    if (!call) return res.status(404).json({ error: "Not found" });
    res.json(call);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

router.patch("/calls/:id", async (req, res) => {
  try {
    const { status, metadata, disposition } = req.body || {};
    const allowed = ["status", "metadata", "disposition"];
    const setParts = [];
    const values = [];

    let i = 1;
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        setParts.push(`${key} = $${i}`);
        values.push(req.body[key]);
        i++;
      }
    }

    if (setParts.length === 0) return res.status(400).json({ error: "No updates provided" });

    values.push(req.params.id);
    const query = `UPDATE calls SET ${setParts.join(", ")}, updated_at = now() WHERE id = $${i} RETURNING *`;
    const result = await db.query(query, values);

    if (result.rows.length === 0) return res.status(404).json({ error: "Not found" });
    res.json(result.rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/recordings/:id", async (req, res) => {
  try {
    const r = await db.query("SELECT * FROM recordings WHERE id = $1", [req.params.id]);
    const rec = r.rows[0];
    if (!rec) return res.status(404).json({ error: "Not found" });
    res.json(rec);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/recordings/:id/audio", async (req, res) => {
  try {
    const r = await db.query("SELECT id, tenant_id, recording_url FROM recordings WHERE id = $1", [req.params.id]);
    const rec = r.rows[0];
    if (!rec || !rec.recording_url) return res.status(404).json({ error: "Not found" });

    const tenant = await getTenantById(rec.tenant_id);
    const twilioAuth = require("../lib/twilio").getAuthForTenant(tenant);
    if (!twilioAuth) return res.status(502).json({ error: "Recording service not configured" });

    const url = rec.recording_url.replace(".json", ".mp3");
    const auth = Buffer.from(`${twilioAuth.accountSid}:${twilioAuth.authToken}`).toString("base64");

    // Some older recording URLs might not include api.twilio.com if stored incorrectly, handle it cleanly
    const fullUrl = url.startsWith("http") ? url : `https://api.twilio.com${url}`;

    const resp = await fetch(fullUrl, { headers: { Authorization: `Basic ${auth}` } });
    if (!resp.ok) {
      const errBody = await resp.text();
      console.error("[Recordings] Fetch failed:", resp.status, errBody);
      return res.status(502).send("Failed to fetch recording");
    }

    res.setHeader("Content-Type", "audio/mpeg");
    Readable.fromWeb(resp.body).pipe(res);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/bookings", async (req, res) => {
  try {
    const tenantId = getTenantIdFromQuery(req);
    if (!tenantId) return res.status(400).json({ error: "tenant_id required" });
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
    const result = await db.query(
      `SELECT b.*, t.name as technician_name 
       FROM bookings b 
       LEFT JOIN technicians t ON b.technician_id = t.id
       WHERE b.tenant_id = $1 
       ORDER BY b.preferred_date DESC, b.appointment_time DESC, b.created_at DESC 
       LIMIT $2`,
      [tenantId, limit]
    );
    res.json({ bookings: result.rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

router.patch("/bookings/:id", async (req, res) => {
  try {
    const { status, technician_id, preferred_date, appointment_time, notes } = req.body || {};
    const allowed = ["status", "technician_id", "preferred_date", "appointment_time", "notes"];
    const setParts = [];
    const values = [];
    let i = 1;

    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        setParts.push(`${key} = $${i}`);
        values.push(req.body[key]);
        i++;
      }
    }

    if (setParts.length === 0) return res.status(400).json({ error: "No updates provided" });

    values.push(req.params.id);
    const query = `UPDATE bookings SET ${setParts.join(", ")}, updated_at = now() WHERE id = $${i} RETURNING *`;
    const result = await db.query(query, values);

    if (result.rows.length === 0) return res.status(404).json({ error: "Not found" });
    res.json(result.rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

// -------------------- Technicians --------------------

router.get("/technicians", async (req, res) => {
  try {
    const tenantId = getTenantIdFromQuery(req);
    if (!tenantId) return res.status(400).json({ error: "tenant_id required" });
    const result = await db.query(
      "SELECT * FROM technicians WHERE tenant_id = $1 ORDER BY name ASC",
      [tenantId]
    );
    res.json({ technicians: result.rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/technicians", async (req, res) => {
  try {
    const tenantId = getTenantIdFromQuery(req);
    if (!tenantId) return res.status(400).json({ error: "tenant_id required" });
    const { name, email, phone } = req.body || {};
    if (!name) return res.status(400).json({ error: "Name is required" });
    const result = await db.query(
      "INSERT INTO technicians (tenant_id, name, email, phone) VALUES ($1, $2, $3, $4) RETURNING *",
      [tenantId, name, email, phone]
    );
    res.status(201).json(result.rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

router.patch("/technicians/:id", async (req, res) => {
  try {
    const { name, email, phone } = req.body || {};
    const result = await db.query(
      "UPDATE technicians SET name = COALESCE($1, name), email = COALESCE($2, email), phone = COALESCE($3, phone), updated_at = now() WHERE id = $4 RETURNING *",
      [name, email, phone, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "Not found" });
    res.json(result.rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

router.delete("/technicians/:id", async (req, res) => {
  try {
    await db.query("DELETE FROM technicians WHERE id = $1", [req.params.id]);
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/followups", async (req, res) => {
  try {
    const tenantId = getTenantIdFromQuery(req);
    if (!tenantId) return res.status(400).json({ error: "tenant_id required" });

    // Join with leads to get estimated revenue and other CRM data
    const result = await db.query(
      `SELECT er.*, 
              l.estimated_revenue_cents,
              l.name as lead_name,
              l.status as lead_status,
              (SELECT MAX(created_at) FROM recovery_touches WHERE recovery_id = er.id) as last_contact
       FROM estimate_recoveries er
       LEFT JOIN leads l ON er.lead_id = l.id
       WHERE er.tenant_id = $1 AND er.status IN ('active', 'paused')
       ORDER BY er.next_action_at ASC`,
      [tenantId]
    );

    res.json({ followups: result.rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/followups/:id/sms", async (req, res) => {
  try {
    const recovery = await estimateRecovery.getRecoveryById(req.params.id);
    if (!recovery) return res.status(404).json({ error: "Not found" });

    const tenant = await getTenantById(recovery.tenant_id);
    const stepDef = estimateRecovery.ALL_STEPS.get(recovery.current_step);
    
    const vars = {
      first_name: recovery.contact_name?.split(/\s+/)[0] || "there",
      company_name: tenant.company_name || tenant.name
    };

    await estimateRecovery.sendRecoverySms(recovery, tenant, stepDef, vars);
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

router.post("/followups/:id/call", async (req, res) => {
  try {
    const recovery = await estimateRecovery.getRecoveryById(req.params.id);
    if (!recovery) return res.status(404).json({ error: "Not found" });

    const tenant = await getTenantById(recovery.tenant_id);
    const stepDef = estimateRecovery.ALL_STEPS.get(recovery.current_step);
    
    const vars = {
      first_name: recovery.contact_name?.split(/\s+/)[0] || "there",
      company_name: tenant.company_name || tenant.name
    };

    await estimateRecovery.makeRecoveryCall(recovery, tenant, stepDef, vars);
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

router.patch("/followups/:id/status", async (req, res) => {
  try {
    const { status } = req.body; // 'booked' or 'lost'
    const recoveryId = req.params.id;

    if (status === 'booked') {
      await estimateRecovery.markConverted(recoveryId);
      // Also update the lead status if linked
      const rec = await estimateRecovery.getRecoveryById(recoveryId);
      if (rec.lead_id) {
        await db.query("UPDATE leads SET status = 'Booked' WHERE id = $1", [rec.lead_id]);
      }
    } else if (status === 'lost') {
      await estimateRecovery.markCancelled(recoveryId);
      const rec = await estimateRecovery.getRecoveryById(recoveryId);
      if (rec.lead_id) {
        await db.query("UPDATE leads SET status = 'Lost' WHERE id = $1", [rec.lead_id]);
      }
    }

    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

router.get("/metrics", async (req, res) => {
  try {
    const tenantId = getTenantIdFromQuery(req);
    if (!tenantId) return res.status(400).json({ error: "tenant_id required" });

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    console.log(`[Metrics] Fetching for tenant=${tenantId}`);

    const [
      salesStats,
      aiStats,
      sourceStats,
      trendStats,
      todayStats,
      pipelineStats
    ] = await Promise.all([
      // 1. Sales Metrics
      db.query(
        `SELECT 
          COUNT(DISTINCT l.id) as leads_generated,
          COUNT(DISTINCT er.id) as estimates_sent,
          COUNT(DISTINCT b.id) as estimates_accepted,
          COALESCE(SUM(b.revenue_cents), 0) as revenue_booked
         FROM leads l
         LEFT JOIN estimate_recoveries er ON er.lead_id = l.id AND er.created_at > $2
         LEFT JOIN bookings b ON b.lead_id = l.id AND b.created_at > $2
         WHERE l.tenant_id = $1 AND l.created_at > $2`,
        [tenantId, thirtyDaysAgo]
      ),
      // 2. AI Performance
      db.query(
        `SELECT 
          COUNT(*) as calls_handled,
          COUNT(*) FILTER (WHERE transferred = true) as human_transferred,
          (SELECT COUNT(*) FROM bookings WHERE tenant_id = $1 AND call_id IS NOT NULL AND created_at > $2) as appointments_booked,
          (SELECT COUNT(*) FROM estimate_recoveries WHERE tenant_id = $1 AND status = 'converted' AND updated_at > $2) as missed_calls_recovered
         FROM calls 
         WHERE tenant_id = $1 AND started_at > $2`,
        [tenantId, thirtyDaysAgo]
      ),
      // 3. Lead Sources (Distribution)
      db.query(
        `SELECT 
          COALESCE(channel, 'unknown') as source,
          COUNT(*) as count
         FROM messages
         WHERE tenant_id = $1 AND created_at > $2 AND direction = 'inbound'
         GROUP BY channel
         UNION ALL
         SELECT 'phone' as source, COUNT(*) as count FROM calls WHERE tenant_id = $1 AND started_at > $2
         ORDER BY count DESC`,
        [tenantId, thirtyDaysAgo]
      ),
      // 4. Trend Data (Last 7 Days)
      db.query(
        `SELECT 
          d.day::date as date,
          COUNT(l.id) as leads,
          COUNT(b.id) as bookings
         FROM generate_series(now() - interval '6 days', now(), interval '1 day') d(day)
         LEFT JOIN leads l ON l.tenant_id = $1 AND l.created_at::date = d.day::date
         LEFT JOIN bookings b ON b.tenant_id = $1 AND b.created_at::date = d.day::date
         GROUP BY d.day
         ORDER BY d.day ASC`,
        [tenantId]
      ),
      // 5. Today Stats
      db.query(
        `SELECT
          (SELECT COUNT(*) FROM calls WHERE tenant_id = $1 AND started_at >= now() - interval '24 hours') as calls,
          (SELECT COUNT(*) FROM estimate_recoveries WHERE tenant_id = $1 AND status = 'converted' AND updated_at >= now() - interval '24 hours') as recovered,
          (SELECT COUNT(*) FROM leads WHERE tenant_id = $1 AND created_at >= now() - interval '24 hours') as leads,
          (SELECT COUNT(*) FROM bookings WHERE tenant_id = $1 AND created_at >= now() - interval '24 hours') as booked`,
        [tenantId]
      ),
      // 6. Pipeline Stats
      db.query(
        `SELECT
          (SELECT COUNT(*) FROM leads WHERE tenant_id = $1 AND status NOT IN ('Closed', 'Lost')) as open_estimates,
          (SELECT COUNT(*) FROM bookings WHERE tenant_id = $1 AND status = 'scheduled') as jobs_scheduled,
          (SELECT COALESCE(SUM(revenue_cents), 0) FROM bookings WHERE tenant_id = $1 AND status = 'scheduled') as estimated_revenue`,
        [tenantId]
      )
    ]);

    const sales = salesStats.rows[0];
    const ai = aiStats.rows[0];
    
    // Calculate close rate
    const closeRate = sales.leads_generated > 0 
      ? Math.round((sales.estimates_accepted / sales.leads_generated) * 100) 
      : 0;

    console.log(`[Metrics] Response structure:`, { 
      period: "30d", 
      today: !!todayStats.rows[0], 
      pipeline: !!pipelineStats.rows[0],
      sales: !!salesStats.rows[0]
    });

    res.json({
      period: "30d",
      today: {
        calls: parseInt(todayStats.rows[0].calls || 0, 10),
        recovered: parseInt(todayStats.rows[0].recovered || 0, 10),
        leads: parseInt(todayStats.rows[0].leads || 0, 10),
        booked: parseInt(todayStats.rows[0].booked || 0, 10)
      },
      pipeline: {
        open_estimates: parseInt(pipelineStats.rows[0].open_estimates || 0, 10),
        jobs_scheduled: parseInt(pipelineStats.rows[0].jobs_scheduled || 0, 10),
        estimated_revenue: parseInt(pipelineStats.rows[0].estimated_revenue || 0, 10)
      },
      sales: {
        leads_generated: parseInt(sales.leads_generated, 10),
        estimates_sent: parseInt(sales.estimates_sent, 10),
        estimates_accepted: parseInt(sales.estimates_accepted, 10),
        revenue_booked: parseInt(sales.revenue_booked, 10),
        close_rate: closeRate
      },
      ai: {
        calls_handled: parseInt(ai.calls_handled, 10),
        human_transferred: parseInt(ai.human_transferred, 10),
        appointments_booked: parseInt(ai.appointments_booked, 10),
        missed_calls_recovered: parseInt(ai.missed_calls_recovered, 10),
        ai_success_rate: ai.calls_handled > 0 
          ? Math.round(((ai.calls_handled - ai.human_transferred) / ai.calls_handled) * 100) 
          : 0
      },
      sources: sourceStats.rows.map(r => ({
        label: r.source.charAt(0).toUpperCase() + r.source.slice(1),
        value: parseInt(r.count, 10)
      })),
      trends: trendStats.rows.map(r => ({
        date: r.date,
        leads: parseInt(r.leads, 10),
        bookings: parseInt(r.bookings, 10)
      }))
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});


router.get("/activity-feed", async (req, res) => {
  try {
    const tenantId = getTenantIdFromQuery(req);
    if (!tenantId) return res.status(400).json({ error: "tenant_id required" });

    const [calls, bookings, recoveries, followUps] = await Promise.all([
      db.query(
        "SELECT id, started_at as at, 'call' as type, disposition, transferred FROM calls WHERE tenant_id = $1 ORDER BY started_at DESC LIMIT 15",
        [tenantId]
      ),
      db.query(
        "SELECT id, created_at as at, 'booking' as type, contact_name, status FROM bookings WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 15",
        [tenantId]
      ),
      db.query(
        "SELECT id, updated_at as at, 'recovery' as type, status, contact_name FROM estimate_recoveries WHERE tenant_id = $1 ORDER BY updated_at DESC LIMIT 15",
        [tenantId]
      ),
      db.query(
        "SELECT id, created_at as at, 'follow_up' as type, follow_up_type, status FROM follow_ups WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 15",
        [tenantId]
      ),
    ]);

    const events = [
      ...calls.rows.map(r => ({
        id: r.id,
        at: r.at,
        type: "call",
        text: r.transferred ? "AI transferred call to human" : (r.disposition === 'booked' ? "AI booked appointment on call" : "AI answered call")
      })),
      ...bookings.rows.map(r => ({
        id: r.id,
        at: r.at,
        type: "booking",
        text: r.status === 'scheduled' ? `Appointment booked: ${r.contact_name || 'Lead'}` : `Lead captured: ${r.contact_name || 'Lead'}`
      })),
      ...recoveries.rows.map(r => ({
        id: r.id,
        at: r.at,
        type: "recovery",
        text: r.status === 'converted' ? `Missed call recovered: ${r.contact_name || 'Lead'}` : `Recovery sequence active: ${r.contact_name || 'Lead'}`
      })),
      ...followUps.rows.map(r => ({
        id: r.id,
        at: r.at,
        type: "follow_up",
        text: `SMS followup sent: ${r.follow_up_type}`
      }))
    ];

    events.sort((a, b) => new Date(b.at) - new Date(a.at));

    res.json({ feed: events.slice(0, 25) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

// More specific route first so /tenants/:id is matched before /tenants
function maskTwilioSid(sid) {
  if (!sid || typeof sid !== "string") return null;
  if (sid.length <= 8) return "***";
  return sid.substring(0, 4) + "***" + sid.slice(-4);
}

function maskFacebookToken(token) {
  if (!token || typeof token !== "string") return null;
  if (token.length <= 12) return "***";
  return token.substring(0, 6) + "..." + token.slice(-6);
}

const TENANT_SELECT_TWILIO = `t.twilio_account_sid, t.twilio_auth_token`;
const TENANT_SELECT_BASE = `t.id, t.name, t.slug, t.company_name, t.welcome_message, t.instructions, t.transfer_numbers, t.transfer_sms_brief, t.crm_webhook_url, t.crm_type, t.follow_up_enabled, t.plan, t.facebook_page_id, t.facebook_page_access_token, t.tone_of_voice, t.objection_handling_config, t.business_hours, t.afterhours_behavior, t.google_calendar_linked, t.google_calendar_id, t.zapier_webhook_url, t.api_key, t.website, t.voice_model, t.faqs, t.plan_overrides, t.promo_label`;
const TENANT_SELECT_BASE_LEGACY = `t.id, t.name, t.slug, t.company_name, t.welcome_message, t.instructions, t.transfer_numbers, t.transfer_sms_brief, t.crm_webhook_url, t.crm_type, t.follow_up_enabled`;

router.get("/tenants/:id", async (req, res) => {
  try {
    const r = await db.query(
      `SELECT ${TENANT_SELECT_BASE}, ${TENANT_SELECT_TWILIO},
       (SELECT json_agg(json_build_object('phone', pn.phone, 'is_primary', pn.is_primary)) FROM phone_numbers pn WHERE pn.tenant_id = t.id) as phones FROM tenants t WHERE t.id = $1`,
      [req.params.id]
    );
    const tenant = r.rows[0];
    if (!tenant) return res.status(404).json({ error: "Not found" });

    const masked = { ...tenant };
    masked.twilio_account_sid_masked = maskTwilioSid(tenant.twilio_account_sid);
    masked.facebook_token_masked = maskFacebookToken(tenant.facebook_page_access_token);
    masked.api_key_masked = tenant.api_key ? tenant.api_key.substring(0, 4) + "..." + tenant.api_key.slice(-4) : null;
    masked.has_twilio_credentials = !!(tenant.twilio_account_sid && tenant.twilio_auth_token);
    
    delete masked.twilio_account_sid;
    delete masked.twilio_auth_token;
    delete masked.facebook_page_access_token;
    delete masked.api_key;

    res.json(masked);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/tenants", async (req, res) => {
  try {
    // If regular user, only show their business
    const userTenantId = req.user?.tenant_id;
    let query = `SELECT ${TENANT_SELECT_BASE}, (SELECT json_agg(json_build_object('phone', pn.phone, 'is_primary', pn.is_primary)) FROM phone_numbers pn WHERE pn.tenant_id = t.id) as phones FROM tenants t ORDER BY t.name`;
    let params = [];
    
    if (userTenantId) {
      query = `SELECT ${TENANT_SELECT_BASE}, (SELECT json_agg(json_build_object('phone', pn.phone, 'is_primary', pn.is_primary)) FROM phone_numbers pn WHERE pn.tenant_id = t.id) as phones FROM tenants t WHERE t.id = $1`;
      params = [userTenantId];
    }

    const r = await db.query(query, params);
    const tenants = r.rows.map(t => {
      const masked = { ...t };
      masked.twilio_account_sid_masked = maskTwilioSid(t.twilio_account_sid);
      masked.api_key_masked = t.api_key ? t.api_key.substring(0, 4) + "..." + t.api_key.slice(-4) : null;
      masked.has_twilio_credentials = !!(t.twilio_account_sid && t.twilio_auth_token);
      
      delete masked.twilio_account_sid;
      delete masked.twilio_auth_token;
      delete masked.facebook_page_access_token;
      delete masked.api_key;
      return masked;
    });

    res.json({ tenants });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/tenants", async (req, res) => {
  try {
    const userId = req.user?.sub;
    const userTenantId = req.user?.tenant_id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    if (userTenantId) {
      return res.status(400).json({ error: "You already have a business. Use Settings or the Businesses page to manage it." });
    }
    const body = req.body || {};
    const name = body.name || "";
    const company_name = body.company_name || body.companyName || "";
    const slugInput = body.slug;
    const companyName = (company_name || name || "").trim();
    const displayName = (name || company_name || "").trim();
    if (!displayName && !companyName) {
      return res.status(400).json({ error: "Business name or company name is required" });
    }

    // BYOT: if tenant provides their own Twilio credentials + phone, use manual flow
    const byotSid = (body.twilio_account_sid || "").trim();
    const byotToken = (body.twilio_auth_token || "").trim();
    const manualPhone = body.phone || body.phone_number || "";

    let phone = null;
    let twilioSid = null;
    let isByot = !!(byotSid && byotToken);

    if (isByot && manualPhone) {
      // BYOT flow: tenant provides their own number
      phone = normalizePhoneInput(manualPhone);
      if (!phone) {
        return res.status(400).json({ error: "A valid phone number is required for BYOT (e.g. +18076055898 or 8076055898)" });
      }
    } else {
      // Platform flow: dynamically purchase a number
      try {
        let numberToBuy = body.assigned_number;
        if (!numberToBuy) {
          // Fallback if they bypassed the UI selection
          const available = await fetchAvailableNumbers();
          if (!available || available.length === 0) throw new Error("No numbers available");
          numberToBuy = available[0].phoneNumber;
        }

        const purchased = await purchaseNewNumber(numberToBuy);
        phone = purchased.phone;
        twilioSid = purchased.twilioSid;
      } catch (err) {
        console.error("Dashboard POST /tenants phone provisioning error:", err);
        return res.status(503).json({ error: "Could not provision a new phone number. Details: " + err.message });
      }
    }

    // Check if this phone number is already assigned to another tenant
    const phoneExists = await db.query("SELECT id FROM phone_numbers WHERE phone = $1", [phone]);
    if (phoneExists.rows.length > 0) {
      return res.status(409).json({ error: "This phone number is already assigned to another business." });
    }

    const finalName = displayName || companyName;
    const finalCompany = companyName || displayName;
    const slug = (slugInput || finalName)
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "");
    if (!slug) return res.status(400).json({ error: "Could not generate a valid slug from the business name" });
    const existing = await db.query("SELECT id FROM tenants WHERE slug = $1", [slug]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: "A business with this slug already exists. Try a different name." });
    }
    const insert = await db.query(
      "INSERT INTO tenants (name, slug, company_name) VALUES ($1, $2, $3) RETURNING id, name, slug, company_name",
      [finalName, slug, finalCompany]
    );
    const tenant = insert.rows[0];

    // If BYOT credentials provided, save them on the tenant
    if (isByot) {
      await db.query(
        "UPDATE tenants SET twilio_account_sid = $1, twilio_auth_token = $2, updated_at = now() WHERE id = $3",
        [byotSid, byotToken, tenant.id]
      );
    }

    // Insert the phone number linked to this tenant
    const phoneRow = await db.query(
      "INSERT INTO phone_numbers (tenant_id, phone, is_primary, twilio_sid) VALUES ($1, $2, true, $3) RETURNING id",
      [tenant.id, phone, twilioSid]
    );

    // Auto-configure Twilio webhook on this number
    const tenantForTwilio = await getTenantById(tenant.id);
    const webhookResult = await configurePhoneWebhook(phone, tenant.id, tenantForTwilio);
    if (!webhookResult.success) {
      // Rollback: remove the phone number and tenant since webhook setup failed
      await db.query("DELETE FROM phone_numbers WHERE id = $1", [phoneRow.rows[0].id]);
      await db.query("DELETE FROM tenants WHERE id = $1", [tenant.id]);
      await db.query(
        "UPDATE dashboard_users SET tenant_id = NULL, role = 'viewer', updated_at = now() WHERE id = $1",
        [userId]
      );
      return res.status(400).json({
        error: webhookResult.error || "Could not configure this phone number in Twilio. Please contact support."
      });
    }
    // Update Twilio SID if we didn't already have it (BYOT case)
    if (webhookResult.twilioSid && !twilioSid) {
      await db.query("UPDATE phone_numbers SET twilio_sid = $1, updated_at = now() WHERE id = $2", [webhookResult.twilioSid, phoneRow.rows[0].id]);
    }
    await db.query(
      "UPDATE dashboard_users SET tenant_id = $1, role = $2, updated_at = now() WHERE id = $3",
      [tenant.id, "admin", userId]
    );
    const newToken = auth.signToken({
      sub: userId,
      email: req.user.email,
      tenant_id: tenant.id,
      role: "admin",
    });
    const userRow = await db.query(
      "SELECT id, email, tenant_id, role FROM dashboard_users WHERE id = $1",
      [userId]
    );
    const user = userRow.rows[0];
    res.status(201).json({
      token: newToken,
      user: { id: user.id, email: user.email, tenant_id: user.tenant_id, role: user.role },
      tenant: { ...tenant, phones: [{ phone, is_primary: true }] },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

function normalizeTransferNumbers(value) {
  if (value == null) return [];
  if (Array.isArray(value)) {
    return value.filter((v) => typeof v === "string").map((v) => String(v).trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return normalizeTransferNumbers(parsed);
    } catch (_) {
      return value.split(",").map((s) => s.trim()).filter(Boolean);
    }
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    return Object.values(value).filter((v) => typeof v === "string").map((v) => String(v).trim()).filter(Boolean);
  }
  return [];
}

router.patch("/tenants/:id", async (req, res) => {
  try {
    const id = req.params.id;
    let allowed = [
      "welcome_message", "instructions", "transfer_numbers", "transfer_sms_brief", 
      "crm_webhook_url", "crm_type", "follow_up_enabled", "plan", 
      "twilio_account_sid", "twilio_auth_token", "facebook_page_id", "facebook_page_access_token",
      "tone_of_voice", "objection_handling_config", "business_hours", "afterhours_behavior", 
      "google_calendar_linked", "google_calendar_id", "zapier_webhook_url",
      "website", "voice_model", "faqs"
    ];
    try {
      await db.query("SELECT twilio_account_sid FROM tenants WHERE id = $1 LIMIT 1", [id]);
    } catch (colErr) {
      if (colErr.code === "42703") {
        allowed = allowed.filter((k) => k !== "twilio_account_sid" && k !== "twilio_auth_token");
      } else throw colErr;
    }
    const updates = {};
    for (const key of allowed) {
      if (req.body[key] === undefined) continue;
      if (key === "transfer_numbers") {
        updates[key] = normalizeTransferNumbers(req.body[key]);
      } else if (key === "twilio_auth_token") {
        updates[key] = req.body[key] === "" ? null : req.body[key];
      } else if (key === "plan") {
        const p = (req.body[key] || "").toLowerCase();
        if (!["basic", "pro", "elite"].includes(p)) {
          return res.status(400).json({ error: "plan must be basic, pro, or elite" });
        }
        updates[key] = p;
      } else {
        updates[key] = req.body[key];
      }
    }
    if (Object.keys(updates).length === 0) return res.status(400).json({ error: "No allowed fields to update" });
    const set = Object.keys(updates).map((k, i) => `${k} = $${i + 1}`).join(", ");
    const values = Object.keys(updates).map((k) => {
      const v = updates[k];
      if (["transfer_numbers", "business_hours", "objection_handling_config", "faqs"].includes(k)) {
        return JSON.stringify(v);
      }
      return v;
    });
    values.push(id);
    await db.query(
      `UPDATE tenants SET ${set}, updated_at = now() WHERE id = $${values.length}`,
      values
    );
    let r;
    try {
      r = await db.query(
        `SELECT ${TENANT_SELECT_BASE}, ${TENANT_SELECT_TWILIO},
         (SELECT json_agg(json_build_object('phone', pn.phone, 'is_primary', pn.is_primary)) FROM phone_numbers pn WHERE pn.tenant_id = t.id) as phones FROM tenants t WHERE t.id = $1`,
        [id]
      );
    } catch (colErr) {
      if (colErr.code === "42703") {
        r = await db.query(
          `SELECT ${TENANT_SELECT_BASE_LEGACY}, ${TENANT_SELECT_TWILIO}
           (SELECT json_agg(json_build_object('phone', pn.phone, 'is_primary', pn.is_primary)) FROM phone_numbers pn WHERE pn.tenant_id = t.id) as phones FROM tenants t WHERE t.id = $1`,
          [id]
        );
        if (r.rows[0]) {
          r.rows[0].twilio_account_sid = null;
          r.rows[0].has_twilio_credentials = false;
          r.rows[0].plan = "basic";
        }
      } else throw colErr;
    }
    if (!r.rows[0]) return res.status(404).json({ error: "Not found" });
    const row = r.rows[0];
    const out = { ...row };
    delete out.twilio_account_sid;
    delete out.facebook_page_access_token;
    delete out.api_key;
    out.twilio_account_sid_masked = maskTwilioSid(row.twilio_account_sid);
    out.facebook_token_masked = maskFacebookToken(row.facebook_page_access_token);
    out.api_key_masked = row.api_key ? row.api_key.substring(0, 4) + "..." + row.api_key.slice(-4) : null;
    out.has_twilio_credentials = row.has_twilio_credentials === true;
    if (out.plan == null) out.plan = "basic";
    res.json(out);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

// -------------------- Twilio Utility Endpoints --------------------

router.get("/twilio/available-numbers", async (req, res) => {
  try {
    const areaCode = req.query.area_code || null;
    const limit = parseInt(req.query.limit, 10) || 10;
    const numbers = await fetchAvailableNumbers(areaCode, limit);
    res.json({ numbers });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not fetch available numbers from Twilio." });
  }
});

// -------------------- Phone Numbers --------------------

router.get("/phone-numbers", async (req, res) => {
  try {
    const tenantId = getTenantIdFromQuery(req);
    if (!tenantId) return res.status(400).json({ error: "tenant_id required" });
    const result = await db.query(
      "SELECT id, tenant_id, phone, is_primary, created_at FROM phone_numbers WHERE tenant_id = $1 ORDER BY is_primary DESC, created_at",
      [tenantId]
    );
    res.json({ phone_numbers: result.rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/phone-numbers", async (req, res) => {
  try {
    const tenantId = getTenantIdFromQuery(req);
    if (!tenantId) return res.status(400).json({ error: "tenant_id required" });
    const phone = normalizePhoneInput(req.body?.phone);
    if (!phone) {
      return res.status(400).json({ error: "A valid phone number is required (e.g. +18076055898 or 8076055898)" });
    }
    // Check if already assigned
    const existing = await db.query("SELECT id, tenant_id FROM phone_numbers WHERE phone = $1", [phone]);
    if (existing.rows.length > 0) {
      const owner = existing.rows[0].tenant_id;
      if (owner === tenantId) {
        return res.status(409).json({ error: "This number is already added to your business." });
      }
      return res.status(409).json({ error: "This phone number is already assigned to another business." });
    }
    // If this is the first number, make it primary
    const countResult = await db.query("SELECT COUNT(*) as count FROM phone_numbers WHERE tenant_id = $1", [tenantId]);
    const isPrimary = parseInt(countResult.rows[0].count, 10) === 0;
    // Auto-configure Twilio webhook on this number before saving
    const tenantForTwilio = await getTenantById(tenantId);
    const webhookResult = await configurePhoneWebhook(phone, tenantId, tenantForTwilio);
    if (!webhookResult.success) {
      return res.status(400).json({
        error: webhookResult.error || "Could not configure this phone number in Twilio. Make sure it is purchased and active in your Twilio account."
      });
    }
    const result = await db.query(
      "INSERT INTO phone_numbers (tenant_id, phone, is_primary, twilio_sid) VALUES ($1, $2, $3, $4) RETURNING id, tenant_id, phone, is_primary, twilio_sid, created_at",
      [tenantId, phone, isPrimary, webhookResult.twilioSid || null]
    );
    res.status(201).json({ ...result.rows[0], webhook_configured: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

router.delete("/phone-numbers/:id", async (req, res) => {
  try {
    const tenantId = getTenantIdFromQuery(req);
    if (!tenantId) return res.status(400).json({ error: "tenant_id required" });
    const phoneId = req.params.id;
    // Verify ownership
    const existing = await db.query(
      "SELECT id, is_primary FROM phone_numbers WHERE id = $1 AND tenant_id = $2",
      [phoneId, tenantId]
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: "Phone number not found" });
    }
    // Check if this is the only number — require at least one
    const countResult = await db.query("SELECT COUNT(*) as count FROM phone_numbers WHERE tenant_id = $1", [tenantId]);
    if (parseInt(countResult.rows[0].count, 10) <= 1) {
      return res.status(400).json({ error: "Cannot remove your only phone number. Add another number first." });
    }
    await db.query("DELETE FROM phone_numbers WHERE id = $1", [phoneId]);
    // If deleted number was primary, promote the oldest remaining
    if (existing.rows[0].is_primary) {
      await db.query(
        "UPDATE phone_numbers SET is_primary = true, updated_at = now() WHERE id = (SELECT id FROM phone_numbers WHERE tenant_id = $1 ORDER BY created_at LIMIT 1)",
        [tenantId]
      );
    }
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

// -------------------- Estimate Recoveries --------------------

// List sales wins (converted recoveries)
router.get("/sales-wins", async (req, res) => {
  try {
    const tenantId = getTenantIdFromQuery(req);
    if (!tenantId) return res.status(400).json({ error: "tenant_id required" });
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
    const result = await db.query(
      "SELECT * FROM estimate_recoveries WHERE tenant_id = $1 AND status = 'converted' ORDER BY updated_at DESC LIMIT $2",
      [tenantId, limit]
    );
    res.json({ sales_wins: result.rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

// Recovery stats
router.get("/recoveries/stats", async (req, res) => {
  try {
    const tenantId = getTenantIdFromQuery(req);
    if (!tenantId) return res.status(400).json({ error: "tenant_id required" });
    const stats = await estimateRecovery.getRecoveryStats(tenantId);
    res.json(stats);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

// Start a recovery for a booking
router.post("/recoveries", async (req, res) => {
  try {
    const tenantId = getTenantIdFromQuery(req);
    if (!tenantId) return res.status(400).json({ error: "tenant_id required" });
    const { booking_id, contact_name, contact_phone, contact_email, lead_source } = req.body || {};
    if (!booking_id) return res.status(400).json({ error: "booking_id required" });
    const recovery = await estimateRecovery.startRecovery(tenantId, booking_id, {
      contact_name, contact_phone, contact_email, lead_source,
    });
    if (!recovery) return res.status(400).json({ error: "Could not start recovery — booking not found or already active" });
    res.status(201).json(recovery);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

// Get single recovery with touch history
router.get("/recoveries/:id", async (req, res) => {
  try {
    const recovery = await estimateRecovery.getRecoveryById(req.params.id);
    if (!recovery) return res.status(404).json({ error: "Not found" });
    const touches = await estimateRecovery.getTouchesByRecovery(req.params.id);
    res.json({ ...recovery, touches });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

// Set objection type on a recovery
router.patch("/recoveries/:id/objection", async (req, res) => {
  try {
    const { objection_type } = req.body || {};
    if (!["price", "thinking", "spouse"].includes(objection_type)) {
      return res.status(400).json({ error: "objection_type must be: price, thinking, or spouse" });
    }
    await estimateRecovery.setObjection(req.params.id, objection_type);
    const updated = await estimateRecovery.getRecoveryById(req.params.id);
    res.json(updated);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

// Mark recovered (converted)
router.post("/recoveries/:id/convert", async (req, res) => {
  try {
    await estimateRecovery.markConverted(req.params.id);
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

// Pause / resume / cancel
router.post("/recoveries/:id/pause", async (req, res) => {
  try {
    await estimateRecovery.markPaused(req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/recoveries/:id/resume", async (req, res) => {
  try {
    await estimateRecovery.resumeRecovery(req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/recoveries/:id/cancel", async (req, res) => {
  try {
    await estimateRecovery.markCancelled(req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: "Server error" });
  }
});

// -------------------- Conversations Center --------------------

router.get("/conversations", async (req, res) => {
  try {
    const tenantId = getTenantIdFromQuery(req);
    if (!tenantId) return res.status(400).json({ error: "tenant_id required" });

    const result = await db.query(
      `SELECT l.id, l.name, l.phone, l.status, l.metadata as lead_metadata,
              act.last_at, act.last_body, act.last_type, act.last_channel
       FROM leads l
       JOIN (
         SELECT lead_id, 
                MAX(at) as last_at,
                (ARRAY_AGG(body ORDER BY at DESC))[1] as last_body,
                (ARRAY_AGG(type ORDER BY at DESC))[1] as last_type,
                (ARRAY_AGG(channel ORDER BY at DESC))[1] as last_channel
         FROM (
           SELECT lead_id, created_at as at, body, 'message' as type, channel FROM messages WHERE tenant_id = $1
           UNION ALL
           SELECT lead_id, started_at as at, transcript as body, 'call' as type, 'voice' as channel FROM calls WHERE tenant_id = $1 AND lead_id IS NOT NULL
         ) t
         GROUP BY lead_id
       ) act ON l.id = act.lead_id
       WHERE l.tenant_id = $1
       ORDER BY act.last_at DESC`,
      [tenantId]
    );

    res.json({ conversations: result.rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/conversations/:id/timeline", async (req, res) => {
  try {
    const leadId = req.params.id;
    const result = await db.query(
      `SELECT 'message' as type, id, channel, direction, body as content, created_at as at, metadata
       FROM messages
       WHERE lead_id = $1
       UNION ALL
       SELECT 'call' as type, id, 'voice' as channel, 'inbound' as direction, transcript as content, started_at as at, metadata
       FROM calls
       WHERE lead_id = $1
       ORDER BY at ASC`,
      [leadId]
    );

    res.json({ timeline: result.rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/tenants/:id/reset-api-key", async (req, res) => {
  try {
    const id = req.params.id;
    const newKey = require("crypto").randomBytes(24).toString("base64");
    const result = await db.query(
      "UPDATE tenants SET api_key = $1, updated_at = now() WHERE id = $2 RETURNING api_key",
      [newKey, id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "Not found" });
    res.json({ api_key: result.rows[0].api_key });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;

