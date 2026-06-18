"use strict";

const crypto = require("crypto");
const db = require("../lib/db");
const { sendEmail, REP_COACH_FROM } = require("./email");

const APP_STORE_URL = process.env.REP_COACH_APP_STORE_URL || "https://apps.apple.com";
const PLAY_STORE_URL = process.env.REP_COACH_PLAY_STORE_URL || "https://play.google.com";
const DASHBOARD_URL = process.env.DASHBOARD_URL || process.env.BASE_URL || "";
const REP_COACH_URL = process.env.REP_COACH_URL || "https://airepcoach.com";

const SET_PASSWORD_TTL_HOURS = 24;

// One-time set-password link (Drew's locked decision: no temp passwords).
// Reuses the magic_links table with a dedicated purpose. Returns the URL or ""
// if the link couldn't be created (caller degrades gracefully).
async function createSetPasswordLink(email) {
  try {
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + SET_PASSWORD_TTL_HOURS * 3600 * 1000);
    await db.query(
      `INSERT INTO magic_links (email, token, purpose, expires_at)
       VALUES ($1, $2, 'rep_coach_set_password', $3)`,
      [email.trim().toLowerCase(), token, expiresAt],
    );
    return `${REP_COACH_URL}/set-password?token=${token}`;
  } catch (err) {
    console.error("[repCoachProvisioning] set-password link failed:", err.message);
    return "";
  }
}

async function provisionFromCheckout(session, opts = {}) {
  const seatTier = ["standard", "pro", "elite"].includes(opts.tier) ? opts.tier : "standard";
  const customerEmail = session.customer_details?.email || session.customer_email;
  const magicLinkToken = session.client_reference_id;

  if (!customerEmail) {
    console.error("[repCoachProvisioning] no customer email in session");
    return;
  }

  let magicLink = null;
  if (magicLinkToken) {
    const r = await db.query(
      "SELECT * FROM magic_links WHERE token = $1 AND purpose = 'rep_coach_signup'",
      [magicLinkToken],
    );
    magicLink = r.rows[0] || null;
    if (magicLink && !magicLink.used_at) {
      await db.query("UPDATE magic_links SET used_at = now() WHERE id = $1", [magicLink.id]);
    }
  }

  const email = (magicLink?.email || customerEmail).trim().toLowerCase();

  const existingUser = await db.query(
    "SELECT id, tenant_id FROM dashboard_users WHERE email = $1",
    [email],
  );
  if (existingUser.rows[0]) {
    const tenantId = existingUser.rows[0].tenant_id;
    await db.query(
      `UPDATE tenants
          SET rep_coach_enabled = true,
              stripe_subscription_id = COALESCE($1, stripe_subscription_id),
              subscription_status = 'active',
              updated_at = now()
        WHERE id = $2`,
      [session.subscription || null, tenantId],
    );
    await db.query(
      `UPDATE dashboard_users
          SET rep_seat_active = true,
              rep_seat_tier = $1,
              seat_type = COALESCE(seat_type, 'rep'),
              rep_coach_account_type = COALESCE(rep_coach_account_type, 'manager_provisioned'),
              rep_seat_activated_at = COALESCE(rep_seat_activated_at, now()),
              updated_at = now()
        WHERE id = $2`,
      [seatTier, existingUser.rows[0].id],
    );
    console.log("[repCoachProvisioning] enabled rep coach (tier=%s) for existing tenant=%s user=%s", seatTier, tenantId, email);
    return;
  }

  // No temp password (Drew's locked decision). The account is created without a
  // usable password; the welcome email carries a one-time set-password link.
  const placeholderHash = await require("bcrypt").hash(
    crypto.randomBytes(24).toString("hex"),
    10,
  );

  const companyName = email.split("@")[1]?.split(".")[0] || "My Company";
  const slugBase =
    companyName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "company";
  const slug = `${slugBase}-${crypto.randomBytes(3).toString("hex")}`;

  // GUESSED DEFAULT (flag for Drew): standalone trial accounts start in
  // 'trialing' until Stripe charges at trial end. trial_ends_at mirrors the
  // subscription's trial_end if present.
  const isTrial = opts.isTrial === true || Boolean(opts.trialEnd);
  const subscriptionStatus = isTrial ? "trialing" : "active";
  const trialEndsAt = opts.trialEnd ? new Date(opts.trialEnd * 1000) : null;

  const tenantResult = await db.query(
    `INSERT INTO tenants (name, company_name, slug, plan, subscription_status, stripe_subscription_id, stripe_customer_id, rep_coach_enabled, aifdh_enabled)
     VALUES ($1, $1, $2, 'basic', $5, $3, $4, true, false)
     RETURNING id`,
    [
      companyName,
      slug,
      session.subscription || null,
      session.customer || null,
      subscriptionStatus,
    ],
  );
  const tenantId = tenantResult.rows[0].id;

  await db.query(
    `INSERT INTO dashboard_users
       (tenant_id, email, password_hash, role, rep_seat_active, rep_seat_tier,
        seat_type, rep_coach_account_type, trial_ends_at)
     VALUES ($1, $2, $3, 'admin', true, $4, 'rep', 'standalone', $5)`,
    [tenantId, email, placeholderHash, seatTier, trialEndsAt],
  );

  console.log("[repCoachProvisioning] created standalone tenant=%s user=%s trial=%s", tenantId, email, isTrial);

  const setPasswordUrl = await createSetPasswordLink(email);

  await sendEmail({
    from: REP_COACH_FROM,
    to: email,
    subject: "Welcome to AI Rep Coach — Your account is ready",
    html: `
      <div style="font-family: system-ui, sans-serif; max-width: 520px; margin: 0 auto; padding: 40px 24px;">
        <h1 style="font-size: 24px; font-weight: 800; color: #000; margin: 0 0 16px;">
          You're in! Welcome to AI Rep Coach.
        </h1>
        <p style="font-size: 15px; color: #444; line-height: 1.6; margin: 0 0 24px;">
          Your account has been created. Here's how to get started:
        </p>

        <div style="background: #f5f5f5; border-radius: 12px; padding: 20px; margin-bottom: 24px;">
          <p style="margin: 0 0 8px; font-size: 13px; color: #888; font-weight: 600;">YOUR LOGIN</p>
          <p style="margin: 0; font-size: 15px; color: #000;">
            <strong>Email:</strong> ${email}<br />
            Set your password using the secure link below — it expires in 24 hours.
          </p>
        </div>

        ${setPasswordUrl ? `<a href="${setPasswordUrl}" style="display: inline-block; background: #000; color: #facc15; font-size: 15px; font-weight: 600; padding: 14px 32px; border-radius: 9999px; text-decoration: none; margin-bottom: 24px;">
          Set your password →
        </a>` : ""}

        <h2 style="font-size: 18px; font-weight: 700; color: #000; margin: 32px 0 12px;">
          Download the mobile app
        </h2>
        <p style="font-size: 14px; color: #444; line-height: 1.6; margin: 0 0 16px;">
          Your reps use the mobile app during in-home visits to receive real-time coaching cues.
        </p>
        <p style="font-size: 14px;">
          <a href="${APP_STORE_URL}" style="color: #2563eb; font-weight: 600;">App Store (iOS)</a>
          &nbsp;&nbsp;|&nbsp;&nbsp;
          <a href="${PLAY_STORE_URL}" style="color: #2563eb; font-weight: 600;">Play Store (Android)</a>
        </p>

        <h2 style="font-size: 18px; font-weight: 700; color: #000; margin: 32px 0 12px;">
          Next steps
        </h2>
        <ol style="font-size: 14px; color: #444; line-height: 1.8; padding-left: 20px; margin: 0;">
          <li>Log in to the dashboard and change your password</li>
          <li>Invite your reps from the Team page</li>
          <li>Have reps download the app and log in</li>
          <li>Start an in-home session — AI coaching cues will fire automatically</li>
        </ol>

        <hr style="border: none; border-top: 1px solid #eee; margin: 32px 0;" />
        <p style="font-size: 12px; color: #bbb;">
          AI Rep Coach · Real-time coaching for in-home sales<br />
          <a href="mailto:support@airepcoach.com" style="color: #bbb;">support@airepcoach.com</a>
        </p>
      </div>
    `,
  });
}

module.exports = { provisionFromCheckout };
