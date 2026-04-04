"use strict";

const express = require("express");
const db = require("../lib/db");
const { getOrCreateLead, updateLeadInfo } = require("../services/leads");
const estimateRecoveryService = require("../services/estimateRecovery");

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

/**
 * POST /webhooks/crm/estimate-sent
 * Intended for Zapier or DripJobs when a proposal gets sent.
 * Expects JSON body with:
 * {
 *   "api_key": "TENANT_API_KEY",
 *   "contact_name": "John Doe",
 *   "contact_phone": "1234567890",
 *   "contact_email": "john@doe.com",
 *   "estimated_revenue_cents": 150000,
 *   "lead_source": "Zapier"
 * }
 */
router.post("/crm/estimate-sent", async (req, res) => {
  try {
    const { 
      api_key, 
      contact_name, 
      contact_phone, 
      contact_email,
      estimated_revenue_cents,
      lead_source 
    } = req.body;

    // We can also support api_key in headers if they prefer
    const apiKey = api_key || req.headers['x-api-key'] || req.headers['authorization'];

    if (!apiKey) {
      return res.status(401).json({ error: "Missing api_key" });
    }

    const phone = normalizePhoneInput(contact_phone);
    if (!phone) {
      return res.status(400).json({ error: "Valid contact_phone is required" });
    }

    // Lookup tenant
    const rTenant = await db.query("SELECT id FROM tenants WHERE api_key = $1", [apiKey.replace("Bearer ", "")]);
    if (rTenant.rows.length === 0) {
      return res.status(401).json({ error: "Invalid API key" });
    }
    const tenantId = rTenant.rows[0].id;

    // Get or Create Lead
    const source = lead_source || "CRM Webhook";
    let lead = await getOrCreateLead(tenantId, phone, contact_name, source);
    
    // Update additional properties
    let updates = {};
    if (contact_email && !lead.email) updates.email = contact_email;
    if (estimated_revenue_cents) updates.estimated_revenue_cents = parseInt(estimated_revenue_cents, 10);
    
    if (Object.keys(updates).length > 0) {
        await updateLeadInfo(lead.id, updates);
        // Refresh lead with updates for downstream
        lead = { ...lead, ...updates };
    }

    // Fire the Sales Recovery system (falls into the Ghost Sequence)
    const recoveryProcess = await estimateRecoveryService.startEstimateRecovery(tenantId, lead, {
        lead_source: source
    });

    res.json({ 
      success: true, 
      message: "Lead received and recovery sequence initiated.",
      recovery_id: recoveryProcess ? recoveryProcess.id : null 
    });

  } catch (e) {
    console.error("[Webhooks] /crm/estimate-sent error:", e);
    res.status(500).json({ error: "Server error handling webhook" });
  }
});

module.exports = router;
