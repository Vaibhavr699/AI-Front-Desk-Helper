"use strict";

const { Readable } = require("stream");
const express = require("express");
const db = require("../lib/db");
const auth = require("../lib/auth");
const { getTenantById } = require("../lib/tenant");
const { listPlans, hasNurturingReferralAccess } = require("../lib/plans");
const { configurePhoneWebhook, getClientForTenant, purchaseNewNumber, fetchAvailableNumbers, getOwnedUnassignedNumbers } = require("../lib/twilio");

const router = express.Router();
const estimateRecovery = require("../services/estimateRecovery");
const emailService = require("../services/email");
const nurturingService = require("../services/nurturing");
const notificationsService = require("../services/notifications");
const { logAction } = require("../lib/auditLogger");
 const locationBilling = require("../lib/locationBilling");
const {
  sendLocationAddedEmail,
  sendFranchiseeInviteEmail,
  sendLocationRemovalConfirmationEmail,
  sendLocationRateChangeNoticeEmail,
} = require("../services/email");
const crypto = require("crypto");
const { getTenantIdFromQuery, getTargetTenantIds, requireRole, ROLES } = require("../lib/auth");

/** Normalize a US phone to E.164 (+1XXXXXXXXXX). Returns null if invalid. */
function normalizePhoneInput(raw) {
  if (!raw || typeof raw !== "string") return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (raw.startsWith("+") && digits.length >= 10) return `+${digits}`;
  return null;
}


router.get("/plans", (_req, res) => {
  try {
    res.json({ plans: listPlans() });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

// --- Bookings (Available to Staff, Manager, and Owner) ---
router.get("/bookings", async (req, res) => {
  try {
    const tenantIds = await getTargetTenantIds(req);
    if (!tenantIds.length) return res.status(400).json({ error: "tenant_id required" });

    const limit = Math.min(parseInt(req.query.limit, 10) || 15, 100);
    const offset = parseInt(req.query.offset, 10) || 0;
    const search = req.query.search || "";
    const status = req.query.status || "";
    const sortBy = req.query.sortBy || "preferred_date";
    const sortDir = req.query.sortDir === "asc" ? "ASC" : "DESC";

    const params = [tenantIds];
    let where = "WHERE b.tenant_id = ANY($1)";
    let i = 2;

    if (status && status !== "all") {
      where += ` AND LOWER(b.status) = $${i++}`;
      params.push(status.toLowerCase());
    }

    if (search) {
      where += ` AND (b.contact_name ILIKE $${i} OR b.contact_phone ILIKE $${i} OR b.scope ILIKE $${i} OR b.address ILIKE $${i})`;
      params.push(`%${search}%`);
      i++;
    }

    const allowedSort = ["contact_name", "preferred_date", "estimated_revenue_cents", "status", "created_at"];
    const activeSort = allowedSort.includes(sortBy) ? sortBy : "preferred_date";

    const countRes = await db.query(`
      SELECT COUNT(*) FROM bookings b ${where}`,
      params
    );
    const total = parseInt(countRes.rows[0].count, 10);

    params.push(limit, offset);
    const result = await db.query(`
       SELECT b.*, t.name as technician_name, biz.name as business_name
       FROM bookings b 
       LEFT JOIN technicians t ON b.technician_id = t.id
       JOIN tenants biz ON b.tenant_id = biz.id
       ${where}
       ORDER BY b.${activeSort} ${sortDir}, b.created_at DESC 
       LIMIT $${i++} OFFSET $${i++}`,
      params
    );

    res.json({ 
      bookings: result.rows,
      pagination: { total, limit, offset }
    });
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
    const booking = result.rows[0];

    await logAction({
      organization_id: String(booking.tenant_id),
      user_id: req.user?.sub ? String(req.user.sub) : null,
      action: "booking_updated",
      entity_type: "booking",
      entity_id: String(booking.id),
      new_value: { status: booking.status, technician_id: booking.technician_id },
      ip_address: req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.ip || null,
      user_agent: req.get("user-agent") || null,
    }).catch(() => {});

    if (technician_id != null && technician_id !== "") {
      const tenantId = booking.tenant_id;
      const [tenantResult, techResult] = await Promise.all([
        getTenantById(tenantId),
        db.query("SELECT id, name, email, phone FROM technicians WHERE id = $1", [technician_id]),
      ]);
      const technician = techResult.rows[0];
      const tenant = tenantResult;
      if (technician && tenant) {
        emailService.sendTechnicianAssignmentEmail(tenant, technician, booking).then((r) => {
          if (r.ok) console.log("[Bookings] Technician assignment email sent to", technician.email);
          else console.warn("[Bookings] Technician assignment email failed:", r.error);
        }).catch((e) => console.error("[Bookings] Technician assignment email error:", e));
      }
    }

    if (status === "Completed" && booking.lead_id) {
      const serviceDate = booking.preferred_date
        ? (typeof booking.preferred_date === "string" && booking.preferred_date.includes("T")
            ? booking.preferred_date.slice(0, 10)
            : booking.preferred_date)
        : new Date().toISOString().slice(0, 10);
      await db.query(
        "UPDATE leads SET last_service_date = $1::date, updated_at = now() WHERE id = $2",
        [serviceDate, booking.lead_id]
      ).catch((e) => console.error("[Bookings] Update lead last_service_date:", e));
      nurturingService.schedulePostServiceCampaigns(booking.tenant_id, booking).catch((e) =>
        console.error("[Bookings] Schedule nurturing campaigns:", e)
      );
    }

    res.json(booking);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

// Everything below this requires at least Staff-level access
router.use((req, res, next) => {
  if (!req.user || !['owner', 'admin', 'manager', 'staff'].includes(req.user.role)) {
    return res.status(403).json({ error: "Forbidden — insufficient permissions", code: "INSUFFICIENT_PERMISSIONS" });
  }
  next();
});

router.get("/calls", async (req, res) => {
  try {
    const tenantIds = await getTargetTenantIds(req);
    if (!tenantIds.length) return res.status(400).json({ error: "tenant_id required" });
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
    const offset = parseInt(req.query.offset, 10) || 0;
    const status = req.query.status;
    let q = `
      SELECT c.*, 
             t.name as business_name,
             r.id as recording_id, 
             r.transcript as transcript_preview
      FROM calls c
      JOIN tenants t ON c.tenant_id = t.id
      LEFT JOIN LATERAL (
        SELECT id, transcript 
        FROM recordings 
        WHERE call_id = c.id 
        ORDER BY created_at DESC 
        LIMIT 1
      ) r ON true
      WHERE c.tenant_id = ANY($1)
    `;
    const params = [tenantIds];
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

    await logAction({
      organization_id: String(rec.tenant_id),
      user_id: req.user?.sub ? String(req.user.sub) : null,
      action: "recording_played",
      entity_type: "recording",
      entity_id: String(rec.id),
      new_value: { recording_id: rec.id },
      ip_address: req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.ip || null,
      user_agent: req.get("user-agent") || null,
    }).catch(() => {});

    const tenant = await getTenantById(rec.tenant_id);
    const twilioAuth = require("../lib/twilio").getAuthForTenant(tenant);
    if (!twilioAuth) return res.status(502).json({ error: "Recording service not configured" });

    const url = rec.recording_url.replace(".json", ".mp3");
    const auth = Buffer.from(`${twilioAuth.accountSid}:${twilioAuth.authToken}`).toString("base64");

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

// -------------------- Technicians --------------------

router.get("/technicians", async (req, res) => {
  try {
    const tenantIds = await getTargetTenantIds(req);
    if (!tenantIds.length) return res.status(400).json({ error: "tenant_id required" });
    const result = await db.query(
      "SELECT * FROM technicians WHERE tenant_id = ANY($1) ORDER BY name ASC",
      [tenantIds]
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
    const tenantIds = await getTargetTenantIds(req);
    if (!tenantIds.length) return res.status(400).json({ error: "tenant_id required" });

    const [recoveryRes, followupRes, appointmentRes] = await Promise.all([
     db.query(`
  SELECT er.*, 
          l.estimated_revenue_cents,
          l.name as lead_name,
          l.status as lead_status,
          l.lead_source,
          CASE 
            WHEN er.lead_source = 'missed_call' THEN 'missed_call'
            ELSE 'recovery'
          END as system_type,
          (SELECT MAX(created_at) FROM recovery_touches WHERE recovery_id = er.id) as last_contact,
          EXTRACT(EPOCH FROM (now() - er.created_at)) / 86400.0 as days_waiting
   FROM estimate_recoveries er
   LEFT JOIN leads l ON er.lead_id = l.id
   WHERE er.tenant_id = ANY($1) AND er.status IN ('active', 'paused')`,
  [tenantIds]
),
      db.query(`
        SELECT f.id, f.tenant_id, f.contact_name, f.status,
                f.contact_name as lead_name,
                f.due_at as next_action_at,
                f.follow_up_type as current_step,
                b.estimated_revenue_cents,
                b.lead_source,
                'nurturing' as system_type,
                f.sent_at as last_contact,
                EXTRACT(EPOCH FROM (now() - f.created_at)) / 86400.0 as days_waiting
         FROM follow_ups f
         LEFT JOIN bookings b ON f.booking_id = b.id
         WHERE f.tenant_id = ANY($1) AND f.status = 'pending'`,
        [tenantIds]
      ),
      db.query(`
        SELECT b.id, b.tenant_id, b.contact_name, b.contact_phone, b.status,
                b.contact_name as lead_name,
                b.preferred_date as next_action_at,
                b.appointment_time,
                b.estimated_revenue_cents,
                b.lead_source,
                b.scope, b.job_type, b.address,
                'appointment' as system_type,
                'pre_appointment' as current_step,
                b.created_at as last_contact,
                EXTRACT(EPOCH FROM (now() - b.created_at)) / 86400.0 as days_waiting,
                EXTRACT(EPOCH FROM (b.preferred_date::timestamp - now())) / 86400.0 as days_until_appointment
         FROM bookings b
         WHERE b.tenant_id = ANY($1)
           AND LOWER(b.status) IN ('booked', 'confirmed')
           AND b.preferred_date >= CURRENT_DATE`,
        [tenantIds]
      )
    ]);

    const combined = [
      ...recoveryRes.rows.map(r => ({ ...r, days_waiting: parseFloat(r.days_waiting) || 0 })),
      ...followupRes.rows.map(r => ({ ...r, days_waiting: parseFloat(r.days_waiting) || 0 })),
      ...appointmentRes.rows.map(r => ({
        ...r,
        days_waiting: parseFloat(r.days_waiting) || 0,
        days_until_appointment: parseFloat(r.days_until_appointment) || 0
      }))
    ];
    combined.sort((a, b) => {
      const timeA = new Date(a.next_action_at || '9999-12-31').getTime();
      const timeB = new Date(b.next_action_at || '9999-12-31').getTime();
      return timeA - timeB;
    });

    res.json({ followups: combined });
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
    if (!stepDef) {
      return res.status(400).json({ error: `Invalid current step '${recovery.current_step}' for this follow-up` });
    }
    
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
    if (!stepDef) {
      return res.status(400).json({ error: `Invalid current step '${recovery.current_step}' for this follow-up` });
    }
    
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
    const { status } = req.body;
    const recoveryId = req.params.id;

    if (status === 'booked') {
      await estimateRecovery.markConverted(recoveryId);
      const rec = await estimateRecovery.getRecoveryById(recoveryId);
      if (rec.lead_id) {
        await db.query("UPDATE leads SET status = 'Booked' WHERE id = $1", [rec.lead_id]);
      }
      notificationsService.createNotification(rec.tenant_id, {
        type: 'follow_up_converted',
        title: 'Follow-up Converted',
        body: `Follow-up for ${rec.contact_name} has been successfully converted to a booking.`,
        data: { recoveryId, leadId: rec.lead_id }
      }).catch(e => console.error("Notification error:", e));
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
    let tenantIds = await getTargetTenantIds(req);
    tenantIds = tenantIds.filter(id => /^[0-9a-f-]{36}$/i.test(id));
    if (!tenantIds.length) {
      console.warn(`[Metrics] No valid tenant UUIDs resolved for request. User=${req.user?.sub}`);
      return res.status(400).json({ error: "No valid business location selected" });
    }

    const period = req.query.period || req.query.range || "30d";
    let isRollup = tenantIds.length > 1 || req.query.rollup === 'true';
    console.log(`[Metrics] Request: user=${req.user?.email} targets=[${tenantIds.join(",")}] rollup=${isRollup} period=${period}`);

    let days = 30;
    if (period === '7d') days = 7;
    else if (period === '90d') days = 90;
    else if (period === 'today') days = 1;

    const currentWindow = new Date();
    currentWindow.setDate(currentWindow.getDate() - days);
    const prevWindow = new Date();
    prevWindow.setDate(prevWindow.getDate() - (days * 2));

    const results = await Promise.all([
      db.query(`
        SELECT 
          COUNT(DISTINCT l.id) as leads_generated,
          COUNT(DISTINCT er.id) as estimates_sent,
          COUNT(DISTINCT b.id) as estimates_accepted,
          COALESCE(SUM(b.estimated_revenue_cents), 0) as revenue_booked
         FROM leads l
         LEFT JOIN estimate_recoveries er ON er.lead_id = l.id AND er.created_at > $2
         LEFT JOIN bookings b ON b.lead_id = l.id AND b.created_at > $2
         WHERE l.tenant_id = ANY($1) AND l.created_at > $2`,
        [tenantIds, currentWindow]
      ),
      db.query(`
        SELECT 
          COUNT(DISTINCT l.id) as leads_generated,
          COUNT(DISTINCT er.id) as estimates_sent,
          COUNT(DISTINCT b.id) as estimates_accepted,
          COALESCE(SUM(b.estimated_revenue_cents), 0) as revenue_booked
         FROM leads l
         LEFT JOIN estimate_recoveries er ON er.lead_id = l.id AND er.created_at BETWEEN $2 AND $3
         LEFT JOIN bookings b ON b.lead_id = l.id AND b.created_at BETWEEN $2 AND $3
         WHERE l.tenant_id = ANY($1) AND l.created_at BETWEEN $2 AND $3`,
        [tenantIds, prevWindow, currentWindow]
      ),
      db.query(`
        SELECT 
          COUNT(*) as calls_handled,
          (SELECT COUNT(*) FROM bookings WHERE tenant_id = ANY($1) AND call_id IS NOT NULL AND created_at > $2) as appointments_booked,
          SUM(CASE WHEN disposition = 'booked' OR status ILIKE '%booked%' OR status = 'Estimate Scheduled' THEN 1 ELSE 0 END) as calls_booked,
          SUM(CASE WHEN status = 'FollowUp Needed' OR disposition = 'follow_up' THEN 1 ELSE 0 END) as calls_followup,
          SUM(CASE WHEN transfer_to IS NOT NULL OR disposition = 'transferred' THEN 1 ELSE 0 END) as calls_transferred,
          SUM(CASE WHEN status = 'Spam' THEN 1 ELSE 0 END) as calls_spam,
          SUM(CASE WHEN (disposition IS NULL OR disposition = 'completed') AND transfer_to IS NULL AND status NOT ILIKE '%booked%' AND status != 'Estimate Scheduled' AND status != 'FollowUp Needed' AND status != 'Spam' AND COALESCE(duration_minutes, 0) < 1.0 THEN 1 ELSE 0 END) as calls_hung_up,
          SUM(CASE WHEN (disposition IS NULL OR disposition = 'completed') AND transfer_to IS NULL AND status NOT ILIKE '%booked%' AND status != 'Estimate Scheduled' AND status != 'FollowUp Needed' AND status != 'Spam' AND COALESCE(duration_minutes, 0) >= 1.0 THEN 1 ELSE 0 END) as calls_confused,
          SUM(CASE WHEN (disposition IS NULL OR disposition = 'completed') AND transfer_to IS NULL AND status NOT ILIKE '%booked%' AND status != 'Estimate Scheduled' AND status != 'FollowUp Needed' AND status != 'Spam' AND COALESCE(duration_minutes, 0) < 0.16 THEN 1 ELSE 0 END) as hung_up_10s,
          SUM(CASE WHEN (disposition IS NULL OR disposition = 'completed') AND transfer_to IS NULL AND status NOT ILIKE '%booked%' AND status != 'Estimate Scheduled' AND status != 'FollowUp Needed' AND status != 'Spam' AND COALESCE(duration_minutes, 0) >= 0.16 AND COALESCE(duration_minutes, 0) < 0.5 THEN 1 ELSE 0 END) as hung_up_30s,
          SUM(CASE WHEN (disposition IS NULL OR disposition = 'completed') AND transfer_to IS NULL AND status NOT ILIKE '%booked%' AND status != 'Estimate Scheduled' AND status != 'FollowUp Needed' AND status != 'Spam' AND COALESCE(duration_minutes, 0) >= 0.5 AND COALESCE(duration_minutes, 0) < 1.0 THEN 1 ELSE 0 END) as hung_up_60s,
          SUM(CASE WHEN transcript ILIKE '%can you repeat%' OR transcript ILIKE '%say that again%' THEN 1 ELSE 0 END) as confused_repeat,
          SUM(CASE WHEN transcript ILIKE '%don''t understand%' OR transcript ILIKE '%do not understand%' THEN 1 ELSE 0 END) as confused_understand,
          SUM(CASE WHEN transcript ILIKE '%what did you say%' THEN 1 ELSE 0 END) as confused_what_say,
          SUM(CASE WHEN transcript ILIKE '%huh%' OR transcript ILIKE '%what?%' THEN 1 ELSE 0 END) as confused_huh
         FROM calls 
         WHERE tenant_id = ANY($1) AND started_at > $2`,
        [tenantIds, currentWindow]
      ),
      db.query(`
        SELECT 
          COUNT(*) as calls_handled,
          (SELECT COUNT(*) FROM bookings WHERE tenant_id = ANY($1) AND call_id IS NOT NULL AND created_at BETWEEN $2 AND $3) as appointments_booked,
          SUM(CASE WHEN disposition = 'booked' OR status ILIKE '%booked%' OR status = 'Estimate Scheduled' THEN 1 ELSE 0 END) as calls_booked,
          SUM(CASE WHEN status = 'FollowUp Needed' OR disposition = 'follow_up' THEN 1 ELSE 0 END) as calls_followup,
          SUM(CASE WHEN transfer_to IS NOT NULL OR disposition = 'transferred' THEN 1 ELSE 0 END) as calls_transferred,
          SUM(CASE WHEN status = 'Spam' THEN 1 ELSE 0 END) as calls_spam,
          SUM(CASE WHEN (disposition IS NULL OR disposition = 'completed') AND transfer_to IS NULL AND status NOT ILIKE '%booked%' AND status != 'Estimate Scheduled' AND status != 'FollowUp Needed' AND status != 'Spam' AND COALESCE(duration_minutes, 0) < 1.0 THEN 1 ELSE 0 END) as calls_hung_up,
          SUM(CASE WHEN (disposition IS NULL OR disposition = 'completed') AND transfer_to IS NULL AND status NOT ILIKE '%booked%' AND status != 'Estimate Scheduled' AND status != 'FollowUp Needed' AND status != 'Spam' AND COALESCE(duration_minutes, 0) >= 1.0 THEN 1 ELSE 0 END) as calls_confused,
          SUM(CASE WHEN (disposition IS NULL OR disposition = 'completed') AND transfer_to IS NULL AND status NOT ILIKE '%booked%' AND status != 'Estimate Scheduled' AND status != 'FollowUp Needed' AND status != 'Spam' AND COALESCE(duration_minutes, 0) < 0.16 THEN 1 ELSE 0 END) as hung_up_10s,
          SUM(CASE WHEN (disposition IS NULL OR disposition = 'completed') AND transfer_to IS NULL AND status NOT ILIKE '%booked%' AND status != 'Estimate Scheduled' AND status != 'FollowUp Needed' AND status != 'Spam' AND COALESCE(duration_minutes, 0) >= 0.16 AND COALESCE(duration_minutes, 0) < 0.5 THEN 1 ELSE 0 END) as hung_up_30s,
          SUM(CASE WHEN (disposition IS NULL OR disposition = 'completed') AND transfer_to IS NULL AND status NOT ILIKE '%booked%' AND status != 'Estimate Scheduled' AND status != 'FollowUp Needed' AND status != 'Spam' AND COALESCE(duration_minutes, 0) >= 0.5 AND COALESCE(duration_minutes, 0) < 1.0 THEN 1 ELSE 0 END) as hung_up_60s,
          SUM(CASE WHEN transcript ILIKE '%can you repeat%' OR transcript ILIKE '%say that again%' THEN 1 ELSE 0 END) as confused_repeat,
          SUM(CASE WHEN transcript ILIKE '%don''t understand%' OR transcript ILIKE '%do not understand%' THEN 1 ELSE 0 END) as confused_understand,
          SUM(CASE WHEN transcript ILIKE '%what did you say%' THEN 1 ELSE 0 END) as confused_what_say,
          SUM(CASE WHEN transcript ILIKE '%huh%' OR transcript ILIKE '%what?%' THEN 1 ELSE 0 END) as confused_huh
         FROM calls 
         WHERE tenant_id = ANY($1) AND started_at BETWEEN $2 AND $3`,
        [tenantIds, prevWindow, currentWindow]
      ),
      db.query(`
        SELECT 
          source,
          COUNT(*) as leads,
          COUNT(DISTINCT b_id) as booked,
          CASE WHEN COUNT(*) > 0 THEN ROUND((COUNT(DISTINCT b_id)::numeric / COUNT(*)::numeric) * 100) ELSE 0 END as rate,
          COALESCE(SUM(actual_revenue), 0) as revenue
         FROM (
           SELECT 
             COALESCE(NULLIF(TRIM(lead_source), ''), 'Direct') as source,
             b.id as b_id,
             b.actual_revenue_cents as actual_revenue
           FROM bookings b
           WHERE b.tenant_id = ANY($1) AND b.created_at > $2
           UNION ALL
           SELECT 
             COALESCE(NULLIF(TRIM(lead_source), ''), 'Direct') as source,
             NULL as b_id,
             0 as actual_revenue
           FROM calls c
           WHERE c.tenant_id = ANY($1) AND c.started_at > $2 
             AND c.id NOT IN (SELECT call_id FROM bookings WHERE call_id IS NOT NULL)
           UNION ALL
           SELECT 
             COALESCE(NULLIF(TRIM(lead_source), ''), 'Direct') as source,
             NULL as b_id,
             0 as actual_revenue
           FROM leads l
           WHERE l.tenant_id = ANY($1) AND l.created_at > $2
             AND l.id NOT IN (SELECT lead_id FROM bookings WHERE lead_id IS NOT NULL)
             AND l.id NOT IN (SELECT lead_id FROM calls WHERE lead_id IS NOT NULL)
         ) t
         GROUP BY source
         ORDER BY leads DESC`,
        [tenantIds, currentWindow]
      ),
      db.query(`
        SELECT 
          method,
          COUNT(*) as actions,
          COUNT(DISTINCT b_id) as booked,
          CASE WHEN COUNT(*) > 0 THEN ROUND((COUNT(DISTINCT b_id)::numeric / COUNT(*)::numeric) * 100) ELSE 0 END as rate,
          COALESCE(SUM(actual_revenue), 0) as revenue
         FROM (
           SELECT 'Phone call' as method, b.id as b_id, b.actual_revenue_cents as actual_revenue FROM bookings b JOIN calls c ON b.call_id = c.id WHERE b.tenant_id = ANY($1) AND b.created_at > $2
           UNION ALL
           SELECT 'Phone call' as method, NULL as b_id, 0 as actual_revenue FROM calls WHERE tenant_id = ANY($1) AND started_at > $2 AND id NOT IN (SELECT call_id FROM bookings WHERE call_id IS NOT NULL)
           UNION ALL
           SELECT 'SMS follow-up' as method, b.id as b_id, b.actual_revenue_cents as actual_revenue FROM bookings b JOIN leads l ON b.lead_id = l.id WHERE b.tenant_id = ANY($1) AND b.created_at > $2 AND b.call_id IS NULL AND l.id IN (SELECT lead_id FROM campaign_log WHERE channel = 'sms')
           UNION ALL
           SELECT 'Email' as method, b.id as b_id, b.actual_revenue_cents as actual_revenue FROM bookings b JOIN leads l ON b.lead_id = l.id WHERE b.tenant_id = ANY($1) AND b.created_at > $2 AND b.call_id IS NULL AND l.id IN (SELECT lead_id FROM campaign_log WHERE channel = 'email')
           UNION ALL
           SELECT 'Website chat' as method, b.id as b_id, b.actual_revenue_cents as actual_revenue FROM bookings b JOIN leads l ON b.lead_id = l.id WHERE b.tenant_id = ANY($1) AND b.created_at > $2 AND b.call_id IS NULL AND b.lead_source ILIKE '%chat%'
         ) t
         GROUP BY method
         ORDER BY actions DESC`,
        [tenantIds, currentWindow]
      ),
      // ── FIX 1: avg_job_value now falls back to estimated_revenue_cents
      // ── FIX 2: total_recoveries counts estimate_recovery rows directly (not via lead join)
      db.query(`
        SELECT
          COALESCE(
            NULLIF(AVG(b.actual_revenue_cents), 0),
            AVG(b.estimated_revenue_cents)
          ) as avg_job_value,
          COALESCE(AVG(EXTRACT(EPOCH FROM (b.created_at - l.created_at))/60), 0) as avg_time_to_book,
          (SELECT COUNT(*) FROM estimate_recoveries WHERE tenant_id = ANY($1) AND status = 'converted' AND created_at > $2) as recovered_count,
          (SELECT COUNT(*) FROM estimate_recoveries WHERE tenant_id = ANY($1) AND created_at > $2) as total_recoveries
         FROM bookings b
         JOIN leads l ON b.lead_id = l.id
         WHERE b.tenant_id = ANY($1) AND b.created_at > $2`,
        [tenantIds, currentWindow]
      ),
      db.query(`
        SELECT 
          d.day::date as date,
          COUNT(l.id) as leads,
          COUNT(b.id) as bookings
         FROM generate_series(now() - interval '6 days', now(), interval '1 day') d(day)
         LEFT JOIN leads l ON l.tenant_id = ANY($1) AND l.created_at::date = d.day::date
         LEFT JOIN bookings b ON b.tenant_id = ANY($1) AND b.created_at::date = d.day::date
         GROUP BY d.day
         ORDER BY d.day ASC`,
        [tenantIds]
      ),
      db.query(`
        SELECT
          (SELECT COUNT(*) FROM calls WHERE tenant_id = ANY($1) AND started_at >= now() - interval '24 hours') as calls,
          (SELECT COUNT(*) FROM estimate_recoveries WHERE tenant_id = ANY($1) AND status = 'converted' AND updated_at >= now() - interval '24 hours') as recovered,
          (SELECT COUNT(*) FROM leads WHERE tenant_id = ANY($1) AND created_at >= now() - interval '24 hours') as leads,
          (SELECT COUNT(*) FROM bookings WHERE tenant_id = ANY($1) AND created_at >= now() - interval '24 hours') as booked`,
        [tenantIds]
      ),
      // ── FIX (Apr 17, 2026): actual_revenue now sums from BOTH bookings AND leads tables,
      //     because /webhooks/crm/job-won writes revenue to leads.actual_revenue_cents,
      //     while earlier flows write to bookings.actual_revenue_cents.
      //     The NOT IN subquery prevents double-counting when a lead has both a revenue
      //     value AND an associated booking row that also has revenue.
      //     Also updated confirmed_jobs count to include leads with revenue (not just bookings),
      //     so the "confirmed jobs" tile matches reality.
      db.query(`
        SELECT
          (SELECT COUNT(*) FROM leads WHERE tenant_id = ANY($1) AND status NOT IN ('Closed', 'Lost')) as open_leads,
          (SELECT COUNT(*) FROM leads WHERE tenant_id = ANY($1) AND status = 'New') as leads_needing_followup,
          (SELECT COUNT(*) FROM bookings WHERE tenant_id = ANY($1) AND LOWER(status) IN ('booked', 'confirmed', 'scheduled')) as jobs_scheduled,
          (
            (SELECT COUNT(*) FROM bookings WHERE tenant_id = ANY($1) AND (LOWER(status) IN ('completed') OR actual_revenue_cents > 0))
            +
            (SELECT COUNT(*) FROM leads WHERE tenant_id = ANY($1) 
               AND (LOWER(status) = 'won' OR actual_revenue_cents > 0)
               AND id NOT IN (
                 SELECT lead_id FROM bookings
                 WHERE lead_id IS NOT NULL
                   AND (LOWER(status) IN ('completed') OR actual_revenue_cents > 0)
               ))
          ) as confirmed_jobs,
          COALESCE(
            (SELECT SUM(estimated_revenue_cents) FROM leads WHERE tenant_id = ANY($1) AND status NOT IN ('Closed', 'Lost') AND estimated_revenue_cents > 0),
            0
          ) + COALESCE(
            (SELECT SUM(estimated_revenue_cents) FROM bookings WHERE tenant_id = ANY($1) AND LOWER(status) IN ('booked', 'confirmed', 'scheduled') AND lead_id IS NULL AND estimated_revenue_cents > 0),
            0
          ) as estimated_revenue,
          (SELECT SUM(estimated_revenue_cents) FROM bookings WHERE tenant_id = ANY($1) AND LOWER(status) IN ('cancelled', 'lost', 'rejected', 'lost lead')) as lost_revenue,
          (
            COALESCE(
              (SELECT SUM(actual_revenue_cents)
               FROM bookings 
               WHERE tenant_id = ANY($1) 
                 AND actual_revenue_cents IS NOT NULL 
                 AND actual_revenue_cents > 0),
              0
            )
            +
            COALESCE(
              (SELECT SUM(actual_revenue_cents)
               FROM leads 
               WHERE tenant_id = ANY($1) 
                 AND actual_revenue_cents IS NOT NULL 
                 AND actual_revenue_cents > 0
                 AND id NOT IN (
                   SELECT lead_id FROM bookings 
                   WHERE lead_id IS NOT NULL 
                     AND actual_revenue_cents IS NOT NULL 
                     AND actual_revenue_cents > 0
                 )),
              0
            )
          ) as actual_revenue`,
        [tenantIds]
      ),
      db.query(`
        SELECT
          (SELECT COUNT(*) FROM campaign_log WHERE tenant_id = ANY($1) AND sent_at > $2) as emails_sent,
          (SELECT COUNT(*) FROM referral_leads WHERE tenant_id = ANY($1) AND created_at > $2) as referrals_generated`,
        [tenantIds, currentWindow]
      ),
      // ── FIX (Apr 17, 2026): location rollup total_revenue now also adds per-tenant
      //     revenue from the leads table (with NOT IN dedup against bookings), so HQ
      //     rollups match the single-tenant Confirmed Revenue tile.
      isRollup ? db.query(`
        SELECT 
          t.id, t.name, t.city, t.state, t.business_type,
          (SELECT COUNT(*) FROM calls c WHERE c.tenant_id = t.id AND c.started_at > $2) as total_calls,
          (SELECT COUNT(*) FROM bookings b WHERE b.tenant_id = t.id AND b.created_at > $2) as total_bookings,
          (
            COALESCE(
              (SELECT SUM(COALESCE(b.actual_revenue_cents, b.estimated_revenue_cents, 0))
               FROM bookings b WHERE b.tenant_id = t.id AND b.created_at > $2 AND LOWER(b.status) NOT IN ('cancelled','lost','rejected')),
              0
            )
            +
            COALESCE(
              (SELECT SUM(l.actual_revenue_cents)
               FROM leads l 
               WHERE l.tenant_id = t.id 
                 AND l.actual_revenue_cents IS NOT NULL 
                 AND l.actual_revenue_cents > 0
                 AND l.id NOT IN (
                   SELECT lead_id FROM bookings 
                   WHERE lead_id IS NOT NULL 
                     AND actual_revenue_cents IS NOT NULL 
                     AND actual_revenue_cents > 0
                 )),
              0
            )
          ) as total_revenue,
          (SELECT COUNT(*) FROM leads l WHERE l.tenant_id = t.id AND l.status NOT IN ('Closed', 'Lost')) as open_leads
         FROM tenants t
         WHERE t.id = ANY($1)
         ORDER BY t.name ASC`,
        [tenantIds, currentWindow]
      ) : Promise.resolve({ rows: [] })
    ]);

    const salesStats         = results[0];
    const salesStatsPrev     = results[1];
    const aiStats            = results[2];
    const aiStatsPrev        = results[3];
    const sourceStats        = results[4];
    const contactMethodStats = results[5];
    const opsStats           = results[6];
    const trendStats         = results[7];
    const todayStats         = results[8];
    const pipelineStats      = results[9];
    const nurturingStats     = results[10];
    const locationStats      = results[11];

    const sales       = salesStats.rows[0]     || { leads_generated: 0, estimates_sent: 0, estimates_accepted: 0, revenue_booked: 0 };
    const salesPrev   = salesStatsPrev.rows[0] || { leads_generated: 0, estimates_sent: 0, estimates_accepted: 0, revenue_booked: 0 };
    const ai          = aiStats.rows[0]        || { calls_handled: 0, appointments_booked: 0 };
    const aiPrev      = aiStatsPrev.rows[0]    || { calls_handled: 0, appointments_booked: 0 };
    const pipeline    = pipelineStats.rows[0]  || { open_leads: 0, leads_needing_followup: 0, jobs_scheduled: 0 };
    const nurturingRow = nurturingStats.rows[0] || { emails_sent: 0, referrals_generated: 0 };

    const getTrend = (curr, prev) => {
      if (!prev || prev == 0) return curr > 0 ? 100 : 0;
      return Math.round(((curr - prev) / prev) * 100);
    };

    const location_breakdown = isRollup ? locationStats.rows.map(r => ({
      id: r.id,
      name: r.name,
      city: r.city || "Local",
      state: r.state || "",
      isHQ: r.business_type === 'parent',
      calls: parseInt(r.total_calls, 10),
      bookings: parseInt(r.total_bookings, 10),
      revenue: parseInt(r.total_revenue, 10),
      openLeads: parseInt(r.open_leads, 10),
      rate: r.total_calls > 0 ? Math.round((r.total_bookings / r.total_calls) * 100) : 0
    })) : [];

    const insights = [];
    if (isRollup) {
      location_breakdown.forEach(loc => {
        if (loc.rate < 40 && loc.calls > 10) {
          insights.push({
            id: `low-rate-${loc.id}`,
            text: `${loc.name} — booking rate below 40%`,
            action: 'Review AI instructions',
            link: `/settings/ai?tenantId=${loc.id}`
          });
        }
        if (loc.openLeads > 40) {
          insights.push({
            id: `high-leads-${loc.id}`,
            text: `${loc.name} — ${loc.openLeads} open leads needing follow-up`,
            action: 'Trigger follow-up',
            link: `/pipeline?tenantId=${loc.id}`
          });
        }
      });
    }

    // ── FIX: followup_conv now uses direct recovery count (not lead-joined count)
    //         which prevents inflated percentages like 400%
    const recoveredCount   = parseInt(opsStats.rows[0]?.recovered_count  || 0, 10);
    const totalRecoveries  = parseInt(opsStats.rows[0]?.total_recoveries || 0, 10);
    const followupConv     = totalRecoveries > 0
      ? Math.min(Math.round((recoveredCount / totalRecoveries) * 100), 100)
      : 0;

    // ── FIX: avg_job_value uses estimated_revenue_cents fallback
    const rawAvgJobValue = parseFloat(opsStats.rows[0]?.avg_job_value || 0);
    const avgJobValue    = Math.round(rawAvgJobValue);

    res.json({
      period: "30d",
      isRollup,
      totals: {
        calls: parseInt(ai.calls_handled, 10),
        calls_trend: getTrend(parseInt(ai.calls_handled, 10), parseInt(aiPrev.calls_handled, 10)),
        booking_rate: ai.calls_handled > 0 ? Math.round((parseInt(ai.appointments_booked, 10) / parseInt(ai.calls_handled, 10)) * 100) : 0,
        booking_rate_trend: getTrend(
          ai.calls_handled > 0 ? (parseInt(ai.appointments_booked, 10) / parseInt(ai.calls_handled, 10)) : 0,
          aiPrev.calls_handled > 0 ? (parseInt(aiPrev.appointments_booked, 10) / parseInt(aiPrev.calls_handled, 10)) : 0
        ),
        revenue: parseInt(sales.revenue_booked, 10),
        revenue_trend: getTrend(parseInt(sales.revenue_booked, 10), parseInt(salesPrev.revenue_booked, 10)),
        open_leads: parseInt(pipeline.open_leads, 10),
        leads_needing_followup: parseInt(pipeline.leads_needing_followup, 10)
      },
      sales: {
        leads_generated: parseInt(sales.leads_generated, 10),
        close_rate: sales.leads_generated > 0 ? Math.round((parseInt(sales.estimates_accepted, 10) / parseInt(sales.leads_generated, 10)) * 100) : 0,
        estimates_accepted: parseInt(sales.estimates_accepted, 10),
        revenue_booked: parseInt(sales.revenue_booked, 10)
      },
      ai: {
        calls_handled: parseInt(ai.calls_handled, 10),
        ai_success_rate: ai.calls_handled > 0 ? Math.round((parseInt(ai.appointments_booked, 10) / parseInt(ai.calls_handled, 10)) * 100) : 0,
        appointments_booked: parseInt(ai.appointments_booked, 10),
        missed_calls_recovered: parseInt(todayStats.rows[0].recovered || 0, 10),
        calls_booked: parseInt(ai.calls_booked || 0, 10),
        calls_followup: parseInt(ai.calls_followup || 0, 10),
        calls_transferred: parseInt(ai.calls_transferred || 0, 10),
        calls_spam: parseInt(ai.calls_spam || 0, 10),
        calls_hung_up: parseInt(ai.calls_hung_up || 0, 10),
        calls_confused: parseInt(ai.calls_confused || 0, 10),
        hung_up_10s: parseInt(ai.hung_up_10s || 0, 10),
        hung_up_30s: parseInt(ai.hung_up_30s || 0, 10),
        hung_up_60s: parseInt(ai.hung_up_60s || 0, 10),
        confused_repeat: parseInt(ai.confused_repeat || 0, 10),
        confused_understand: parseInt(ai.confused_understand || 0, 10),
        confused_what_say: parseInt(ai.confused_what_say || 0, 10),
        confused_huh: parseInt(ai.confused_huh || 0, 10),
      },
      aiPrev: {
        calls_handled: parseInt(aiPrev.calls_handled || 0, 10),
        appointments_booked: parseInt(aiPrev.appointments_booked || 0, 10),
        calls_booked: parseInt(aiPrev.calls_booked || 0, 10),
        calls_followup: parseInt(aiPrev.calls_followup || 0, 10),
        calls_transferred: parseInt(aiPrev.calls_transferred || 0, 10),
        calls_spam: parseInt(aiPrev.calls_spam || 0, 10),
        calls_hung_up: parseInt(aiPrev.calls_hung_up || 0, 10),
        calls_confused: parseInt(aiPrev.calls_confused || 0, 10),
        hung_up_10s: parseInt(aiPrev.hung_up_10s || 0, 10),
        hung_up_30s: parseInt(aiPrev.hung_up_30s || 0, 10),
        hung_up_60s: parseInt(aiPrev.hung_up_60s || 0, 10),
        confused_repeat: parseInt(aiPrev.confused_repeat || 0, 10),
        confused_understand: parseInt(aiPrev.confused_understand || 0, 10),
        confused_what_say: parseInt(aiPrev.confused_what_say || 0, 10),
        confused_huh: parseInt(aiPrev.confused_huh || 0, 10),
      },
      today: {
        calls: parseInt(todayStats.rows[0].calls || 0, 10),
        recovered: parseInt(todayStats.rows[0].recovered || 0, 10),
        leads: parseInt(todayStats.rows[0].leads || 0, 10),
        booked: parseInt(todayStats.rows[0].booked || 0, 10)
      },
      pipeline: {
        open_estimates: parseInt(pipeline.open_leads || 0, 10),
        jobs_scheduled: parseInt(pipeline.jobs_scheduled || 0, 10),
        confirmed_jobs: parseInt(pipeline.confirmed_jobs || 0, 10),
        estimated_revenue: parseInt(pipeline.estimated_revenue || 0, 10),
        lost_revenue: parseInt(pipeline.lost_revenue || 0, 10),
        actual_revenue: pipeline.actual_revenue != null ? parseInt(pipeline.actual_revenue, 10) : null
      },
      metrics: {
        sources: sourceStats.rows.map(r => ({
          label: r.source,
          leads: parseInt(r.leads, 10),
          booked: parseInt(r.booked, 10),
          rate: parseInt(r.rate, 10),
          revenue: parseInt(r.revenue, 10)
        })),
        methods: contactMethodStats.rows.map(r => ({
          label: r.label || r.method,
          leads: parseInt(r.actions || r.leads, 10),
          booked: parseInt(r.booked, 10),
          rate: parseInt(r.rate, 10),
          revenue: parseInt(r.revenue, 10)
        })),
        ops: {
          avg_job_value: avgJobValue,
          avg_time_to_book: Math.round(parseInt(opsStats.rows[0]?.avg_time_to_book || 0, 10)),
          recovered_count: recoveredCount,
          followup_conv: followupConv,
        }
      },
      location_breakdown,
      insights,
      sources: sourceStats.rows.map(r => ({
        label: r.source,
        leads: parseInt(r.leads, 10),
        booked: parseInt(r.booked, 10),
        revenue: parseInt(r.revenue, 10)
      })),
      trends: trendStats.rows.map(r => ({
        date: r.date,
        leads: parseInt(r.leads, 10),
        bookings: parseInt(r.bookings, 10)
      })),
      nurturing: {
        emails_sent: parseInt(nurturingRow.emails_sent, 10),
        referrals_generated: parseInt(nurturingRow.referrals_generated, 10)
      },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/activity-feed", async (req, res) => {
  try {
    const tenantIds = await getTargetTenantIds(req);
    if (!tenantIds.length) return res.status(400).json({ error: "tenant_id required" });

    const [calls, bookings, recoveries, followUps] = await Promise.all([
      db.query(
        "SELECT c.id, c.started_at as at, 'call' as type, c.disposition, c.transferred, t.name as business_name FROM calls c JOIN tenants t ON c.tenant_id = t.id WHERE c.tenant_id = ANY($1) ORDER BY c.started_at DESC LIMIT 15",
        [tenantIds]
      ),
      db.query(
        "SELECT b.id, b.created_at as at, 'booking' as type, b.contact_name, b.status, t.name as business_name FROM bookings b JOIN tenants t ON b.tenant_id = t.id WHERE b.tenant_id = ANY($1) ORDER BY b.created_at DESC LIMIT 15",
        [tenantIds]
      ),
      db.query(
        "SELECT er.id, er.updated_at as at, 'recovery' as type, er.status, er.contact_name, t.name as business_name FROM estimate_recoveries er JOIN tenants t ON er.tenant_id = t.id WHERE er.tenant_id = ANY($1) ORDER BY er.updated_at DESC LIMIT 15",
        [tenantIds]
      ),
      db.query(
        "SELECT f.id, f.created_at as at, 'follow_up' as type, f.follow_up_type, f.status, t.name as business_name FROM follow_ups f JOIN tenants t ON f.tenant_id = t.id WHERE f.tenant_id = ANY($1) ORDER BY f.created_at DESC LIMIT 15",
        [tenantIds]
      ),
    ]);

    const isRollup = tenantIds.length > 1;
    const events = [
      ...calls.rows.map(r => ({
        id: r.id, at: r.at, type: "call",
        text: (r.transferred ? "AI transferred call to human" : (r.disposition === 'booked' ? "AI booked appointment on call" : "AI answered call")) + (isRollup ? ` (${r.business_name})` : "")
      })),
      ...bookings.rows.map(r => ({
        id: r.id, at: r.at, type: "booking",
        text: (r.status === 'scheduled' ? `Appointment booked: ${r.contact_name || 'Lead'}` : `Lead captured: ${r.contact_name || 'Lead'}`) + (isRollup ? ` (${r.business_name})` : "")
      })),
      ...recoveries.rows.map(r => ({
        id: r.id, at: r.at, type: "recovery",
        text: (r.status === 'converted' ? `Missed call recovered: ${r.contact_name || 'Lead'}` : `Recovery sequence active: ${r.contact_name || 'Lead'}`) + (isRollup ? ` (${r.business_name})` : "")
      })),
      ...followUps.rows.map(r => ({
        id: r.id, at: r.at, type: "follow_up",
        text: `SMS followup sent: ${r.follow_up_type}` + (isRollup ? ` (${r.business_name})` : "")
      }))
    ];

    events.sort((a, b) => new Date(b.at) - new Date(a.at));
    res.json({ feed: events.slice(0, 25) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

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
const TENANT_SELECT_BASE = `t.id, t.name, t.slug, t.company_name, t.timezone, t.welcome_message,t.voice_welcome_message, t.chat_welcome_message, t.instructions, t.transfer_numbers, t.transfer_sms_brief, t.crm_webhook_url, t.crm_type, t.follow_up_enabled, t.plan, t.facebook_page_id, t.facebook_page_access_token, t.tone_of_voice, t.objection_handling_config, t.business_hours, t.afterhours_behavior, t.google_calendar_linked, t.google_calendar_id, t.google_calendar_email, t.zapier_webhook_url, t.api_key, t.website, t.voice_model, t.faqs, t.plan_overrides, t.promo_label, t.logo_url, t.nurturing_enabled, t.referral_enabled, t.seasonal_campaigns_enabled, t.maintenance_reminder_months, t.reengagement_reminder_months, t.referral_request_days_after_service, t.nurturing_campaign_calendar, t.maintenance_touchpoints, t.reengagement_touchpoints, t.parent_id, t.business_type, t.default_lead_source, t.brand_color, t.brand_mode, t.inbound_voice, t.outbound_voice, t.outbound_agent_name, t.outbound_instructions, t.accent_color, t.favicon_url, t.support_email, t.account_type, t.parent_mode, t.billing_owner, t.reseller_tier, t.reseller_code, t.reseller_customer_limit, t.reseller_wholesale_rate_cents, t.reseller_id, t.billing_responsibility, t.ai_master_enabled, t.ai_answers_after_hours, t.ring_first_enabled, t.ring_first_phone, t.ring_first_timeout_seconds, t.voicemail_message_url`;
const TENANT_SELECT_BASE_LEGACY = `t.id, t.name, t.slug, t.company_name, t.welcome_message, t.instructions, t.transfer_numbers, t.transfer_sms_brief, t.crm_webhook_url, t.crm_type, t.follow_up_enabled, t.parent_id, t.business_type`;

router.get("/tenants/:id", async (req, res) => {
  try {
    let id = req.params.id;
    if (id === "all") {
      if (req.user?.tenant_id) {
        id = req.user.tenant_id;
      } else {
        return res.status(400).json({ error: "Target ID required for details" });
      }
    }

    const r = await db.query(`
      SELECT ${TENANT_SELECT_BASE}, ${TENANT_SELECT_TWILIO},
       (SELECT json_agg(json_build_object('phone', pn.phone, 'is_primary', pn.is_primary)) FROM phone_numbers pn WHERE pn.tenant_id = t.id) as phones FROM tenants t WHERE t.id = $1`,
      [id]
    );
    const tenant = r.rows[0];
    if (!tenant) return res.status(404).json({ error: "Not found" });

    if (req.user?.tenant_id && req.user.tenant_id !== tenant.id && !req.user.is_super_admin) {
      if (req.user.tenant_business_type !== 'parent' || tenant.parent_id !== req.user.tenant_id) {
        return res.status(403).json({ error: "Forbidden — insufficient permissions to access this location" });
      }
    }

    const masked = { ...tenant };
    masked.twilio_account_sid_masked = maskTwilioSid(tenant.twilio_account_sid);
    masked.facebook_token_masked = maskFacebookToken(tenant.facebook_page_access_token);
    masked.api_key_masked = tenant.api_key ? tenant.api_key.substring(0, 4) + "..." + tenant.api_key.slice(-4) : null;
    masked.has_twilio_credentials = !!(tenant.twilio_account_sid && tenant.twilio_auth_token);
    masked.has_nurturing_referral = hasNurturingReferralAccess(tenant);
    delete masked.twilio_account_sid;
    delete masked.twilio_auth_token;
    delete masked.facebook_page_access_token;

    res.json(masked);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/tenants", async (req, res) => {
  try {
    const userTenantId = req.user?.tenant_id;
    let query = `SELECT ${TENANT_SELECT_BASE}, (SELECT json_agg(json_build_object('phone', pn.phone, 'is_primary', pn.is_primary)) FROM phone_numbers pn WHERE pn.tenant_id = t.id) as phones FROM tenants t ORDER BY t.name`;
    let params = [];
    
    if (userTenantId) {
      console.log(`[GET /tenants] user tenant_id=${userTenantId}, business_type=${req.user.tenant_business_type}, parent_id=${req.user.tenant_parent_id}`);
      if (req.user.tenant_business_type === 'parent') {
        query = `SELECT ${TENANT_SELECT_BASE}, (SELECT json_agg(json_build_object('phone', pn.phone, 'is_primary', pn.is_primary)) FROM phone_numbers pn WHERE pn.tenant_id = t.id) as phones FROM tenants t WHERE t.id = $1 OR t.parent_id = $1 ORDER BY (CASE WHEN t.id = $1 THEN 0 ELSE 1 END), t.name`;
      } else {
        query = `SELECT ${TENANT_SELECT_BASE}, (SELECT json_agg(json_build_object('phone', pn.phone, 'is_primary', pn.is_primary)) FROM phone_numbers pn WHERE pn.tenant_id = t.id) as phones FROM tenants t WHERE t.id = $1`;
      }
      params = [userTenantId];
    }

    const r = await db.query(query, params);
    const tenants = r.rows.map(t => {
      const masked = { ...t };
      masked.twilio_account_sid_masked = maskTwilioSid(t.twilio_account_sid);
      masked.api_key_masked = t.api_key ? t.api_key.substring(0, 4) + "..." + t.api_key.slice(-4) : null;
      masked.has_twilio_credentials = !!(t.twilio_account_sid && t.twilio_auth_token);
      masked.has_nurturing_referral = hasNurturingReferralAccess(t);
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
    const body = req.body || {};
    const businessType = body.business_type || 'standalone';
    const parentId = body.parent_id || null;

    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    
    if (userTenantId) {
      if (req.user.tenant_business_type === 'parent' && parentId === userTenantId) {
        // Allowed
      } else {
        return res.status(400).json({ error: "You already have a business. Use Settings or the Businesses page to manage it." });
      }
    }
    const name = body.name || "";
    const company_name = body.company_name || body.companyName || "";
    const slugInput = body.slug;
    const companyName = (company_name || name || "").trim();
    const displayName = (name || company_name || "").trim();
    if (!displayName && !companyName) {
      return res.status(400).json({ error: "Business name or company name is required" });
    }

    const byotSid = (body.twilio_account_sid || "").trim();
    const byotToken = (body.twilio_auth_token || "").trim();
    const manualPhone = body.phone || body.phone_number || "";

    let phone = null;
    let twilioSid = null;
    let isByot = !!(byotSid && byotToken);

    if (isByot && manualPhone) {
      phone = normalizePhoneInput(manualPhone);
      if (!phone) {
        return res.status(400).json({ error: "A valid phone number is required for BYOT (e.g. +18076055898 or 8076055898)" });
      }
    } else if (body.assigned_number || body.phone || body.phone_number) {
      try {
        let numberToBuy = body.assigned_number;
        if (!numberToBuy) {
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

    if (phone) {
      const phoneExists = await db.query("SELECT id FROM phone_numbers WHERE phone = $1", [phone]);
      if (phoneExists.rows.length > 0) {
        return res.status(409).json({ error: "This phone number is already assigned to another business." });
      }
    }

    const finalName = displayName || companyName;
    const finalCompany = companyName || displayName;
    const slug = (slugInput || finalName).toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
    if (!slug) return res.status(400).json({ error: "Could not generate a valid slug from the business name" });
    const existing = await db.query("SELECT id FROM tenants WHERE slug = $1", [slug]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: "A business with this slug already exists. Try a different name." });
    }
    const insert = await db.query(
      "INSERT INTO tenants (name, slug, company_name, business_type, parent_id) VALUES ($1, $2, $3, $4, $5) RETURNING id, name, slug, company_name, business_type, parent_id",
      [finalName, slug, finalCompany, businessType, parentId]
    );
    const tenant = insert.rows[0];

    if (isByot) {
      await db.query(
        "UPDATE tenants SET twilio_account_sid = $1, twilio_auth_token = $2, updated_at = now() WHERE id = $3",
        [byotSid, byotToken, tenant.id]
      );
    }

    if (phone) {
      const phoneRow = await db.query(
        "INSERT INTO phone_numbers (tenant_id, phone, is_primary, twilio_sid) VALUES ($1, $2, false, $3) RETURNING id",
        [tenant.id, phone, twilioSid]
      );
      const tenantForTwilio = await getTenantById(tenant.id);
      const webhookResult = await configurePhoneWebhook(phone, tenant.id, tenantForTwilio);
      if (webhookResult.success) {
        if (webhookResult.twilioSid && !twilioSid) {
          await db.query("UPDATE phone_numbers SET twilio_sid = $1, updated_at = now() WHERE id = $2", [webhookResult.twilioSid, phoneRow.rows[0].id]);
        }
      } else {
        console.warn("[Onboarding] Could not configure webhook for %s: %s", phone, webhookResult.error);
      }
    }

    if (!userTenantId) {
      await db.query(
        "UPDATE dashboard_users SET tenant_id = $1, role = $2, updated_at = now() WHERE id = $3",
        [tenant.id, "admin", userId]
      );
    }

    const effectiveTenantId = userTenantId || tenant.id;
    const newToken = auth.signToken({
      sub: userId,
      email: req.user.email,
      tenant_id: effectiveTenantId,
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
      tenant: { ...tenant, phones: phone ? [{ phone, is_primary: true }] : [] },
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

    const checkResult = await db.query("SELECT parent_id FROM tenants WHERE id = $1", [id]);
    const targetTenant = checkResult.rows[0];
    if (!targetTenant) return res.status(404).json({ error: "Tenant not found" });

    if (req.user?.tenant_id && req.user.tenant_id !== id && !req.user.is_super_admin) {
      if (req.user.tenant_business_type !== 'parent' || targetTenant.parent_id !== req.user.tenant_id) {
        return res.status(403).json({ error: "Forbidden — insufficient permissions to modify this location" });
      }
    }

  let allowed = [
      "name", "company_name", "timezone", "website", "logo_url",
      "welcome_message", "voice_welcome_message", "chat_welcome_message", "instructions", "transfer_numbers", "transfer_sms_brief",
      "crm_webhook_url", "crm_type", "follow_up_enabled", "plan", 
      "twilio_account_sid", "twilio_auth_token", "facebook_page_id", "facebook_page_access_token",
      "tone_of_voice", "objection_handling_config", "business_hours", "afterhours_behavior", 
      "google_calendar_linked", "google_calendar_id", "zapier_webhook_url",
      "voice_model", "faqs", "inbound_voice", "outbound_voice", "outbound_agent_name", "outbound_instructions",
      "brand_color", "brand_mode", "accent_color", "favicon_url", "support_email",
      "nurturing_enabled", "referral_enabled", "seasonal_campaigns_enabled",
      "maintenance_reminder_months", "reengagement_reminder_months", "referral_request_days_after_service",
      "nurturing_campaign_calendar",
      "maintenance_touchpoints", "reengagement_touchpoints",
      // AI Control (mig 040) — tenant-wide routing fields. Apr 23, 2026.
      "ai_master_enabled", "ai_answers_after_hours",
      "ring_first_enabled", "ring_first_phone", "ring_first_timeout_seconds",
      "voicemail_message_url"
    ];
   
    try {
      await db.query("SELECT twilio_account_sid FROM tenants WHERE id = $1 LIMIT 1", [id]);
    } catch (colErr) {
      if (colErr.code === "42703") {
        allowed = allowed.filter((k) => k !== "twilio_account_sid" && k !== "twilio_auth_token");
      } else throw colErr;
    }
    // ── AI Control validation (mig 040, tenant-wide routing) ─────────
    // Validate the 6 AI Control fields UP FRONT before the generic
    // update loop runs. We do this before the generic loop so that
    // (a) validation errors return clean 400s instead of raw 500s
    // from Postgres CHECK constraints, and (b) the cross-field rule
    // (ring_first_enabled=true REQUIRES ring_first_phone) is enforced
    // at the API layer. The DB CHECK is still the last line of defense,
    // but this path gives the UI actionable error messages.
    const body = req.body || {};

    // ring_first_phone — must be E.164 (+1XXXXXXXXXX). Accept loose
    // input and normalize. Passing null/empty clears it.
    if (body.ring_first_phone !== undefined && body.ring_first_phone !== null && body.ring_first_phone !== "") {
      const normalized = normalizePhoneInput(body.ring_first_phone);
      if (!normalized) {
        return res.status(400).json({
          error: "ring_first_phone must be a valid US phone number (e.g. +14025551234 or 402-555-1234)"
        });
      }
      body.ring_first_phone = normalized;
    } else if (body.ring_first_phone === "" || body.ring_first_phone === null) {
      body.ring_first_phone = null;
    }

    // ring_first_timeout_seconds — must be integer 5–60
    if (body.ring_first_timeout_seconds !== undefined && body.ring_first_timeout_seconds !== null) {
      const n = Number(body.ring_first_timeout_seconds);
      if (!Number.isInteger(n) || n < 5 || n > 60) {
        return res.status(400).json({
          error: "ring_first_timeout_seconds must be an integer between 5 and 60"
        });
      }
      body.ring_first_timeout_seconds = n;
    }

    // voicemail_message_url — HTTPS only, must end in .mp3 or .wav
    if (body.voicemail_message_url !== undefined && body.voicemail_message_url !== null && body.voicemail_message_url !== "") {
      const s = String(body.voicemail_message_url).trim();
      if (!/^https:\/\//i.test(s)) {
        return res.status(400).json({ error: "voicemail_message_url must start with https://" });
      }
      if (!/\.(mp3|wav)(\?.*)?$/i.test(s)) {
        return res.status(400).json({ error: "voicemail_message_url must point to an .mp3 or .wav file" });
      }
      if (s.length > 2000) {
        return res.status(400).json({ error: "voicemail_message_url is too long (max 2000 chars)" });
      }
      body.voicemail_message_url = s;
    } else if (body.voicemail_message_url === "" || body.voicemail_message_url === null) {
      body.voicemail_message_url = null;
    }

    // Cross-field rule: if ring_first_enabled is being set to true,
    // ring_first_phone must be present either in this request OR
    // already on the tenant row. Matches DB constraint
    // tenants_ring_first_phone_required.
    if (body.ring_first_enabled === true) {
      const existingRow = await db.query(
        "SELECT ring_first_phone FROM tenants WHERE id = $1",
        [id]
      );
      const existingPhone = existingRow.rows[0]?.ring_first_phone;
      const incomingPhone = body.ring_first_phone; // may be undefined, null, or string
      const willHavePhone =
        incomingPhone !== undefined
          ? incomingPhone != null
          : existingPhone != null;
      if (!willHavePhone) {
        return res.status(400).json({
          error: "ring_first_phone is required when ring_first_enabled is true"
        });
      }
    }
    // ───────────────────────────────────────────────────────────────

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
      } else if (key === "brand_mode") {
        // Whitelist matches the DB CHECK constraint added Apr 19. Anything
        // outside these two values would fail the constraint anyway, but
        // validating here gives a clean 400 instead of a Postgres 500.
        // TODO: when Pro customers go live, gate this behind
        // req.user.is_super_admin so tenants can't self-upgrade to white_label
        // without paying the $29/mo add-on.
        const m = (req.body[key] || "").toString();
        if (!["ai_branded", "white_label"].includes(m)) {
          return res.status(400).json({ error: "brand_mode must be ai_branded or white_label" });
        }
        updates[key] = m;
      } else {
        updates[key] = req.body[key];
      }
    }
    if (Object.keys(updates).length === 0) return res.status(400).json({ error: "No allowed fields to update" });
    const nurturingKeys = ["nurturing_enabled", "referral_enabled", "seasonal_campaigns_enabled", "maintenance_reminder_months", "reengagement_reminder_months", "referral_request_days_after_service", "nurturing_campaign_calendar", "maintenance_touchpoints", "reengagement_touchpoints"];
    const hasNurturingUpdate = Object.keys(updates).some((k) => nurturingKeys.includes(k));
    if (hasNurturingUpdate) {
      const current = await db.query("SELECT id, plan, plan_overrides FROM tenants WHERE id = $1", [id]).then((r) => r.rows[0]);
      if (!current || !hasNurturingReferralAccess(current)) {
        return res.status(403).json({ error: "Customer Nurturing & Referral is available on Elite or as an add-on. Upgrade your plan to enable." });
      }
    }
    const set = Object.keys(updates).map((k, i) => `${k} = $${i + 1}`).join(", ");
    const values = Object.keys(updates).map((k) => {
      const v = updates[k];
      if (["transfer_numbers", "business_hours", "objection_handling_config", "faqs", "nurturing_campaign_calendar", "maintenance_touchpoints", "reengagement_touchpoints"].includes(k)) {
        return typeof v === "object" ? JSON.stringify(v) : v;
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
      r = await db.query(`
        SELECT ${TENANT_SELECT_BASE}, ${TENANT_SELECT_TWILIO},
         (SELECT json_agg(json_build_object('phone', pn.phone, 'is_primary', pn.is_primary)) FROM phone_numbers pn WHERE pn.tenant_id = t.id) as phones FROM tenants t WHERE t.id = $1`,
        [id]
      );
    } catch (colErr) {
      if (colErr.code === "42703") {
        r = await db.query(`
          SELECT ${TENANT_SELECT_BASE_LEGACY}, ${TENANT_SELECT_TWILIO}
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
    out.has_nurturing_referral = hasNurturingReferralAccess(out);

    await logAction({
      organization_id: String(id),
      user_id: req.user?.sub ? String(req.user.sub) : null,
      action: "settings_updated",
      entity_type: "settings",
      entity_id: String(id),
      new_value: updates,
      ip_address: req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.ip || null,
      user_agent: req.get("user-agent") || null,
    }).catch(() => {});

   res.json(out);
  } catch (e) {
    // DB CHECK constraint violations — SQLSTATE 23514. Map the
    // known mig 040 constraint names to user-friendly messages so
    // the Settings UI can surface them on save. Anything we don't
    // recognize falls through to the generic 500 path.
    if (e.code === "23514") {
      const name = e.constraint || "";
      const errorMap = {
        tenants_ring_first_phone_format:
          "ring_first_phone must be in E.164 format (e.g. +14025551234)",
        tenants_ring_first_timeout_range:
          "ring_first_timeout_seconds must be between 5 and 60",
        tenants_ring_first_phone_required:
          "ring_first_phone is required when ring_first_enabled is true",
        tenants_voicemail_url_format:
          "voicemail_message_url must be an HTTPS URL under 2000 characters",
      };
      if (errorMap[name]) {
        console.warn("[PATCH /tenants] CHECK constraint '%s' violated: %s", name, e.message);
        return res.status(400).json({ error: errorMap[name] });
      }
      // Unknown constraint — log raw and give a generic 400.
      console.warn("[PATCH /tenants] Unrecognized CHECK constraint:", name, e.message);
      return res.status(400).json({ error: "One of the values you provided isn't allowed." });
    }
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

// -------------------- Twilio Utility Endpoints --------------------

router.get("/twilio/available-numbers", async (req, res) => {
  try {
    const areaCode = req.query.area_code || null;
    const limit = parseInt(req.query.limit, 10) || 10;
    const owned = await getOwnedUnassignedNumbers(db, areaCode);
    const available = await fetchAvailableNumbers(areaCode, limit);
    const combined = [
      ...owned,
      ...available.filter(n => !owned.some(o => o.phoneNumber === n.phoneNumber))
    ].slice(0, limit + owned.length);
    res.json({ numbers: combined });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not fetch available numbers from Twilio." });
  }
});

// -------------------- Phone Numbers --------------------

router.get("/phone-numbers", async (req, res) => {
  try {
    const tenantIds = await getTargetTenantIds(req);
    if (!tenantIds.length) return res.status(400).json({ error: "tenant_id required" });
    const result = await db.query(
      `SELECT id, tenant_id, phone, is_primary, lead_source, created_at,
              twilio_sid, ai_status, ring_first_enabled, ring_first_phone,
              ring_first_timeout_seconds, business_hours_enabled, voicemail_message_url
         FROM phone_numbers
        WHERE tenant_id = ANY($1)
        ORDER BY is_primary DESC, created_at`,
      [tenantIds]
    );
    res.json({ phone_numbers: result.rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

// ══════════════════════════════════════════════════════════════════════
// Build 1 (Apr 23, 2026) — helpers for validating the AI scheduling +
// ring-first fields that migration 039 added to phone_numbers. Shared by
// POST /phone-numbers (create) and PATCH /phone-numbers/:id (update).
//
// Each helper returns { ok: true, value } on success or
// { ok: false, error: "<msg>" } on failure. The caller translates failures
// into 400 responses. Kept as plain helpers (not a class) to match the
// rest of this file's style.
// ══════════════════════════════════════════════════════════════════════

function validateAiStatus(raw) {
  if (raw == null) return { ok: true, value: undefined };
  const v = String(raw).toLowerCase();
  if (v !== "on" && v !== "off") {
    return { ok: false, error: "ai_status must be 'on' or 'off'" };
  }
  return { ok: true, value: v };
}

function validateRingFirstTimeout(raw) {
  if (raw == null || raw === "") return { ok: true, value: undefined };
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 5 || n > 60) {
    return { ok: false, error: "ring_first_timeout_seconds must be an integer between 5 and 60" };
  }
  return { ok: true, value: n };
}

/**
 * Ring-first destination. Accepts E.164 input OR loose human formats
 * (dashed, parens, leading 1), reusing the existing normalizePhoneInput
 * helper so users don't need to type the `+` themselves. Passing null or
 * empty string clears the field.
 */
function validateRingFirstPhone(raw) {
  if (raw == null || raw === "") return { ok: true, value: null };
  const normalized = normalizePhoneInput(raw);
  if (!normalized) {
    return { ok: false, error: "ring_first_phone must be a valid US phone number (e.g. +14025551234 or 402-555-1234)" };
  }
  return { ok: true, value: normalized };
}

/**
 * Voicemail URL — must be HTTPS (Twilio refuses http:// <Play> sources)
 * and end in .mp3 or .wav. Empty string or null clears the field.
 */
function validateVoicemailUrl(raw) {
  if (raw == null || raw === "") return { ok: true, value: null };
  const s = String(raw).trim();
  if (!/^https:\/\//i.test(s)) {
    return { ok: false, error: "voicemail_message_url must start with https://" };
  }
  if (!/\.(mp3|wav)(\?.*)?$/i.test(s)) {
    return { ok: false, error: "voicemail_message_url must point to an .mp3 or .wav file" };
  }
  if (s.length > 2000) {
    return { ok: false, error: "voicemail_message_url is too long (max 2000 chars)" };
  }
  return { ok: true, value: s };
}

/**
 * Build the SET clause + values array for phone_numbers UPDATE/INSERT of
 * the Build 1 fields. Also enforces the cross-field rule that matches
 * the DB CHECK constraint (ring_first_enabled=true REQUIRES ring_first_phone
 * to be set — either in the request OR already present on the row).
 *
 * existingRow is the current DB state (for PATCH) or null (for POST).
 * Returns { ok, fields: { col: value, ... }, error? }.
 */
function collectRoutingFields(body, existingRow) {
  const out = {};

  // ai_status
  if (body.ai_status !== undefined) {
    const r = validateAiStatus(body.ai_status);
    if (!r.ok) return { ok: false, error: r.error };
    out.ai_status = r.value;
  }

  // ring_first_enabled (boolean, no validator needed beyond coercion)
  let ringFirstEnabledIncoming;
  if (body.ring_first_enabled !== undefined) {
    out.ring_first_enabled = !!body.ring_first_enabled;
    ringFirstEnabledIncoming = out.ring_first_enabled;
  }

  // ring_first_phone
  let ringFirstPhoneIncoming;
  if (body.ring_first_phone !== undefined) {
    const r = validateRingFirstPhone(body.ring_first_phone);
    if (!r.ok) return { ok: false, error: r.error };
    out.ring_first_phone = r.value;
    ringFirstPhoneIncoming = r.value;
  }

  // ring_first_timeout_seconds
  if (body.ring_first_timeout_seconds !== undefined) {
    const r = validateRingFirstTimeout(body.ring_first_timeout_seconds);
    if (!r.ok) return { ok: false, error: r.error };
    if (r.value !== undefined) out.ring_first_timeout_seconds = r.value;
  }

  // business_hours_enabled (boolean)
  if (body.business_hours_enabled !== undefined) {
    out.business_hours_enabled = !!body.business_hours_enabled;
  }

  // voicemail_message_url
  if (body.voicemail_message_url !== undefined) {
    const r = validateVoicemailUrl(body.voicemail_message_url);
    if (!r.ok) return { ok: false, error: r.error };
    out.voicemail_message_url = r.value;
  }

  // Cross-field rule: if ring-first is being enabled, there must be a
  // destination phone EITHER in this request OR already on the row.
  // Matches the DB CHECK constraint phone_numbers_ring_first_phone_required
  // so we fail fast in the 400 path instead of hitting a Postgres 23514.
  const willBeEnabled =
    ringFirstEnabledIncoming !== undefined
      ? ringFirstEnabledIncoming
      : existingRow?.ring_first_enabled === true;

  const willHavePhone =
    ringFirstPhoneIncoming !== undefined
      ? ringFirstPhoneIncoming != null
      : existingRow?.ring_first_phone != null;

  if (willBeEnabled && !willHavePhone) {
    return {
      ok: false,
      error: "ring_first_phone is required when ring_first_enabled is true",
    };
  }

  return { ok: true, fields: out };
}

router.post("/phone-numbers", async (req, res) => {
  try {
    const tenantId = getTenantIdFromQuery(req);
    if (!tenantId) return res.status(400).json({ error: "tenant_id required" });

    const tenant = await db.query(
      "SELECT plan, extra_numbers_count FROM tenants WHERE id = $1",
      [tenantId]
    ).then((r) => r.rows[0]);

    const countRes = await db.query("SELECT COUNT(*) FROM phone_numbers WHERE tenant_id = $1", [tenantId]);
    const currentCount = parseInt(countRes.rows[0].count, 10);

    const { getPlan } = require("../lib/plans");
    const planDef = getPlan(tenant.plan || "basic");
    const planLimit = planDef.numberLimit || 1;
    const extraLimit = tenant.extra_numbers_count || 0;
    const totalLimit = planLimit + extraLimit;

    if (currentCount >= totalLimit) {
      return res.status(403).json({
        error: `Phone number limit reached. Your '${tenant.plan || "basic"}' plan includes ${planLimit} number(s) plus ${extraLimit} purchased extra(s). Total allowed: ${totalLimit}.`,
        limit_reached: true,
        current_plan: tenant.plan || "basic",
        plan_limit: planLimit,
        extra_limit: extraLimit,
        total_limit: totalLimit,
      });
    }

    const phone = normalizePhoneInput(req.body?.phone);
    const lead_source = req.body?.lead_source || req.body?.label || null;
    const setPrimary = !!req.body?.is_primary;
    const isOwned = !!req.body?.is_owned;

    if (!phone) {
      return res.status(400).json({ error: "A valid phone number is required (e.g. +14025551234)" });
    }

    const existing = await db.query("SELECT id, tenant_id FROM phone_numbers WHERE phone = $1", [phone]);
    if (existing.rows.length > 0) {
      const owner = existing.rows[0].tenant_id;
      if (owner === tenantId) {
        return res.status(409).json({ error: "This number is already added to your business." });
      }
      return res.status(409).json({ error: "This phone number is already assigned to another business." });
    }

    // Build 1: collect the routing fields from the body. existingRow=null
    // because this is a fresh create. Safe to include even when all fields
    // are omitted — the helper just returns {}.
    const routing = collectRoutingFields(req.body || {}, null);
    if (!routing.ok) {
      return res.status(400).json({ error: routing.error });
    }

    const isPurchasable = !!req.body?.is_purchasable;
    if (isPurchasable && !isOwned) {
      try {
        await purchaseNewNumber(phone);
      } catch (err) {
        return res.status(503).json({ error: "Failed to purchase number: " + err.message });
      }
    }

    if (setPrimary) {
      await db.query(
        "UPDATE phone_numbers SET is_primary = false, updated_at = now() WHERE tenant_id = $1",
        [tenantId]
      );
    }

    const tenantForTwilio = await getTenantById(tenantId);
    const webhookResult = await configurePhoneWebhook(phone, tenantId, tenantForTwilio);

    // Base INSERT columns — the existing ones that have always been here.
    // Then dynamically append any Build 1 routing fields the caller provided.
    const insertCols = ["tenant_id", "phone", "is_primary", "twilio_sid", "lead_source"];
    const insertVals = [
      tenantId,
      phone,
      setPrimary,
      webhookResult.success ? (webhookResult.twilioSid || null) : null,
      lead_source,
    ];
    for (const [col, val] of Object.entries(routing.fields)) {
      insertCols.push(col);
      insertVals.push(val);
    }
    const placeholders = insertVals.map((_, i) => `$${i + 1}`).join(", ");
    const returningCols = [
      "id", "tenant_id", "phone", "is_primary", "twilio_sid", "lead_source", "created_at",
      "ai_status", "ring_first_enabled", "ring_first_phone", "ring_first_timeout_seconds",
      "business_hours_enabled", "voicemail_message_url",
    ].join(", ");

    const result = await db.query(
      `INSERT INTO phone_numbers (${insertCols.join(", ")})
       VALUES (${placeholders})
       RETURNING ${returningCols}`,
      insertVals
    );

    res.status(201).json({
      ...result.rows[0],
      webhook_configured: webhookResult.success,
      warning: webhookResult.success ? null : "Number added, but could not be configured in Twilio (External Number)",
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

// -------------------- Estimate Recoveries --------------------

router.get("/sales-wins", async (req, res) => {
  try {
    const tenantIds = await getTargetTenantIds(req);
    if (!tenantIds.length) return res.status(400).json({ error: "tenant_id required" });
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
    const result = await db.query(
      "SELECT * FROM estimate_recoveries WHERE tenant_id = ANY($1) AND status = 'converted' ORDER BY updated_at DESC LIMIT $2",
      [tenantIds, limit]
    );
    res.json({ sales_wins: result.rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/recoveries/stats", async (req, res) => {
  try {
    const tenantIds = await getTargetTenantIds(req);
    if (!tenantIds.length) return res.status(400).json({ error: "tenant_id required" });
    const stats = await estimateRecovery.getRecoveryStats(tenantIds);
    res.json(stats);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

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

router.patch("/phone-numbers/:id", async (req, res) => {
  try {
    const tenantId = getTenantIdFromQuery(req);
    if (!tenantId) return res.status(400).json({ error: "tenant_id required" });

    const { is_primary, lead_source, label } = req.body || {};
    const finalSource = lead_source || label;
    const phoneId = req.params.id;

    // Read the full row up-front so collectRoutingFields can enforce
    // cross-field rules (e.g. enabling ring-first when the row already
    // has a destination phone set). Also doubles as the ownership check.
    const existingResult = await db.query(
      `SELECT id, tenant_id, ai_status, ring_first_enabled, ring_first_phone,
              ring_first_timeout_seconds, business_hours_enabled, voicemail_message_url
         FROM phone_numbers
        WHERE id = $1 AND tenant_id = $2`,
      [phoneId, tenantId]
    );
    if (existingResult.rows.length === 0) {
      return res.status(404).json({ error: "Phone number not found" });
    }
    const existingRow = existingResult.rows[0];

    // ── Build 1: validate routing fields BEFORE doing any writes ──────
    const routing = collectRoutingFields(req.body || {}, existingRow);
    if (!routing.ok) {
      return res.status(400).json({ error: routing.error });
    }

    // ── Legacy behavior: primary-flip and lead_source updates ─────────
    if (is_primary === true) {
      await db.query(
        "UPDATE phone_numbers SET is_primary = false, updated_at = now() WHERE tenant_id = $1",
        [tenantId]
      );
      await db.query(
        "UPDATE phone_numbers SET is_primary = true, updated_at = now() WHERE id = $1",
        [phoneId]
      );
    } else if (is_primary === false) {
      // Only clear primary on the target row. Don't touch siblings — that
      // would leave the tenant with no primary at all.
      await db.query(
        "UPDATE phone_numbers SET is_primary = false, updated_at = now() WHERE id = $1",
        [phoneId]
      );
    }

    if (finalSource !== undefined) {
      await db.query(
        "UPDATE phone_numbers SET lead_source = $1, updated_at = now() WHERE id = $2",
        [finalSource, phoneId]
      );
    }

    // ── Build 1 routing field updates ─────────────────────────────────
    // Build a single UPDATE covering whichever subset the caller provided.
    // Keeps the write atomic and avoids a flurry of small UPDATEs.
    const routingKeys = Object.keys(routing.fields);
    if (routingKeys.length > 0) {
      const setParts = routingKeys.map((k, i) => `${k} = $${i + 1}`);
      setParts.push(`updated_at = now()`);
      const values = routingKeys.map((k) => routing.fields[k]);
      values.push(phoneId);
      await db.query(
        `UPDATE phone_numbers SET ${setParts.join(", ")} WHERE id = $${values.length}`,
        values
      );
    }

    // Return the fresh row so the UI can update optimistic state
    const freshResult = await db.query(
      `SELECT id, tenant_id, phone, is_primary, lead_source, created_at, updated_at,
              ai_status, ring_first_enabled, ring_first_phone, ring_first_timeout_seconds,
              business_hours_enabled, voicemail_message_url
         FROM phone_numbers
        WHERE id = $1`,
      [phoneId]
    );

    res.json({ success: true, phone_number: freshResult.rows[0] });
  } catch (e) {
    // Surface DB CHECK constraint violations as 400 instead of 500 so the
    // UI can show a useful message. Postgres uses SQLSTATE 23514 for these.
    if (e.code === "23514") {
      console.warn("[PATCH phone_numbers] CHECK constraint violated:", e.message);
      return res.status(400).json({
        error: "One of the values you provided isn't allowed. Check ring-first phone format, timeout range (5-60), or ai_status (on/off).",
      });
    }
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/recoveries/:id/convert", async (req, res) => {
  try {
    await estimateRecovery.markConverted(req.params.id);
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

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

    const result = await db.query(`
      SELECT l.id, l.name, l.phone, l.status, l.metadata as lead_metadata,
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
    const result = await db.query(`
      SELECT 'message' as type, id, channel, direction, body as content, created_at as at, metadata
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

    const checkResult = await db.query("SELECT parent_id FROM tenants WHERE id = $1", [id]);
    const targetTenant = checkResult.rows[0];
    if (!targetTenant) return res.status(404).json({ error: "Tenant not found" });

    if (req.user?.tenant_id && req.user.tenant_id !== id && !req.user.is_super_admin) {
      if (req.user.tenant_business_type !== 'parent' || targetTenant.parent_id !== req.user.tenant_id) {
        return res.status(403).json({ error: "Forbidden — insufficient permissions to reset this location's API key" });
      }
    }

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

// --- Notifications ---
router.get("/notifications", async (req, res) => {
  try {
    const tenantIds = await getTargetTenantIds(req);
    if (tenantIds.length === 0) return res.status(400).json({ error: "tenant_id required" });
    const limit = parseInt(req.query.limit, 10) || 20;
    const q = `
      SELECT * FROM notifications 
      WHERE tenant_id = ANY($1) AND read = FALSE 
      ORDER BY created_at DESC 
      LIMIT $2
    `;
    const result = await db.query(q, [tenantIds, limit]);
    res.json({ notifications: result.rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/notifications/:id/read", async (req, res) => {
  try {
    const tenantId = getTenantIdFromQuery(req);
    const notification = await notificationsService.markAsRead(req.params.id, tenantId);
    if (!notification) return res.status(404).json({ error: "Not found or unauthorized" });
    res.json({ success: true, notification });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/notifications/mark-all-read", async (req, res) => {
  try {
    const tenantId = getTenantIdFromQuery(req);
    const result = await notificationsService.markAllAsRead(tenantId);
    res.json({ success: true, count: result.count });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

// ═════════════════════════════════════════════════════════════════════════
// LOCATION BILLING ENDPOINTS (Apr 19, 2026)
// Multi-location support for parent tenants. Four endpoints:
//   POST   /tenants/:parentId/locations/preview  — modal preview math
//   POST   /tenants/:parentId/locations          — create new child location
//   DELETE /tenants/:parentId/locations/:childId — remove child (immediate
//                                                  deactivation, 30-day data
//                                                  retention, no refund)
//   PATCH  /tenants/:parentId/locations/:childId — update child name/phone
//                                                  (or rate override if super)
//
// Auth model:
//   - Caller must be member of the PARENT tenant with role owner/admin,
//     OR be super-admin
//   - HQ removal blocked (childId === parentId)
//   - rate override edits (locations_*_rate_cents, plan_*_override_cents)
//     restricted to super-admin
// ═════════════════════════════════════════════════════════════════════════

/** Verify the caller can manage this parent's locations. Throws 403 if not. */
function ensureCanManageLocations(req, parentTenantId) {
  if (req.user?.is_super_admin) return true;
  if (req.user?.tenant_id !== parentTenantId) {
    const err = new Error("You don't have access to this parent tenant");
    err.statusCode = 403;
    throw err;
  }
  if (!["owner", "admin"].includes(req.user?.role)) {
    const err = new Error("Only owners and admins can manage locations");
    err.statusCode = 403;
    throw err;
  }
  return true;
}

/** Generate a URL-safe random invite token (43 chars, ~256 bits of entropy). */
function generateInviteToken() {
  return crypto.randomBytes(32).toString("base64url");
}

/**
 * POST /tenants/:parentId/locations/preview
 * Body: { billing_responsibility?: 'parent_pays' | 'self_pays', plan?: string }
 * Returns prorated preview math. Used by the "Add Location" modal so the
 * parent sees what they'll be charged BEFORE confirming.
 *
 * No writes. Safe to call repeatedly.
 */
router.post("/tenants/:parentId/locations/preview", async (req, res) => {
  try {
    const parentId = req.params.parentId;
    ensureCanManageLocations(req, parentId);

    const parentResult = await db.query("SELECT * FROM tenants WHERE id = $1", [parentId]);
    const parent = parentResult.rows[0];
    if (!parent) return res.status(404).json({ error: "Parent tenant not found" });

    // Validate the parent CAN add a location at all (plan tier, HQ tier limit, sub status)
    try {
      await locationBilling.enforceCanAddLocation(parent);
    } catch (err) {
      return res.status(err.statusCode || 400).json({ error: err.message });
    }

    const billingResponsibility = req.body?.billing_responsibility || "parent_pays";
    if (!["parent_pays", "self_pays"].includes(billingResponsibility)) {
      return res.status(400).json({ error: "billing_responsibility must be parent_pays or self_pays" });
    }

    // self_pays only allowed on rollup_only parents (franchise model)
    if (billingResponsibility === "self_pays" && parent.parent_mode !== "rollup_only") {
      return res.status(400).json({
        error: "self_pays is only available on rollup_only parent tenants. Contact support to convert your account.",
      });
    }

    const childPlan = req.body?.plan || "pro";

    const preview = await locationBilling.calculateProratedPreview(
      parent,
      billingResponsibility,
      childPlan
    );

    res.json({
      ok: true,
      parent: {
        id: parent.id,
        name: parent.name,
        company_name: parent.company_name,
        parent_mode: parent.parent_mode,
        plan: parent.plan,
        billing_interval: parent.billing_interval || "monthly",
      },
      preview,
    });
  } catch (e) {
    console.error("[Locations] Preview error:", e);
    res.status(e.statusCode || 500).json({ error: e.message || "Server error" });
  }
});

/**
 * POST /tenants/:parentId/locations
 * Body: {
 *   name: string,                             (required)
 *   company_name?: string,
 *   slug?: string,
 *   billing_responsibility?: 'parent_pays' | 'self_pays',
 *   plan?: 'basic' | 'pro' | 'elite',         (required for self_pays; default 'pro')
 *   franchisee_email?: string,                (required for self_pays — invite goes here)
 *   timezone?: string,
 * }
 *
 * For parent_pays: creates child tenant immediately, syncs to parent's
 * Stripe subscription as a new line item, sends confirmation email.
 *
 * For self_pays: creates child tenant in PENDING state (is_suspended=true,
 * no subscription), generates invite token + 14-day expiry, emails
 * franchisee. Tenant activates on franchisee checkout completion.
 */
router.post("/tenants/:parentId/locations", async (req, res) => {
  try {
    const parentId = req.params.parentId;
    ensureCanManageLocations(req, parentId);

    const parentResult = await db.query("SELECT * FROM tenants WHERE id = $1", [parentId]);
    const parent = parentResult.rows[0];
    if (!parent) return res.status(404).json({ error: "Parent tenant not found" });

    try {
      await locationBilling.enforceCanAddLocation(parent);
    } catch (err) {
      return res.status(err.statusCode || 400).json({ error: err.message });
    }

    const body = req.body || {};
    const name = (body.name || "").trim();
    const companyName = (body.company_name || name || "").trim();
    if (!name && !companyName) {
      return res.status(400).json({ error: "Location name is required" });
    }
    const finalName = name || companyName;
    const finalCompany = companyName || name;

    const billingResponsibility = body.billing_responsibility || "parent_pays";
    if (!["parent_pays", "self_pays"].includes(billingResponsibility)) {
      return res.status(400).json({ error: "billing_responsibility must be parent_pays or self_pays" });
    }

    if (billingResponsibility === "self_pays" && parent.parent_mode !== "rollup_only") {
      return res.status(400).json({
        error: "self_pays is only available on rollup_only parent tenants",
      });
    }

    const childPlan = (body.plan || "pro").toLowerCase();
    if (!["basic", "pro", "elite"].includes(childPlan)) {
      return res.status(400).json({ error: "plan must be basic, pro, or elite" });
    }

    let franchiseeEmail = null;
    if (billingResponsibility === "self_pays") {
      franchiseeEmail = (body.franchisee_email || "").trim().toLowerCase();
      if (!franchiseeEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(franchiseeEmail)) {
        return res.status(400).json({
          error: "franchisee_email is required for self_pays locations and must be a valid email",
        });
      }
    }

    // Generate a unique slug from the name
    let baseSlug = (body.slug || finalName).toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "");
    if (!baseSlug) baseSlug = `location-${Date.now()}`;

    let slug = baseSlug;
    let attempt = 1;
    while (attempt < 20) {
      const existing = await db.query("SELECT id FROM tenants WHERE slug = $1", [slug]);
      if (existing.rows.length === 0) break;
      slug = `${baseSlug}-${attempt}`;
      attempt++;
    }
    if (attempt >= 20) {
      return res.status(409).json({ error: "Could not generate a unique slug. Try a different name." });
    }

    const timezone = body.timezone || parent.timezone || "America/Chicago";

    // Create the child tenant row
    // - parent_pays: active immediately (is_suspended=false)
    // - self_pays: pending until franchisee completes checkout (is_suspended=true)
    const isSelfPays = billingResponsibility === "self_pays";
    const isSuspended = isSelfPays;

    let inviteToken = null;
    let inviteExpiresAt = null;
    if (isSelfPays) {
      inviteToken = generateInviteToken();
      const expires = new Date();
      expires.setDate(expires.getDate() + 14);
      inviteExpiresAt = expires.toISOString();
    }

    const insertResult = await db.query(
      `INSERT INTO tenants (
         name, slug, company_name, business_type, parent_id,
         billing_responsibility, plan, timezone,
         is_suspended, brand_mode,
         franchisee_invite_token, franchisee_invite_expires_at,
         created_at, updated_at
       )
       VALUES ($1, $2, $3, 'location', $4, $5, $6, $7, $8, $9, $10, $11, now(), now())
       RETURNING id, name, slug, company_name, business_type, parent_id,
                 billing_responsibility, plan, timezone, is_suspended, brand_mode,
                 franchisee_invite_token, franchisee_invite_expires_at`,
      [
        finalName,
        slug,
        finalCompany,
        parentId,
        billingResponsibility,
        childPlan,
        timezone,
        isSuspended,
        // Inherit parent's brand_mode (white_label HQ → white_label child)
        parent.brand_mode || "ai_branded",
        inviteToken,
        inviteExpiresAt,
      ]
    );
  const newLocation = insertResult.rows[0];

    // Promote parent to business_type='parent' on first location add.
    // Idempotent — the WHERE clause no-ops if already 'parent'. This gates
    // the LocationSwitcher "All Locations" rollup option on the frontend
    // (tenants.some(t => t.business_type === 'parent')), so without this
    // update any standalone customer adding their first location would
    // have a broken dropdown.
    await db.query(
      "UPDATE tenants SET business_type = 'parent', updated_at = now() WHERE id = $1 AND business_type != 'parent'",
      [parentId]
    );

    // Audit log the creation (use parent_id for org scope)
    await logAction({
      organization_id: String(parentId),
      user_id: req.user?.sub ? String(req.user.sub) : null,
      action: "location_created",
      entity_type: "tenant",
      entity_id: String(newLocation.id),
      new_value: {
        name: finalName,
        slug,
        billing_responsibility: billingResponsibility,
        plan: childPlan,
      },
      ip_address: req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.ip || null,
      user_agent: req.get("user-agent") || null,
    }).catch(() => {});

    // ─── parent_pays branch: Stripe sync + confirmation email ────────────
    if (!isSelfPays) {
      const stripeResult = await locationBilling.addChildToParentSubscription(parent, newLocation);

      // Always record the sync outcome so the retry UI + rollup badges
      // share one source of truth (see migration 036).
      await locationBilling.recordSyncStatus(newLocation.id, stripeResult).catch((err) =>
        console.error("[Locations] recordSyncStatus failed post-create:", err.message)
      );

      if (!stripeResult.ok) {
        console.error(
          "[Locations] Stripe sync FAILED for new location %s under parent %s: %s",
          newLocation.id,
          parentId,
          stripeResult.reason || stripeResult.error
        );
        // Don't 500 — child is created, parent can manually sync later
        // via the retry button. Return 201 with a warning so the UI knows.
        return res.status(201).json({
          ok: true,
          location: newLocation,
          warning: `Location created but Stripe sync failed: ${stripeResult.reason || stripeResult.error}. You can retry from the Locations page.`,
        });
      }

      // Re-read the child row to get the new parent_location_stripe_item_id
      const updatedChildResult = await db.query("SELECT * FROM tenants WHERE id = $1", [newLocation.id]);
      const updatedChild = updatedChildResult.rows[0];

      // Calculate the actual preview values for the confirmation email
      const preview = await locationBilling.calculateProratedPreview(parent, "parent_pays", childPlan);

      // Send confirmation email to parent's owners/admins (fire-and-forget)
      sendLocationAddedEmail({
        parentTenant: parent,
        newLocation: updatedChild,
        proratedTodayCents: preview.proratedTodayCents,
        locationRateCents: preview.locationRateCents,
        nextChargeDate: preview.nextChargeDate,
        newRecurringMonthlyCents: preview.newRecurringMonthlyCents,
      }).catch((e) =>
        console.error("[Locations] sendLocationAddedEmail failed:", e.message)
      );

      return res.status(201).json({
        ok: true,
        location: updatedChild,
        preview,
        stripe: {
          subscription_item_id: stripeResult.subscriptionItemId,
          price_id: stripeResult.priceId,
        },
      });
    }

    // ─── self_pays branch: send franchisee invite email ──────────────────
    const frontendBase = (process.env.FRONTEND_URL || "http://localhost:5173").replace(/\/+$/, "");
    const inviteUrl = `${frontendBase}/franchisee-invite/${inviteToken}`;

    sendFranchiseeInviteEmail({
      parentTenant: parent,
      newLocation,
      franchiseeEmail,
      inviteUrl,
      expiresAt: inviteExpiresAt,
    }).catch((e) =>
      console.error("[Locations] sendFranchiseeInviteEmail failed:", e.message)
    );

    return res.status(201).json({
      ok: true,
      location: newLocation,
      invite: {
        url: inviteUrl,
        sent_to: franchiseeEmail,
        expires_at: inviteExpiresAt,
      },
    });
  } catch (e) {
    console.error("[Locations] Create error:", e);
    res.status(e.statusCode || 500).json({ error: e.message || "Server error" });
  }
});

/**
 * DELETE /tenants/:parentId/locations/:childId
 * Per Apr 19 spec:
 *   1. Mark child location_removed_at = now(), is_suspended = true
 *   2. Set location_data_retention_until = now() + 30 days
 *   3. Remove from parent's Stripe subscription (no refund)
 *   4. Send removal confirmation email
 *   5. HQ removal blocked (childId === parentId returns 400)
 *
 * Daily cron at 3 AM hard-deletes tenant + all data once retention expires.
 */
router.delete("/tenants/:parentId/locations/:childId", async (req, res) => {
  try {
    const parentId = req.params.parentId;
    const childId = req.params.childId;
    ensureCanManageLocations(req, parentId);

    if (childId === parentId) {
      return res.status(400).json({ error: "Cannot remove HQ. Use a different process to close the entire account." });
    }

    const parentResult = await db.query("SELECT * FROM tenants WHERE id = $1", [parentId]);
    const parent = parentResult.rows[0];
    if (!parent) return res.status(404).json({ error: "Parent tenant not found" });

    const childResult = await db.query(
      "SELECT * FROM tenants WHERE id = $1 AND parent_id = $2",
      [childId, parentId]
    );
    const child = childResult.rows[0];
    if (!child) return res.status(404).json({ error: "Location not found under this parent" });

    if (child.location_removed_at) {
      return res.status(409).json({ error: "Location is already pending removal" });
    }

    // Calculate retention timestamp (30 days from now)
    const retentionUntil = new Date();
    retentionUntil.setDate(retentionUntil.getDate() + 30);

    // Mark child as removed + suspended (immediate deactivation per spec)
    await db.query(
      `UPDATE tenants
          SET location_removed_at = now(),
              location_data_retention_until = $1,
              is_suspended = true,
              updated_at = now()
        WHERE id = $2`,
      [retentionUntil.toISOString(), childId]
    );

    // Stripe sync: remove the child's line item from parent's subscription
    // (parent_pays only — self_pays children have their own subscription)
    let stripeWarning = null;
    if (child.billing_responsibility !== "self_pays" && child.parent_location_stripe_item_id) {
      const stripeResult = await locationBilling.removeChildFromParentSubscription(child);
      if (!stripeResult.ok) {
        stripeWarning = `Stripe cleanup failed: ${stripeResult.reason || stripeResult.error}. Bill may need manual adjustment.`;
        console.error(
          "[Locations] Stripe removal FAILED for child %s under parent %s: %s",
          childId, parentId, stripeWarning
        );
      }
    } else if (child.billing_responsibility === "self_pays" && child.stripe_subscription_id) {
      // For self_pays, we cancel the franchisee's own subscription
      try {
        const { stripe } = require("../lib/stripe");
        if (stripe) {
          await stripe.subscriptions.cancel(child.stripe_subscription_id, {
            prorate: false,
          });
          console.log("[Locations] Cancelled self_pays subscription %s for child %s", child.stripe_subscription_id, childId);
        }
      } catch (err) {
        stripeWarning = `Failed to cancel franchisee subscription: ${err.message}. Contact support.`;
        console.error("[Locations] self_pays cancel FAILED for child %s: %s", childId, err.message);
      }
    }

    // Audit log
    await logAction({
      organization_id: String(parentId),
      user_id: req.user?.sub ? String(req.user.sub) : null,
      action: "location_removed",
      entity_type: "tenant",
      entity_id: String(childId),
      new_value: {
        location_removed_at: new Date().toISOString(),
        location_data_retention_until: retentionUntil.toISOString(),
        billing_responsibility: child.billing_responsibility,
      },
      ip_address: req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.ip || null,
      user_agent: req.get("user-agent") || null,
    }).catch(() => {});

    // Send removal confirmation email (fire-and-forget)
    sendLocationRemovalConfirmationEmail({
      parentTenant: parent,
      removedLocation: child,
      dataRetentionUntil: retentionUntil.toISOString(),
    }).catch((e) =>
      console.error("[Locations] sendLocationRemovalConfirmationEmail failed:", e.message)
    );

    res.json({
      ok: true,
      location_id: childId,
      location_removed_at: new Date().toISOString(),
      data_retention_until: retentionUntil.toISOString(),
      warning: stripeWarning,
    });
  } catch (e) {
    console.error("[Locations] Delete error:", e);
    res.status(e.statusCode || 500).json({ error: e.message || "Server error" });
  }
});

/**
 * PATCH /tenants/:parentId/locations/:childId
 * Body: { name?, company_name?, plan?,
 *         locations_monthly_rate_cents?, locations_annual_rate_cents?,
 *         plan_monthly_override_cents?, plan_annual_override_cents? }
 *
 * Standard updates (name, company_name, plan) — any owner/admin
 * Rate overrides (the *_cents fields) — superadmin only
 *
 * If any rate override OR plan changes, syncs to Stripe and sends a
 * rate-change notice email.
 */
router.patch("/tenants/:parentId/locations/:childId", async (req, res) => {
  try {
    const parentId = req.params.parentId;
    const childId = req.params.childId;
    ensureCanManageLocations(req, parentId);

    const parentResult = await db.query("SELECT * FROM tenants WHERE id = $1", [parentId]);
    const parent = parentResult.rows[0];
    if (!parent) return res.status(404).json({ error: "Parent tenant not found" });

    const childResult = await db.query(
      "SELECT * FROM tenants WHERE id = $1 AND parent_id = $2",
      [childId, parentId]
    );
    const child = childResult.rows[0];
    if (!child) return res.status(404).json({ error: "Location not found under this parent" });

    if (child.location_removed_at) {
      return res.status(400).json({ error: "Cannot update a removed location" });
    }

    const body = req.body || {};
    const updates = {};

    // Anyone (owner/admin/superadmin) can update these
    const safeFields = ["name", "company_name", "plan"];
    for (const key of safeFields) {
      if (body[key] !== undefined) {
        if (key === "plan") {
          const p = String(body[key] || "").toLowerCase();
          if (!["basic", "pro", "elite"].includes(p)) {
            return res.status(400).json({ error: "plan must be basic, pro, or elite" });
          }
          updates[key] = p;
        } else {
          updates[key] = body[key];
        }
      }
    }

    // Rate override fields — SUPERADMIN ONLY
    const rateOverrideFields = [
      "locations_monthly_rate_cents",
      "locations_annual_rate_cents",
      "plan_monthly_override_cents",
      "plan_annual_override_cents",
    ];
    let hasRateOverrideEdit = false;
    for (const key of rateOverrideFields) {
      if (body[key] !== undefined) {
        if (!req.user?.is_super_admin) {
          return res.status(403).json({
            error: `Only super-admin can change ${key}. Contact support for rate adjustments.`,
          });
        }
        const val = body[key];
        if (val !== null && (typeof val !== "number" || val < 0 || !Number.isInteger(val))) {
          return res.status(400).json({ error: `${key} must be a non-negative integer (cents) or null` });
        }
        updates[key] = val;
        hasRateOverrideEdit = true;
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: "No allowed fields to update" });
    }

    // Capture old rates BEFORE update for the rate-change email
    const oldMonthlyRate = locationBilling.getChildLocationCostCents(parent, child, "monthly");

    const setClause = Object.keys(updates).map((k, i) => `${k} = $${i + 1}`).join(", ");
    const values = Object.values(updates);
    values.push(childId);
    await db.query(
      `UPDATE tenants SET ${setClause}, updated_at = now() WHERE id = $${values.length}`,
      values
    );

    // Re-read child for fresh values
    const updatedChildResult = await db.query("SELECT * FROM tenants WHERE id = $1", [childId]);
    const updatedChild = updatedChildResult.rows[0];

    // Audit log
    await logAction({
      organization_id: String(parentId),
      user_id: req.user?.sub ? String(req.user.sub) : null,
      action: "location_updated",
      entity_type: "tenant",
      entity_id: String(childId),
      new_value: updates,
      ip_address: req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.ip || null,
      user_agent: req.get("user-agent") || null,
    }).catch(() => {});

  // If rate or plan changed AND child is parent_pays AND has Stripe item → re-sync
    let stripeResult = null;
    let rateChanged = false;
    if (
      (hasRateOverrideEdit || updates.plan) &&
      updatedChild.billing_responsibility !== "self_pays" &&
      updatedChild.parent_location_stripe_item_id
    ) {
      stripeResult = await locationBilling.updateChildSubscriptionRate(parent, updatedChild);

      // Record status so the UI can surface update failures the same way
      // it surfaces create failures.
      await locationBilling.recordSyncStatus(updatedChild.id, stripeResult).catch((err) =>
        console.error("[Locations] recordSyncStatus failed post-update:", err.message)
      );

      const newMonthlyRate = locationBilling.getChildLocationCostCents(parent, updatedChild, "monthly");
      if (newMonthlyRate !== oldMonthlyRate) {
        rateChanged = true;
        // Send rate change notice (30-day notice on increase, immediate on decrease)
        const isIncrease = newMonthlyRate > oldMonthlyRate;
        const effectiveDate = new Date();
        if (isIncrease) {
          // 30-day notice for increases
          effectiveDate.setDate(effectiveDate.getDate() + 30);
        }
        sendLocationRateChangeNoticeEmail({
          parentTenant: parent,
          location: updatedChild,
          oldRateCents: oldMonthlyRate,
          newRateCents: newMonthlyRate,
          effectiveDate: effectiveDate.toISOString(),
          reason: hasRateOverrideEdit ? "admin_override" : "plan_upgrade",
        }).catch((e) =>
          console.error("[Locations] sendLocationRateChangeNoticeEmail failed:", e.message)
        );
      }
    }

    res.json({
      ok: true,
      location: updatedChild,
      rate_changed: rateChanged,
      stripe: stripeResult,
    });
  } catch (e) {
    console.error("[Locations] Update error:", e);
    res.status(e.statusCode || 500).json({ error: e.message || "Server error" });
  }
});

/**
 * POST /tenants/:parentId/locations/:childId/retry-sync
 * Apr 20, 2026 — One-click retry for locations whose Stripe sync previously
 * failed. Calls updateChildSubscriptionRate which handles both cases:
 *   - Child has a stripe item ID → updates price/rate
 *   - Child has no ID           → falls through to addChildToParentSubscription
 *                                  and creates a fresh item
 *
 * Records the outcome via recordSyncStatus so the UI badge flips to synced
 * (or stays failed with a fresh error message) on return.
 *
 * Auth: owner/admin of parent OR super-admin.
 * Preconditions:
 *   - Child must exist under this parent
 *   - Child must not be self_pays (those have their own subscription)
 *   - Child must not be suspended or pending franchisee invite
 *   - Child must not be removed
 */
router.post("/tenants/:parentId/locations/:childId/retry-sync", async (req, res) => {
  try {
    const parentId = req.params.parentId;
    const childId = req.params.childId;
    ensureCanManageLocations(req, parentId);

    const [parentResult, childResult] = await Promise.all([
      db.query("SELECT * FROM tenants WHERE id = $1", [parentId]),
      db.query("SELECT * FROM tenants WHERE id = $1 AND parent_id = $2", [childId, parentId]),
    ]);
    const parent = parentResult.rows[0];
    const child = childResult.rows[0];
    if (!parent) return res.status(404).json({ error: "Parent tenant not found" });
    if (!child) return res.status(404).json({ error: "Location not found under this parent" });

    if (child.location_removed_at) {
      return res.status(400).json({ error: "Cannot retry sync on a removed location" });
    }
    if (child.billing_responsibility === "self_pays") {
      return res.status(400).json({
        error: "Self-pays locations have their own subscription and don't sync to HQ's bill.",
      });
    }

    // updateChildSubscriptionRate handles both "item exists" and "item missing"
    // cases internally — safe to call regardless of current sync state.
    const stripeResult = await locationBilling.updateChildSubscriptionRate(parent, child);

    // Record outcome so the UI badge updates on refresh.
    await locationBilling.recordSyncStatus(childId, stripeResult).catch((err) =>
      console.error("[Locations] recordSyncStatus failed post-retry:", err.message)
    );

    // Audit trail — distinguish retries from other sync attempts so we can
    // grep for "how often are customers hitting the retry button"
    await logAction({
      organization_id: String(parentId),
      user_id: req.user?.sub ? String(req.user.sub) : null,
      action: "location_stripe_retry",
      entity_type: "tenant",
      entity_id: String(childId),
      new_value: {
        ok: !!stripeResult?.ok,
        reason: stripeResult?.reason || null,
        error: stripeResult?.error || null,
      },
      ip_address: req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.ip || null,
      user_agent: req.get("user-agent") || null,
    }).catch(() => {});

    if (!stripeResult?.ok) {
      return res.status(502).json({
        ok: false,
        error: stripeResult?.error || stripeResult?.reason || "Stripe sync failed",
        sync_status: "failed",
      });
    }

    // Re-read child to return the fresh row (with updated stripe_sync_status,
    // stripe_item IDs, etc.) so the UI doesn't need a second round-trip.
    const updatedChildResult = await db.query("SELECT * FROM tenants WHERE id = $1", [childId]);
    res.json({
      ok: true,
      location: updatedChildResult.rows[0],
      sync_status: "synced",
      stripe: {
        subscription_item_id: stripeResult.subscriptionItemId || null,
        price_id: stripeResult.priceId || null,
      },
    });
  } catch (e) {
    console.error("[Locations] Retry sync error:", e);
    res.status(e.statusCode || 500).json({ error: e.message || "Server error" });
  }
});

/**
 * GET /tenants/:parentId/locations
 * Lists all active (non-removed) child locations under a parent. Returns
 * each child's calculated location rate alongside its row, so the UI can
 * display "What this location costs you" without recalculating client-side.
 */
router.get("/tenants/:parentId/locations", async (req, res) => {
  try {
    const parentId = req.params.parentId;
    ensureCanManageLocations(req, parentId);

    const parentResult = await db.query("SELECT * FROM tenants WHERE id = $1", [parentId]);
    const parent = parentResult.rows[0];
    if (!parent) return res.status(404).json({ error: "Parent tenant not found" });

    const children = await locationBilling.listActiveLocations(parentId);
    const enriched = children.map((child) => ({
      ...child,
      location_cost_monthly_cents: locationBilling.getChildLocationCostCents(parent, child, "monthly"),
      location_cost_annual_cents:
        locationBilling.getChildLocationCostCents(parent, child, "annual") * 12,
    }));

    res.json({
      ok: true,
      parent: {
        id: parent.id,
        name: parent.name,
        company_name: parent.company_name,
        parent_mode: parent.parent_mode,
        plan: parent.plan,
      },
      locations: enriched,
      count: enriched.length,
      location_limit: null,
    });
  } catch (e) {
    console.error("[Locations] List error:", e);
    res.status(e.statusCode || 500).json({ error: e.message || "Server error" });
  }
});

/**
 * GET /tenants/:parentId/rollup
 * Apr 20, 2026 — Businesses page rollup dashboard.
 *
 * Returns everything the Businesses page needs in ONE request:
 *   - Parent HQ summary (plan, parent_mode, brand_mode, etc.)
 *   - Aggregated totals across ALL locations (including HQ if operating_hq)
 *     for the last 30 days: calls, bookings, revenue, open leads
 *   - Total MRR that the parent pays for hosting all locations
 *   - Per-location rows with individual 30d stats + cost-to-HQ + status
 *     flags (Stripe sync, suspended, pending franchisee invite)
 *   - Health insights (locations below 40% booking rate, locations with
 *     40+ open leads, locations with failed Stripe sync)
 *
 * Design note: we query ONCE per stat (calls / bookings / revenue) using
 * `WHERE tenant_id = ANY($1)` with the combined parent+children ID list,
 * then GROUP BY tenant_id on the server to build the per-location rows.
 * That's 3 queries total for stats, not N+1.
 *
 * Auth: caller must be owner/admin of the parent OR super-admin.
 */
router.get("/tenants/:parentId/rollup", async (req, res) => {
  try {
    const parentId = req.params.parentId;
    ensureCanManageLocations(req, parentId);

    // 1. Load parent + active children in parallel
    const [parentResult, children] = await Promise.all([
      db.query("SELECT * FROM tenants WHERE id = $1", [parentId]),
      locationBilling.listActiveLocations(parentId),
    ]);

    const parent = parentResult.rows[0];
    if (!parent) return res.status(404).json({ error: "Parent tenant not found" });

    // For operating_hq parents, include HQ itself in the rollup rows.
    // For rollup_only parents, exclude HQ (it doesn't run jobs).
    const includeHQInRollup = parent.parent_mode === "operating_hq";
    const rollupTenants = includeHQInRollup ? [parent, ...children] : [...children];
    const rollupIds = rollupTenants.map((t) => t.id);

    // 30-day window
    const windowStart = new Date();
    windowStart.setDate(windowStart.getDate() - 30);

    // 2. Fire all per-tenant aggregations in parallel
    //    We query the full scope in one shot and GROUP BY tenant_id so the
    //    frontend never does N queries.
    const [
      callsAgg,
      bookingsAgg,
      revenueAgg,
      openLeadsAgg,
    ] = rollupIds.length === 0
      ? [{ rows: [] }, { rows: [] }, { rows: [] }, { rows: [] }]
      : await Promise.all([
          // Calls per tenant (last 30d)
          db.query(
            `SELECT tenant_id,
                    COUNT(*) AS total_calls,
                    SUM(CASE WHEN disposition = 'booked' OR status ILIKE '%booked%' OR status = 'Estimate Scheduled' THEN 1 ELSE 0 END) AS calls_booked
               FROM calls
              WHERE tenant_id = ANY($1) AND started_at > $2
              GROUP BY tenant_id`,
            [rollupIds, windowStart]
          ),
          // Bookings per tenant (last 30d)
          db.query(
            `SELECT tenant_id, COUNT(*) AS total_bookings
               FROM bookings
              WHERE tenant_id = ANY($1) AND created_at > $2
              GROUP BY tenant_id`,
            [rollupIds, windowStart]
          ),
          // Revenue per tenant — mirrors the Dashboard Confirmed Revenue
          // formula (bookings.actual_revenue_cents + leads.actual_revenue_cents
          // with NOT IN dedup). Using the SAME formula means the Businesses
          // page numbers match the dashboard tile exactly.
          db.query(
            `SELECT t.id AS tenant_id,
                    (
                      COALESCE(
                        (SELECT SUM(actual_revenue_cents)
                           FROM bookings
                          WHERE tenant_id = t.id
                            AND actual_revenue_cents IS NOT NULL
                            AND actual_revenue_cents > 0),
                        0
                      )
                      +
                      COALESCE(
                        (SELECT SUM(actual_revenue_cents)
                           FROM leads
                          WHERE tenant_id = t.id
                            AND actual_revenue_cents IS NOT NULL
                            AND actual_revenue_cents > 0
                            AND id NOT IN (
                              SELECT lead_id FROM bookings
                              WHERE lead_id IS NOT NULL
                                AND actual_revenue_cents IS NOT NULL
                                AND actual_revenue_cents > 0
                            )),
                        0
                      )
                    ) AS confirmed_revenue_cents
               FROM tenants t
              WHERE t.id = ANY($1)`,
            [rollupIds]
          ),
          // Open leads per tenant (all time, not windowed — matches Dashboard)
          db.query(
            `SELECT tenant_id, COUNT(*) AS open_leads
               FROM leads
              WHERE tenant_id = ANY($1)
                AND status NOT IN ('Closed', 'Lost')
              GROUP BY tenant_id`,
            [rollupIds]
          ),
        ]);

    // Index query results by tenant_id for O(1) lookup
    const callsByTenant = new Map(
      callsAgg.rows.map((r) => [r.tenant_id, {
        calls: parseInt(r.total_calls, 10) || 0,
        calls_booked: parseInt(r.calls_booked, 10) || 0,
      }])
    );
    const bookingsByTenant = new Map(
      bookingsAgg.rows.map((r) => [r.tenant_id, parseInt(r.total_bookings, 10) || 0])
    );
    const revenueByTenant = new Map(
      revenueAgg.rows.map((r) => [r.tenant_id, parseInt(r.confirmed_revenue_cents, 10) || 0])
    );
    const openLeadsByTenant = new Map(
      openLeadsAgg.rows.map((r) => [r.tenant_id, parseInt(r.open_leads, 10) || 0])
    );

    // 3. Build per-location rows
    const locations = rollupTenants.map((t) => {
      const callStats = callsByTenant.get(t.id) || { calls: 0, calls_booked: 0 };
      const bookings = bookingsByTenant.get(t.id) || 0;
      const revenue = revenueByTenant.get(t.id) || 0;
      const openLeads = openLeadsByTenant.get(t.id) || 0;
      const bookingRate = callStats.calls > 0
        ? Math.round((callStats.calls_booked / callStats.calls) * 100)
        : 0;

      const isHQ = t.id === parent.id;
      const costMonthlyCents = isHQ
        ? 0  // HQ pays its own plan, not a location fee
        : locationBilling.getChildLocationCostCents(parent, t, "monthly");

      // Pending franchisee invite = self_pays + is_suspended + has invite token
      const isPendingInvite = !!(
        t.billing_responsibility === "self_pays" &&
        t.is_suspended &&
        t.franchisee_invite_token
      );

      // Stripe sync failed — now using the explicit column populated by
      // recordSyncStatus() in lib/locationBilling.js. HQ and self_pays
      // locations are never expected to have a parent-sub item, so we
      // ignore their status. (Migration 036 backfilled existing rows.)
      const stripeSyncFailed = !isHQ
        && t.billing_responsibility !== "self_pays"
        && !t.is_suspended
        && t.stripe_sync_status === "failed";

      return {
        id: t.id,
        name: t.name,
        company_name: t.company_name,
        slug: t.slug,
        logo_url: t.logo_url,
        website: t.website,
        business_type: t.business_type,
        is_hq: isHQ,
        plan: t.plan,
        brand_mode: t.brand_mode,
        billing_responsibility: t.billing_responsibility || (isHQ ? "parent_pays" : null),
        is_suspended: !!t.is_suspended,
        is_pending_invite: isPendingInvite,
        stripe_sync_failed: stripeSyncFailed,
        cost_monthly_cents: costMonthlyCents,
        stats_30d: {
          calls: callStats.calls,
          bookings,
          revenue_cents: revenue,
          open_leads: openLeads,
          booking_rate: bookingRate,
        },
      };
    });

    // 4. Calculate HQ summary aggregates
    const totalLocationsCount = children.length; // excludes HQ itself
    const totalMrrToHqCents = locations.reduce((sum, loc) => sum + loc.cost_monthly_cents, 0);
    const totalCalls30d = locations.reduce((sum, loc) => sum + loc.stats_30d.calls, 0);
    const totalBookings30d = locations.reduce((sum, loc) => sum + loc.stats_30d.bookings, 0);
    const totalRevenue30dCents = locations.reduce((sum, loc) => sum + loc.stats_30d.revenue_cents, 0);
    const totalOpenLeads = locations.reduce((sum, loc) => sum + loc.stats_30d.open_leads, 0);
    const combinedBookingRate = totalCalls30d > 0
      ? Math.round((totalBookings30d / totalCalls30d) * 100)
      : 0;

    // 5. Build health insights — actionable flags a franchisor cares about
    const insights = [];
    for (const loc of locations) {
      // Low booking rate (needs >10 calls to avoid noise from new locations)
      if (loc.stats_30d.booking_rate < 40 && loc.stats_30d.calls >= 10) {
        insights.push({
          id: `low-rate-${loc.id}`,
          severity: "warning",
          text: `${loc.name} — booking rate ${loc.stats_30d.booking_rate}% (target 40%+)`,
          location_id: loc.id,
          action: "review_ai",
        });
      }
      // Follow-up backlog
      if (loc.stats_30d.open_leads >= 40) {
        insights.push({
          id: `high-leads-${loc.id}`,
          severity: "warning",
          text: `${loc.name} — ${loc.stats_30d.open_leads} open leads need follow-up`,
          location_id: loc.id,
          action: "trigger_followup",
        });
      }
      // Stripe sync failed — the Apr 19 latent bug we flagged
      if (loc.stripe_sync_failed) {
        insights.push({
          id: `stripe-fail-${loc.id}`,
          severity: "error",
          text: `${loc.name} — Stripe billing sync failed. Remove and re-add to fix.`,
          location_id: loc.id,
          action: "resync_stripe",
        });
      }
      // Pending franchisee invite — not an error, just informational
      if (loc.is_pending_invite) {
        insights.push({
          id: `pending-${loc.id}`,
          severity: "info",
          text: `${loc.name} — waiting on franchisee to complete signup`,
          location_id: loc.id,
          action: "resend_invite",
        });
      }
    }

    res.json({
      ok: true,
      parent: {
        id: parent.id,
        name: parent.name,
        company_name: parent.company_name,
        slug: parent.slug,
        logo_url: parent.logo_url,
        plan: parent.plan,
        parent_mode: parent.parent_mode,
        brand_mode: parent.brand_mode,
        billing_interval: parent.billing_interval || "monthly",
        subscription_status: parent.subscription_status,
      },
      summary: {
        total_locations: totalLocationsCount,
        include_hq_in_rollup: includeHQInRollup,
        total_mrr_to_hq_cents: totalMrrToHqCents,
        total_calls_30d: totalCalls30d,
        total_bookings_30d: totalBookings30d,
        total_revenue_30d_cents: totalRevenue30dCents,
        total_open_leads: totalOpenLeads,
        combined_booking_rate: combinedBookingRate,
      },
      locations,
      insights,
    });
  } catch (e) {
    console.error("[Rollup] Error:", e);
    res.status(e.statusCode || 500).json({ error: e.message || "Server error" });
  }
});

module.exports = router;
