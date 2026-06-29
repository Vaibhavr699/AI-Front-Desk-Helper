"use strict";

/**
 * routes/thumbtackLeads.js
 *
 * Phase 14 (Jun 12, 2026) — Thumbtack inbound webhook (speed-to-lead).
 *
 * Unlike Angi (which requires emailing crmintegrations@angi.com to enable a
 * feed), Thumbtack has a FREE SELF-SERVE webhook built into the pro's own
 * account. The tenant configures it themselves:
 *   Thumbtack.com → profile photo (top right) → Integrations → Manage webhooks
 *   → Create webhook → paste THIS url → choose "leads" → Save → send a test.
 * No email, no waiting on Thumbtack's team. The first tenant who wires a real
 * Thumbtack account to their per-tenant URL is the live test for this parser.
 *
 * THIS ENDPOINT:
 *   POST /api/webhooks/thumbtack/:tenantId
 *
 *   1. Resolve the tenant from the path. (Per-tenant URL means we never have to
 *      guess which business a lead belongs to — Thumbtack posts to the URL the
 *      pro pasted into THEIR webhook config for THEIR business profile.)
 *   2. Parse Thumbtack's JSON into { name, phone, serviceType, thumbtackLeadId }.
 *      ⚠️ KEY CONSTRAINT (per Thumbtack's own help docs): Thumbtack provides
 *      the customer NAME and PHONE on all leads — it does NOT provide email.
 *      The pro messages/calls the customer for anything else. So there is no
 *      email field to map here; don't expect one.
 *   3. getOrCreateLead → lead row tagged lead_source = 'thumbtack'.
 *   4. Speed-to-lead: fire the AI SMS opener within seconds (source-aware).
 *      AI callback (voice) is intentionally NOT fired here — per-tenant opt-in
 *      (TCPA); a homeowner who messaged a pro on Thumbtack did not consent to a
 *      robocall.
 *   5. NEVER DROP: if parsing yields no usable phone, OR anything throws, we
 *      forward the raw payload to the tenant owner (email + bell) so a human can
 *      act. We ALWAYS return 200 so Thumbtack doesn't retry-storm us.
 *
 * ONE-WAY / NO REPLY-BACK: Thumbtack's self-serve webhook is inbound-only —
 * Thumbtack sends to us, but we can't post a reply back into the Thumbtack
 * inbox (that needs the OAuth Messaging API, a separate partner build). So our
 * AI texts the customer DIRECTLY via SMS using the phone Thumbtack handed us.
 * Note: Thumbtack ranks pros partly on reply speed measured inside Thumbtack;
 * because we reply over SMS (not the Thumbtack inbox), that in-Thumbtack
 * "replied" signal isn't registered. Registering it is a future OAuth-path
 * enhancement, intentionally out of scope for v1.
 *
 * ONE INTEGRATION PER ACCOUNT (Thumbtack limit, surfaced in the UI tile):
 * Thumbtack allows only ONE lead integration per account. If the tenant's
 * Thumbtack account is already wired to another CRM/tool, they must disconnect
 * that before pointing their webhook here. Nothing this endpoint can enforce —
 * it's flagged in the Lead Sources tile's note.
 *
 * PER-BUSINESS-PROFILE: each Thumbtack webhook is tied to a single business
 * profile. A pro with multiple profiles sets up a separate webhook per profile
 * (all can point at this same per-tenant URL — leads just merge under the one
 * AIFDH tenant, which is the desired behavior).
 *
 * IDEMPOTENCY: Thumbtack may re-POST the same lead (retries, or a test resend).
 * We dedupe on thumbtackLeadId (the negotiation/lead id) when present — skip if
 * we've already created a lead for it in the last 24h — so a retry doesn't
 * double-text the customer. Test leads arrive tagged by Thumbtack as test data;
 * we still process them (they exercise the full path), but they carry their own
 * ids so they won't collide with real leads.
 *
 * NO AUTH MIDDLEWARE: this is a public webhook (Thumbtack posts server-to-server
 * with no bearer token). Mounted OUTSIDE the authMiddleware chain. The
 * per-tenant UUID path segment + an optional shared secret
 * (THUMBTACK_WEBHOOK_SECRET, checked only when set) are the access control.
 */

const express = require("express");
const router = express.Router();

const db = require("../lib/db");
const { getTenantById } = require("../lib/tenant");
const leadsService = require("../services/leads");
const notificationsService = require("../services/notifications");
const emailService = require("../services/email");
const { normalizeE164Phone } = require("../lib/phone");

// ─────────────────────────────────────────────────────────────────────────────
// Field parser — defensive against Thumbtack's varying key spellings.
//
// The self-serve webhook's exact JSON shape isn't published in Thumbtack's
// public partner dev docs (those describe the OAuth Negotiations API). What IS
// confirmed: leads carry the customer's name + phone (NO email). The OAuth
// partner sample payload uses { leadID, customerID, businessID, message: {...} }
// with snake/camel variants seen across integrations, and the name often
// arrives as a single "Customer Name" / "Full Name" string that needs splitting.
// So we check many spellings and fall back gracefully. ⚠️ Confirm/extend against
// the first REAL payload that lands (log the raw body, then tighten the map).
// ─────────────────────────────────────────────────────────────────────────────
function firstNonEmpty(obj, keys) {
  for (const k of keys) {
    const v = obj?.[k];
    if (v != null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

function parseThumbtackLead(body) {
  // Thumbtack has nested shapes across versions (e.g. { lead: {...} },
  // { negotiation: {...} }, or a top-level object). Flatten common envelopes,
  // and also pull a nested customer object if present.
  const b =
    (body &&
      (body.lead ||
        body.Lead ||
        body.negotiation ||
        body.Negotiation ||
        body.data ||
        body.Data)) ||
    body ||
    {};

  // Some payloads nest contact info under customer / contact.
  const c = b.customer || b.Customer || b.contact || b.Contact || b;

  const firstName = firstNonEmpty(c, ["firstName", "first_name", "FirstName", "firstname"]);
  const lastName = firstNonEmpty(c, ["lastName", "last_name", "LastName", "lastname"]);
  // Thumbtack's default is a single full-name field ("Customer Name" /
  // "Full Name"); DripJobs' guide splits it on whitespace. We keep the full
  // string for display and let downstream split if it needs first/last.
  const fullName =
    firstNonEmpty(c, [
      "name", "fullName", "full_name", "FullName", "customerName",
      "customer_name", "CustomerName", "contactName",
    ]) || [firstName, lastName].filter(Boolean).join(" ");

  const phone = firstNonEmpty(c, [
    "phone", "phoneNumber", "phone_number", "Phone", "PhoneNumber",
    "primaryPhone", "customerPhone", "customer_phone", "mobilePhone", "mobile",
  ]);

  // Thumbtack does NOT send email on leads — but check anyway in case a future
  // payload version or a custom form field includes one. Never required.
  const email = firstNonEmpty(c, ["email", "emailAddress", "email_address", "Email"]);

  // Thumbtack's service category / request title, e.g. "Interior Painting" or
  // the customer's request subject.
  const serviceType = firstNonEmpty(b, [
    "category", "categoryName", "category_name", "serviceType", "service",
    "requestTitle", "request_title", "title", "jobType", "projectType", "request",
  ]);

  // The customer's first message text, if present (Thumbtack "negotiation" =
  // a customer reaching out with a request). Useful context for the opener +
  // the lead timeline.
  const messageText = firstNonEmpty(
    b.message || b.Message || b,
    ["text", "messageText", "message_text", "body", "message"]
  );

  // Thumbtack's own unique id for the lead/negotiation — used for dedupe.
  const thumbtackLeadId = firstNonEmpty(b, [
    "leadID", "leadId", "lead_id", "negotiationID", "negotiationId",
    "negotiation_id", "id", "requestId", "request_id",
  ]);

  // Thumbtack business id (which of the pro's profiles this lead is for) — handy
  // for audit when a pro runs multiple business profiles into one AIFDH tenant.
  const businessId = firstNonEmpty(b, [
    "businessID", "businessId", "business_id", "BusinessID",
  ]);

  return {
    name: fullName || "Thumbtack Lead",
    phone,
    email, // almost always empty for Thumbtack; kept for forward-compat
    serviceType,
    messageText,
    thumbtackLeadId,
    businessId,
    raw: body,
  };
}

// Build the source-aware speed-to-lead opener. Short + plain so it reads like a
// real person, names the source (homeowners expect a reply after a Thumbtack
// request), and asks what they need. We DON'T promise to reply "on Thumbtack"
// because we're texting them directly.
function buildThumbtackOpener(tenant, lead) {
  const company = tenant.company_name || tenant.name || "our team";
  const svc = lead.serviceType ? ` about your ${lead.serviceType.toLowerCase()} project` : "";
  const firstName = (lead.name || "").split(/\s+/)[0];
  const hi = firstName && firstName !== "Thumbtack" ? `Hi ${firstName}, ` : "Hi, ";
  return (
    `${hi}this is ${company} — thanks for reaching out on Thumbtack${svc}! ` +
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
    type: "thumbtack_lead_needs_review",
    title: "New Thumbtack lead needs your attention",
    body: `A Thumbtack lead came in but couldn't be auto-handled (${reason}). Open it to follow up — don't let it go cold.`,
    data: { reason, raw: rawBody },
  }).catch((e) => console.error("[Thumbtack] forward notification failed:", e.message));

  // Email to owner (so it reaches them off-dashboard too).
  try {
    const to = tenant.support_email || process.env.CONTACT_EMAIL || "drew@aifrontdeskhelper.com";
    await emailService.sendEmail({
      to,
      subject: `🔔 New Thumbtack lead (action needed) — ${company}`,
      html:
        `<h2>New Thumbtack lead — needs manual follow-up</h2>` +
        `<p>A Thumbtack lead arrived but we couldn't auto-text it (<strong>${reason}</strong>). ` +
        `Reach out fast — Thumbtack ranks pros on reply speed and the customer is likely messaging several pros at once.</p>` +
        `<pre style="background:#f5f5f5;padding:12px;border-radius:8px;white-space:pre-wrap">${pretty.replace(/[<>]/g, (ch) => (ch === "<" ? "&lt;" : "&gt;"))}</pre>`,
    });
  } catch (e) {
    console.error("[Thumbtack] forward email failed:", e.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// The webhook.
// ─────────────────────────────────────────────────────────────────────────────
router.post("/:tenantId", async (req, res) => {
  // ALWAYS 200 to Thumbtack — our resilience is internal (forward-on-fail), and
  // a non-200 just makes Thumbtack retry, risking duplicate texts. Acknowledge
  // receipt, then do the work; if the work fails we forward.
  const tenantId = req.params.tenantId;
  let tenant = null;

  try {
    // Optional shared-secret gate (only enforced if the env var is set).
    const secret = process.env.THUMBTACK_WEBHOOK_SECRET;
    if (secret) {
      const provided =
        req.headers["x-thumbtack-secret"] ||
        req.headers["x-webhook-secret"] ||
        req.query.secret ||
        "";
      if (provided !== secret) {
        console.warn("[Thumbtack] webhook secret mismatch tenant=%s", tenantId);
        return res.status(401).json({ ok: false, error: "unauthorized" });
      }
    }

    tenant = await getTenantById(tenantId).catch(() => null);
    if (!tenant) {
      console.warn("[Thumbtack] webhook for unknown tenant=%s", tenantId);
      // 200 so Thumbtack doesn't retry a permanently-bad URL; log for us.
      return res.status(200).json({ ok: false, error: "tenant_not_found" });
    }

    const lead = parseThumbtackLead(req.body || {});
    console.log("[Thumbtack] lead received tenant=%s ttLeadId=%s svc=%s hasPhone=%s",
      tenant.id, lead.thumbtackLeadId || "(none)", lead.serviceType || "(none)", !!lead.phone);

    // ── Idempotency: skip if we already handled this thumbtackLeadId recently ──
    if (lead.thumbtackLeadId) {
      try {
        const dup = await db.query(
          `SELECT id FROM leads
            WHERE tenant_id = $1
              AND metadata->>'thumbtack_lead_id' = $2
              AND created_at > now() - interval '24 hours'
            LIMIT 1`,
          [tenant.id, lead.thumbtackLeadId]
        );
        if (dup.rows.length > 0) {
          console.log("[Thumbtack] duplicate ttLeadId=%s — skipping", lead.thumbtackLeadId);
          return res.status(200).json({ ok: true, deduped: true });
        }
      } catch (e) {
        // Dedup is best-effort; a failure here shouldn't block the lead.
        console.error("[Thumbtack] dedup check failed:", e.message);
      }
    }

    // ── No usable phone → forward to owner, never drop ──────────────────────
    const normalizedPhone = lead.phone ? normalizeE164Phone(lead.phone) : null;
    if (!normalizedPhone) {
      console.warn("[Thumbtack] no usable phone tenant=%s — forwarding raw to owner", tenant.id);
      await forwardRawLeadToOwner(tenant, req.body || {}, "no phone number in lead");
      return res.status(200).json({ ok: true, forwarded: true });
    }

    // ── Create / resolve the lead, tagged source = 'thumbtack' ──────────────
    const leadRow = await leadsService.getOrCreateLead(
      tenant.id,
      normalizedPhone,
      lead.name,
      "thumbtack",     // lead_source
      "third_party"    // contact_method bucket
    );
    if (!leadRow) {
      await forwardRawLeadToOwner(tenant, req.body || {}, "lead create failed");
      return res.status(200).json({ ok: true, forwarded: true });
    }

    // Stamp the extra detail + Thumbtack metadata onto the lead (best-effort).
    leadsService.updateLeadInfo(leadRow.id, {
      email: lead.email || undefined, // usually undefined for Thumbtack
      project_type: lead.serviceType || undefined,
      metadata: {
        thumbtack_lead_id: lead.thumbtackLeadId || null,
        thumbtack_business_id: lead.businessId || null,
        thumbtack_service: lead.serviceType || null,
        thumbtack_first_message: lead.messageText || null,
        source_detail: "thumbtack_webhook",
      },
    }).catch((e) => console.error("[Thumbtack] updateLeadInfo failed:", e.message));

    // ── Speed-to-lead: fire the AI SMS opener now ───────────────────────────
    // lib/outboundSms.send resolves the tenant's own Twilio creds/From number
    // AND writes the message to `messages`, so the opener shows on the lead's
    // conversation timeline automatically. Returns { ok, sid?, reason?, error? }.
    let smsSent = false;
    try {
      const outboundSms = require("../lib/outboundSms");
      const opener = buildThumbtackOpener(tenant, lead);
      const result = await outboundSms.send({
        tenant,
        to: normalizedPhone,
        body: opener,
        source: "thumbtack_speed_to_lead",
        leadId: leadRow.id,
        sourceId: lead.thumbtackLeadId || null,
        meta: {
          thumbtack_lead_id: lead.thumbtackLeadId || null,
          thumbtack_service: lead.serviceType || null,
        },
      });
      smsSent = !!(result && result.ok);
      if (!smsSent) {
        console.warn("[Thumbtack] outboundSms.send non-ok tenant=%s lead=%s reason=%s err=%s",
          tenant.id, leadRow.id, result?.reason || "unknown", result?.error || "(none)");
      } else {
        console.log("[Thumbtack] speed-to-lead SMS sent tenant=%s lead=%s sid=%s",
          tenant.id, leadRow.id, result.sid || "(none)");
      }
    } catch (e) {
      console.error("[Thumbtack] speed-to-lead SMS failed:", e.message);
    }

    // If the SMS didn't go (Twilio error, bad number, etc.), still surface the
    // lead to the owner so it isn't lost.
    if (!smsSent) {
      await forwardRawLeadToOwner(
        tenant,
        req.body || {},
        "lead created but speed-to-lead SMS did not send (check Twilio config / number)"
      );
    } else {
      // Happy path — a quieter "new Thumbtack lead, AI is on it" notification.
      notificationsService.createNotification(tenant.id, {
        type: "thumbtack_lead_engaged",
        title: "New Thumbtack lead — AI texted them",
        body: `${lead.name}${lead.serviceType ? ` (${lead.serviceType})` : ""} came in from Thumbtack. The AI sent the first text within seconds.`,
        data: { leadId: leadRow.id, thumbtackLeadId: lead.thumbtackLeadId || null },
      }).catch(() => {});
    }

    return res.status(200).json({ ok: true, leadId: leadRow.id, smsSent });
  } catch (err) {
    console.error("[Thumbtack] webhook fatal error tenant=%s: %s", tenantId, err.stack || err.message);
    // Never-drop: try to forward even on a fatal error, then 200 so Thumbtack
    // doesn't retry-storm. If tenant wasn't resolved we can't forward — log only.
    if (tenant) {
      forwardRawLeadToOwner(tenant, req.body || {}, `unexpected error: ${err.message}`).catch(() => {});
    }
    return res.status(200).json({ ok: true, error_handled: true });
  }
});

module.exports = router;
