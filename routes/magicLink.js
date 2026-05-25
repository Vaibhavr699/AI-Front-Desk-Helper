"use strict";

const express = require("express");
const crypto = require("crypto");
const db = require("../lib/db");
const { sendEmail } = require("../services/email");

const router = express.Router();

const MAGIC_LINK_TTL_MS = 24 * 60 * 60 * 1000;
const REP_COACH_URL = process.env.REP_COACH_URL || "https://airepcoach.com";
const STRIPE_CHECKOUT_URL = process.env.REP_COACH_STRIPE_CHECKOUT_URL || "";

router.post("/request", async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email || typeof email !== "string" || !email.includes("@")) {
      return res.status(400).json({ error: "Valid email required" });
    }

    const normalized = email.trim().toLowerCase();
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + MAGIC_LINK_TTL_MS);

    await db.query(
      `INSERT INTO magic_links (email, token, purpose, expires_at)
       VALUES ($1, $2, 'rep_coach_signup', $3)`,
      [normalized, token, expiresAt],
    );

    const checkoutUrl = STRIPE_CHECKOUT_URL
      ? `${STRIPE_CHECKOUT_URL}?prefilled_email=${encodeURIComponent(normalized)}&client_reference_id=${token}`
      : `${REP_COACH_URL}/setup?token=${token}`;

    const result = await sendEmail({
      to: normalized,
      subject: "Your AI Rep Coach Demo — Get Started",
      html: `
        <div style="font-family: system-ui, sans-serif; max-width: 520px; margin: 0 auto; padding: 40px 24px;">
          <h1 style="font-size: 28px; font-weight: 800; color: #000; margin: 0 0 16px;">
            Welcome to AI Rep Coach
          </h1>
          <p style="font-size: 16px; color: #444; line-height: 1.6; margin: 0 0 32px;">
            You're one click away from real-time AI coaching for your sales team.
            Click below to schedule your demo and start your 14-day free trial.
          </p>
          <a href="${checkoutUrl}" style="display: inline-block; background: #000; color: #facc15; font-size: 15px; font-weight: 600; padding: 14px 32px; border-radius: 9999px; text-decoration: none;">
            Schedule Your Demo →
          </a>
          <p style="font-size: 13px; color: #999; margin-top: 32px; line-height: 1.5;">
            This link expires in 24 hours. If you didn't request this, you can safely ignore this email.
          </p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 32px 0;" />
          <p style="font-size: 12px; color: #bbb;">
            AI Rep Coach · Real-time coaching for in-home sales<br />
            <a href="mailto:support@airepcoach.com" style="color: #bbb;">support@airepcoach.com</a>
          </p>
        </div>
      `,
    });

    if (!result.ok) {
      console.error("[magicLink] email send failed:", result.error);
      return res.status(500).json({ error: "Failed to send email" });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("[magicLink] request error:", err.message);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/verify", async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) return res.status(400).json({ error: "Token required" });

    const r = await db.query(
      `SELECT * FROM magic_links
        WHERE token = $1 AND purpose = 'rep_coach_signup'
          AND expires_at > now() AND used_at IS NULL`,
      [token],
    );

    if (!r.rows[0]) {
      return res.status(410).json({ error: "Link expired or already used" });
    }

    await db.query(
      `UPDATE magic_links SET used_at = now() WHERE id = $1`,
      [r.rows[0].id],
    );

    res.json({ ok: true, email: r.rows[0].email });
  } catch (err) {
    console.error("[magicLink] verify error:", err.message);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
