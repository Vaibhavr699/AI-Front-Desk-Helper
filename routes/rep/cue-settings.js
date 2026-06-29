"use strict";

const express = require("express");
const db = require("../../lib/db");
const { repAuthChain } = require("../../lib/requireRep");
const { CUE_TYPES } = require("../../services/liveCueEngine");

const router = express.Router();

const VALID_CUE_KEYS = new Set(Object.keys(CUE_TYPES));

router.get("/", ...repAuthChain, async (req, res) => {
  try {
    const r = await db.query(
      "SELECT cue_preferences FROM dashboard_users WHERE id = $1",
      [req.rep.id],
    );
    const prefs = r.rows[0]?.cue_preferences || {};
    const result = {};
    for (const key of VALID_CUE_KEYS) {
      result[key] = prefs[key] !== false;
    }
    res.json({ cue_preferences: result });
  } catch (e) {
    console.error("[rep/cue-settings GET]", e);
    res.status(500).json({ error: "Server error" });
  }
});

router.patch("/", ...repAuthChain, async (req, res) => {
  try {
    const updates = req.body || {};
    const currentR = await db.query(
      "SELECT cue_preferences FROM dashboard_users WHERE id = $1",
      [req.rep.id],
    );
    const current = currentR.rows[0]?.cue_preferences || {};

    for (const [key, value] of Object.entries(updates)) {
      if (!VALID_CUE_KEYS.has(key)) continue;
      if (typeof value !== "boolean") continue;
      current[key] = value;
    }

    await db.query(
      `UPDATE dashboard_users SET cue_preferences = $1::jsonb WHERE id = $2`,
      [JSON.stringify(current), req.rep.id],
    );

    const result = {};
    for (const key of VALID_CUE_KEYS) {
      result[key] = current[key] !== false;
    }
    res.json({ cue_preferences: result });
  } catch (e) {
    console.error("[rep/cue-settings PATCH]", e);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
