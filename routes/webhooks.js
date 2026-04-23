"use strict";

const express = require("express");
const db = require("../lib/db");
const { getOrCreateLead, updateLeadInfo } = require("../services/leads");
const estimateRecoveryService = require("../services/estimateRecovery");
const { schedulePostServiceCampaigns } = require("../services/nurturing");
const notificationService = require("../services/notifications");

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

/** Recursive helper to find a value based on keyword matches in keys */
function findFuzzyValue(obj, keywords) {
  if (!obj || typeof obj !== "object") return null;
  const keys = Object.keys(obj);
  // 1. Check immediate keys for exact or partial matches
  for (const key of keys) {
    const k = key.toLowerCase();
    if (keywords.some(kw => k === kw || k.includes(kw))) {
      const val = obj[key];
      if (val !== null && val !== undefined && val !== "" && typeof val !== "object") return val;
    }
  }
  // 2. Recurse into nested objects (DripJobs often nests under Project, Job, etc.)
  for (const key of keys) {
    if (obj[key] && typeof obj[key] === "object" && !Array.isArray(obj[key])) {
      const found = findFuzzyValue(obj[key], keywords);
      if (found) return found;
    }
  }
  return null;
}

/**
 * POST /webhooks/crm/estimate-sent
 * Intended for Zapier or DripJobs when a proposal gets sent.
 */
router.post("/crm/estimate-sent", async (req, res) => {
  try {
    const body = req.body;
    const { contact_email, lead_source } = body;

    const apiKey = body.api_key || req.headers['x-api-key'] || req.headers['authorization'];
    if (!apiKey) return res.status(401).json({ error: "Missing api_key" });

    // 1. Smart Name Detection
    let name = body.contact_name || findFuzzyValue(body, ["customer_name", "contact_name", "client_name", "name"]);
    if (!name && body.first_name) name = `${body.first_name} ${body.last_name || ""}`.trim();

    // 2. Smart Phone Detection
    let rawPhone = body.contact_phone || findFuzzyValue(body, ["phone", "mobile", "tel", "cell"]);
    let phone = normalizePhoneInput(rawPhone);

    if (!phone) {
      console.warn("[Webhooks] /crm/estimate-sent: Could not find valid phone number in payload:", JSON.stringify(body));
      return res.status(400).json({ 
        error: "Valid contact_phone is required. Smart detection could not find a 'phone' field in your payload.",
        received_body: body 
      });
    }

    // 3. Smart Revenue Detection
    let rawRev = body.estimated_revenue_cents;
    if (rawRev === undefined || rawRev === null || rawRev === 0 || rawRev === "") {
        rawRev = findFuzzyValue(body, ["total", "amount", "price", "value", "revenue", "grand_total"]);
    }

    // Lookup tenant
    const rTenant = await db.query("SELECT id FROM tenants WHERE api_key = $1", [apiKey.replace("Bearer ", "")]);
    if (rTenant.rows.length === 0) return res.status(401).json({ error: "Invalid API key" });
    const tenantId = rTenant.rows[0].id;

    // Get or Create Lead
    const source = lead_source || "CRM Webhook";
    let lead = await getOrCreateLead(tenantId, phone, name || "CRM Lead", source, 'crm');
    
    // Update additional properties
    let updates = {};
    if (contact_email && !lead.email) updates.email = contact_email;

    // Validate and parse revenue
    if (rawRev !== undefined && rawRev !== null && rawRev !== "") {
      const rawString = String(rawRev).replace(/[^0-9.-]/g, "");
      if (rawString.includes(".")) {
        // It's a decimal (e.g. 4783.38), convert dollars to cents
        const parsedFloat = parseFloat(rawString);
        if (!isNaN(parsedFloat)) {
          updates.estimated_revenue_cents = Math.round(parsedFloat * 100);
        }
      } else {
        // It's already in cents (e.g. 478338)
        const parsedInt = parseInt(rawString, 10);
        if (!isNaN(parsedInt)) {
          updates.estimated_revenue_cents = parsedInt;
        }
      }
    }
    
    if (Object.keys(updates).length > 0) {
        await updateLeadInfo(lead.id, updates);
        lead = { ...lead, ...updates };
    }

    // 🔥 Hot lead notification (non-blocking) — fires only for $5k+ estimates
    if (updates.estimated_revenue_cents) {
      notificationService.notifyHotLead(tenantId, {
        customer_name: lead.name,
        amount_cents:  updates.estimated_revenue_cents,
        lead_id:       lead.id,
        phone:         lead.phone,
      }).catch((e) => console.error("[Webhooks] notifyHotLead failed:", e.message));
    }

    // Fire the Sales Recovery system
    const recoveryProcess = await estimateRecoveryService.startEstimateRecovery(tenantId, lead, {
        lead_source: source
    });

    res.json({ 
      success: true, 
      message: "Lead received and recovery sequence initiated.",
      recovery_id: recoveryProcess ? recoveryProcess.id : null,
      mapped_data: { name, phone, revenue_cents: updates.estimated_revenue_cents }
    });

  } catch (e) {
    console.error("[Webhooks] /crm/estimate-sent error:", e);
    res.status(500).json({ error: "Server error handling webhook" });
  }
});

/**
 * POST /webhooks/crm/job-won
 * Intended for Zapier when a job is marked as "Won" or "Completed".
 */
router.post("/crm/job-won", async (req, res) => {
  try {
    const body = req.body;
    const { contact_email, lead_source } = body;

    const apiKey = body.api_key || req.headers['x-api-key'] || req.headers['authorization'];
    if (!apiKey) return res.status(401).json({ error: "Missing api_key" });

    // Reuse smart detection for Name and Phone
    let name = body.contact_name || findFuzzyValue(body, ["customer_name", "contact_name", "client_name", "name"]);
    if (!name && body.first_name) name = `${body.first_name} ${body.last_name || ""}`.trim();

    let rawPhone = body.contact_phone || findFuzzyValue(body, ["phone", "mobile", "tel", "cell"]);
    let phone = normalizePhoneInput(rawPhone);

    if (!phone) {
      return res.status(400).json({ error: "Valid contact_phone is required for attribution." });
    }

    // Smart Revenue Detection for Actual Revenue
    let rawRev = body.actual_revenue_cents || findFuzzyValue(body, ["total", "amount", "price", "revenue", "grand_total"]);

    const rTenant = await db.query("SELECT id FROM tenants WHERE api_key = $1", [apiKey.replace("Bearer ", "")]);
    if (rTenant.rows.length === 0) return res.status(401).json({ error: "Invalid API key" });
    const tenantId = rTenant.rows[0].id;

    const source = lead_source || "CRM Webhook";
    let lead = await getOrCreateLead(tenantId, phone, name || "CRM Lead", source, 'crm');
    
    let updates = { status: 'Won' };
    if (contact_email && !lead.email) updates.email = contact_email;

    // Validate and parse ACTUAL revenue
    if (rawRev !== undefined && rawRev !== null && rawRev !== "") {
      const rawString = String(rawRev).replace(/[^0-9.-]/g, "");
      if (rawString.includes(".")) {
        const parsedFloat = parseFloat(rawString);
        if (!isNaN(parsedFloat)) updates.actual_revenue_cents = Math.round(parsedFloat * 100);
      } else {
        const parsedInt = parseInt(rawString, 10);
        if (!isNaN(parsedInt)) updates.actual_revenue_cents = parsedInt;
      }
    }
    
    await updateLeadInfo(lead.id, updates);
    await schedulePostServiceCampaigns(tenantId, { lead_id: lead.id, preferred_date: new Date().toISOString() });
    await db.query("UPDATE leads SET last_service_date = CURRENT_DATE WHERE id = $1", [lead.id]);

    // 💰 Revenue recovered notification (non-blocking)
    if (updates.actual_revenue_cents) {
      notificationService.notifyRevenueRecovered(tenantId, {
        amount_cents:  updates.actual_revenue_cents,
        customer_name: lead.name,
        lead_id:       lead.id,
        booking_id:    null, // job-won doesn't create a booking directly
      }).catch((e) => console.error("[Webhooks] notifyRevenueRecovered failed:", e.message));
    }
   
    res.json({ 
      success: true, 
      message: "Lead marked as Won and confirmed revenue updated.",
      mapped_data: { name, phone, confirmed_cents: updates.actual_revenue_cents }
    });

  } catch (e) {
    console.error("[Webhooks] /crm/job-won error:", e);
    res.status(500).json({ error: "Server error handling won job" });
  }
});

module.exports = router;
