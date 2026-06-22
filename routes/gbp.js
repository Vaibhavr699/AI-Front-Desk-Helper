"use strict";

/**
 * routes/gbp.js
 *
 * GBP Traction endpoints — bundled into the $29/mo Reviews add-on.
 * Every endpoint gates on hasReviewsAccess (shared with routes/reviews.js
 * via lib/addonAccess.js) so the billing boundary is one source of truth.
 *
 * Phases covered here:
 *   G1 — audit:   GET /status, GET /audit, POST /audit/run
 *   G2 — drafts:  GET /posts, POST /posts/generate, PATCH /posts/:id, DELETE /posts/:id
 *   G3 — publish: POST /posts/:id/approve   (added in G3)
 *   G5 — perf:    GET /performance          (added in G5)
 *
 * Tenant resolution mirrors routes/reviews.js: getTenantIdFromQuery(req),
 * same google-column select, same connected/access gates. Mounted without
 * authMiddleware (like reviews) — see server.js mount note at bottom.
 */

const express = require("express");
const router  = express.Router();

router.use((req, res, next) => {
  console.log("[GBP Router] HIT:", req.method, req.path);
  next();
});

const db = require("../lib/db");
const { getTenantIdFromQuery } = require("../lib/auth");
const { hasReviewsAccess } = require("../lib/addonAccess");
const gbpAudit   = require("../services/gbpAudit");
const gbpPosting = require("../services/gbpPosting");

// Pull tenant with the columns the gate + connection check need.
async function getTenantWithGoogle(tenantId) {
  const res = await db.query(
    `SELECT id, name, company_name, plan, plan_overrides,
            google_access_token, google_location_id, google_account_id
       FROM tenants WHERE id = $1`,
    [tenantId]
  );
  return res.rows[0] || null;
}

/**
 * Resolve tenant + enforce the add-on gate in one step.
 * Returns { tenant } on success, or sends the error response and returns null.
 */
async function gateTenant(req, res) {
  const tenantId = getTenantIdFromQuery(req);
  if (!tenantId) { res.status(400).json({ error: "tenant_id required" }); return null; }

  const tenant = await getTenantWithGoogle(tenantId);
  if (!tenant) { res.status(404).json({ error: "Tenant not found" }); return null; }

  if (!hasReviewsAccess(tenant)) {
    res.status(403).json({ error: "Reviews add-on not active" });
    return null;
  }
  return { tenant, tenantId };
}

// ── GET /api/gbp/status ─────────────────────────────────────────────────────
router.get("/status", async (req, res) => {
  try {
    const gated = await gateTenant(req, res);
    if (!gated) return;
    const { tenant, tenantId } = gated;

    const connected = !!(tenant.google_access_token && tenant.google_location_id);

    let hasAudit = false, lastAuditAt = null, healthScore = null;
    const a = await db.query(
      "SELECT health_score, generated_at FROM gbp_audit WHERE tenant_id = $1",
      [tenantId]
    );
    if (a.rows[0]) {
      hasAudit = true; lastAuditAt = a.rows[0].generated_at; healthScore = a.rows[0].health_score;
    }

    const dc = await db.query(
      "SELECT COUNT(*) FROM gbp_posts WHERE tenant_id = $1 AND status = 'draft'",
      [tenantId]
    );

    res.json({
      connected,
      location_name: tenant.company_name || tenant.name || null,
      has_audit:     hasAudit,
      last_audit_at: lastAuditAt,
      health_score:  healthScore,
      draft_count:   parseInt(dc.rows[0].count, 10),
    });
  } catch (err) {
    console.error("GET /api/gbp/status error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ── GET /api/gbp/audit ──────────────────────────────────────────────────────
// Cached snapshot, no Google call.
router.get("/audit", async (req, res) => {
  try {
    const gated = await gateTenant(req, res);
    if (!gated) return;
    const { tenantId } = gated;

    const result = await db.query(
      `SELECT health_score, gaps, profile_snapshot, generated_at
         FROM gbp_audit WHERE tenant_id = $1`,
      [tenantId]
    );
    if (!result.rows[0]) return res.json({ has_audit: false });

    const row = result.rows[0];
    res.json({
      has_audit:        true,
      health_score:     row.health_score,
      gaps:             row.gaps || [],
      profile_snapshot: row.profile_snapshot || {},
      generated_at:     row.generated_at,
    });
  } catch (err) {
    console.error("GET /api/gbp/audit error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ── POST /api/gbp/audit/run ─────────────────────────────────────────────────
// Live read-only audit against Google; upserts + returns the snapshot.
router.post("/audit/run", async (req, res) => {
  try {
    const gated = await gateTenant(req, res);
    if (!gated) return;
    const { tenant, tenantId } = gated;

    if (!(tenant.google_access_token && tenant.google_location_id)) {
      return res.status(400).json({ error: "Google Business Profile not connected" });
    }

    const result = await gbpAudit.runAuditForTenant(tenantId);
    if (!result.ok) {
      const status = result.reason === "not_connected" ? 400 : 502;
      return res.status(status).json({ error: result.reason, detail: result.message || null });
    }

    res.json({ ok: true, health_score: result.healthScore, gaps: result.gaps, snapshot: result.snapshot });
  } catch (err) {
    console.error("POST /api/gbp/audit/run error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ── GET /api/gbp/posts ──────────────────────────────────────────────────────
// List posts by status (default 'draft'). Statuses: draft|approved|published|failed|archived
router.get("/posts", async (req, res) => {
  try {
    const gated = await gateTenant(req, res);
    if (!gated) return;
    const { tenantId } = gated;

    const status = req.query.status || "draft";
    const valid = ["draft", "approved", "publishing", "published", "failed", "archived"];
    if (!valid.includes(status)) return res.status(400).json({ error: "Invalid status filter" });

    const result = await db.query(
      `SELECT id, post_type, summary, cta_type, cta_url, media_url, status,
              google_post_resource_name, publish_error, published_at, created_at, updated_at
         FROM gbp_posts
        WHERE tenant_id = $1 AND status = $2
        ORDER BY created_at DESC
        LIMIT 50`,
      [tenantId, status]
    );

    const dc = await db.query(
      "SELECT COUNT(*) FROM gbp_posts WHERE tenant_id = $1 AND status = 'draft'",
      [tenantId]
    );

    res.json({ posts: result.rows, draft_count: parseInt(dc.rows[0].count, 10) });
  } catch (err) {
    console.error("GET /api/gbp/posts error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ── POST /api/gbp/posts/generate ────────────────────────────────────────────
// Generate N AI drafts (default 1). Does NOT publish — writes status='draft'.
router.post("/posts/generate", async (req, res) => {
  try {
    const gated = await gateTenant(req, res);
    if (!gated) return;
    const { tenantId } = gated;

    const count    = Math.min(5, Math.max(1, parseInt(req.body?.count, 10) || 1));
    const postType = ["STANDARD", "OFFER", "EVENT"].includes(req.body?.post_type)
      ? req.body.post_type : "STANDARD";

    const result = await gbpPosting.generateDraftsForTenant(tenantId, { count, postType });
    if (!result.ok) {
      return res.status(502).json({ error: result.reason || "generation_failed" });
    }
    res.json({ ok: true, drafts: result.drafts });
  } catch (err) {
    console.error("POST /api/gbp/posts/generate error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ── PATCH /api/gbp/posts/:id ────────────────────────────────────────────────
// Owner edits a draft's text / cta before approving. Only draft|approved editable.
router.patch("/posts/:id", async (req, res) => {
  try {
    const gated = await gateTenant(req, res);
    if (!gated) return;
    const { tenantId } = gated;
    const { id } = req.params;

    const existing = await db.query(
      "SELECT status FROM gbp_posts WHERE id = $1 AND tenant_id = $2",
      [id, tenantId]
    );
    if (!existing.rows[0]) return res.status(404).json({ error: "Post not found" });
    if (!["draft", "approved"].includes(existing.rows[0].status)) {
      return res.status(400).json({ error: "Only draft or approved posts can be edited" });
    }

    const fields = [];
    const params = [id, tenantId];
    const set = (col, val) => { params.push(val); fields.push(`${col} = $${params.length}`); };

    if (typeof req.body?.summary === "string") set("summary", req.body.summary);
    if (typeof req.body?.cta_url === "string")  set("cta_url", req.body.cta_url);
    if (typeof req.body?.cta_type === "string") set("cta_type", req.body.cta_type);
    if (typeof req.body?.media_url === "string") set("media_url", req.body.media_url);
    if (fields.length === 0) return res.status(400).json({ error: "No editable fields provided" });
    fields.push("updated_at = now()");

    const result = await db.query(
      `UPDATE gbp_posts SET ${fields.join(", ")}
        WHERE id = $1 AND tenant_id = $2
        RETURNING id, post_type, summary, cta_type, cta_url, media_url, status, updated_at`,
      params
    );
    res.json({ ok: true, post: result.rows[0] });
  } catch (err) {
    console.error("PATCH /api/gbp/posts/:id error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ── DELETE /api/gbp/posts/:id ───────────────────────────────────────────────
// Soft-archive a draft (never hard-delete — keep for the flywheel/audit trail).
router.delete("/posts/:id", async (req, res) => {
  try {
    const gated = await gateTenant(req, res);
    if (!gated) return;
    const { tenantId } = gated;
    const { id } = req.params;

    const result = await db.query(
      `UPDATE gbp_posts SET status = 'archived', updated_at = now()
        WHERE id = $1 AND tenant_id = $2 AND status IN ('draft','approved')
        RETURNING id`,
      [id, tenantId]
    );
    if (!result.rows[0]) return res.status(404).json({ error: "Post not found or not archivable" });
    res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/gbp/posts/:id error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;

/*
 * ── SERVER.JS MOUNT (add next to the reviews mount) ─────────────────────────
 *   app.use("/api/gbp", require("./routes/gbp"));
 * Resolves tenant via getTenantIdFromQuery (query param), like reviews, so no
 * authMiddleware wrapper. Must sit before the SPA catch-all.
 */
