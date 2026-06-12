"use strict";

/**
 * routes/networxLeads.js
 *
 * Phase 14 (Jun 12, 2026) — Networx inbound webhook (speed-to-lead).
 *
 * Networx is a home-service lead broker (like Angi). It delivers purchased
 * leads to a partner endpoint via JSON POST. The tenant arranges delivery to
 * THIS per-tenant URL with their Networx account rep / dashboard webhook
 * settings — AIFDH owns no Networx account.
 *
 * THIS ENDPOINT:
 *   POST /api/webhooks/networx/:tenantId
 *
 * Networx leads are broker leads: they carry name, phone, email, address, and
 * a service/category. Phone is normally present (broker leads are sold as
 * contactable). The parser is defensive about exact key spellings since the
 * self-serve payload shape isn't published — confirm against the first real
 * lead and tighten.
 *
 * Mirrors the Angi handler: getOrCreateLead tagged lead_source='networx',
 * source-aware speed-to-lead SMS, dedupe on lead id, never-drop forward-to-
 * owner, optional secret gate, no AI voice (TCPA), always 200.
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

function parseNetworxLead(body) {
  const b =
    (body && (body.lead || body.Lead || body.data || body.Data)) || body || {};
  const c = b.customer || b.Customer || b.contact || b.Contact || b;

  const firstName = firstNonEmpty(c, ["firstName", "first_name", "FirstName", "firstname", "fname"]);
  const lastName = firstNonEmpty(c, ["lastName", "last_name", "LastName", "lastname", "lname"]);
  const fullName =
    firstNonEmpty(c, [
      "name", "fullName", "full_name", "customerName", "customer_name", "contactName",
    ]) || [firstName, lastName].filter(Boolean).join(" ");

  const phone = firstNonEmpty(c, [
    "phone", "phoneNumber", "phone_number", "Phone", "PhoneNumber",
    "primaryPhone", "contactPhone", "mobilePhone", "cell",
  ]);

  const email = firstNonEmpty(c, ["email", "emailAddress", "email_address", "Email"]);

  const address = firstNonEmpty(c, [
    "address", "streetAddress", "street_address", "address1", "Address",
  ]);
  const city = firstNonEmpty(c, ["city", "City"]);
  const state = firstNonEmpty(c, ["state", "State"]);
  const zip = firstNonEmpty(c, ["zip", "zipCode", "zip_code", "postalCode", "Zip"]);
  const fullAddress = [address, city, state, zip].filter(Boolean).join(", ");

  const serviceType = firstNonEmpty(b, [
    "serviceType", "service", "category", "categoryName", "jobType",
    "projectType", "trade", "interest", "job_type",
  ]);

  const networxLeadId = firstNonEmpty(b, [
    "leadId", "lead_id", "id", "networxId", "networx_id", "referenceId", "reference_id",
  ]);

  return {
    name: fullName || "Networx Lead",
    phone,
    email,
    address: fullAddress,
    serviceType,
    networxLeadId,
    raw: body,
  };
}

function buildNetworxOpener(tenant, lead) {
  const company = tenant.company_name || tenant.name || "our team";
  const svc = lead.serviceType ? ` about your ${lead.serviceType.toLowerCase()} project` : "";
  const firstName = (lead.name || "").split(/\s+/)[0];
  const hi = firstName && firstName !== "Networx" ? `Hi ${firstName}, ` : "Hi, ";
  return (
    `${hi}this is ${company} — thanks for your request${svc}! ` +
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
    type: "networx_lead_needs_review",
    title: "New Networx lead needs your attention",
    body: `A Networx lead came in but couldn't be auto-handled (${reason}). Open it to follow up — don't let it go cold.`,
    data: { reason, raw: rawBody },
  }).catch((e) => console.error("[Networx] forward notification failed:", e.message));

  try {
    const to = tenant.support_email || process.env.CONTACT_EMAIL || "drew@aifrontdeskhelper.com";
    await emailService.sendEmail({
      to,
      subject: `🔔 New Networx lead (action needed) — ${company}`,
      html:
        `<h2>New Networx lead — needs manual follow-up</h2>` +
        `<p>A Networx lead arrived but we couldn't auto-text it (<strong>${reason}</strong>). ` +
        `Reach out fast — broker leads are shared with several pros and go cold quickly.</p>` +
        `<pre style="background:#f5f5f5;padding:12px;border-radius:8px;white-space:pre-wrap">${pretty.replace(/[<>]/g, (ch) => (ch === "<" ? "&lt;" : "&gt;"))}</pre>`,
    });
  } catch (e) {
    console.error("[Networx] forward email failed:", e.message);
  }
}

router.post("/:tenantId", async (req, res) => {
  const tenantId = req.params.tenantId;
  let tenant = null;

  try {
    const secret = process.env.NETWORX_WEBHOOK_SECRET;
    if (secret) {
      const provided =
        req.headers["x-networx-secret"] ||
        req.headers["x-webhook-secret"] ||
        req.query.secret ||
        "";
      if (provided !== secret) {
        console.warn("[Networx] webhook secret mismatch tenant=%s", tenantId);
        return res.status(401).json({ ok: false, error: "unauthorized" });
      }
    }

    tenant = await getTenantById(tenantId).catch(() => null);
    if (!tenant) {
      console.warn("[Networx] webhook for unknown tenant=%s", tenantId);
      return res.status(200).json({ ok: false, error: "tenant_not_found" });
    }

    const lead = parseNetworxLead(req.body || {});
    console.log("[Networx] lead received tenant=%s networxLeadId=%s svc=%s hasPhone=%s",
      tenant.id, lead.networxLeadId || "(none)", lead.serviceType || "(none)", !!lead.phone);

    if (lead.networxLeadId) {
      try {
        const dup = await db.query(
          `SELECT id FROM leads
            WHERE tenant_id = $1
              AND metadata->>'networx_lead_id' = $2
              AND created_at > now() - interval '24 hours'
            LIMIT 1`,
          [tenant.id, lead.networxLeadId]
        );
        if (dup.rows.length > 0) {
          console.log("[Networx] duplicate networxLeadId=%s — skipping", lead.networxLeadId);
          return res.status(200).json({ ok: true, deduped: true });
        }
      } catch (e) {
        console.error("[Networx] dedup check failed:", e.message);
      }
    }

    const normalizedPhone = lead.phone ? normalizeE164Phone(lead.phone) : null;
    if (!normalizedPhone) {
      console.warn("[Networx] no usable phone tenant=%s — forwarding raw to owner", tenant.id);
      await forwardRawLeadToOwner(tenant, req.body || {}, "no phone number in lead");
      return res.status(200).json({ ok: true, forwarded: true });
    }

    const leadRow = await leadsService.getOrCreateLead(
      tenant.id,
      normalizedPhone,
      lead.name,
      "networx",       // lead_source
      "third_party"    // contact_method bucket
    );
    if (!leadRow) {
      await forwardRawLeadToOwner(tenant, req.body || {}, "lead create failed");
      return res.status(200).json({ ok: true, forwarded: true });
    }

    leadsService.updateLeadInfo(leadRow.id, {
      email: lead.email || undefined,
      address: lead.address || undefined,
      project_type: lead.serviceType || undefined,
      metadata: {
        networx_lead_id: lead.networxLeadId || null,
        networx_service: lead.serviceType || null,
        source_detail: "networx_webhook",
      },
    }).catch((e) => console.error("[Networx] updateLeadInfo failed:", e.message));

    let smsSent = false;
    try {
      const outboundSms = require("../lib/outboundSms");
      const opener = buildNetworxOpener(tenant, lead);
      const result = await outboundSms.send({
        tenant,
        to: normalizedPhone,
        body: opener,
        source: "networx_speed_to_lead",
        leadId: leadRow.id,
        sourceId: lead.networxLeadId || null,
        meta: {
          networx_lead_id: lead.networxLeadId || null,
          networx_service: lead.serviceType || null,
        },
      });
      smsSent = !!(result && result.ok);
      if (!smsSent) {
        console.warn("[Networx] outboundSms.send non-ok tenant=%s lead=%s reason=%s err=%s",
          tenant.id, leadRow.id, result?.reason || "unknown", result?.error || "(none)");
      } else {
        console.log("[Networx] speed-to-lead SMS sent tenant=%s lead=%s sid=%s",
          tenant.id, leadRow.id, result.sid || "(none)");
      }
    } catch (e) {
      console.error("[Networx] speed-to-lead SMS failed:", e.message);
    }

    if (!smsSent) {
      await forwardRawLeadToOwner(
        tenant,
        req.body || {},
        "lead created but speed-to-lead SMS did not send (check Twilio config / number)"
      );
    } else {
      notificationsService.createNotification(tenant.id, {
        type: "networx_lead_engaged",
        title: "New Networx lead — AI texted them",
        body: `${lead.name}${lead.serviceType ? ` (${lead.serviceType})` : ""} came in from Networx. The AI sent the first text within seconds.`,
        data: { leadId: leadRow.id, networxLeadId: lead.networxLeadId || null },
      }).catch(() => {});
    }

    return res.status(200).json({ ok: true, leadId: leadRow.id, smsSent });
  } catch (err) {
    console.error("[Networx] webhook fatal error tenant=%s: %s", tenantId, err.stack || err.message);
    if (tenant) {
      forwardRawLeadToOwner(tenant, req.body || {}, `unexpected error: ${err.message}`).catch(() => {});
    }
    return res.status(200).json({ ok: true, error_handled: true });
  }
});

module.exports = router;
