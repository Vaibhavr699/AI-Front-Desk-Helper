"use strict";

/**
 * routes/franchisee.js
 * Apr 19, 2026 — Franchisee invite acceptance flow (self_pays only)
 *
 * PUBLIC routes (no auth) — but token-protected. Called by the franchisee
 * frontend at /franchisee-invite/{token} to:
 *
 *   GET  /api/franchisee/invite/:token        → verify invite, return invite details
 *   POST /api/franchisee/invite/:token/checkout → start Stripe checkout for chosen plan
 *
 * Activation happens in lib/stripe.js handleWebhookEvent when checkout
 * completes (sets stripe_subscription_id, plan, subscription_status='active',
 * is_suspended=false, franchisee_invite_accepted_at=now()).
 *
 * Also includes one AUTHENTICATED route used by franchisor:
 *   POST /api/franchisee/invite/:childId/resend → regenerate token + resend email
 *
 * See conversation Apr 19 for full design rationale.
 */

const express = require("express");
const db = require("../lib/db");
const crypto = require("crypto");
const { listPlans } = require("../lib/plans");
const { createFranchiseeInviteCheckoutSession } = require("../lib/stripe");
const { sendFranchiseeInviteEmail } = require("../services/email");
const { authMiddleware } = require("../lib/auth");

const router = express.Router();

/**
 * GET /api/franchisee/invite/:token
 * PUBLIC — no auth required (the token IS the auth).
 *
 * Returns the invite details so the frontend can render the welcome page:
 *   - franchisor name + branding (logo, brand_color, etc.)
 *   - location name + slug
 *   - available plans the franchisee can pick from (basic/pro/elite)
 *   - whether the invite is already used or expired
 *
 * Does NOT return any sensitive data (no Stripe IDs, no API keys).
 */
router.get("/invite/:token", async (req, res) => {
  try {
    const token = String(req.params.token || "").trim();
    if (!token || token.length < 20) {
      return res.status(400).json({ error: "Invalid invite token" });
    }

    // Look up the child tenant by token. JOIN parent for branding context.
    const result = await db.query(
      `SELECT
         child.id              AS child_id,
         child.name            AS child_name,
         child.company_name    AS child_company_name,
         child.slug            AS child_slug,
         child.timezone        AS child_timezone,
         child.is_suspended    AS child_is_suspended,
         child.stripe_subscription_id AS child_subscription_id,
         child.franchisee_invite_token AS token,
         child.franchisee_invite_expires_at AS expires_at,
         child.franchisee_invite_accepted_at AS accepted_at,
         child.billing_responsibility AS billing_responsibility,
         child.parent_id       AS parent_id,
         parent.name           AS parent_name,
         parent.company_name   AS parent_company_name,
         parent.brand_color    AS parent_brand_color,
         parent.accent_color   AS parent_accent_color,
         parent.logo_url       AS parent_logo_url,
         parent.support_email  AS parent_support_email,
         parent.brand_mode     AS parent_brand_mode,
         parent.parent_mode    AS parent_parent_mode
       FROM tenants child
       LEFT JOIN tenants parent ON child.parent_id = parent.id
       WHERE child.franchisee_invite_token = $1
       LIMIT 1`,
      [token]
    );

    const invite = result.rows[0];
    if (!invite) {
      return res.status(404).json({
        error: "Invite not found. The link may have been used or expired. Ask your franchisor to resend.",
        code: "INVITE_NOT_FOUND",
      });
    }

    // State checks — return clear error codes the frontend can route on
    if (invite.accepted_at) {
      return res.status(409).json({
        error: "This invite has already been accepted. If you've lost access to your account, contact support.",
        code: "INVITE_ALREADY_ACCEPTED",
      });
    }

    if (invite.child_subscription_id) {
      return res.status(409).json({
        error: "This location already has an active subscription.",
        code: "INVITE_ALREADY_SUBSCRIBED",
      });
    }

    if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
      return res.status(410).json({
        error: "This invite has expired. Ask your franchisor to send a fresh link.",
        code: "INVITE_EXPIRED",
        expired_at: invite.expires_at,
      });
    }

    if (invite.billing_responsibility !== "self_pays") {
      // Defensive — should never happen since invites are only generated for self_pays
      return res.status(400).json({
        error: "This location is not configured for self-pay billing.",
        code: "INVITE_NOT_SELF_PAYS",
      });
    }

    // Return the standard plans available for the franchisee to choose
    const availablePlans = listPlans();

    res.json({
      ok: true,
      invite: {
        token: invite.token,
        expires_at: invite.expires_at,
      },
      location: {
        id: invite.child_id,
        name: invite.child_name,
        company_name: invite.child_company_name,
        slug: invite.child_slug,
        timezone: invite.child_timezone,
      },
      franchisor: {
        id: invite.parent_id,
        name: invite.parent_name,
        company_name: invite.parent_company_name,
        brand_color: invite.parent_brand_color,
        accent_color: invite.parent_accent_color,
        logo_url: invite.parent_logo_url,
        support_email: invite.parent_support_email,
        brand_mode: invite.parent_brand_mode,
        // Franchisees inherit franchisor's branding — UI shows franchisor's logo/colors
      },
      plans: availablePlans,
    });
  } catch (e) {
    console.error("[Franchisee] GET /invite/:token error:", e);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * POST /api/franchisee/invite/:token/checkout
 * Body: { plan: 'basic' | 'pro' | 'elite', interval: 'monthly' | 'annual', return_url?: string }
 * PUBLIC — no auth required (the token IS the auth).
 *
 * Validates the invite, then starts a Stripe checkout session for the
 * franchisee's CHOSEN plan against the franchisee's OWN Stripe customer.
 * On success, returns the Stripe checkout URL for the frontend to redirect to.
 *
 * The activation step happens in the Stripe webhook (lib/stripe.js)
 * when checkout.session.completed fires with type=franchisee_invite.
 */
router.post("/invite/:token/checkout", async (req, res) => {
  try {
    const token = String(req.params.token || "").trim();
    const planId = String(req.body?.plan || "").toLowerCase().trim();
    const interval = String(req.body?.interval || "monthly").toLowerCase().trim();
    const returnUrl = req.body?.return_url || null;

    if (!token || token.length < 20) {
      return res.status(400).json({ error: "Invalid invite token" });
    }
    if (!["basic", "pro", "elite"].includes(planId)) {
      return res.status(400).json({ error: "plan must be basic, pro, or elite" });
    }
    if (!["monthly", "annual"].includes(interval)) {
      return res.status(400).json({ error: "interval must be monthly or annual" });
    }

    // Verify the invite is still valid (re-check everything, don't trust the
    // GET endpoint's response since the frontend may have stale state)
    const result = await db.query(
      `SELECT id, parent_id, billing_responsibility,
              franchisee_invite_token, franchisee_invite_expires_at,
              franchisee_invite_accepted_at, stripe_subscription_id
         FROM tenants
        WHERE franchisee_invite_token = $1
        LIMIT 1`,
      [token]
    );
    const child = result.rows[0];
    if (!child) {
      return res.status(404).json({ error: "Invite not found", code: "INVITE_NOT_FOUND" });
    }
    if (child.accepted_at) {
      return res.status(409).json({ error: "Invite already accepted", code: "INVITE_ALREADY_ACCEPTED" });
    }
    if (child.stripe_subscription_id) {
      return res.status(409).json({ error: "Already subscribed", code: "INVITE_ALREADY_SUBSCRIBED" });
    }
    if (child.franchisee_invite_expires_at && new Date(child.franchisee_invite_expires_at) < new Date()) {
      return res.status(410).json({ error: "Invite expired", code: "INVITE_EXPIRED" });
    }
    if (child.billing_responsibility !== "self_pays") {
      return res.status(400).json({ error: "Not a self-pay location", code: "INVITE_NOT_SELF_PAYS" });
    }

    // Default success URL points to a generic welcome page; frontend can override
    const successReturnUrl =
      returnUrl ||
      `${(process.env.FRONTEND_URL || "http://localhost:5173").replace(/\/+$/, "")}/welcome`;

    const checkout = await createFranchiseeInviteCheckoutSession({
      childTenantId: child.id,
      parentTenantId: child.parent_id,
      planId,
      interval,
      acceptToken: token,
      successReturnUrl,
    });

    console.log(
      "[Franchisee] Created checkout for invite token=%s child=%s plan=%s interval=%s",
      token.slice(0, 8) + "...",
      child.id,
      planId,
      interval
    );

    res.json({
      ok: true,
      checkout_url: checkout.url,
      type: checkout.type,
    });
  } catch (e) {
    console.error("[Franchisee] POST /invite/:token/checkout error:", e.message);
    // Surface user-facing error message but don't leak stack traces
    const status = e.message && /not found|already|expired|invalid/i.test(e.message) ? 400 : 500;
    res.status(status).json({ error: e.message || "Server error" });
  }
});

/**
 * POST /api/franchisee/invite/:childId/resend
 * AUTHENTICATED — franchisor only (must be owner/admin of parent or superadmin)
 *
 * Generates a fresh invite token (extends 14 more days) and re-sends the
 * invite email to the same address. Does NOT change the child tenant
 * (still pending, still suspended, no subscription yet).
 *
 * Body: { franchisee_email?: string }  — optional, defaults to original email
 */
router.post("/invite/:childId/resend", authMiddleware, async (req, res) => {
  try {
    const childId = req.params.childId;

    // Look up child + parent for auth check
    const result = await db.query(
      `SELECT child.*, parent.id AS parent_id_check
         FROM tenants child
         LEFT JOIN tenants parent ON child.parent_id = parent.id
        WHERE child.id = $1`,
      [childId]
    );
    const child = result.rows[0];
    if (!child) return res.status(404).json({ error: "Location not found" });

    // Auth: must be owner/admin of the parent OR superadmin
    if (!req.user?.is_super_admin) {
      if (req.user?.tenant_id !== child.parent_id) {
        return res.status(403).json({ error: "You don't have access to this parent tenant" });
      }
      if (!["owner", "admin"].includes(req.user?.role)) {
        return res.status(403).json({ error: "Only owners and admins can resend invites" });
      }
    }

    if (child.billing_responsibility !== "self_pays") {
      return res.status(400).json({ error: "This location is not configured for self-pay billing" });
    }
    if (child.franchisee_invite_accepted_at) {
      return res.status(409).json({ error: "This invite has already been accepted" });
    }
    if (child.stripe_subscription_id) {
      return res.status(409).json({ error: "This location already has an active subscription" });
    }

    const franchiseeEmail = String(req.body?.franchisee_email || "").trim().toLowerCase();
    if (franchiseeEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(franchiseeEmail)) {
      return res.status(400).json({ error: "franchisee_email must be a valid email" });
    }

    // Generate fresh token + 14-day expiry
    const newToken = crypto.randomBytes(32).toString("base64url");
    const newExpires = new Date();
    newExpires.setDate(newExpires.getDate() + 14);

    await db.query(
      `UPDATE tenants
          SET franchisee_invite_token = $1,
              franchisee_invite_expires_at = $2,
              updated_at = now()
        WHERE id = $3`,
      [newToken, newExpires.toISOString(), childId]
    );

    // Get parent for the email
    const parentResult = await db.query("SELECT * FROM tenants WHERE id = $1", [child.parent_id]);
    const parent = parentResult.rows[0];

    const frontendBase = (process.env.FRONTEND_URL || "http://localhost:5173").replace(/\/+$/, "");
    const inviteUrl = `${frontendBase}/franchisee-invite/${newToken}`;

    // Determine recipient: explicit override OR fall back to whatever was used originally
    // (We don't currently store the original email — if frontend doesn't pass one,
    // the franchisor will need to pass it explicitly. Future improvement: store
    // franchisee_invite_email on the tenant row.)
    if (!franchiseeEmail) {
      return res.status(400).json({
        error: "franchisee_email is required when resending. We don't store the original recipient.",
      });
    }

    const updatedChild = { ...child, franchisee_invite_token: newToken, franchisee_invite_expires_at: newExpires.toISOString() };

    sendFranchiseeInviteEmail({
      parentTenant: parent,
      newLocation: updatedChild,
      franchiseeEmail,
      inviteUrl,
      expiresAt: newExpires.toISOString(),
    }).catch((e) =>
      console.error("[Franchisee] Resend email failed:", e.message)
    );

    console.log(
      "[Franchisee] Resent invite for child=%s to %s (new expiry %s)",
      childId,
      franchiseeEmail,
      newExpires.toISOString()
    );

    res.json({
      ok: true,
      invite: {
        url: inviteUrl,
        sent_to: franchiseeEmail,
        expires_at: newExpires.toISOString(),
      },
    });
  } catch (e) {
    console.error("[Franchisee] Resend error:", e);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
