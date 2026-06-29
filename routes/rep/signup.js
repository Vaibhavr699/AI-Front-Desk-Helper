"use strict";

const express = require("express");
const crypto = require("crypto");
const router = express.Router();
const db = require("../../lib/db");
const repCoachStripe = require("../../lib/repCoachStripe");

const REP_COACH_URL = process.env.REP_COACH_URL || "https://airepcoach.com";
const SIGNUP_LINK_TTL_MS = 60 * 60 * 1000;

// POST /api/rep/signup/checkout — standalone self-serve signup (Path A).
// Public (pre-auth). Creates a rep_coach_signup magic link carrying the email,
// then a 14-day-trial repCoachStripe checkout session. The webhook provisions
// the account on checkout.session.completed.
router.post("/checkout", async (req, res) => {
  try {
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    if (!email || !email.includes("@")) {
      return res.status(400).json({ error: "Valid email required" });
    }
    if (!repCoachStripe.isConfigured()) {
      return res.status(503).json({ error: "Signup is temporarily unavailable" });
    }

    const existing = await db.query(
      "SELECT id FROM dashboard_users WHERE email = $1",
      [email],
    );
    if (existing.rows[0]) {
      return res.status(409).json({
        error: "An account with this email already exists. Log in instead.",
        code: "ACCOUNT_EXISTS",
      });
    }

    const token = crypto.randomBytes(32).toString("hex");
    await db.query(
      `INSERT INTO magic_links (email, token, purpose, expires_at)
       VALUES ($1, $2, 'rep_coach_signup', $3)`,
      [email, token, new Date(Date.now() + SIGNUP_LINK_TTL_MS)],
    );

    const { url } = await repCoachStripe.createTrialCheckout({
      email,
      magicToken: token,
      successUrl: `${REP_COACH_URL}/signup/success`,
      cancelUrl: `${REP_COACH_URL}/`,
    });

    res.json({ checkout_url: url });
  } catch (err) {
    console.error("[rep/signup/checkout]", err.message);
    res.status(500).json({ error: "Couldn't start signup. Please try again." });
  }
});

module.exports = router;
