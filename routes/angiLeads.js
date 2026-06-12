"use strict";

/**
 * routes/angiLeads.js
 *
 * Phase 14 (Jun 11, 2026) — Angi Leads inbound webhook (speed-to-lead).
 *
 * Angi delivers each new lead to a partner endpoint as a JSON POST (their
 * "Standard Lead API"). A pro emails crmintegrations@angi.com their SPID /
 * Account Number + this endpoint URL, Angi enables the feed (~1 business day,
 * up to 72h), and every new lead lands here.
 *
 * THIS ENDPOINT:
 *   POST /api/webhooks/angi/:tenantId
 *
 *   1. Resolve the tenant from the path. (Per-tenant URL means we never have
 *      to guess which business a lead belongs to — Angi posts to the URL we
 *      gave them for that specific pro account.)
 *   2. Parse Angi's JSON into { name, phone, email, address, serviceType,
 *      angiLeadId }. Angi's exact field names vary slightly across their feed
 *      versions, so parseAngiLead() is defensive: it checks several known key
 *      spellings and falls back gracefully. ⚠️ FINALIZE the field map against
 *      Angi's official field-definitions doc (request it from crmintegrations@
 *      angi.com) before relying on any single key.
 *   3. getOrCreateLead → lead row tagged lead_source = 'angi'.
 *   4. Speed-to-lead: fire the AI SMS opener within seconds (source-aware).
 *      AI callback (voice) is intentionally NOT fired here — that's per-tenant
 *      opt-in (TCPA); a lead who filled an Angi form did not consent to a call.
 *   5. NEVER DROP: if parsing yields no usable phone, OR anything throws, we
 *      forward the raw payload to the tenant owner (email + bell) so a human
 *      can act. We ALWAYS return 200 so Angi doesn't retry-storm us; the
 *      forward-on-fail path is our safety net, not an error to Angi.
 *
 * MASKED NUMBERS (Angi privacy feature): Angi may send a TEMPORARY phone
 * number that proxies to the real homeowner, and it only works if the tenant's
 * sending number is on Angi's "connected numbers" allowlist. If the tenant's
 * Twilio number isn't allowlisted on Angi, the SMS silently won't deliver to
 * the lead. That's an Angi-side config (flagged in setup), not something this
 * endpoint can fix — but we still record the lead and the masked number, and
 * the opener asks the customer to confirm the best number, so we capture the
 * real one before the temp number's ~30-day expiry.
 *
 * IDEMPOTENCY: Angi may re-POST the same lead (retries). We dedupe on
 * angiLeadId when present (skip if we've already created a lead for it in the
 * last 24h), so a retry doesn't double-text the customer.
 *
 * NO AUTH MIDDLEWARE: this is a public webhook (Angi posts server-to-server
 * with no bearer token). It's mounted OUTSIDE the authMiddleware chain. The
 * per-tenant path segment + an optional shared secret (ANGI_WEBHOOK_SECRET,
 * checked when set) are the access control. Keep the URL unguessable-ish by
 * using the tenant UUID in the path.
 */

const express = require("express");
const router = express.Router();

const db = require("../lib/db");
const { getTenantById } = require("../lib/tenant");
const leadsService = require("../services/leads");
const messagesService = require("../services/messages");
const notificationsService = require("../services/notifications");
const emailService = require("../services/email");
const { normalizeE164Phone } = require("../lib/phone");

// ─────────────────────────────────────────────────────────────────────────────
// Field parser — defensive against Angi's varying key spellings.
// ⚠️ Confirm/extend against Angi's official field-definitions doc.
// ─────────────────────────────────────────────────────────────────────────────
function firstNonEmpty(obj, keys) {
  for (const k of keys) {
    const v = obj?.[k];
    if (v != null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

function parseAngiLead(body) {
  // Angi has nested shapes in some feed versions (e.g. { lead: {...} } or
  // { Lead: {...} }). Flatten the most common envelopes first.
  const b =
    (body && (body.lead || body.Lead || body.data || body.Data)) || body || {};

  const firstName = firstNonEmpty(b, ["firstName", "first_name", "FirstName", "firstname"]);
  const lastName = firstNonEmpty(b, ["lastName", "last_name", "LastName", "lastname"]);
  const fullName =
    firstNonEmpty(b, ["name", "fullName", "full_name", "FullName", "contactName"]) ||
    [firstName, lastName].filter(Boolean).join(" ");

  const phone = firstNonEmpty(b, [
    "phone", "phoneNumber", "phone_number", "Phone", "PhoneNumber",
    "primaryPhone", "contactPhone", "mobilePhone",
  ]);

  const email = firstNonEmpty(b, ["email", "emailAddress", "email_address", "Email"]);

  const address = firstNonEmpty(b, [
    "address", "streetAddress", "street_address", "address1", "Address",
  ]);
  const city = firstNonEmpty(b, ["city", "City"]);
  const state = firstNonEmpty(b, ["state", "State"]);
  const zip = firstNonEmpty(b, ["zip", "zipCode", "zip_code", "postalCode", "Zip"]);
  const fullAddress = [address, city, state, zip].filter(Boolean).join(", ");

  // Angi's "task" / service category, e.g. "Interior Painting".
  const serviceType = firstNonEmpty(b, [
    "taskName", "task", "task_name", "serviceType", "service", "category",
    "jobType", "projectType", "interest",
  ]);

  // Angi's own unique id for the lead — used for dedupe.
  const angiLeadId = firstNonEmpty(b, [
    "leadId", "lead_id", "id", "oid", "leadOid", "srid", "sr_id", "taskId",
  ]);

  // Angi SPID / account number (useful for audit / multi-account pros).
  const spid = firstNonEmpty(b, ["spid", "SPID", "spEntityId", "accountId"]);

  return {
    name: fullName || "Angi Lead",
    phone,
    email,
    address: fullAddress,
    serviceType,
    angiLeadId,
    spid,
    raw: body,
  };
}

// Build the source-aware speed-to-lead opener. Kept short + plain so it reads
// like a real person, names the source (homeowners expect a callback after an
// Angi request), and asks them to confirm the best number — which also
// captures the real number when Angi handed us a masked/temporary one.
function buildAngiOpener(tenant, lead) {
  const company = tenant.company_name || tenant.name || "our team";
  const svc = lead.serviceType ? ` about your ${lead.serviceType.toLowerCase()} project` : "";
  const firstName = (lead.name || "").split(/\s+/)[0];
  const hi = firstName && firstName !== "Angi" ? `Hi ${firstName}, ` : "Hi, ";
  return (
    `${hi}this is ${company} — thanks for your request on Angi${svc}! ` +
    `I can get you a quick quote and find a time that works. ` +
    `What are you looking to get done? ` +
    `(Reply STOP to opt out.)`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Forward-on-fail — the never-drop safety net. Emails the raw lead to the
// tenant owner + drops a bell notification so a human can act even when we
// couldn't parse a usable phone or something threw. Best-effort; never throws.
// ─────────────────────────────────────────────────────────────────────────────
async function forwardRawLeadToOwner(tenant, rawBody, reason) {
  const company = tenant.company_name || tenant.name || "your business";
  const pretty = (() => {
    try { return JSON.stringify(rawBody, null, 2); } catch { return String(rawBody); }
  })();

  // Bell notification (in-dashboard).
  notificationsService.createNotification(tenant.id, {
    type: "angi_lead_needs_review",
    title: "New Angi lead needs your attention",
    body: `An Angi lead came in but couldn't be auto-handled (${reason}). Open it to follow up — don't let it go cold.`,
    data: { reason, raw: rawBody },
  }).catch((e) => console.error("[Angi] forward notification failed:", e.message));

  // Email to owner (so it reaches them off-dashboard too).
  try {
    const to = tenant.support_email || process.env.CONTACT_EMAIL || "drew@aifrontdeskhelper.com";
    await emailService.sendEmail({
      to,
      subject: `🔔 New Angi lead (action needed) — ${company}`,
      html:
        `<h2>New Angi lead — needs manual follow-up</h2>` +
        `<p>An Angi lead arrived but we couldn't auto-text it (<strong>${reason}</strong>). ` +
        `Reach out fast — Angi leads are shared with several pros and go cold in minutes.</p>` +
        `<pre style="background:#f5f5f5;padding:12px;border-radius:8px;white-space:pre-wrap">${pretty.replace(/[<>]/g, (c) => (c === "<" ? "&lt;" : "&gt;"))}</pre>`,
    });
  } catch (e) {
    console.error("[Angi] forward email failed:", e.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// The webhook.
// ─────────────────────────────────────────────────────────────────────────────
router.post("/:tenantId", async (req, res) => {
  // ALWAYS 200 to Angi — our resilience is internal (forward-on-fail), and a
  // non-200 just makes Angi retry, risking duplicate texts. We acknowledge
  // receipt immediately, then do the work; if the work fails we forward.
  const tenantId = req.params.tenantId;
  let tenant = null;

  try {
    // Optional shared-secret gate (only enforced if the env var is set).
    const secret = process.env.ANGI_WEBHOOK_SECRET;
    if (secret) {
      const provided =
        req.headers["x-angi-secret"] ||
        req.headers["x-webhook-secret"] ||
        req.query.secret ||
        "";
      if (provided !== secret) {
        console.warn("[Angi] webhook secret mismatch tenant=%s", tenantId);
        return res.status(401).json({ ok: false, error: "unauthorized" });
      }
    }

    tenant = await getTenantById(tenantId).catch(() => null);
    if (!tenant) {
      console.warn("[Angi] webhook for unknown tenant=%s", tenantId);
      // 200 so Angi doesn't retry a permanently-bad URL; log for us.
      return res.status(200).json({ ok: false, error: "tenant_not_found" });
    }

    const lead = parseAngiLead(req.body || {});
    console.log("[Angi] lead received tenant=%s angiLeadId=%s svc=%s hasPhone=%s",
      tenant.id, lead.angiLeadId || "(none)", lead.serviceType || "(none)", !!lead.phone);

    // ── Idempotency: skip if we already handled this angiLeadId recently ────
    if (lead.angiLeadId) {
      try {
        const dup = await db.query(
          `SELECT id FROM leads
            WHERE tenant_id = $1
              AND metadata->>'angi_lead_id' = $2
              AND created_at > now() - interval '24 hours'
            LIMIT 1`,
          [tenant.id, lead.angiLeadId]
        );
        if (dup.rows.length > 0) {
          console.log("[Angi] duplicate angiLeadId=%s — skipping", lead.angiLeadId);
          return res.status(200).json({ ok: true, deduped: true });
        }
      } catch (e) {
        // Dedup is best-effort; a failure here shouldn't block the lead.
        console.error("[Angi] dedup check failed:", e.message);
      }
    }

    // ── No usable phone → forward to owner, never drop ──────────────────────
    const normalizedPhone = lead.phone ? normalizeE164Phone(lead.phone) : null;
    if (!normalizedPhone) {
      console.warn("[Angi] no usable phone tenant=%s — forwarding raw to owner", tenant.id);
      await forwardRawLeadToOwner(tenant, req.body || {}, "no phone number in lead");
      return res.status(200).json({ ok: true, forwarded: true });
    }

    // ── Create / resolve the lead, tagged source = 'angi' ───────────────────
    const leadRow = await leadsService.getOrCreateLead(
      tenant.id,
      normalizedPhone,
      lead.name,
      "angi",          // lead_source
      "third_party"    // contact_method bucket
    );
    if (!leadRow) {
      await forwardRawLeadToOwner(tenant, req.body || {}, "lead create failed");
      return res.status(200).json({ ok: true, forwarded: true });
    }

    // Stamp the extra detail + Angi metadata onto the lead (best-effort).
    leadsService.updateLeadInfo(leadRow.id, {
      email: lead.email || undefined,
      address: lead.address || undefined,
      project_type: lead.serviceType || undefined,
      metadata: {
        angi_lead_id: lead.angiLeadId || null,
        angi_spid: lead.spid || null,
        angi_service: lead.serviceType || null,
        source_detail: "angi_leads_api",
      },
    }).catch((e) => console.error("[Angi] updateLeadInfo failed:", e.message));

    // ── Speed-to-lead: fire the AI SMS opener now ───────────────────────────
    // Reuse the same Twilio send path the rest of the app uses. We require
    // sendTwilioSms from server.js? No — it's defined in server.js and not
    // exported. So we send via the messages/twilio service layer instead.
    // IMPORTANT: this route does NOT have direct access to server.js's
    // sendTwilioSms(); we use services/sms.js's sender (sendSms) which wraps
    // the same tenant-aware Twilio credential resolution. If your sms service
    // exposes a different export name, adjust the require below.
    let smsSent = false;
    try {
      const smsService = require("../services/sms");
      const opener = buildAngiOpener(tenant, lead);
      // sendSms(tenantId, toPhone, body) — tenant-aware sender.
      const result = await smsService.sendSms(tenant.id, normalizedPhone, opener);
      smsSent = !!(result && (result.ok || result.sid));
      if (smsSent) {
        messagesService.saveMessage(tenant.id, leadRow.id, "sms", "outbound", opener, {
          source: "angi_speed_to_lead",
        });
      } else {
        console.warn("[Angi] SMS send returned non-ok tenant=%s lead=%s", tenant.id, leadRow.id);
      }
    } catch (e) {
      console.error("[Angi] speed-to-lead SMS failed:", e.message);
    }

    // If the SMS didn't go (e.g. masked number not allowlisted on Angi, or a
    // Twilio error), still surface the lead to the owner so it isn't lost.
    if (!smsSent) {
      await forwardRawLeadToOwner(
        tenant,
        req.body || {},
        "lead created but speed-to-lead SMS did not send (check Angi connected-numbers allowlist / Twilio)"
      );
    } else {
      // Happy path — a quieter "new Angi lead, AI is on it" notification.
      notificationsService.createNotification(tenant.id, {
        type: "angi_lead_engaged",
        title: "New Angi lead — AI texted them",
        body: `${lead.name}${lead.serviceType ? ` (${lead.serviceType})` : ""} came in from Angi. The AI sent the first text within seconds.`,
        data: { leadId: leadRow.id, angiLeadId: lead.angiLeadId || null },
      }).catch(() => {});
    }

    return res.status(200).json({ ok: true, leadId: leadRow.id, smsSent });
  } catch (err) {
    console.error("[Angi] webhook fatal error tenant=%s: %s", tenantId, err.stack || err.message);
    // Never-drop: try to forward even on a fatal error, then 200 so Angi
    // doesn't retry-storm. If tenant wasn't resolved we can't forward — log only.
    if (tenant) {
      forwardRawLeadToOwner(tenant, req.body || {}, `unexpected error: ${err.message}`).catch(() => {});
    }
    return res.status(200).json({ ok: true, error_handled: true });
  }
});

module.exports = router;
