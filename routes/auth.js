"use strict";

const express = require("express");
const auth = require("../lib/auth");
const db = require("../lib/db");

const router = express.Router();

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

module.exports = router;
