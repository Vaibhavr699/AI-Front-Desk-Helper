"use strict";

const express = require("express");
const auth = require("../lib/auth");
const db = require("../lib/db");

const router = express.Router();

const emailService = require("../services/email");

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password required" });
    }
    const user = await auth.findUserByEmail(email.trim().toLowerCase());
    if (!user) {
      return res.status(401).json({ error: "Invalid email or password" });
    }
    const valid = await auth.verifyPassword(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: "Invalid email or password" });
    }
    const token = auth.signToken({
      sub: user.id,
      email: user.email,
      tenant_id: user.tenant_id,
      role: user.role,
      is_super_admin: user.is_super_admin === true,
    });
    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        tenant_id: user.tenant_id,
        role: user.role,
        is_super_admin: user.is_super_admin === true,
      },
    });
  } catch (e) {
    console.error("Login error:", e);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/signup", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password required" });
    }
    const normalized = email.trim().toLowerCase();
    if (password.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters" });
    }
    const existing = await auth.findUserByEmail(normalized);
    if (existing) {
      return res.status(409).json({ error: "An account with this email already exists" });
    }
    const hash = await auth.hashPassword(password);
    const r = await db.query(
      "INSERT INTO dashboard_users (email, password_hash, role) VALUES ($1, $2, 'viewer') RETURNING id, email, tenant_id, role",
      [normalized, hash]
    );
    const user = r.rows[0];
    const token = auth.signToken({
      sub: user.id,
      email: user.email,
      tenant_id: user.tenant_id,
      role: user.role,
    });
    res.status(201).json({
      token,
      user: {
        id: user.id,
        email: user.email,
        tenant_id: user.tenant_id,
        role: user.role,
      },
    });
  } catch (e) {
    console.error("Signup error:", e);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ error: "Email required" });
    const normalized = email.trim().toLowerCase();
    const user = await auth.findUserByEmail(normalized);
    if (!user) {
      console.log("[Auth] Forgot password: no user found for", normalized);
      return res.json({ message: "If an account exists with that email, a reset link has been sent." });
    }
    const token = auth.generateResetToken();
    const expires = new Date(Date.now() + 3600000); // 1 hour
    await auth.saveResetToken(user.email, token, expires);

    const base = (process.env.DASHBOARD_URL || process.env.BASE_URL || "").replace(/\/$/, "");
    const resetLink = base ? `${base}/reset-password?token=${token}` : "";
    if (!resetLink) {
      console.warn("[Auth] DASHBOARD_URL or BASE_URL not set – password reset email not sent. Set one so the reset link works.");
      return res.json({ message: "If an account exists with that email, a reset link has been sent." });
    }
    const result = await emailService.sendPasswordResetEmail(user.email, resetLink);
    if (!result.ok) {
      console.error("[Auth] Password reset email failed for", user.email, ":", result.error);
    } else {
      console.log("[Auth] Password reset email sent to", user.email);
    }
    res.json({ message: "If an account exists with that email, a reset link has been sent." });
  } catch (e) {
    console.error("Forgot password error:", e);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/reset-password", async (req, res) => {
  try {
    const { token, password } = req.body || {};
    if (!token || !password) {
      return res.status(400).json({ error: "Token and password required" });
    }
    const user = await auth.findUserByResetToken(token);
    if (!user) {
      return res.status(400).json({ error: "Invalid or expired reset token" });
    }
    const hash = await auth.hashPassword(password);
    await auth.updatePassword(user.id, hash);
    res.json({ message: "Password updated successfully" });
  } catch (e) {
    console.error("Reset password error:", e);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
