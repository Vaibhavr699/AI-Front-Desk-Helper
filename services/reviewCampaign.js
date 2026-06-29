"use strict";

/**
 * services/reviewCampaign.js
 *
 * Automated post-job review-request drip (NiceJob-style). COMPLIANT design:
 * every enrolled customer is asked, every message links to the tenant's public
 * Google review page. No review-gating (Google policy + FTC rule).
 *
 * Lifecycle:
 *   startReviewCampaign(tenantId, customer)  ← trigger (job-won webhook OR
 *                                               manual "request review" button)
 *   processDueReviewCampaigns()              ← cron, fires due steps
 *   completeCampaignsForReview(...)          ← exit-on-review (called from
 *                                               reviewScheduler when a new
 *                                               review lands)
 *   stopCampaign(id)                         ← tenant Stop button
 *
 * DEFAULT cadence (tenant-overridable via tenants.review_campaign_steps):
 *   day 1  → SMS
 *   day 3  → SMS
 *   day 7  → EMAIL  (falls back to SMS if no email on file)
 *
 * Exit conditions: review detected | all steps sent | tenant Stop | DNC/STOP.
 *
 * Reuses existing infra:
 *   lib/outboundSms.send         — visibility-logged SMS (messages table)
 *   services/email.sendEmail     — visibility-logged email
 *   services/sms.isPhoneDoNotContact — TCPA/DNC gate
 */

const db = require("../lib/db");

// ── Default cadence ─────────────────────────────────────────────────────────
// Each step: { day, channel:"sms"|"email", smsFallback?:bool }
// day = days after enrollment (≈ job completion). The day-7 email falls back
// to SMS when the customer has no email on file (Drew decision Jun 23).
const DEFAULT_STEPS = [
  { day: 1, channel: "sms" },
  { day: 3, channel: "sms" },
  { day: 7, channel: "email", smsFallback: true },
];

// Default message templates. Tokens: {{first_name}} {{company_name}} {{review_link}}
// SMS includes STOP opt-out (TCPA). Tenants can override per-step in config.
const DEFAULT_SMS_BODY =
  "Hi {{first_name}}, thanks again for choosing {{company_name}}! " +
  "If you have a moment, we'd really appreciate a quick Google review: {{review_link}} " +
  "Reply STOP to opt out.";

const DEFAULT_EMAIL_SUBJECT = "How did we do, {{first_name}}?";
const DEFAULT_EMAIL_BODY =
  "Hi {{first_name}}, thank you for choosing {{company_name}}. " +
  "If you were happy with our work, a quick Google review would mean a lot and helps other " +
  'homeowners find us. You can leave one here: <a href="{{review_link}}">{{review_link}}</a>. ' +
  "Thank you!";

// ── Helpers ─────────────────────────────────────────────────────────────────

function addDays(d, days) {
  const out = new Date(d);
  out.setTime(out.getTime() + days * 24 * 60 * 60 * 1000);
  return out;
}

function getFirstName(fullName) {
  if (!fullName || typeof fullName !== "string") return "there";
  return fullName.trim().split(/\s+/)[0] || "there";
}

function last10(phone) {
  return String(phone || "").replace(/\D/g, "").slice(-10);
}

function substitute(text, vars) {
  if (typeof text !== "string" || !text) return "";
  return text
    .replace(/\{\{\s*first_name\s*\}\}/gi, vars.first_name || "there")
    .replace(/\{\{\s*company_name\s*\}\}/gi, vars.company_name || "")
    .replace(/\{\{\s*review_link\s*\}\}/gi, vars.review_link || "");
}

// Resolve the step array for a tenant: custom (jsonb) or the default recipe.
function resolveSteps(tenant) {
  const custom = tenant.review_campaign_steps;
  if (Array.isArray(custom) && custom.length > 0) {
    // Normalize + sort by day; keep only sms/email channels.
    return custom
      .filter((s) => s && (s.channel === "sms" || s.channel === "email") && Number.isFinite(Number(s.day)))
      .map((s) => ({
        day: Number(s.day),
        channel: s.channel,
        message: typeof s.message === "string" ? s.message : null,
        subject: typeof s.subject === "string" ? s.subject : null,
        smsFallback: s.channel === "email" ? s.smsFallback !== false : false,
      }))
      .sort((a, b) => a.day - b.day);
  }
  return DEFAULT_STEPS.map((s) => ({ ...s, message: null, subject: null }));
}

// ── Tenant config loader ────────────────────────────────────────────────────

async function getTenantForCampaign(tenantId) {
  const res = await db.query(
    `SELECT id, name, company_name, city, state,
            review_campaign_enabled, review_link, review_campaign_steps,
            google_location_id
       FROM tenants WHERE id = $1`,
    [tenantId]
  );
  return res.rows[0] || null;
}

// ── Public: startReviewCampaign ─────────────────────────────────────────────
//
// Enroll a customer. Idempotent per (tenant, phone) for ACTIVE campaigns —
// a customer already mid-campaign won't be double-enrolled. The first step
// fires after its `day` delay (default day 1), giving the tenant a window to
// Stop before anything sends.
//
// customer = { leadId?, name, phone, email }
//
// Returns the campaign row, or null (disabled / no-config / no-contact / dupe).

async function startReviewCampaign(tenantId, customer = {}, options = {}) {
  const tenant = await getTenantForCampaign(tenantId);
  if (!tenant) return null;

  // Master switch.
  if (!tenant.review_campaign_enabled) {
    console.log("[ReviewCampaign] disabled for tenant=%s — skip enroll", tenantId);
    return null;
  }

  // Need a review link to send anything meaningful.
  if (!tenant.review_link) {
    console.log("[ReviewCampaign] no review_link for tenant=%s — skip enroll", tenantId);
    return null;
  }

  const phone = customer.phone || null;
  const email = customer.email || null;
  if (!phone && !email) {
    console.log("[ReviewCampaign] no contact method for enroll tenant=%s", tenantId);
    return null;
  }

  // Dedupe: existing ACTIVE campaign for this phone (or lead) → skip.
  if (phone) {
    const dupe = await db.query(
      `SELECT id FROM review_campaigns
        WHERE tenant_id = $1 AND status = 'active'
          AND right(regexp_replace(COALESCE(contact_phone,''), '[^0-9]', '', 'g'), 10) = $2
        LIMIT 1`,
      [tenantId, last10(phone)]
    );
    if (dupe.rows.length > 0) {
      console.log("[ReviewCampaign] active campaign already exists tenant=%s phone=%s", tenantId, phone);
      return dupe.rows[0];
    }
  }

  const steps = resolveSteps(tenant);
  if (steps.length === 0) {
    console.log("[ReviewCampaign] no usable steps tenant=%s — skip", tenantId);
    return null;
  }

  const now = new Date();
  const firstSendAt = addDays(now, steps[0].day);

  const res = await db.query(
    `INSERT INTO review_campaigns
       (tenant_id, lead_id, contact_name, contact_phone, contact_email,
        status, current_step, next_send_at, enrolled_at, job_completed_at, source)
     VALUES ($1,$2,$3,$4,$5,'active',0,$6,now(),$7,$8)
     RETURNING *`,
    [
      tenantId,
      customer.leadId || null,
      customer.name || null,
      phone,
      email,
      firstSendAt.toISOString(),
      options.jobCompletedAt || now.toISOString(),
      options.source || "job_completed",
    ]
  );

  console.log("[ReviewCampaign] enrolled tenant=%s phone=%s first_send=%s",
    tenantId, phone || "(none)", firstSendAt.toISOString());
  return res.rows[0];
}

// ── Public: processDueReviewCampaigns (cron) ────────────────────────────────

async function processDueReviewCampaigns() {
  const due = await db.query(
    `SELECT * FROM review_campaigns
      WHERE status = 'active' AND next_send_at <= now()
      ORDER BY next_send_at
      LIMIT 50`
  );

  let processed = 0;
  for (const campaign of due.rows) {
    try {
      await executeCampaignStep(campaign);
      processed++;
    } catch (e) {
      console.error("[ReviewCampaign] step failed id=%s err=%s", campaign.id, e.message);
    }
  }
  if (processed > 0) console.log("[ReviewCampaign] processed %d due campaign(s)", processed);
}

// ── Execute one step ────────────────────────────────────────────────────────

async function executeCampaignStep(campaign) {
  const tenant = await getTenantForCampaign(campaign.tenant_id);
  if (!tenant) {
    await markStatus(campaign.id, "stopped");
    return;
  }

  // Tenant turned the feature off after enrollment → stop quietly.
  if (!tenant.review_campaign_enabled) {
    console.log("[ReviewCampaign] tenant disabled mid-campaign id=%s — stopping", campaign.id);
    await markStatus(campaign.id, "stopped");
    return;
  }

  const steps = resolveSteps(tenant);
  const idx = campaign.current_step;

  // No more steps → completed (sent everything).
  if (idx >= steps.length) {
    await markCompleted(campaign.id, "all_steps_sent");
    return;
  }

  const step = steps[idx];

  // DNC / STOP gate (TCPA). Applies to SMS sends. If on the list, log a
  // skipped touch and advance (don't keep retrying a DNC'd contact).
  const smsService = require("./sms");
  const phoneBlocked = campaign.contact_phone
    ? await smsService.isPhoneDoNotContact(tenant.id, campaign.contact_phone)
    : true;

  const vars = {
    first_name:   getFirstName(campaign.contact_name),
    company_name: tenant.company_name || tenant.name || "",
    review_link:  tenant.review_link || "",
  };

  // Decide effective channel: email step with no email + smsFallback → sms.
  let channel = step.channel;
  if (channel === "email" && !campaign.contact_email && step.smsFallback) {
    channel = "sms";
  }

  if (channel === "sms") {
    if (!campaign.contact_phone) {
      // No phone for an SMS step → skip this step, advance.
      await logTouch(campaign, idx, "sms", null, "skipped_no_phone");
      await advance(campaign, steps);
      return;
    }
    if (phoneBlocked) {
      // On DNC → mark opted_out (customer-level signal) and stop the campaign.
      console.log("[ReviewCampaign] DNC/STOP blocked id=%s phone=%s — opting out",
        campaign.id, campaign.contact_phone);
      await logTouch(campaign, idx, "sms", null, "skipped_dnc");
      await markStatus(campaign.id, "opted_out");
      return;
    }

    const body = substitute(step.message || DEFAULT_SMS_BODY, vars);
    const outboundSms = require("../lib/outboundSms");
    const result = await outboundSms.send({
      tenant,
      to:       campaign.contact_phone,
      body,
      source:   "review_request",
      leadId:   campaign.lead_id || null,
      sourceId: campaign.id,
      meta:     { review_campaign_id: campaign.id, step: idx },
    });

    if (result.ok) {
      await db.query(
        "UPDATE review_campaigns SET sms_sent = sms_sent + 1, last_sent_at = now(), updated_at = now() WHERE id = $1",
        [campaign.id]
      );
      await logTouch(campaign, idx, "sms", body, "sent");
      console.log("[ReviewCampaign] SMS sent id=%s step=%d", campaign.id, idx);
    } else {
      await logTouch(campaign, idx, "sms", body, "failed");
      console.error("[ReviewCampaign] SMS failed id=%s reason=%s", campaign.id, result.reason || result.error);
    }
  } else {
    // email
    if (!campaign.contact_email) {
      // No email and no SMS fallback → skip step.
      await logTouch(campaign, idx, "email", null, "skipped_no_email");
      await advance(campaign, steps);
      return;
    }

    const subject = substitute(step.subject || DEFAULT_EMAIL_SUBJECT, vars);
    const bodyHtml = `<p>${substitute(step.message || DEFAULT_EMAIL_BODY, vars)}</p>`;
    const emailService = require("./email");
    const result = await emailService.sendEmail({
      to:       campaign.contact_email,
      subject,
      html:     bodyHtml,
      tenantId: tenant.id,
      leadId:   campaign.lead_id || null,
      logBody:  `📧 Review request email sent to ${campaign.contact_email}`,
    });

    if (result.ok) {
      await db.query(
        "UPDATE review_campaigns SET email_sent = email_sent + 1, last_sent_at = now(), updated_at = now() WHERE id = $1",
        [campaign.id]
      );
      await logTouch(campaign, idx, "email", subject, "sent");
      console.log("[ReviewCampaign] email sent id=%s step=%d", campaign.id, idx);
    } else {
      await logTouch(campaign, idx, "email", subject, "failed");
      console.error("[ReviewCampaign] email failed id=%s err=%s", campaign.id, result.error);
    }
  }

  await advance(campaign, steps);
}

// Advance to the next step, or complete when the last step has fired.
async function advance(campaign, steps) {
  const nextIdx = campaign.current_step + 1;
  if (nextIdx >= steps.length) {
    await markCompleted(campaign.id, "all_steps_sent");
    return;
  }
  // Schedule next step relative to ENROLLMENT (so day offsets are absolute),
  // not relative to now — keeps the cadence true to the configured days even
  // if a send ran late.
  const enrolledAt = new Date(campaign.enrolled_at);
  const nextAt = addDays(enrolledAt, steps[nextIdx].day);
  // If that moment already passed (late processing), fire ASAP (now).
  const when = nextAt.getTime() <= Date.now() ? new Date() : nextAt;

  await db.query(
    "UPDATE review_campaigns SET current_step = $1, next_send_at = $2, updated_at = now() WHERE id = $3",
    [nextIdx, when.toISOString(), campaign.id]
  );
}

// ── Public: completeCampaignsForReview (exit-on-review) ──────────────────────
//
// Called from reviewScheduler when a NEW review is detected. Best-effort match
// of the reviewer to an active campaign: same tenant, reviewer first-name
// matches the campaign contact first-name, campaign still active. Marks it
// completed so no further requests go out. Heuristic (Google doesn't expose the
// reviewer's phone/email) — the hard day-cap exit covers the rest.

async function completeCampaignsForReview(tenantId, reviewerName) {
  if (!tenantId || !reviewerName) return 0;
  const first = getFirstName(reviewerName).toLowerCase();
  if (!first || first === "there" || first === "anonymous") return 0;

  try {
    const res = await db.query(
      `UPDATE review_campaigns
          SET status = 'completed', completed_at = now(), updated_at = now()
        WHERE tenant_id = $1
          AND status = 'active'
          AND lower(split_part(trim(contact_name), ' ', 1)) = $2
        RETURNING id`,
      [tenantId, first]
    );
    if (res.rows.length > 0) {
      console.log("[ReviewCampaign] %d campaign(s) completed by new review tenant=%s name=%s",
        res.rows.length, tenantId, reviewerName);
    }
    return res.rows.length;
  } catch (e) {
    console.error("[ReviewCampaign] completeCampaignsForReview failed:", e.message);
    return 0;
  }
}

// ── Status helpers ──────────────────────────────────────────────────────────

async function markStatus(id, status) {
  await db.query(
    "UPDATE review_campaigns SET status = $1, updated_at = now() WHERE id = $2",
    [status, id]
  );
}

async function markCompleted(id, _reason) {
  await db.query(
    "UPDATE review_campaigns SET status = 'completed', completed_at = now(), updated_at = now() WHERE id = $1",
    [id]
  );
  console.log("[ReviewCampaign] completed id=%s", id);
}

// Tenant Stop button.
async function stopCampaign(tenantId, id) {
  const res = await db.query(
    "UPDATE review_campaigns SET status = 'stopped', updated_at = now() WHERE id = $1 AND tenant_id = $2 AND status = 'active' RETURNING id",
    [id, tenantId]
  );
  return res.rows.length > 0;
}

async function logTouch(campaign, stepIndex, channel, body, status) {
  try {
    await db.query(
      `INSERT INTO review_campaign_touches (campaign_id, tenant_id, step_index, channel, body, status)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [campaign.id, campaign.tenant_id, stepIndex, channel, body || null, status]
    );
  } catch (e) {
    console.error("[ReviewCampaign] logTouch failed:", e.message);
  }
}

// ── Queries (for routes) ────────────────────────────────────────────────────

async function listCampaigns(tenantId, { status, limit = 100 } = {}) {
  let q = "SELECT * FROM review_campaigns WHERE tenant_id = $1";
  const params = [tenantId];
  if (status) {
    params.push(status);
    q += " AND status = $" + params.length;
  }
  q += " ORDER BY enrolled_at DESC LIMIT $" + (params.length + 1);
  params.push(limit);
  const res = await db.query(q, params);
  return res.rows;
}

module.exports = {
  startReviewCampaign,
  processDueReviewCampaigns,
  completeCampaignsForReview,
  stopCampaign,
  listCampaigns,
  // exported for testing
  resolveSteps,
  DEFAULT_STEPS,
  DEFAULT_SMS_BODY,
  DEFAULT_EMAIL_BODY,
};
