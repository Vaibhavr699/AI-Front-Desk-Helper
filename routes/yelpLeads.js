"use strict";

/**
 * routes/yelpLeads.js
 *
 * Phase 14 (Jun 12, 2026) — Yelp inbound webhook (speed-to-lead, Zapier-relay).
 *
 * Yelp's native Leads API is PARTNER-GATED (OAuth, business subscriptions,
 * polling — AIFDH would have to become an approved Yelp partner). That's the
 * LSA-style heavy build and is NOT what this is.
 *
 * Instead, this is the SELF-SERVE path that fits our model: the tenant creates
 * a Zapier Zap themselves —
 *     Trigger:  Yelp Leads (new lead / new RAQ)
 *     Action:   Webhooks by Zapier → POST to THIS per-tenant URL
 * — so leads relay through the tenant's own Zapier account into AIFDH. AIFDH
 * owns no Yelp account; the tenant connects their own. Requires the tenant to
 * have a paid Zapier account (Yelp Leads trigger needs Zapier Pro).
 *
 * THIS ENDPOINT:
 *   POST /api/webhooks/yelp/:tenantId
 *
 * ⚠️ YELP REALITIES (shape the parser + expectations):
 *   • PHONE IS OPTIONAL. Only ~40% of Yelp leads include a phone, and only
 *     after the consumer opts in to phone/SMS. The other ~60% are message-only.
 *     → Our never-drop forward-to-owner path fires a LOT for Yelp. That's
 *       expected, not a bug: a message-only lead still reaches the owner.
 *   • EMAIL IS MASKED. Yelp masks emails; the real one isn't exposed. We don't
 *     rely on it. (A masked relay address may appear; we store it but never
 *     treat it as the customer's real email.)
 *   • Field names depend on how the TENANT maps their Zapier action. We can't
 *     fully control that, so the parser is very defensive and we document the
 *     recommended field names in the tile's steps so tenants map them to match.
 *
 * Everything else mirrors the Angi/Thumbtack handlers: getOrCreateLead tagged
 * lead_source='yelp', source-aware speed-to-lead SMS via lib/outboundSms.send,
 * dedupe on lead id, never-drop forward-to-owner, optional secret gate, no AI
 * voice (TCPA), always 200.
 */

const express = require("express");
const router = express.Router();

const db = require("../lib/db");
const { getTenantById } = require("../lib/tenant");
const leadsService = require("../services/leads");
const notificationsService = require("../services/notifications");
const emailService = require("../services/email");
const { normalizeE164Phone } = require("../lib/phone");

function firstNonEmpty(obj, keys) {
  for (const k of keys) {
    const v = obj?.[k];
    if (v != null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

// Recommended Zapier field names are documented in the tile steps, but we check
// many spellings so a tenant's slightly-different mapping still works.
function parseYelpLead(body) {
  const b =
    (body && (body.lead || body.Lead || body.data || body.Data)) || body || {};
  const c = b.customer || b.Customer || b.consumer || b.user || b;

  const firstName = firstNonEmpty(c, ["firstName", "first_name", "FirstName", "firstname"]);
  const lastName = firstNonEmpty(c, ["lastName", "last_name", "LastName", "lastname"]);
  const fullName =
    firstNonEmpty(c, [
      "name", "fullName", "full_name", "displayName", "display_name",
      "customerName", "customer_name", "consumerName", "user_display_name",
    ]) || [firstName, lastName].filter(Boolean).join(" ");

  // Yelp phone: as of Apr 16 2026, real number is in `phone_number` IF the
  // consumer opted in; older configs used a masked `temporary_phone_number`.
  // Check both, plus generic spellings.
  const phone = firstNonEmpty(c, [
    "phone_number", "phoneNumber", "phone", "temporary_phone_number",
    "temporaryPhoneNumber", "Phone", "consumer_phone", "customerPhone",
  ]);

  // Email is masked by Yelp; we capture whatever's present but never trust it
  // as the real address.
  const email = firstNonEmpty(c, ["email", "emailAddress", "email_address", "Email"]);

  // What the customer is asking about (RAQ category / project).
  const serviceType = firstNonEmpty(b, [
    "category", "categoryName", "category_name", "serviceType", "service",
    "project", "projectType", "requestTitle", "title",
  ]);

  // First message text (Yelp "Request a Quote" body), if present.
  const messageText = firstNonEmpty(
    b.message || b.Message || b,
    ["text", "messageText", "message_text", "body", "message", "lead_text"]
  );

  // Yelp lead/event id for dedupe.
  const yelpLeadId = firstNonEmpty(b, [
    "lead_id", "leadId", "leadID", "id", "event_id", "eventId",
    "conversation_id", "conversationId",
  ]);

  // Yelp business id (which location) — audit.
  const businessId = firstNonEmpty(b, [
    "business_id", "businessId", "businessID", "yelp_business_id",
  ]);

  return {
    name: fullName || "Yelp Lead",
    phone,
    email, // masked — informational only
    serviceType,
    messageText,
    yelpLeadId,
    businessId,
    raw: body,
  };
}

function buildYelpOpener(tenant, lead) {
  const company = tenant.company_name || tenant.name || "our team";
  const svc = lead.serviceType ? ` about your ${lead.serviceType.toLowerCase()} project` : "";
  const firstName = (lead.name || "").split(/\s+/)[0];
  const hi = firstName && firstName !== "Yelp" ? `Hi ${firstName}, ` : "Hi, ";
  return (
    `${hi}this is ${company} — thanks for your request on Yelp${svc}! ` +
    `I can get you a quick quote and find a time that works. ` +
    `What are you looking to get done? ` +
    `(Reply STOP to opt out.)`
  );
}

async function forwardRawLeadToOwner(tenant, rawBody, reason) {
  const company = tenant.company_name || tenant.name || "your business";
  const pretty = (() => {
    try { return JSON.stringify(rawBody, null, 2); } catch { return String(rawBody); }
  })();

  notificationsService.createNotification(tenant.id, {
    type: "yelp_lead_needs_review",
    title: "New Yelp lead needs your attention",
    body: `A Yelp lead came in but couldn't be auto-handled (${reason}). Open it to follow up — Yelp often sends message-only leads with no phone, so you may need to reply inside Yelp.`,
    data: { reason, raw: rawBody },
  }).catch((e) => console.error("[Yelp] forward notification failed:", e.message));

  try {
    const to = tenant.support_email || process.env.CONTACT_EMAIL || "drew@aifrontdeskhelper.com";
    await emailService.sendEmail({
      to,
      subject: `🔔 New Yelp lead (action needed) — ${company}`,
      html:
        `<h2>New Yelp lead — needs manual follow-up</h2>` +
        `<p>A Yelp lead arrived but we couldn't auto-text it (<strong>${reason}</strong>). ` +
        `Yelp sends about 60% of leads without a phone number — if there's no phone, reply to this lead inside your Yelp inbox to keep your response time fast.</p>` +
        `<pre style="background:#f5f5f5;padding:12px;border-radius:8px;white-space:pre-wrap">${pretty.replace(/[<>]/g, (ch) => (ch === "<" ? "&lt;" : "&gt;"))}</pre>`,
    });
  } catch (e) {
    console.error("[Yelp] forward email failed:", e.message);
  }
}

router.post("/:tenantId", async (req, res) => {
  const tenantId = req.params.tenantId;
  let tenant = null;

  try {
    const secret = process.env.YELP_WEBHOOK_SECRET;
    if (secret) {
      const provided =
        req.headers["x-yelp-secret"] ||
        req.headers["x-webhook-secret"] ||
        req.query.secret ||
        "";
      if (provided !== secret) {
        console.warn("[Yelp] webhook secret mismatch tenant=%s", tenantId);
        return res.status(401).json({ ok: false, error: "unauthorized" });
      }
    }

    tenant = await getTenantById(tenantId).catch(() => null);
    if (!tenant) {
      console.warn("[Yelp] webhook for unknown tenant=%s", tenantId);
      return res.status(200).json({ ok: false, error: "tenant_not_found" });
    }

    const lead = parseYelpLead(req.body || {});
    console.log("[Yelp] lead received tenant=%s yelpLeadId=%s svc=%s hasPhone=%s",
      tenant.id, lead.yelpLeadId || "(none)", lead.serviceType || "(none)", !!lead.phone);

    if (lead.yelpLeadId) {
      try {
        const dup = await db.query(
          `SELECT id FROM leads
            WHERE tenant_id = $1
              AND metadata->>'yelp_lead_id' = $2
              AND created_at > now() - interval '24 hours'
            LIMIT 1`,
          [tenant.id, lead.yelpLeadId]
        );
        if (dup.rows.length > 0) {
          console.log("[Yelp] duplicate yelpLeadId=%s — skipping", lead.yelpLeadId);
          return res.status(200).json({ ok: true, deduped: true });
        }
      } catch (e) {
        console.error("[Yelp] dedup check failed:", e.message);
      }
    }

    // No usable phone → forward to owner (very common for Yelp — message-only).
    const normalizedPhone = lead.phone ? normalizeE164Phone(lead.phone) : null;
    if (!normalizedPhone) {
      console.warn("[Yelp] no usable phone tenant=%s — forwarding raw to owner (expected for ~60%% of Yelp leads)", tenant.id);
      await forwardRawLeadToOwner(tenant, req.body || {}, "no phone number (Yelp message-only lead)");
      return res.status(200).json({ ok: true, forwarded: true });
    }

    const leadRow = await leadsService.getOrCreateLead(
      tenant.id,
      normalizedPhone,
      lead.name,
      "yelp",          // lead_source
      "third_party"    // contact_method bucket
    );
    if (!leadRow) {
      await forwardRawLeadToOwner(tenant, req.body || {}, "lead create failed");
      return res.status(200).json({ ok: true, forwarded: true });
    }

    leadsService.updateLeadInfo(leadRow.id, {
      project_type: lead.serviceType || undefined,
      metadata: {
        yelp_lead_id: lead.yelpLeadId || null,
        yelp_business_id: lead.businessId || null,
        yelp_service: lead.serviceType || null,
        yelp_first_message: lead.messageText || null,
        yelp_masked_email: lead.email || null, // masked — not the real address
        source_detail: "yelp_zapier_relay",
      },
    }).catch((e) => console.error("[Yelp] updateLeadInfo failed:", e.message));

    let smsSent = false;
    try {
      const outboundSms = require("../lib/outboundSms");
      const opener = buildYelpOpener(tenant, lead);
      const result = await outboundSms.send({
        tenant,
        to: normalizedPhone,
        body: opener,
        source: "yelp_speed_to_lead",
        leadId: leadRow.id,
        sourceId: lead.yelpLeadId || null,
        meta: {
          yelp_lead_id: lead.yelpLeadId || null,
          yelp_service: lead.serviceType || null,
        },
      });
      smsSent = !!(result && result.ok);
      if (!smsSent) {
        console.warn("[Yelp] outboundSms.send non-ok tenant=%s lead=%s reason=%s err=%s",
          tenant.id, leadRow.id, result?.reason || "unknown", result?.error || "(none)");
      } else {
        console.log("[Yelp] speed-to-lead SMS sent tenant=%s lead=%s sid=%s",
          tenant.id, leadRow.id, result.sid || "(none)");
      }
    } catch (e) {
      console.error("[Yelp] speed-to-lead SMS failed:", e.message);
    }

    if (!smsSent) {
      await forwardRawLeadToOwner(
        tenant,
        req.body || {},
        "lead created but speed-to-lead SMS did not send (check Twilio config / number)"
      );
    } else {
      notificationsService.createNotification(tenant.id, {
        type: "yelp_lead_engaged",
        title: "New Yelp lead — AI texted them",
        body: `${lead.name}${lead.serviceType ? ` (${lead.serviceType})` : ""} came in from Yelp. The AI sent the first text within seconds.`,
        data: { leadId: leadRow.id, yelpLeadId: lead.yelpLeadId || null },
      }).catch(() => {});
    }

    return res.status(200).json({ ok: true, leadId: leadRow.id, smsSent });
  } catch (err) {
    console.error("[Yelp] webhook fatal error tenant=%s: %s", tenantId, err.stack || err.message);
    if (tenant) {
      forwardRawLeadToOwner(tenant, req.body || {}, `unexpected error: ${err.message}`).catch(() => {});
    }
    return res.status(200).json({ ok: true, error_handled: true });
  }
});

module.exports = router;
