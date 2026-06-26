"use strict";

// ============================================================================
// services/websiteAudit.js — Website Intelligence persistence (Jun 26, 2026)
// ============================================================================
//
// Thin wrapper around lib/websiteExtractor that:
//   1. loads the tenant's website URL,
//   2. runs the crawl + extraction,
//   3. PERSISTS EVERY RUN into website_audits (mig: website_audits) — success,
//      partial, or failure — so we keep full history (data flywheel + the
//      foundation for Phase 3 trend-tracking) and can add a usage cap later
//      from real data instead of guessing now.
//
// Mirrors the shape of services/gbpAudit.runAuditForTenant (load → run →
// write), but INSERTS a new row per run rather than upserting one, because the
// whole point is to keep the history.
//
// The instruction generators do NOT call this — they read the latest stored
// facts directly (see lib/instructionGenerator.loadLatestWebsiteFacts). This
// service is invoked only by the owner-triggered "Analyze my website" button.
// ============================================================================

const db = require("../lib/db");
const websiteExtractor = require("../lib/websiteExtractor");

// Run a fresh crawl + extraction for one tenant and persist the result.
// Returns { ok, reason, facts, fetched_pages, meta, audit_id, url }.
async function runWebsiteAuditForTenant(tenantId) {
  if (!tenantId) return { ok: false, reason: "no_tenant" };

  const tRes = await db.query("SELECT id, website FROM tenants WHERE id = $1", [tenantId]);
  const tenant = tRes.rows[0];
  if (!tenant) return { ok: false, reason: "tenant_not_found" };

  const url = String(tenant.website || "").trim();
  if (!url) {
    return {
      ok: false,
      reason: "no_website",
      message: "Add your website in the Branding tab first, then analyze it.",
    };
  }

  // Run the crawler. It never throws — on failure it still returns an audit
  // trail (fetched_pages + meta) that's worth persisting.
  const result = await websiteExtractor.runExtraction({ url });

  // Persist EVERY run (success or not).
  let auditId = null;
  try {
    const ins = await db.query(
      `INSERT INTO website_audits (tenant_id, url, facts, fetched_pages, meta)
            VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
      [
        tenantId,
        url,
        JSON.stringify(result.facts || {}),
        JSON.stringify(result.fetched_pages || []),
        JSON.stringify(result.meta || {}),
      ]
    );
    auditId = ins.rows[0]?.id || null;
  } catch (e) {
    console.error("[websiteAudit] persist failed tenant=%s: %s", tenantId, e.message);
    // Don't fail the whole call just because persistence hiccuped — the owner
    // still gets their facts back to use this session.
  }

  console.log(
    "[websiteAudit] tenant=%s ok=%s pages=%d/%d capped=%s reason=%s audit=%s",
    tenantId, result.ok,
    result.meta?.pages_used ?? 0, result.meta?.pages_fetched ?? 0,
    result.meta?.pages_capped, result.reason || "none", auditId || "none"
  );

  return {
    ok: result.ok,
    reason: result.reason || null,
    facts: result.facts,
    fetched_pages: result.fetched_pages,
    meta: result.meta,
    audit_id: auditId,
    url,
  };
}

// Read the most recent stored audit for a tenant (or null). Used by the
// dashboard to show "Last analyzed …" state and the facts summary.
async function getLatestWebsiteAudit(tenantId) {
  if (!tenantId) return null;
  const res = await db.query(
    `SELECT id, url, facts, fetched_pages, meta, created_at
       FROM website_audits
      WHERE tenant_id = $1
      ORDER BY created_at DESC
      LIMIT 1`,
    [tenantId]
  );
  return res.rows[0] || null;
}

module.exports = {
  runWebsiteAuditForTenant,
  getLatestWebsiteAudit,
};
