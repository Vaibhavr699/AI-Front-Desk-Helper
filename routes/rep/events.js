"use strict";

// ── /api/rep/events — batch event firehose ─────────────────────────────────
// The app batches user actions (screen views, alert taps, session checkpoints,
// roleplay starts, etc.) and posts them here every few seconds. Server tags
// every row with the authenticated rep + tenant so the client can't lie about
// who they are even if it can lie about the payload.
//
// Body: { events: [ { event_type, metadata?, occurred_at? }, ... ] }
//
// Limits:
//   • Max 100 events per call (anything larger → 413)
//   • event_type required, must be a short string
//   • metadata is arbitrary JSON, capped at ~16KB stringified per event
// ────────────────────────────────────────────────────────────────────────────

const express = require("express");
const db = require("../../lib/db");
const { repAuthChain } = require("../../lib/requireRep");

const router = express.Router();

const MAX_EVENTS_PER_CALL = 100;
const MAX_METADATA_BYTES = 16 * 1024;

router.post("/", ...repAuthChain, async (req, res) => {
  try {
    const events = Array.isArray(req.body?.events) ? req.body.events : null;
    if (!events || events.length === 0) {
      return res.status(400).json({ error: "events array required" });
    }
    if (events.length > MAX_EVENTS_PER_CALL) {
      return res.status(413).json({ error: `Max ${MAX_EVENTS_PER_CALL} events per call` });
    }

    const ipRaw = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.ip || null;
    const ip = ipRaw && ipRaw !== "::1" ? ipRaw : null;
    const appVersion = req.headers["x-app-version"] || null;

    // Single multi-row insert — cheaper than N round-trips when the app is
    // catching up after offline use.
    const rows = [];
    for (const ev of events) {
      if (!ev || typeof ev.event_type !== "string" || ev.event_type.length === 0) continue;
      const meta = ev.metadata && typeof ev.metadata === "object" ? ev.metadata : {};
      const metaJson = JSON.stringify(meta);
      if (metaJson.length > MAX_METADATA_BYTES) continue;
      rows.push({
        event_type: ev.event_type.slice(0, 80),
        metadata: metaJson,
        device_fingerprint: meta.device_fingerprint || null,
        device_type: meta.device_type || null,
      });
    }
    if (rows.length === 0) {
      return res.status(400).json({ error: "no valid events in batch" });
    }

    const values = [];
    const placeholders = [];
    let p = 1;
    for (const r of rows) {
      placeholders.push(
        `($${p++}, $${p++}, $${p++}, $${p++}::jsonb, $${p++}, $${p++}, $${p++}, $${p++})`
      );
      values.push(
        req.rep.id,
        req.rep.tenant_id,
        r.event_type,
        r.metadata,
        r.device_fingerprint,
        r.device_type,
        ip,
        appVersion
      );
    }

    await db.query(
      `INSERT INTO rep_app_events
         (user_id, tenant_id, event_type, event_metadata, device_fingerprint, device_type, ip_address, app_version)
       VALUES ${placeholders.join(", ")}`,
      values
    );

    res.json({ status: "ok", accepted: rows.length });
  } catch (e) {
    console.error("[rep/events]", e);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
