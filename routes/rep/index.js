"use strict";

// ── /api/rep — Rep mobile app router ────────────────────────────────────────
// One mount point so server.js stays tidy. /auth/login + /auth/totp are
// public; every other rep route gates itself via repAuthChain.
// ────────────────────────────────────────────────────────────────────────────

const express = require("express");
const router = express.Router();

router.use("/auth", require("./auth"));
router.use("/events", require("./events"));
router.use("/push-token", require("./device"));
router.use("/profile", require("./profile"));
router.use("/leads", require("./leads"));
router.use("/appointments", require("./appointments"));
router.use("/coaching", require("./coaching"));
router.use("/roleplay", require("./roleplay"));
router.use("/in-home", require("./in-home"));
router.use("/cue-settings", require("./cue-settings"));
router.use("/recording", require("./recording"));

module.exports = router;
