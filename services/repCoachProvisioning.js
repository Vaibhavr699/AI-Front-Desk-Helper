"use strict";

const crypto = require("crypto");
const db = require("../lib/db");
const auth = require("../lib/auth");
const { sendEmail, REP_COACH_FROM } = require("./email");

const DASHBOARD_URL = process.env.DASHBOARD_URL || process.env.BASE_URL || "";

const SET_PASSWORD_TTL_HOURS = 24;

// One-time set-password link (Drew's locked decision: no temp passwords).
// Reuses the EXISTING, battle-tested reset-token flow (lib/auth saveResetToken +
// the /api/auth/reset-password handler) — no new endpoint. The link lands on the
// dashboard's /reset-password page, which clears the token after use.
async function createSetPasswordLink(email) {
  try {
    const token = auth.generateResetToken();
    const expires = new Date(Date.now() + SET_PASSWORD_TTL_HOURS * 3600 * 1000);
    await auth.saveResetToken(email.trim().toLowerCase(), token, expires);
    const base = DASHBOARD_URL.replace(/\/$/, "");
    return base ? `${base}/reset-password?token=${token}` : "";
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

  const trialLine = isTrial && trialEndsAt
    ? `Your 14-day free trial is active until <strong>${trialEndsAt.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</strong>. You won't be charged until then — cancel anytime before.`
    : `Your subscription is active.`;

  await sendEmail({
    from: REP_COACH_FROM,
    to: email,
    subject: "Welcome to AI Rep Coach — set your password to get started",
    html: `
      <div style="font-family: -apple-system, system-ui, sans-serif; max-width: 520px; margin: 0 auto; background: #ffffff;">
        <div style="background: #000; padding: 28px 32px;">
          <span style="font-size: 13px; font-weight: 700; letter-spacing: 2px; color: #facc15;">AI REP COACH</span>
        </div>

        <div style="padding: 36px 32px;">
          <h1 style="font-size: 24px; font-weight: 800; color: #000; margin: 0 0 12px;">
            You're in. Let's get you set up.
          </h1>
          <p style="font-size: 15px; color: #444; line-height: 1.6; margin: 0 0 8px;">
            Your account for <strong>${email}</strong> is ready.
          </p>
          <p style="font-size: 14px; color: #666; line-height: 1.6; margin: 0 0 28px;">
            ${trialLine}
          </p>

          <div style="background: #f8f8f8; border-radius: 12px; padding: 24px; margin-bottom: 28px; text-align: center;">
            <p style="margin: 0 0 16px; font-size: 14px; color: #444;">
              First, set your password — this secure link expires in 24 hours.
            </p>
            ${setPasswordUrl
              ? `<a href="${setPasswordUrl}" style="display: inline-block; background: #000; color: #facc15; font-size: 15px; font-weight: 700; padding: 14px 36px; border-radius: 9999px; text-decoration: none;">
                   Set your password →
                 </a>`
              : `<p style="font-size: 13px; color: #991b1b; margin: 0;">We couldn't generate your set-password link — reply to this email and we'll sort it out.</p>`}
          </div>

          <h2 style="font-size: 16px; font-weight: 700; color: #000; margin: 0 0 10px;">
            Get the mobile app
          </h2>
          <p style="font-size: 14px; color: #444; line-height: 1.6; margin: 0 0 8px;">
            Reps use the AI Rep Coach app during in-home visits for real-time coaching cues.
          </p>
          <div style="background: #fffbeb; border: 1px solid #fde68a; border-radius: 10px; padding: 14px 16px; margin-bottom: 28px;">
            <p style="font-size: 13px; color: #92400e; margin: 0; font-weight: 600;">
              📱 App download coming soon — we'll email you the install link as soon as it's live.
            </p>
          </div>

          <h2 style="font-size: 16px; font-weight: 700; color: #000; margin: 0 0 10px;">
            What's next
          </h2>
          <ol style="font-size: 14px; color: #444; line-height: 1.8; padding-left: 20px; margin: 0 0 8px;">
            <li>Set your password using the button above</li>
            <li>Log in and explore your coaching dashboard</li>
            <li>Install the app (link coming soon) and start an in-home session</li>
            <li>AI coaching cues fire automatically during the visit</li>
          </ol>
        </div>

        <div style="padding: 24px 32px; border-top: 1px solid #eee;">
          <p style="font-size: 12px; color: #999; margin: 0; line-height: 1.6;">
            AI Rep Coach · Real-time coaching for in-home sales<br />
            Need help? <a href="mailto:support@airepcoach.com" style="color: #999;">support@airepcoach.com</a>
          </p>
        </div>
      </div>
    `,
  });
}

module.exports = { provisionFromCheckout };
