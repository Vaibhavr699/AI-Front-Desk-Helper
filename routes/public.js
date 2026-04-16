"use strict";
 
const express = require("express");
const router  = express.Router();
const db      = require("../lib/db");
const emailService = require("../services/email");
 
// ── POST /api/public/contact ───────────────────────────────────────────────
router.post("/contact", async (req, res) => {
  const { name, phone, email, businessName, enquiry, bestTime } = req.body;
  const message = (enquiry && String(enquiry).trim()) || (businessName && String(businessName).trim()) || "";
  if (!name || !phone || !email || !message) {
    return res.status(400).json({ error: "Missing required fields" });
  }
  try {
    console.log("[Public] Contact form submission from:", email);
    await emailService.sendContactLeadEmail({ name, phone, email, enquiry: message, bestTime });
    res.json({ success: true, message: "Enquiry submitted successfully" });
  } catch (error) {
    console.error("[Public] Contact form error:", error.message);
    res.status(500).json({ error: "Failed to submit enquiry" });
  }
});
 
// ── GET /api/public-tenant/:tenantId ──────────────────────────────────────
// Called by chat-widget.js and book-by-text.js to load per-tenant branding.
// Returns only public-safe fields — no tokens, no keys.
router.get("/public-tenant/:tenantId", async (req, res) => {
  try {
    const { tenantId } = req.params;
    if (!tenantId) return res.status(400).json({ error: "tenantId required" });
 
    const result = await db.query(
      `SELECT
         t.id,
         t.name,
         t.company_name,
         t.welcome_message,
         t.logo_url,
         t.brand_color,
         t.website,
         t.timezone,
         t.business_hours,
         -- Primary Twilio phone number for SMS button
         (SELECT pn.phone
          FROM phone_numbers pn
          WHERE pn.tenant_id = t.id AND pn.is_primary = true
          LIMIT 1) as twilio_phone_number
       FROM tenants t
       WHERE t.id = $1`,
      [tenantId]
    );
 
    const tenant = result.rows[0];
    if (!tenant) return res.status(404).json({ error: "Tenant not found" });
 
    res.json({
      id:                  tenant.id,
      name:                tenant.name,
      company_name:        tenant.company_name || tenant.name,
      welcome_message:     tenant.welcome_message || null,
      logo_url:            tenant.logo_url       || null,
      brand_color:         tenant.brand_color    || "#E8600A",
      website:             tenant.website        || null,
      timezone:            tenant.timezone       || "America/Chicago",
      business_hours:      tenant.business_hours || null,
      twilio_phone_number: tenant.twilio_phone_number || null,
    });
  } catch (err) {
    console.error("[Public] /public-tenant error:", err);
    res.status(500).json({ error: "Server error" });
  }
});
 
module.exports = router;
