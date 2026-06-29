"use strict";

// ── /api/rep/push-token — Expo push token registration ─────────────────────
// Mounted at the rep router root (not under /auth) because the spec lists it
// at POST /api/rep/push-token. Idempotent — call any time the Expo token
// rotates (which it does on app reinstall, OS upgrades, etc.).
// ────────────────────────────────────────────────────────────────────────────

const express = require("express");
const db = require("../../lib/db");
const repAuth = require("../../lib/repAuth");
const { repAuthChain } = require("../../lib/requireRep");

const router = express.Router();

router.post("/", ...repAuthChain, async (req, res) => {
  try {
    const { expo_push_token } = req.body || {};
    if (!expo_push_token || typeof expo_push_token !== "string") {
      return res.status(400).json({ error: "expo_push_token required" });
    }
    await db.query("UPDATE dashboard_users SET expo_push_token = $1 WHERE id = $2", [
      expo_push_token,
      req.rep.id,
    ]);
    await repAuth.logRepEvent(req, {
      user_id: req.rep.id,
      tenant_id: req.rep.tenant_id,
      event_type: "rep_push_token_registered",
      metadata: {},
    });
    res.json({ status: "ok" });
  } catch (e) {
    console.error("[rep/push-token]", e);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
