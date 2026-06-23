"use strict";

/**
 * routes/reviewCampaigns.js
 *
 * Tenant-facing API for the review-request drip. Mounted at
 * /api/review-campaigns (see server.js). Gated by the Reviews add-on
 * (hasReviewsAccess) — same gate as routes/reviews.js, since this feature
 * is part of the $29/mo Reviews add-on.
 *
 * Endpoints:
 *   GET    /config            → { enabled, review_link, steps }
 *   PATCH  /config            → update enabled / review_link / steps
 *   GET    /                  → list campaigns (?status=active|completed|...)
 *   POST   /:id/stop          → tenant Stop button
 *   POST   /request           → manual "request review" (enroll one customer)
 */

const express = require("express");
const router  = express.Router();
const db      = require("../lib/db");
const { getTenantIdFromQuery } = require("../lib/auth");
const reviewCampaign = require("../services/reviewCampaign");

// Reuse the same add-on gate Reviews uses.
async function getTenantAccess(tenantId) {
  const res = await db.query(
    "SELECT id, plan, plan_overrides FROM tenants WHERE id = $1",
    [tenantId]
  );
  const tenant = res.rows[0];
  if (!tenant) return { tenant: null, hasAccess: false };
  const overrides = tenant.plan_overrides || {};
  const hasAccess =
    tenant.plan === "elite" || !!(overrides.reviews_addon || overrides.reviews);
  return { tenant, hasAccess };
}

// ── GET /config ─────────────────────────────────────────────────────────────
router.get("/config", async (req, res) => {
  try {
    const tenantId = getTenantIdFromQuery(req);
    if (!tenantId) return res.status(400).json({ error: "tenant_id required" });

    const { hasAccess } = await getTenantAccess(tenantId);
    if (!hasAccess) return res.status(403).json({ error: "Reviews add-on not active" });

    const r = await db.query(
      `SELECT review_campaign_enabled, review_link, review_campaign_steps
         FROM tenants WHERE id = $1`,
      [tenantId]
    );
    const row = r.rows[0] || {};
    res.json({
      enabled:     !!row.review_campaign_enabled,
      review_link: row.review_link || "",
      steps:       row.review_campaign_steps || null, // null → engine default
      default_steps: reviewCampaign.DEFAULT_STEPS,
    });
  } catch (err) {
    console.error("GET /api/review-campaigns/config error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ── PATCH /config ───────────────────────────────────────────────────────────
// Body: { enabled?, review_link?, steps? }
router.patch("/config", async (req, res) => {
  try {
    const tenantId = getTenantIdFromQuery(req);
    if (!tenantId) return res.status(400).json({ error: "tenant_id required" });

    const { hasAccess } = await getTenantAccess(tenantId);
    if (!hasAccess) return res.status(403).json({ error: "Reviews add-on not active" });

    const { enabled, review_link, steps } = req.body || {};

    const sets = [];
    const params = [];
    let i = 1;

    if (typeof enabled === "boolean") {
      sets.push(`review_campaign_enabled = $${i++}`);
      params.push(enabled);
    }
    if (typeof review_link === "string") {
      sets.push(`review_link = $${i++}`);
      params.push(review_link.trim() || null);
    }
    if (steps !== undefined) {
      // Accept an array of {day,channel,message?,subject?} or null to reset.
      let value = null;
      if (Array.isArray(steps)) {
        value = JSON.stringify(
          steps
            .filter((s) => s && (s.channel === "sms" || s.channel === "email") && Number.isFinite(Number(s.day)))
            .map((s) => ({
              day: Number(s.day),
              channel: s.channel,
              message: typeof s.message === "string" ? s.message : undefined,
              subject: typeof s.subject === "string" ? s.subject : undefined,
              smsFallback: s.channel === "email" ? s.smsFallback !== false : undefined,
            }))
        );
      }
      sets.push(`review_campaign_steps = $${i++}`);
      params.push(value);
    }

    if (sets.length === 0) {
      return res.status(400).json({ error: "No valid fields to update" });
    }

    params.push(tenantId);
    await db.query(
      `UPDATE tenants SET ${sets.join(", ")}, updated_at = now() WHERE id = $${i}`,
      params
    );

    res.json({ success: true });
  } catch (err) {
    console.error("PATCH /api/review-campaigns/config error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ── GET / (list campaigns) ──────────────────────────────────────────────────
router.get("/", async (req, res) => {
  try {
    const tenantId = getTenantIdFromQuery(req);
    if (!tenantId) return res.status(400).json({ error: "tenant_id required" });

    const { hasAccess } = await getTenantAccess(tenantId);
    if (!hasAccess) return res.status(403).json({ error: "Reviews add-on not active" });

    const status = req.query.status || null;
    const campaigns = await reviewCampaign.listCampaigns(tenantId, { status });
    res.json({ campaigns });
  } catch (err) {
    console.error("GET /api/review-campaigns error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ── POST /:id/stop (tenant Stop button) ─────────────────────────────────────
router.post("/:id/stop", async (req, res) => {
  try {
    const tenantId = getTenantIdFromQuery(req);
    if (!tenantId) return res.status(400).json({ error: "tenant_id required" });

    const { hasAccess } = await getTenantAccess(tenantId);
    if (!hasAccess) return res.status(403).json({ error: "Reviews add-on not active" });

    const ok = await reviewCampaign.stopCampaign(tenantId, req.params.id);
    if (!ok) return res.status(404).json({ error: "Active campaign not found" });
    res.json({ success: true });
  } catch (err) {
    console.error("POST /api/review-campaigns/:id/stop error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ── POST /request (manual "request review" button) ──────────────────────────
// Body: { name?, phone?, email?, lead_id? }  — enroll one customer now.
router.post("/request", async (req, res) => {
  try {
    const tenantId = getTenantIdFromQuery(req);
    if (!tenantId) return res.status(400).json({ error: "tenant_id required" });

    const { hasAccess } = await getTenantAccess(tenantId);
    if (!hasAccess) return res.status(403).json({ error: "Reviews add-on not active" });

    const { name, phone, email, lead_id } = req.body || {};
    if (!phone && !email) {
      return res.status(400).json({ error: "phone or email required" });
    }

    const campaign = await reviewCampaign.startReviewCampaign(
      tenantId,
      { name, phone, email, leadId: lead_id || null },
      { source: "manual" }
    );

    if (!campaign) {
      return res.status(409).json({
        error: "Could not start campaign. Check that review requests are enabled and a review link is set.",
      });
    }
    res.json({ success: true, campaign });
  } catch (err) {
    console.error("POST /api/review-campaigns/request error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
