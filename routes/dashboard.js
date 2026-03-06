"use strict";

const { Readable } = require("stream");
const express = require("express");
const db = require("../lib/db");
const auth = require("../lib/auth");
const { getTenantById } = require("../lib/tenant");
const { listPlans } = require("../lib/plans");
const { configurePhoneWebhook, getClientForTenant, purchaseNewNumber, fetchAvailableNumbers } = require("../lib/twilio");

const router = express.Router();

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
    let q = "SELECT * FROM calls WHERE tenant_id = $1";
    const params = [tenantId];
    if (status) {
      params.push(status);
      q += " AND status = $2";
    }
    q += " ORDER BY started_at DESC LIMIT $" + (params.length + 1) + " OFFSET $" + (params.length + 2);
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
      "SELECT * FROM bookings WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT $2",
      [tenantId, limit]
    );
    res.json({ bookings: result.rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/follow-ups", async (req, res) => {
  try {
    const tenantId = getTenantIdFromQuery(req);
    if (!tenantId) return res.status(400).json({ error: "tenant_id required" });
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
    const status = req.query.status;
    let q = "SELECT * FROM follow_ups WHERE tenant_id = $1";
    const params = [tenantId];
    if (status) {
      params.push(status);
      q += " AND status = $2";
    }
    q += " ORDER BY due_at DESC LIMIT $" + (params.length + 1);
    params.push(limit);
    const result = await db.query(q, params);
    res.json({ follow_ups: result.rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/metrics", async (req, res) => {
  try {
    const tenantId = getTenantIdFromQuery(req);
    if (!tenantId) return res.status(400).json({ error: "tenant_id required" });

    const [
      totalCalls,
      bookedCalls,
      transferredCalls,
      revenue,
      byDisposition,
    ] = await Promise.all([
      db.query(
        "SELECT COUNT(*) as count FROM calls WHERE tenant_id = $1 AND started_at > now() - interval '30 days'",
        [tenantId]
      ),
      db.query(
        "SELECT COUNT(DISTINCT c.id) as count FROM calls c JOIN bookings b ON b.call_id = c.id WHERE c.tenant_id = $1 AND c.started_at > now() - interval '30 days'",
        [tenantId]
      ),
      db.query(
        "SELECT COUNT(*) as count FROM calls WHERE tenant_id = $1 AND transferred = true AND started_at > now() - interval '30 days'",
        [tenantId]
      ),
      db.query(
        "SELECT COALESCE(SUM(revenue_cents), 0) as cents FROM bookings WHERE tenant_id = $1 AND created_at > now() - interval '30 days'",
        [tenantId]
      ),
      db.query(
        `SELECT disposition, COUNT(*) as count FROM calls
         WHERE tenant_id = $1 AND started_at > now() - interval '30 days'
         GROUP BY disposition`,
        [tenantId]
      ),
    ]);

    const total = parseInt(totalCalls.rows[0].count, 10) || 0;
    const booked = parseInt(bookedCalls.rows[0].count, 10) || 0;
    const transferred = parseInt(transferredCalls.rows[0].count, 10) || 0;

    res.json({
      period: "30d",
      total_calls: total,
      booked_count: booked,
      booked_pct: total ? Math.round((booked / total) * 100) : 0,
      transferred_count: transferred,
      transferred_pct: total ? Math.round((transferred / total) * 100) : 0,
      ai_handled_count: total - transferred,
      revenue_cents: parseInt(revenue.rows[0].cents, 10) || 0,
      by_disposition: (byDisposition.rows || []).reduce((acc, r) => {
        acc[r.disposition || "unknown"] = parseInt(r.count, 10);
        return acc;
      }, {}),
    });
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

const TENANT_SELECT_TWILIO = `t.twilio_account_sid,
       (t.twilio_account_sid IS NOT NULL AND t.twilio_auth_token IS NOT NULL AND t.twilio_auth_token != '') as has_twilio_credentials,`;
const TENANT_SELECT_BASE = `t.id, t.name, t.slug, t.company_name, t.welcome_message, t.instructions, t.transfer_numbers, t.transfer_sms_brief, t.crm_webhook_url, t.crm_type, t.follow_up_enabled, t.plan`;
const TENANT_SELECT_BASE_LEGACY = `t.id, t.name, t.slug, t.company_name, t.welcome_message, t.instructions, t.transfer_numbers, t.transfer_sms_brief, t.crm_webhook_url, t.crm_type, t.follow_up_enabled`;

router.get("/tenants/:id", async (req, res) => {
  try {
    let r;
    try {
      r = await db.query(
        `SELECT ${TENANT_SELECT_BASE}, ${TENANT_SELECT_TWILIO}
         (SELECT json_agg(json_build_object('phone', pn.phone, 'is_primary', pn.is_primary)) FROM phone_numbers pn WHERE pn.tenant_id = t.id) as phones FROM tenants t WHERE t.id = $1`,
        [req.params.id]
      );
    } catch (colErr) {
      if (colErr.code === "42703") {
        r = await db.query(
          `SELECT ${TENANT_SELECT_BASE_LEGACY}, ${TENANT_SELECT_TWILIO}
           (SELECT json_agg(json_build_object('phone', pn.phone, 'is_primary', pn.is_primary)) FROM phone_numbers pn WHERE pn.tenant_id = t.id) as phones FROM tenants t WHERE t.id = $1`,
          [req.params.id]
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
    out.twilio_account_sid_masked = maskTwilioSid(row.twilio_account_sid);
    out.has_twilio_credentials = row.has_twilio_credentials === true;
    if (out.plan == null) out.plan = "basic";
    res.json(out);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/tenants", async (req, res) => {
  try {
    const userId = req.user?.sub;
    const userTenantId = req.user?.tenant_id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    if (userTenantId) {
      const r = await db.query(
        "SELECT t.id, t.name, t.slug, t.company_name, (SELECT json_agg(json_build_object('phone', pn.phone, 'is_primary', pn.is_primary)) FROM phone_numbers pn WHERE pn.tenant_id = t.id) as phones FROM tenants t WHERE t.id = $1",
        [userTenantId]
      );
      return res.json({ tenants: r.rows });
    }
    res.json({ tenants: [] });
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
    let allowed = ["welcome_message", "instructions", "transfer_numbers", "transfer_sms_brief", "crm_webhook_url", "crm_type", "follow_up_enabled", "plan", "twilio_account_sid", "twilio_auth_token"];
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
      return k === "transfer_numbers" ? JSON.stringify(v) : v;
    });
    values.push(id);
    await db.query(
      `UPDATE tenants SET ${set}, updated_at = now() WHERE id = $${values.length}`,
      values
    );
    let r;
    try {
      r = await db.query(
        `SELECT ${TENANT_SELECT_BASE}, ${TENANT_SELECT_TWILIO}
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
    out.twilio_account_sid_masked = maskTwilioSid(row.twilio_account_sid);
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

const estimateRecovery = require("../services/estimateRecovery");

// List recoveries for tenant
router.get("/recoveries", async (req, res) => {
  try {
    const tenantId = getTenantIdFromQuery(req);
    if (!tenantId) return res.status(400).json({ error: "tenant_id required" });
    const status = req.query.status || null;
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
    const rows = await estimateRecovery.getRecoveriesByTenant(tenantId, { status, limit });
    res.json({ recoveries: rows });
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

module.exports = router;
