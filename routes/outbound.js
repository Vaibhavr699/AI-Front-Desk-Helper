"use strict";

const express = require("express");
const router = express.Router();
const db = require("../lib/db");
const { getTenantIdFromQuery, requireRole, ROLES } = require("../lib/auth");
const { processCSV, generateAutoScripts, getTrackingBoard } = require("../services/outbound");
const multer = require("multer");
const upload = multer();

// RBAC: Staff has no access. Business Manager can view/pause but not launch.
router.use(requireRole([ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER]));

/**
 * List campaigns
 */
router.get("/campaigns", async (req, res) => {
  try {
    const tenantId = getTenantIdFromQuery(req);
    const r = await db.query(
      "SELECT * FROM outbound_campaigns WHERE tenant_id = $1 ORDER BY created_at DESC", 
      [tenantId]
    );
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Create a new campaign (Launch flow)
 */
router.post("/campaigns", requireRole([ROLES.OWNER, ROLES.ADMIN]), upload.single("csv"), async (req, res) => {
  try {
    const tenantId = getTenantIdFromQuery(req);
    const { name, mode, prompt_description, calling_hours_start, calling_hours_end, max_attempts, consent_confirmed } = req.body;

    console.log(`[Campaign Route] New campaign: ${name}, mode=${mode}, tenantId=${tenantId}`);
    console.log(`[Campaign Route] File received: ${req.file ? req.file.originalname : 'NONE'}, size=${req.file ? req.file.size : 0}`);

    if (!consent_confirmed) {
      return res.status(400).json({ error: "Consent confirmation is required." });
    }

    const campaignRes = await db.query(
      `INSERT INTO outbound_campaigns (
        tenant_id, name, mode, status, prompt_description, 
        calling_hours_start, calling_hours_end, max_attempts
      ) VALUES ($1, $2, $3, 'active', $4, $5, $6, $7) RETURNING *`,
      [
        tenantId, name, mode, prompt_description, 
        calling_hours_start || "08:00:00", 
        calling_hours_end || "19:00:00", 
        max_attempts || 3
      ]
    );

    const campaign = campaignRes.rows[0];

    // Process CSV
    if (req.file) {
      console.log(`[Campaign Route] Processing CSV for campaign ${campaign.id}...`);
      const count = await processCSV(campaign.id, tenantId, req.file.buffer);
      console.log(`[Campaign Route] CSV processed. ${count} contacts added.`);
    } else {
      console.warn(`[Campaign Route] No CSV file found in request!`);
    }

    // Auto Script Generation
    if (mode === "auto" && prompt_description) {
      await generateAutoScripts(campaign.id, tenantId, prompt_description);
    }

    res.json(campaign);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Get tracking board for a campaign
 */
router.get("/campaigns/:id", async (req, res) => {
  try {
    const data = await getTrackingBoard(req.params.id);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * List contacts for tracking board table
 */
router.get("/campaigns/:id/contacts", async (req, res) => {
  try {
    const r = await db.query(
      "SELECT * FROM outbound_contacts WHERE campaign_id = $1 ORDER BY created_at ASC LIMIT 100", 
      [req.params.id]
    );
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Update campaign details (Prompt, Name, etc.)
 */
router.patch("/campaigns/:id", async (req, res) => {
  try {
    const { prompt_description, name } = req.body;
    const updates = [];
    const values = [];
    
    if (prompt_description !== undefined) {
      updates.push(`prompt_description = $${updates.length + 1}`);
      values.push(prompt_description);
    }
    if (name !== undefined) {
      updates.push(`name = $${updates.length + 1}`);
      values.push(name);
    }

    if (updates.length > 0) {
      values.push(req.params.id);
      await db.query(
        `UPDATE outbound_campaigns SET ${updates.join(", ")}, updated_at = now() WHERE id = $${values.length}`,
        values
      );
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Pause campaign
 */
router.post("/campaigns/:id/pause", async (req, res) => {
  await db.query("UPDATE outbound_campaigns SET status = 'paused' WHERE id = $1", [req.params.id]);
  res.json({ success: true });
});

/**
 * Resume campaign
 */
router.post("/campaigns/:id/resume", async (req, res) => {
  await db.query("UPDATE outbound_campaigns SET status = 'active' WHERE id = $1", [req.params.id]);
  res.json({ success: true });
});

/**
 * Purchase Minute Bundle
 */
router.post("/purchase-bundle", requireRole([ROLES.OWNER, ROLES.ADMIN]), async (req, res) => {
  try {
    const tenantId = getTenantIdFromQuery(req);
    const { minutes, amount } = req.body; // e.g. 500, 99.00
    
    // In a real app, integrate Stripe here. For now, just update balance.
    await db.query(
      "UPDATE tenants SET bundle_minutes_balance = bundle_minutes_balance + $1 WHERE id = $2",
      [minutes, tenantId]
    );
    
    res.json({ success: true, newBalance: 0 /* calculate if needed */ });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
