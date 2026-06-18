"use strict";

// ── /api/rep/profile ────────────────────────────────────────────────────────
//   GET    — returns profile + tenant + seat info + coaching delivery prefs
//   PATCH  — updates the fields the rep is allowed to edit themselves:
//              • coaching_delivery_prefs (audio/watch/popup/sidebar toggles)
//              • preferred_earbud_device (Phase 6 D v1)
//
// Tenant name, role, seat tier, and email are not editable from the app —
// those changes go through the dashboard team management flow.
// ────────────────────────────────────────────────────────────────────────────

const express = require("express");
const db = require("../../lib/db");
const repAuth = require("../../lib/repAuth");
const { repAuthChain } = require("../../lib/requireRep");
const { normalizeE164Phone } = require("../../lib/phone");
const { isValidUsState } = require("../../lib/usStates");

const router = express.Router();

router.get("/", ...repAuthChain, async (req, res) => {
  try {
    const r = await db.query(
      `SELECT u.id, u.email, u.role, u.tenant_id, u.phone, u.home_state,
              u.rep_seat_tier, u.rep_seat_activated_at,
              u.seat_type, u.rep_coach_account_type, u.trial_ends_at,
              u.coaching_delivery_prefs, u.preferred_earbud_device,
              u.expo_push_token IS NOT NULL AS push_registered,
              u.last_app_open_at, u.trusted_devices,
              t.name AS tenant_name, t.business_type AS tenant_business_type,
              t.timezone AS tenant_timezone,
              t.rep_coach_enabled, t.aifdh_enabled
         FROM dashboard_users u
         LEFT JOIN tenants t ON u.tenant_id = t.id
        WHERE u.id = $1`,
      [req.rep.id]
    );
    const u = r.rows[0];
    if (!u) return res.status(404).json({ error: "Profile not found" });

    const now = Date.now();
    const trustedDevices = Array.isArray(u.trusted_devices)
      ? u.trusted_devices
          .filter((d) => d && d.expires_at && new Date(d.expires_at).getTime() > now)
          .map((d) => ({
            fingerprint: d.fingerprint,
            biometric_type: d.biometric_type || null,
            registered_at: d.registered_at,
            expires_at: d.expires_at,
          }))
      : [];

    res.json({
      id: u.id,
      email: u.email,
      phone: u.phone || null,
      home_state: u.home_state || null,
      role: u.role,
      tenant: {
        id: u.tenant_id,
        name: u.tenant_name,
        business_type: u.tenant_business_type,
        timezone: u.tenant_timezone,
        rep_coach_enabled: u.rep_coach_enabled === true,
        aifdh_enabled: u.aifdh_enabled !== false,
      },
      seat: {
        tier: u.rep_seat_tier || "standard",
        activated_at: u.rep_seat_activated_at,
        seat_type: u.seat_type || null,
        account_type: u.rep_coach_account_type || null,
        trial_ends_at: u.trial_ends_at || null,
      },
      coaching_delivery_prefs: u.coaching_delivery_prefs || {},
      preferred_earbud_device: u.preferred_earbud_device,
      push_registered: u.push_registered,
      last_app_open_at: u.last_app_open_at,
      trusted_devices: trustedDevices,
    });
  } catch (e) {
    console.error("[rep/profile GET]", e);
    res.status(500).json({ error: "Server error" });
  }
});

router.patch("/", ...repAuthChain, async (req, res) => {
  try {
    const updates = [];
    const values = [];
    let p = 1;

    if (req.body?.coaching_delivery_prefs && typeof req.body.coaching_delivery_prefs === "object") {
      // Accept only known channel keys/types so the client can't store arbitrary JSON.
      const incoming = req.body.coaching_delivery_prefs;
      const clean = {};
      for (const ch of ["popup", "sidebar", "watch", "audio"]) {
        if (typeof incoming[ch] === "boolean") clean[ch] = incoming[ch];
      }
      const gap = Number(incoming.audio_min_gap_seconds);
      if (Number.isFinite(gap) && gap >= 0 && gap <= 3600) {
        clean.audio_min_gap_seconds = Math.round(gap);
      }
      if (Object.keys(clean).length > 0) {
        // Merge over current prefs so partial updates don't clobber other channels.
        const current = await db.query(
          "SELECT coaching_delivery_prefs FROM dashboard_users WHERE id = $1",
          [req.rep.id]
        );
        const merged = { ...(current.rows[0]?.coaching_delivery_prefs || {}), ...clean };
        updates.push(`coaching_delivery_prefs = $${p++}::jsonb`);
        values.push(JSON.stringify(merged));
      }
    }
    if (typeof req.body?.preferred_earbud_device === "string" || req.body?.preferred_earbud_device === null) {
      updates.push(`preferred_earbud_device = $${p++}`);
      values.push(req.body.preferred_earbud_device);
    }
    if (typeof req.body?.phone === "string" || req.body?.phone === null) {
      const raw = req.body.phone;
      let phoneValue = null;
      if (raw && raw.trim().length > 0) {
        phoneValue = normalizeE164Phone(raw);
        if (!phoneValue) {
          return res.status(400).json({ error: "Phone must be a valid number", code: "PHONE_INVALID" });
        }
      }
      updates.push(`phone = $${p++}`);
      values.push(phoneValue);
    }
    if (typeof req.body?.home_state === "string" || req.body?.home_state === null) {
      let stateValue = null;
      if (req.body.home_state) {
        const code = String(req.body.home_state).trim().toUpperCase();
        if (!isValidUsState(code)) {
          return res.status(400).json({ error: "Invalid state", code: "STATE_INVALID" });
        }
        stateValue = code;
      }
      updates.push(`home_state = $${p++}`);
      values.push(stateValue);
    }
    if (updates.length === 0) {
      return res.status(400).json({ error: "No editable fields in body" });
    }
    values.push(req.rep.id);
    await db.query(
      `UPDATE dashboard_users SET ${updates.join(", ")}, updated_at = now() WHERE id = $${p}`,
      values
    );
    await repAuth.logRepEvent(req, {
      user_id: req.rep.id,
      tenant_id: req.rep.tenant_id,
      event_type: "rep_profile_updated",
      metadata: { fields: updates.map((u) => u.split(" ")[0]) },
    });
    res.json({ status: "ok" });
  } catch (e) {
    console.error("[rep/profile PATCH]", e);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
