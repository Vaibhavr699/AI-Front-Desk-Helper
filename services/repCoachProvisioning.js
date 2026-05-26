"use strict";

const crypto = require("crypto");
const db = require("../lib/db");
const { sendEmail } = require("./email");

const APP_STORE_URL = process.env.REP_COACH_APP_STORE_URL || "https://apps.apple.com";
const PLAY_STORE_URL = process.env.REP_COACH_PLAY_STORE_URL || "https://play.google.com";
const DASHBOARD_URL = process.env.DASHBOARD_URL || process.env.BASE_URL || "";

async function provisionFromCheckout(session) {
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
    console.log("[repCoachProvisioning] enabled rep coach for existing tenant=%s user=%s", tenantId, email);
    return;
  }

  const tempPassword = crypto.randomBytes(6).toString("base64url");
  const bcrypt = require("bcrypt");
  const hashedPassword = await bcrypt.hash(tempPassword, 10);

  const tenantResult = await db.query(
    `INSERT INTO tenants (name, plan, subscription_status, stripe_subscription_id, stripe_customer_id, rep_coach_enabled)
     VALUES ($1, $2, 'active', $3, $4, true)
     RETURNING id`,
    [
      email.split("@")[1]?.split(".")[0] || "My Company",
      "basic",
      session.subscription || null,
      session.customer || null,
    ],
  );
  const tenantId = tenantResult.rows[0].id;

  await db.query(
    `INSERT INTO dashboard_users (tenant_id, email, password, role, rep_seat_active, rep_seat_tier)
     VALUES ($1, $2, $3, 'admin', true, 'standard')`,
    [tenantId, email, hashedPassword],
  );

  console.log("[repCoachProvisioning] created tenant=%s user=%s", tenantId, email);

  const loginUrl = DASHBOARD_URL ? `${DASHBOARD_URL}/login` : "";

  await sendEmail({
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
            <strong>Temporary password:</strong> ${tempPassword}
          </p>
        </div>

        ${loginUrl ? `<a href="${loginUrl}" style="display: inline-block; background: #000; color: #facc15; font-size: 15px; font-weight: 600; padding: 14px 32px; border-radius: 9999px; text-decoration: none; margin-bottom: 24px;">
          Log in to Dashboard →
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
