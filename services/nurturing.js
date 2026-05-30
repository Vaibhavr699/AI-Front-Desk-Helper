"use strict";

const db = require("../lib/db");
const twilio = require("../lib/twilio");
const outboundSms = require("../lib/outboundSms");
const outboundCall = require("../lib/outboundCall");
const { hasNurturingReferralAccess } = require("../lib/plans");
const emailService = require("./email");
const { DateTime } = require("luxon");

const POST_SERVICE_DAYS = 1;

function addDays(d, days) {
  const out = new Date(d);
  out.setDate(out.getDate() + days);
  return out;
}

// ─────────────────────────────────────────────────────────
// DNC SUPPRESSION (Migration 059, May 8 2026)
// ─────────────────────────────────────────────────────────

/**
 * Check whether a lead should be blocked from outbound nurturing due to
 * a do_not_contact flag.
 *
 * Two ways to match:
 *   1. leadId directly references a DNC'd lead.
 *   2. phone matches any DNC'd lead in the same tenant — covers cases
 *      where the schedule row was created without a lead_id, or where
 *      the same phone exists across multiple lead rows.
 *
 * Cheap query thanks to the partial index idx_leads_do_not_contact —
 * the WHERE do_not_contact = true predicate scans only flagged rows.
 *
 * Returns true if blocked, false if safe to proceed.
 */
async function isLeadDoNotContact({ leadId, tenantId, phone } = {}) {
  // Path 1: direct lead_id match
  if (leadId) {
    const r = await db.query(
      "SELECT 1 FROM leads WHERE id = $1 AND do_not_contact = true LIMIT 1",
      [leadId]
    );
    if (r.rows.length > 0) return true;
  }

  // Path 2: any same-phone lead in this tenant is DNC. Matches both
  // E.164 exact and last-10-digit normalized form.
  if (phone && tenantId) {
    const last10 = String(phone).replace(/\D/g, "").slice(-10);
    const r = await db.query(
      `SELECT 1 FROM leads
        WHERE tenant_id = $1
          AND do_not_contact = true
          AND (
            phone = $2
            OR right(regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g'), 10) = $3
          )
        LIMIT 1`,
      [tenantId, phone, last10]
    );
    if (r.rows.length > 0) return true;
  }

  return false;
}

/**
 * Schedule post-service follow-up and referral request after a completed job.
 * Completed job leads → maintenance + re-engagement + referral + seasonal (all flows).
 */
async function schedulePostServiceCampaigns(tenantId, booking) {
  if (!booking?.lead_id) return;
  const tenant = await db.query(
    "SELECT id, company_name, name, nurturing_enabled, referral_enabled, referral_request_days_after_service, plan, plan_overrides FROM tenants WHERE id = $1",
    [tenantId]
  ).then((r) => r.rows[0]);
  if (!tenant || !tenant.nurturing_enabled || !hasNurturingReferralAccess(tenant)) return;

  const baseDate = booking.preferred_date
    ? (typeof booking.preferred_date === "string" && booking.preferred_date.includes("T")
        ? booking.preferred_date.slice(0, 10)
        : booking.preferred_date)
    : new Date().toISOString().slice(0, 10);
  const base = new Date(baseDate + "T12:00:00Z");

  await db.query(
    `INSERT INTO nurturing_schedule (tenant_id, lead_id, booking_id, campaign_type, due_at, status)
     VALUES ($1, $2, $3, 'post_service_followup', $4, 'pending')`,
    [tenantId, booking.lead_id, booking.id, addDays(base, POST_SERVICE_DAYS).toISOString()]
  );

  const referralDays = Math.max(1, parseInt(tenant.referral_request_days_after_service, 10) || 5);
  if (tenant.referral_enabled) {
    await db.query(
      `INSERT INTO nurturing_schedule (tenant_id, lead_id, booking_id, campaign_type, due_at, status)
       VALUES ($1, $2, $3, 'referral_request', $4, 'pending')`,
      [tenantId, booking.lead_id, booking.id, addDays(base, referralDays).toISOString()]
    );
  }
}

/**
 * Process due nurturing_schedule rows.
 *
 * DNC suppression (Migration 059): the LEFT JOIN to leads + the
 * COALESCE filter skip any schedule whose linked lead is DNC'd. Schedules
 * without a lead_id (rare) pass through this filter and get caught by the
 * defense-in-depth check inside processOneNurturing.
 */
async function processDueNurturing() {
  const rows = await db.query(
    `SELECT ns.*, ns.metadata as schedule_metadata, t.company_name, t.name as tenant_name, t.plan, t.plan_overrides, t.nurturing_enabled, t.timezone,
            (SELECT pn.phone FROM phone_numbers pn WHERE pn.tenant_id = ns.tenant_id ORDER BY pn.is_primary DESC NULLS LAST LIMIT 1) as tenant_phone,
            l.phone as lead_phone, l.email as lead_email, l.name as lead_name
     FROM nurturing_schedule ns
     JOIN tenants t ON t.id = ns.tenant_id
     LEFT JOIN leads l ON l.id = ns.lead_id
     WHERE ns.status = 'pending'
       AND ns.due_at <= now()
       -- DNC suppression (Migration 059): skip if the linked lead is flagged.
       AND COALESCE(l.do_not_contact, false) = false
     ORDER BY ns.due_at
     LIMIT 50`
  );

  for (const row of rows.rows) {
    const tz       = row.timezone || "America/Chicago";
    const nowLocal = DateTime.now().setZone(tz);
    const hour     = nowLocal.hour;

    if (hour < 8 || hour >= 19) {
      console.log(`[Nurturing] Outside outreach window for tenant ${row.tenant_name}. Local time: ${nowLocal.toFormat("HH:mm")}. Skipping.`);
      continue;
    }

    if (!hasNurturingReferralAccess({
      plan:              row.plan,
      plan_overrides:    row.plan_overrides,
      nurturing_enabled: row.nurturing_enabled,
    })) continue;

    await processOneNurturing(row);
  }
}

async function processOneNurturing(row) {
  const {
    id: scheduleId,
    tenant_id,
    lead_id,
    booking_id,
    campaign_type,
    company_name,
    lead_phone,
    lead_email,
    lead_name,
    tenant_phone,
  } = row;

  // Defense in depth (Migration 059): the SQL filter in processDueNurturing
  // should prevent DNC'd schedules from getting here, but a flag could be
  // flipped between the SELECT and now. Catch it before any send and
  // mark the schedule cancelled so it doesn't keep cycling.
  if (await isLeadDoNotContact({ leadId: lead_id, tenantId: tenant_id, phone: lead_phone })) {
    console.log("[Nurturing] DNC blocked at processOneNurturing scheduleId=%s leadId=%s — cancelling", scheduleId, lead_id);
    await db.query("UPDATE nurturing_schedule SET status = 'cancelled' WHERE id = $1", [scheduleId]);
    return;
  }

  const toEmail = lead_email || null;
  const toPhone = lead_phone || null;

  let ownerReplyTo = null;
  try {
    const tenantRes = await db.query(
      "SELECT id, google_calendar_email FROM tenants WHERE id = $1", [tenant_id]
    );
    const t = tenantRes.rows[0];
    if (t && t.google_calendar_email) {
      ownerReplyTo = t.google_calendar_email;
    } else {
      const adminRes = await db.query(
        "SELECT email FROM dashboard_users WHERE tenant_id = $1 ORDER BY (role = 'admin') DESC, created_at ASC LIMIT 1",
        [tenant_id]
      );
      if (adminRes.rows.length > 0) ownerReplyTo = adminRes.rows[0].email;
    }
  } catch (err) {
    console.error("[Nurturing] Failed to resolve owner email for tenant %s:", tenant_id, err.message);
  }

  let logId     = null;
  let emailSent = false;
  let smsSent   = false;
  let body      = "";

  // PR 5 (May 29, 2026): opts bundle for sendNurturingSms so each touch
  // writes to messages with proper lead linkage + campaign metadata.
  const smsOpts = {
    leadId:       lead_id,
    scheduleId,
    campaignType: campaign_type,
    bookingId:    booking_id,
  };

  if (campaign_type === "post_service_followup") {
    if (toEmail) {
      const r = await emailService.sendPostServiceFollowUpEmail(company_name, lead_name, toEmail, ownerReplyTo);
      emailSent = r.ok;
      body      = r.body || "Quick follow-up after your recent service.";
    }
    if (toPhone) {
      const smsBody = `${company_name} here — hope you're happy with the work we did. If you have any questions or need a follow-up, just reply or give us a call.`;
      smsSent = await sendNurturingSms(tenant_id, toPhone, smsBody, smsOpts);
      if (smsSent && !body) body = smsBody;
    }
  } else if (campaign_type === "referral_request") {
    if (toEmail) {
      const r = await emailService.sendReferralRequestEmail(company_name, lead_name, toEmail, ownerReplyTo);
      emailSent = r.ok;
      body      = r.body || "Quick favor — know someone who could use our help?";
    }
    if (toPhone) {
      const smsBody = `Hi${lead_name ? " " + lead_name : ""}! This is ${company_name}. We'd love a quick favor — know anyone who could use our help? Reply with their name and number and we'll reach out. Thanks!`;
      smsSent = await sendNurturingSms(tenant_id, toPhone, smsBody, smsOpts);
      if (smsSent && !body) body = smsBody;
    }
  } else if (campaign_type === "maintenance_reminder") {
    const touchpointHeader = (row.schedule_metadata && row.schedule_metadata.header) || "";
    if (toEmail) {
      const r = await emailService.sendMaintenanceReminderEmail(company_name, lead_name, toEmail, ownerReplyTo);
      emailSent = r.ok;
      body      = r.body || "Maintenance reminder.";
    }
    if (toPhone) {
      const smsBody = touchpointHeader
        ? `${company_name} here — time for your ${touchpointHeader}! We're here when you're ready. Reply or give us a call.`
        : `${company_name} here — it's been a while. We're here when you're ready for your next project. Reply or give us a call.`;
      smsSent = await sendNurturingSms(tenant_id, toPhone, smsBody, smsOpts);
      if (smsSent && !body) body = smsBody;
    }
  } else if (campaign_type === "reengagement") {
    const touchpointHeader = (row.schedule_metadata && row.schedule_metadata.header) || "";
    if (toEmail) {
      const r = await emailService.sendReengagementEmail(company_name, lead_name, toEmail, ownerReplyTo);
      emailSent = r.ok;
      body      = r.body || "Quick check-in.";
    }
    if (toPhone) {
      const smsBody = touchpointHeader
        ? `Hi${lead_name ? " " + lead_name : ""}! ${company_name} here — ${touchpointHeader}. We'd love to hear how things are going. Reply or call anytime.`
        : `Hi${lead_name ? " " + lead_name : ""}! Quick check-in from ${company_name} — we'd love to hear how things are going. Reply or call anytime.`;
      smsSent = await sendNurturingSms(tenant_id, toPhone, smsBody, smsOpts);
      if (smsSent && !body) body = smsBody;
    }
  } else if (campaign_type === "no_response_phone") {
    const hadReply = await db.query(
      "SELECT 1 FROM messages WHERE lead_id = $1 AND direction = 'inbound' AND created_at >= now() - interval '7 days' LIMIT 1",
      [lead_id]
    ).then((r) => r.rows.length > 0);
    if (hadReply) {
      await db.query("UPDATE nurturing_schedule SET status = 'skipped' WHERE id = $1", [scheduleId]);
      return;
    }
    const script   = `Hi, this is ${company_name}. We're checking in to see if you need help with any upcoming projects. Say "schedule" or press 1 if you'd like to book an estimate.`;
    const callSent = await triggerNurturingCall(scheduleId, tenant_id, lead_id, lead_phone, script);
    if (callSent) {
      await db.query(
        `INSERT INTO campaign_log (tenant_id, lead_id, campaign_type, channel, direction, message_body, sent_at, metadata)
         VALUES ($1, $2, 'no_response_phone', 'voice', 'outbound', $3, now(), '{}')`,
        [tenant_id, lead_id, script]
      );
      await db.query("UPDATE nurturing_schedule SET status = 'sent' WHERE id = $1", [scheduleId]);
    } else {
      await db.query("UPDATE nurturing_schedule SET status = 'skipped' WHERE id = $1", [scheduleId]);
    }
    return;
  } else {
    await db.query("UPDATE nurturing_schedule SET status = 'skipped', campaign_log_id = NULL WHERE id = $1", [scheduleId]);
    return;
  }

  const channel = emailSent && smsSent ? "email+sms" : emailSent ? "email" : smsSent ? "sms" : "none";
  const res = await db.query(
    `INSERT INTO campaign_log (tenant_id, lead_id, booking_id, campaign_type, channel, direction, message_body, sent_at, metadata)
     VALUES ($1, $2, $3, $4, $5, 'outbound', $6, now(), $7::jsonb)
     RETURNING id`,
    [tenant_id, lead_id, booking_id, campaign_type, channel, body || null, JSON.stringify({ email_sent: emailSent, sms_sent: smsSent })]
  );
  logId = res.rows[0]?.id;

  await db.query(
    "UPDATE nurturing_schedule SET status = 'sent', campaign_log_id = $1 WHERE id = $2",
    [logId, scheduleId]
  );

  const scheduleNoResponsePhone = ["post_service_followup", "referral_request", "maintenance_reminder", "reengagement"].includes(campaign_type);
  if (scheduleNoResponsePhone && lead_id) {
    const dueAt = addDays(new Date(), 7).toISOString();
    await db.query(
      `INSERT INTO nurturing_schedule (tenant_id, lead_id, booking_id, campaign_type, due_at, status)
       VALUES ($1, $2, $3, 'no_response_phone', $4, 'pending')`,
      [tenant_id, lead_id, booking_id, dueAt]
    ).catch((e) => console.error("[Nurturing] Schedule no_response_phone:", e.message));
  }
}

/**
 * Place an outbound AI nurturing call with voicemail detection.
 *
 * PR 5 (May 29, 2026): Routes through lib/outboundCall.create so the call:
 *   1. Writes a `calls` row immediately on dial (was previously invisible)
 *   2. Stamps metadata.source='nurturing' for filtering
 *   3. Stamps metadata.script_preview so CallDetail UI shows what the AI
 *      was going to say even if voicemail wasn't recorded
 *   4. Records audio (record:true is set by the helper) so voicemail-left
 *      calls eventually surface audio via PR 3's recording pipeline
 *
 * Returns boolean (matches the existing contract).
 */
async function triggerNurturingCall(scheduleId, tenantId, leadId, toPhone, script) {
  if (!toPhone || !script) return false;

  // Defense in depth (Migration 059) — last line of defense before placing
  // an outbound call. processOneNurturing already checked, but a paranoid
  // double-check here costs one indexed query and prevents a billable Twilio
  // call to a DNC'd customer if anything upstream regressed.
  if (await isLeadDoNotContact({ leadId, tenantId, phone: toPhone })) {
    console.log("[Nurturing] DNC blocked at triggerNurturingCall tenant=%s to=%s — suppressing", tenantId, toPhone);
    return false;
  }

  // Pull the full tenant row plus matched_phone — outboundCall.create
  // reads tenant.matched_phone for the from-number.
  const tenant = await db.query(
    `SELECT t.*, (SELECT pn.phone FROM phone_numbers pn WHERE pn.tenant_id = t.id ORDER BY pn.is_primary DESC NULLS LAST LIMIT 1) as matched_phone
     FROM tenants t WHERE t.id = $1`,
    [tenantId]
  ).then((r) => r.rows[0]);
  if (!tenant) return false;

  const baseUrl = process.env.BASE_URL;
  if (!baseUrl) {
    console.warn("[Nurturing] BASE_URL not set, cannot place nurturing call");
    return false;
  }

  const trimmedBase = baseUrl.replace(/\/$/, "");
  const twimlUrl = `${trimmedBase}/twilio/nurturing-call`
    + `?scheduleId=${encodeURIComponent(scheduleId)}`
    + `&script=${encodeURIComponent(script)}`;
  const statusCallback = `${trimmedBase}/twilio/nurturing-call-status?scheduleId=${encodeURIComponent(scheduleId)}`;

  const result = await outboundCall.create({
    tenant,
    to:                      toPhone,
    twimlUrl,
    source:                  "nurturing",
    leadId,
    sourceId:                String(scheduleId),
    leadSource:              "nurturing",
    statusCallback,
    machineDetection:        "Enable",
    machineDetectionTimeout: 8,
    timeout:                 30,
    meta: {
      // Stamped into calls.metadata so CallDetail.jsx (PR 3) shows what
      // the AI was going to say — critical for voicemail-left calls and
      // for the tenant trust foundation more broadly.
      script_preview: script,
      schedule_id:    scheduleId,
      campaign_type:  "no_response_phone",
    },
  });

  if (!result.ok) {
    console.error(
      "[Nurturing] outboundCall.create failed scheduleId=%s reason=%s err=%s",
      scheduleId, result.reason || "unknown", result.error || "(none)"
    );
    return false;
  }

  return true;
}

/**
 * Send an outbound nurturing SMS.
 *
 * PR 5 (May 29, 2026): Routes through lib/outboundSms.send so the message:
 *   1. Writes a `messages` row keyed to the lead (appears on lead timeline,
 *      messages thread, activity feed)
 *   2. Stamps metadata.source='nurturing' + campaign_type for filtering
 *   3. Stamps schedule_id for traceability back to nurturing_schedule
 *
 * Signature change: now accepts an `opts` object with leadId/scheduleId/
 * campaignType/bookingId. Every callsite was updated. Returns boolean
 * (matches the existing contract).
 */
async function sendNurturingSms(tenantId, toPhone, body, opts = {}) {
  // Defense in depth (Migration 059) — last line of defense before sending.
  // Catches DNC flips that happened between the schedule SELECT and now.
  if (await isLeadDoNotContact({ tenantId, phone: toPhone, leadId: opts.leadId })) {
    console.log("[Nurturing] DNC blocked at sendNurturingSms tenant=%s to=%s — suppressing", tenantId, toPhone);
    return false;
  }

  // Pull the full tenant row plus matched_phone — outboundSms.send needs
  // it for Twilio credentials + from-phone resolution.
  const tenant = await db.query(
    `SELECT t.*, (SELECT pn.phone FROM phone_numbers pn WHERE pn.tenant_id = t.id ORDER BY pn.is_primary DESC NULLS LAST LIMIT 1) as matched_phone
     FROM tenants t WHERE t.id = $1`,
    [tenantId]
  ).then((r) => r.rows[0]);
  if (!tenant) return false;

  const result = await outboundSms.send({
    tenant,
    to:       toPhone,
    body,
    source:   "nurturing",
    leadId:   opts.leadId || null,
    sourceId: opts.scheduleId ? String(opts.scheduleId) : null,
    meta: {
      campaign_type: opts.campaignType || "unknown",
      booking_id:    opts.bookingId || null,
      schedule_id:   opts.scheduleId || null,
    },
  });

  if (!result.ok) {
    console.error(
      "[Nurturing] outboundSms.send failed campaign=%s tenant=%s reason=%s err=%s",
      opts.campaignType || "unknown",
      tenantId,
      result.reason || "unknown",
      result.error || "(none)"
    );
    return false;
  }

  return true;
}

async function tryParseReferralReply(tenantId, leadId, messageBody) {
  const recent = await db.query(
    `SELECT id FROM campaign_log
     WHERE tenant_id = $1 AND lead_id = $2 AND campaign_type = 'referral_request' AND direction = 'outbound'
     ORDER BY sent_at DESC LIMIT 1`,
    [tenantId, leadId]
  );
  if (recent.rows.length === 0) return { isReferralReply: false };

  const text = (messageBody || "").trim();
  if (text.length < 5) return { isReferralReply: false };

  const phoneMatch = text.match(/(?:^|\s)(?:\+?1[-.\s]*)?(\d{3})[-.\s]*(\d{3})[-.\s]*(\d{4})(?:\s|$|,|\.)/);
  const phone      = phoneMatch ? `+1${phoneMatch[1]}${phoneMatch[2]}${phoneMatch[3]}` : null;
  let name         = null;
  const namePatterns = [
    /(?:my\s+)?(?:friend|neighbor|brother|sister|coworker|dad|mom)\s+([A-Za-z][A-Za-z\s'-]{1,40})(?:\s+(?:is|needs|his|her|number|at|@))/i,
    /(?:name is|call them)\s+([A-Za-z][A-Za-z\s'-]{1,40})(?:\s|,|\.|$)/i,
    /([A-Za-z][A-Za-z\s'-]{2,40})\s+(?:\d{3}[-.\s]*\d{3}[-.\s]*\d{4}|his number|her number)/i,
  ];
  for (const re of namePatterns) {
    const m = text.match(re);
    if (m && m[1]) { name = m[1].trim(); break; }
  }
  const emailMatch   = text.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
  const referralEmail = emailMatch ? emailMatch[1] : null;

  if (!phone && !name) return { isReferralReply: false };
  return {
    isReferralReply: true,
    referralName:    name || "Referred customer",
    referralPhone:   phone || null,
    referralEmail:   referralEmail || null,
  };
}

async function createReferralAndOutreach(tenantId, referringLeadId, referringBookingId, referralName, referralPhone, referralEmail, serviceInterest) {
  const referringLead = await db.query(
    "SELECT id, name, phone FROM leads WHERE id = $1",
    [referringLeadId]
  ).then((r) => r.rows[0]);
  const tenant = await db.query(
    "SELECT id, company_name, nurturing_enabled, referral_enabled, plan, plan_overrides FROM tenants WHERE id = $1",
    [tenantId]
  ).then((r) => r.rows[0]);
  if (!tenant?.referral_enabled || !referralPhone || !hasNurturingReferralAccess(tenant)) return null;

  let leadId = null;
  const existingLead = await db.query(
    "SELECT id, do_not_contact FROM leads WHERE tenant_id = $1 AND phone = $2",
    [tenantId, referralPhone]
  ).then((r) => r.rows[0]);

  if (existingLead) {
    // DNC suppression (Migration 059): if the referral target is a previously
    // DNC'd lead in this tenant, do NOT create a referral_leads row and do
    // NOT send SMS. The referring customer might not realize their friend
    // is already on our do-not-contact list.
    if (existingLead.do_not_contact) {
      console.log("[Nurturing] Referral target is DNC'd — skipping outreach. tenantId=%s leadId=%s", tenantId, existingLead.id);
      return null;
    }
    leadId = existingLead.id;
  } else {
    const leadRes = await db.query(
      `INSERT INTO leads (tenant_id, name, phone, email, lead_source, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'referral', now(), now())
       RETURNING id`,
      [tenantId, referralName || "Referred", referralPhone, referralEmail || null]
    );
    leadId = leadRes.rows[0]?.id;
  }

  const refRes = await db.query(
    `INSERT INTO referral_leads (tenant_id, referring_lead_id, referring_booking_id, referral_name, referral_phone, referral_email, service_interest, lead_id, lead_status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'new')
     RETURNING id`,
    [tenantId, referringLeadId, referringBookingId, referralName, referralPhone, referralEmail || null, serviceInterest || null, leadId]
  );
  const referralLeadId = refRes.rows[0]?.id;

  const customerName = referringLead?.name || "A customer";
  const smsBody = `Hi${referralName && referralName !== "Referred" ? " " + referralName : ""}! This is ${tenant.company_name}. ${customerName} mentioned you might need our help. Would you like to schedule a quick estimate? Just reply here or give us a call.`;

  // PR 5: pass the **referral target's** leadId (the friend being reached),
  // not the referring lead's id. The SMS goes to the friend's phone, so
  // the message row should attach to the friend's lead timeline.
  await sendNurturingSms(tenantId, referralPhone, smsBody, {
    leadId,
    campaignType: "referral_outreach",
  });

  await db.query(
    `INSERT INTO campaign_log (tenant_id, lead_id, campaign_type, channel, direction, message_body, sent_at, metadata)
     VALUES ($1, $2, 'referral_outreach', 'sms', 'outbound', $3, now(), $4::jsonb)`,
    [tenantId, leadId, smsBody, JSON.stringify({ referral_lead_id: referralLeadId, referring_lead_id: referringLeadId })]
  );

  return { referralLeadId, leadId };
}

async function processMaintenanceReminders() {
  const tenants = await db.query(
    `SELECT id, company_name, maintenance_reminder_months, maintenance_touchpoints, plan, plan_overrides FROM tenants
     WHERE nurturing_enabled = true AND (plan = 'elite' OR (plan_overrides->'addons'->>'customerNurturingReferral') = 'true')`
  );
  for (const t of tenants.rows) {
    const touchpoints = parseTouchpoints(t.maintenance_touchpoints, t.maintenance_reminder_months || 6);
    for (let tpIdx = 0; tpIdx < touchpoints.length; tpIdx++) {
      const tp = touchpoints[tpIdx];
      if (!tp.months || tp.months <= 0) continue;
      // ✅ Only leads with a completed job (last_service_date IS NOT NULL)
      // ✅ DNC suppression (Migration 059): exclude flagged leads.
      const leads = await db.query(
        `SELECT l.id as lead_id FROM leads l
         WHERE l.tenant_id = $1
           AND l.do_not_contact = false
           AND l.last_service_date IS NOT NULL
           AND l.last_service_date + ($2::text || ' months')::interval <= current_date
           AND NOT EXISTS (
             SELECT 1 FROM campaign_log c
             WHERE c.lead_id = l.id AND c.campaign_type = 'maintenance_reminder'
               AND c.sent_at >= current_date - ($2::text || ' months')::interval
               AND (c.metadata->>'touchpoint_index')::int = $3
           )
         LIMIT 100`,
        [t.id, tp.months, tpIdx]
      );
      for (const row of leads.rows) {
        const meta = JSON.stringify({ touchpoint_index: tpIdx, header: tp.header || "" });
        await db.query(
          `INSERT INTO nurturing_schedule (tenant_id, lead_id, booking_id, campaign_type, due_at, status, metadata)
           SELECT $1, $2, NULL, 'maintenance_reminder', now(), 'pending', $3::jsonb
           WHERE NOT EXISTS (
             SELECT 1 FROM nurturing_schedule ns
             WHERE ns.tenant_id = $1 AND ns.lead_id = $2 AND ns.campaign_type = 'maintenance_reminder' AND ns.status = 'pending'
               AND (ns.metadata->>'touchpoint_index')::int = $4
           )`,
          [t.id, row.lead_id, meta, tpIdx]
        ).catch((e) => console.error("[Nurturing] Schedule maintenance:", e.message));
      }
    }
  }
}

async function processReengagement() {
  const tenants = await db.query(
    `SELECT id, company_name, reengagement_reminder_months, reengagement_touchpoints, plan, plan_overrides FROM tenants
     WHERE nurturing_enabled = true AND (plan = 'elite' OR (plan_overrides->'addons'->>'customerNurturingReferral') = 'true')`
  );
  for (const t of tenants.rows) {
    const touchpoints = parseTouchpoints(t.reengagement_touchpoints, t.reengagement_reminder_months || 12);
    for (let tpIdx = 0; tpIdx < touchpoints.length; tpIdx++) {
      const tp = touchpoints[tpIdx];
      if (!tp.months || tp.months <= 0) continue;
      // ✅ Only leads with a completed job (last_service_date IS NOT NULL)
      // ✅ DNC suppression (Migration 059): exclude flagged leads.
      const leads = await db.query(
        `SELECT l.id as lead_id FROM leads l
         WHERE l.tenant_id = $1
           AND l.do_not_contact = false
           AND l.last_service_date IS NOT NULL
           AND l.last_service_date + ($2::text || ' months')::interval <= current_date
           AND NOT EXISTS (
             SELECT 1 FROM campaign_log c
             WHERE c.lead_id = l.id AND c.campaign_type = 'reengagement'
               AND c.sent_at >= current_date - ($2::text || ' months')::interval
               AND (c.metadata->>'touchpoint_index')::int = $3
           )
         LIMIT 100`,
        [t.id, tp.months, tpIdx]
      );
      for (const row of leads.rows) {
        const meta = JSON.stringify({ touchpoint_index: tpIdx, header: tp.header || "" });
        await db.query(
          `INSERT INTO nurturing_schedule (tenant_id, lead_id, booking_id, campaign_type, due_at, status, metadata)
           SELECT $1, $2, NULL, 'reengagement', now(), 'pending', $3::jsonb
           WHERE NOT EXISTS (
             SELECT 1 FROM nurturing_schedule ns
             WHERE ns.tenant_id = $1 AND ns.lead_id = $2 AND ns.campaign_type = 'reengagement' AND ns.status = 'pending'
               AND (ns.metadata->>'touchpoint_index')::int = $4
           )`,
          [t.id, row.lead_id, meta, tpIdx]
        ).catch((e) => console.error("[Nurturing] Schedule reengagement:", e.message));
      }
    }
  }
}

function parseTouchpoints(touchpointsJson, fallbackMonths) {
  if (Array.isArray(touchpointsJson) && touchpointsJson.length > 0) {
    return touchpointsJson.slice(0, 3).map((tp) => ({
      months: Math.max(0, parseInt(tp.months, 10) || 0),
      header: (tp.header || "").trim(),
    }));
  }
  return [{ months: Math.max(1, parseInt(fallbackMonths, 10) || 6), header: "" }];
}

/**
 * Seasonal campaigns.
 *
 * Eligible leads (all enrolled in seasonal; referral/maintenance/reengagement
 * remain post-service only and are NOT sent here):
 *   Group 1: Completed job leads — last_service_date within past 24 months
 *   Group 2: Dormant estimate leads — no completed job but were in estimate
 *            recovery that has since gone dormant, created within past 24 months
 *   Group 3: Lost leads — marked Lost OR recovery cancelled, AND at least
 *            90 days have passed since the lead was last updated (cooling-off
 *            period so we don't nurture someone right after they said no)
 *
 * DNC suppression (Migration 059): all three groups exclude leads where
 * do_not_contact = true.
 */
async function processSeasonalCampaigns() {
  const month   = new Date().getMonth() + 1;
  const tenants = await db.query(
    `SELECT id, company_name, nurturing_campaign_calendar FROM tenants
     WHERE nurturing_enabled = true AND seasonal_campaigns_enabled = true
       AND (plan = 'elite' OR (plan_overrides->'addons'->>'customerNurturingReferral') = 'true')`
  );

  for (const t of tenants.rows) {
    const calendar    = t.nurturing_campaign_calendar && typeof t.nurturing_campaign_calendar === "object"
      ? t.nurturing_campaign_calendar : {};
    const campaignKey = calendar[String(month)] || `seasonal_${month}`;
    const subject     = getDefaultSeasonalSubject(month);
    const bodyHtml    = getDefaultSeasonalBody(month);
    const smsBody     = getDefaultSeasonalSms(month, t.company_name);

    let ownerReplyTo = null;
    try {
      const ownerRes = await db.query(
        "SELECT email FROM dashboard_users WHERE tenant_id = $1 ORDER BY (role = 'admin') DESC, created_at ASC LIMIT 1",
        [t.id]
      );
      if (ownerRes.rows.length > 0) ownerReplyTo = ownerRes.rows[0].email;
    } catch (_) {}

    // ── Group 1: Completed job leads ────────────────────────────────────
    const completedLeads = await db.query(
      `SELECT l.id, l.phone, l.email, l.name FROM leads l
       WHERE l.tenant_id = $1
         AND l.do_not_contact = false
         AND l.last_service_date IS NOT NULL
         AND l.last_service_date >= current_date - interval '24 months'
         AND NOT EXISTS (
           SELECT 1 FROM campaign_log c
           WHERE c.lead_id = l.id AND c.campaign_type = $2 AND c.sent_at >= date_trunc('month', current_date)
         )
       LIMIT 100`,
      [t.id, campaignKey]
    );

    // ── Group 2: Dormant estimate leads — no completed job, recovery dormant
    // These people got a quote, didn't book, went through the full 21-day sequence.
    // They receive seasonal outreach only (not maintenance/re-engagement/referral).
    const dormantEstimateLeads = await db.query(
      `SELECT DISTINCT l.id, l.phone, l.email, l.name FROM leads l
       JOIN estimate_recoveries er ON er.lead_id = l.id
       WHERE l.tenant_id = $1
         AND l.do_not_contact = false
         AND l.last_service_date IS NULL
         AND er.status = 'dormant'
         AND l.created_at >= current_date - interval '24 months'
         AND NOT EXISTS (
           SELECT 1 FROM campaign_log c
           WHERE c.lead_id = l.id AND c.campaign_type = $2 AND c.sent_at >= date_trunc('month', current_date)
         )
       LIMIT 100`,
      [t.id, campaignKey]
    );

    // ── Group 3: Lost leads — 90-day cooling-off period before seasonal ──
    // Enrolls leads that were explicitly marked Lost OR whose estimate recovery
    // was cancelled, but only after 90 days have passed (based on leads.updated_at,
    // which flips when the status is set). No referral/maintenance/reengagement.
    const lostLeads = await db.query(
      `SELECT DISTINCT l.id, l.phone, l.email, l.name FROM leads l
       LEFT JOIN estimate_recoveries er ON er.lead_id = l.id
       WHERE l.tenant_id = $1
         AND l.do_not_contact = false
         AND l.last_service_date IS NULL
         AND (l.status = 'Lost' OR er.status = 'cancelled')
         AND l.updated_at <= current_date - interval '90 days'
         AND l.created_at >= current_date - interval '24 months'
         AND NOT EXISTS (
           SELECT 1 FROM campaign_log c
           WHERE c.lead_id = l.id AND c.campaign_type = $2 AND c.sent_at >= date_trunc('month', current_date)
         )
       LIMIT 100`,
      [t.id, campaignKey]
    );

    // Combine all groups (deduplicated by lead id)
    const seenIds  = new Set();
    const allLeads = [];
    for (const row of [...completedLeads.rows, ...dormantEstimateLeads.rows, ...lostLeads.rows]) {
      if (!seenIds.has(row.id)) {
        seenIds.add(row.id);
        allLeads.push(row);
      }
    }

    for (const row of allLeads) {
      if (row.email) {
        await emailService.sendSeasonalCampaignEmail(
          t.company_name, row.name, subject, bodyHtml, row.email, ownerReplyTo
        ).catch(() => {});
      }
      if (row.phone) {
        // PR 5: pass the lead's id so seasonal touches show on their timeline
        await sendNurturingSms(t.id, row.phone, smsBody, {
          leadId:       row.id,
          campaignType: campaignKey,
        }).catch(() => {});
      }
      await db.query(
        `INSERT INTO campaign_log (tenant_id, lead_id, campaign_type, channel, direction, message_body, sent_at)
         VALUES ($1, $2, $3, 'email+sms', 'outbound', $4, now())`,
        [t.id, row.id, campaignKey, smsBody]
      ).catch(() => {});
    }

    if (allLeads.length > 0) {
      console.log(`[Nurturing] Seasonal ${campaignKey}: sent to ${completedLeads.rows.length} completed + ${dormantEstimateLeads.rows.length} dormant estimate + ${lostLeads.rows.length} lost (90d+) leads for tenant ${t.id}`);
    }
  }
}

function getDefaultSeasonalSubject(month) {
  const titles = {
    1: "Interior refresh ideas", 2: "Pre-spring planning",
    3: "Exterior season is here", 4: "Spring project ideas",
    5: "Summer prep", 6: "Mid-year refresh",
    7: "Summer projects", 8: "Back-to-school touch-ups",
    9: "Fall projects", 10: "Holiday prep",
    11: "Year-end projects", 12: "Year in review",
  };
  return titles[month] || "News from us";
}

function getDefaultSeasonalBody(month) {
  return "We hope you're doing well. If you have any upcoming projects, we'd love to help. Reply or give us a call.";
}

function getDefaultSeasonalSms(month, companyName) {
  return `${companyName} here — hope you're doing well. If you have any upcoming projects, we're here to help. Reply or call us.`;
}

module.exports = {
  schedulePostServiceCampaigns,
  processDueNurturing,
  tryParseReferralReply,
  createReferralAndOutreach,
  processMaintenanceReminders,
  processReengagement,
  processSeasonalCampaigns,
  isLeadDoNotContact,
};
