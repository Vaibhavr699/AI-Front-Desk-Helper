"use strict";

/**
 * facebookLeadgen.js  (Phase A4 — Jun 18, 2026)
 *
 * Facebook Lead Ads ingestion — the "instant-form" half of Facebook, distinct
 * from Messenger DMs. When a homeowner taps a "Get a Free Quote" Lead Ad in
 * the FB/IG feed and submits the form, Meta fires a webhook to the SAME
 * /facebook-webhook endpoint we already use for Messenger — but as an
 * `entry.changes` event with field === "leadgen", NOT an `entry.messaging`
 * event. This module handles that branch.
 *
 * WIRING (in server.js /facebook-webhook handler, right after
 *   `const entry = req.body.entry?.[0];`):
 *
 *     const change = entry?.changes?.[0];
 *     if (change && change.field === "leadgen") {
 *       res.sendStatus(200);                       // ack fast, like the FB messaging path
 *       handleFacebookLeadgen(change.value).catch((e) =>
 *         console.error("[FB Leadgen] async handler error:", e.message));
 *       return;
 *     }
 *     // ... existing messaging logic unchanged ...
 *
 * Mirrors routes/angiLeads.js deliberately: resolve tenant → dedupe on the
 * source's lead id → getOrCreateLead tagged lead_source → updateLeadInfo with
 * metadata → fire the speed-to-lead SMS via lib/outboundSms.send → forward the
 * raw lead to the owner on ANY failure (never drop). Always swallow errors so
 * the webhook ack is never blocked.
 *
 * THE ONE DIFFERENCE FROM ANGI: Angi POSTs the full lead. Meta posts only a
 * `leadgen_id` — we must fetch the field values from the Graph API using the
 * Page access token. THAT fetch is the call requiring `leads_retrieval`. In
 * Development mode it works for Pages you admin (Gladiators) — which is how we
 * generate the one required successful API call before requesting Advanced
 * Access. For OTHER tenants' Pages it stays gated until the app is Live with
 * leads_retrieval approved.
 *
 * DEPENDENCIES (all already in server.js scope; passed in via init()):
 *   getTenantByFacebookPageId, leadsService, db, notificationsService,
 *   emailService, normalizeE164Phone, fetch (node-fetch)
 */

let _deps = null;

// Called once from server.js to inject the already-required modules so this
// file doesn't re-require and risk a different db pool / circular import.
function init(deps) {
  _deps = deps;
}

const GRAPH_VERSION = "v25.0"; // match the webhook field version shown in the FB console

// ─────────────────────────────────────────────────────────────────────────────
// Field mapping — Meta returns field_data as [{ name, values: [...] }, ...]
// where `name` is whatever the advertiser named the form field. Names are
// form-defined and inconsistent, so we match defensively like parseAngiLead.
// ─────────────────────────────────────────────────────────────────────────────
function pickField(fieldMap, candidates) {
  for (const key of candidates) {
    const v = fieldMap[key];
    if (v != null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

function parseLeadFields(fieldData) {
  // Flatten [{name, values:[v]}] → { name: v } with lowercased keys.
  const fieldMap = {};
  for (const f of Array.isArray(fieldData) ? fieldData : []) {
    if (!f || !f.name) continue;
    const val = Array.isArray(f.values) ? f.values[0] : f.values;
    fieldMap[String(f.name).toLowerCase()] = val != null ? String(val) : "";
  }

  const fullName = pickField(fieldMap, [
    "full_name", "name", "your_name", "full name",
  ]);
  const firstName = pickField(fieldMap, ["first_name", "firstname", "first name"]);
  const lastName = pickField(fieldMap, ["last_name", "lastname", "last name"]);
  const name = fullName || [firstName, lastName].filter(Boolean).join(" ") || "Facebook Lead";

  const phone = pickField(fieldMap, [
    "phone_number", "phone", "phonenumber", "phone number", "mobile_number", "contact_number",
  ]);
  const email = pickField(fieldMap, ["email", "email_address", "e-mail"]);

  // Address may be a single field or split; capture whatever's present.
  const street = pickField(fieldMap, ["street_address", "address", "address1"]);
  const city = pickField(fieldMap, ["city", "town"]);
  const state = pickField(fieldMap, ["state", "province", "region"]);
  const zip = pickField(fieldMap, ["zip_code", "post_code", "postal_code", "zip"]);
  const address = [street, city, state, zip].filter(Boolean).join(", ");

  // The advertiser's project/service question — many possible field names.
  const serviceType = pickField(fieldMap, [
    "service", "service_type", "project_type", "what_service_are_you_interested_in",
    "what_do_you_need", "project", "job_type", "interest", "i_am_interested_in",
  ]);

  return { name, phone, email, address, serviceType, rawFieldMap: fieldMap };
}

// Speed-to-lead opener, mirroring buildAngiOpener — names the source so the
// homeowner expects the text, asks for the project, confirms opt-out.
function buildFacebookLeadOpener(tenant, lead) {
  const company = tenant.company_name || tenant.name || "our team";
  const svc = lead.serviceType ? ` about your ${lead.serviceType.toLowerCase()} project` : "";
  const firstName = (lead.name || "").split(/\s+/)[0];
  const hi = firstName && firstName !== "Facebook" ? `Hi ${firstName}, ` : "Hi, ";
  return (
    `${hi}this is ${company} — thanks for your request on Facebook${svc}! ` +
    `I can get you a quick quote and find a time that works. ` +
    `What are you looking to get done? ` +
    `(Reply STOP to opt out.)`
  );
}

// Forward-on-fail safety net — mirrors angiLeads.forwardRawLeadToOwner.
async function forwardRawLeadToOwner(tenant, rawValue, reason) {
  const { notificationsService, emailService } = _deps;
  const company = tenant.company_name || tenant.name || "your business";
  const pretty = (() => {
    try { return JSON.stringify(rawValue, null, 2); } catch { return String(rawValue); }
  })();

  notificationsService.createNotification(tenant.id, {
    type: "facebook_lead_needs_review",
    title: "New Facebook lead needs your attention",
    body: `A Facebook Lead Ad came in but couldn't be auto-handled (${reason}). Open it to follow up — don't let it go cold.`,
    data: { reason, raw: rawValue },
  }).catch((e) => console.error("[FB Leadgen] forward notification failed:", e.message));

  try {
    const to = tenant.support_email || process.env.CONTACT_EMAIL || "drew@aifrontdeskhelper.com";
    await emailService.sendEmail({
      to,
      subject: `🔔 New Facebook lead (action needed) — ${company}`,
      html:
        `<h2>New Facebook Lead Ad — needs manual follow-up</h2>` +
        `<p>A Facebook lead arrived but we couldn't auto-text it (<strong>${reason}</strong>). ` +
        `Reach out fast — speed-to-lead wins these.</p>` +
        `<pre style="background:#f5f5f5;padding:12px;border-radius:8px;white-space:pre-wrap">${pretty.replace(/[<>]/g, (c) => (c === "<" ? "&lt;" : "&gt;"))}</pre>`,
    });
  } catch (e) {
    console.error("[FB Leadgen] forward email failed:", e.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main handler — receives the `change.value` object from the leadgen webhook:
//   { leadgen_id, page_id, form_id, adgroup_id, ad_id, created_time }
// ─────────────────────────────────────────────────────────────────────────────
async function handleFacebookLeadgen(value) {
  const { getTenantByFacebookPageId, leadsService, db, notificationsService, normalizeE164Phone, fetch } = _deps;

  const leadgenId = value?.leadgen_id ? String(value.leadgen_id) : null;
  const pageId = value?.page_id ? String(value.page_id) : null;

  if (!leadgenId || !pageId) {
    console.warn("[FB Leadgen] missing leadgen_id or page_id in value=%j", value);
    return;
  }

  // 1. Resolve tenant from the Page ID — same resolver as the Messenger path.
  const tenant = await getTenantByFacebookPageId(pageId).catch(() => null);
  if (!tenant) {
    console.warn("[FB Leadgen] no tenant for page_id=%s leadgen_id=%s", pageId, leadgenId);
    return;
  }

  // The Page access token — same per-tenant field the Messenger send path uses.
  const pageToken = tenant.facebook_page_access_token;
  if (!pageToken) {
    console.warn("[FB Leadgen] tenant=%s has no page token — forwarding raw", tenant.id);
    await forwardRawLeadToOwner(tenant, value, "no Facebook page token on tenant");
    return;
  }

  // 2. Idempotency — skip if we've already created a lead for this leadgen_id.
  try {
    const dup = await db.query(
      `SELECT id FROM leads
        WHERE tenant_id = $1
          AND metadata->>'fb_leadgen_id' = $2
          AND created_at > now() - interval '24 hours'
        LIMIT 1`,
      [tenant.id, leadgenId]
    );
    if (dup.rows.length > 0) {
      console.log("[FB Leadgen] duplicate leadgen_id=%s — skipping", leadgenId);
      return;
    }
  } catch (e) {
    console.error("[FB Leadgen] dedup check failed:", e.message);
  }

  // 3. Fetch the actual field values from the Graph API. THIS is the call that
  //    requires leads_retrieval. Works in dev for Pages you admin; gated for
  //    other tenants until Live + Advanced Access.
  let fieldData;
  try {
    const url = `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(leadgenId)}` +
      `?access_token=${encodeURIComponent(pageToken)}`;
    const resp = await fetch(url);
    if (!resp.ok) {
      const errBody = await resp.text();
      console.error("[FB Leadgen] Graph fetch failed leadgen_id=%s status=%s body=%s",
        leadgenId, resp.status, errBody.slice(0, 300));
      // 190 = token expired; 100/200 often = missing leads_retrieval permission.
      await forwardRawLeadToOwner(tenant, value,
        `could not fetch lead from Facebook (HTTP ${resp.status} — likely missing leads_retrieval permission or expired token)`);
      return;
    }
    const data = await resp.json();
    fieldData = data.field_data;
  } catch (e) {
    console.error("[FB Leadgen] Graph fetch threw leadgen_id=%s: %s", leadgenId, e.message);
    await forwardRawLeadToOwner(tenant, value, `error fetching lead from Facebook: ${e.message}`);
    return;
  }

  // 4. Map the fields.
  const lead = parseLeadFields(fieldData);
  console.log("[FB Leadgen] lead received tenant=%s leadgen_id=%s svc=%s hasPhone=%s",
    tenant.id, leadgenId, lead.serviceType || "(none)", !!lead.phone);

  // 5. No usable phone → forward to owner, never drop. (Many lead forms collect
  //    email only — that's still a real lead, just can't speed-to-text it.)
  const normalizedPhone = lead.phone ? normalizeE164Phone(lead.phone) : null;
  if (!normalizedPhone) {
    console.warn("[FB Leadgen] no usable phone tenant=%s leadgen_id=%s — forwarding raw", tenant.id, leadgenId);
    await forwardRawLeadToOwner(tenant, { ...value, parsed: lead }, "no phone number in lead form");
    return;
  }

  // 6. Create / resolve the lead, tagged source = 'facebook_leadad'.
  const leadRow = await leadsService.getOrCreateLead(
    tenant.id,
    normalizedPhone,
    lead.name,
    "facebook_leadad", // lead_source
    "third_party"      // contact_method bucket
  );
  if (!leadRow) {
    await forwardRawLeadToOwner(tenant, { ...value, parsed: lead }, "lead create failed");
    return;
  }

  leadsService.updateLeadInfo(leadRow.id, {
    email: lead.email || undefined,
    address: lead.address || undefined,
    project_type: lead.serviceType || undefined,
    metadata: {
      fb_leadgen_id: leadgenId,
      fb_page_id: pageId,
      fb_form_id: value.form_id || null,
      fb_ad_id: value.ad_id || null,
      fb_service: lead.serviceType || null,
      source_detail: "facebook_lead_ads",
    },
  }).catch((e) => console.error("[FB Leadgen] updateLeadInfo failed:", e.message));

  // 7. Speed-to-lead SMS — same sender as Angi (writes to messages table too).
  let smsSent = false;
  try {
    const outboundSms = require("./lib/outboundSms");
    const opener = buildFacebookLeadOpener(tenant, lead);
    const result = await outboundSms.send({
      tenant,
      to: normalizedPhone,
      body: opener,
      source: "facebook_speed_to_lead",
      leadId: leadRow.id,
      sourceId: leadgenId,
      meta: { fb_leadgen_id: leadgenId, fb_service: lead.serviceType || null },
    });
    smsSent = !!(result && result.ok);
    if (!smsSent) {
      console.warn("[FB Leadgen] outboundSms.send non-ok tenant=%s lead=%s reason=%s err=%s",
        tenant.id, leadRow.id, result?.reason || "unknown", result?.error || "(none)");
    } else {
      console.log("[FB Leadgen] speed-to-lead SMS sent tenant=%s lead=%s sid=%s",
        tenant.id, leadRow.id, result.sid || "(none)");
    }
  } catch (e) {
    console.error("[FB Leadgen] speed-to-lead SMS failed:", e.message);
  }

  // 8. Surface to owner appropriately.
  if (!smsSent) {
    await forwardRawLeadToOwner(tenant, { ...value, parsed: lead },
      "lead created but speed-to-lead SMS did not send (check Twilio / tenant SMS config)");
  } else {
    notificationsService.createNotification(tenant.id, {
      type: "facebook_lead_engaged",
      title: "New Facebook lead — AI texted them",
      body: `${lead.name}${lead.serviceType ? ` (${lead.serviceType})` : ""} came in from a Facebook Lead Ad. The AI sent the first text within seconds.`,
      data: { leadId: leadRow.id, leadgenId },
    }).catch(() => {});
  }
}

module.exports = { init, handleFacebookLeadgen, parseLeadFields, buildFacebookLeadOpener };
