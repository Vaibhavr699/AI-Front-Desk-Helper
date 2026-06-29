"use strict";

const db = require("../lib/db");
const notificationService = require("./notifications");
const { logAction } = require("../lib/auditLogger");
const { normalizeE164Phone, getLast10Digits } = require("../lib/phone");

/**
 * Derive contact_method from available signals when not explicitly passed.
 * Priority: explicit arg > ID prefix > lead_source heuristics > 'unknown'.
 */
function deriveContactMethod(explicit, input, leadSource) {
  if (explicit) return explicit;
  if (typeof input === "string" && input.startsWith("fb-")) return "facebook";
  if (typeof input === "string" && input.startsWith("web-")) return "web_form";
  if (leadSource && /dripjobs|crm|webhook/i.test(leadSource)) return "crm";
  return "unknown";
}

/**
 * Get or create a lead by phone number or external ID for a tenant.
 *
 * ───────────────────────────────────────────────────────────────────────
 * PHONE NORMALIZATION FIX (May 28, 2026)
 *
 * ROOT CAUSE of the call→lead linking bug + duplicate leads:
 * This function previously did an EXACT-STRING phone match on both the
 * SELECT and the INSERT. But the same human's number arrives in different
 * formats from different code paths:
 *   - voice WS handler → "+14022907925" (E.164, straight from Twilio)
 *   - SMS/CRM/booking  → normalized elsewhere via normalizeE164Phone
 *   - legacy rows      → "402-290-7925", "4022907925", etc.
 *
 * Because leads has a UNIQUE (tenant_id, phone) constraint on the raw
 * STRING, three different format strings for one number all inserted
 * successfully as three distinct rows (e.g. +14022907925 had 3 rows).
 * And a voice call looking for exact "+14022907925" missed an existing
 * lead stored as "402-290-7925", so it either created a dupe or — on a
 * short call where the fire-and-forget promise raced the call end — left
 * the call with lead_id=null. Result: 34% link rate, duplicate leads.
 *
 * FIX:
 *   1. Normalize real phone numbers to canonical E.164 ONCE at the top.
 *      Store and compare the canonical form everywhere.
 *   2. On lookup, match BOTH the canonical phone AND the last-10-digits,
 *      so we link to legacy rows stored in mixed formats instead of
 *      creating yet another dupe during the transition window.
 *   3. fb-/web- synthetic keys are NOT phone numbers — leave them as-is
 *      (they were never the source of the dupe problem).
 *
 * Once migration 085 backfills all existing leads.phone to E.164 and
 * merges the existing dupes, the UNIQUE (tenant_id, phone) constraint
 * finally does what it was always meant to: one row per real number.
 * ───────────────────────────────────────────────────────────────────────
 */
async function getOrCreateLead(tenantId, phoneOrId, name = null, leadSource = null, contactMethod = null) {
  if (!tenantId || !phoneOrId) return null;
  const raw = String(phoneOrId).trim();

  const isFb  = raw.startsWith("fb-");
  const isWeb = raw.startsWith("web-");
  const isSynthetic = isFb || isWeb;

  // For real phone numbers, normalize to E.164. For synthetic keys
  // (fb-/web-), keep the raw string — they're identifiers, not phones.
  // normalizeE164Phone returns null on unparseable input; fall back to
  // the raw trimmed string so we never lose a lead over a format quirk.
  const canonical = isSynthetic ? raw : (normalizeE164Phone(raw) || raw);

  let res;

  // ── 1. Lookup ──────────────────────────────────────────────────────
  if (isFb) {
    const fbId = raw.replace("fb-", "");
    res = await db.query(
      "SELECT * FROM leads WHERE tenant_id = $1 AND (facebook_id = $2 OR phone = $3)",
      [tenantId, fbId, raw]
    );
  } else if (isWeb) {
    const webId = raw.replace("web-", "");
    res = await db.query(
      "SELECT * FROM leads WHERE tenant_id = $1 AND (web_id = $2 OR phone = $3)",
      [tenantId, webId, raw]
    );
  } else {
    // Standard phone lookup — match canonical E.164 OR last-10-digits.
    // The last-10 match is what links a voice call (+14022907925) to a
    // legacy lead stored as "402-290-7925" or "4022907925", preventing a
    // duplicate during the transition before migration 085's backfill.
    const last10 = getLast10Digits(canonical);
    res = await db.query(
      `SELECT * FROM leads
        WHERE tenant_id = $1
          AND (
            phone = $2
            OR right(regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g'), 10) = $3
          )
        ORDER BY created_at ASC
        LIMIT 1`,
      [tenantId, canonical, last10]
    );
  }

  if (res.rows.length > 0) {
    const lead = res.rows[0];

    // Sync external ID if missing but present in query.
    if (isFb && !lead.facebook_id) {
      await db.query("UPDATE leads SET facebook_id = $1 WHERE id = $2", [raw.replace("fb-", ""), lead.id]);
    } else if (isWeb && !lead.web_id) {
      await db.query("UPDATE leads SET web_id = $1 WHERE id = $2", [raw.replace("web-", ""), lead.id]);
    }

    // Opportunistically upgrade a legacy-format phone to canonical E.164
    // on read, so the table self-heals over time even outside migration 085.
    // Only do this for real phones, only when the stored value differs from
    // canonical, and guard against the unique constraint (another row might
    // already hold the canonical form — if so, leave this one alone rather
    // than throw).
    if (!isSynthetic && lead.phone && lead.phone !== canonical) {
      try {
        await db.query(
          "UPDATE leads SET phone = $1, updated_at = now() WHERE id = $2",
          [canonical, lead.id]
        );
        lead.phone = canonical;
      } catch (e) {
        // 23505 = another row already has canonical phone for this tenant.
        // Harmless here — we still return the lead we found. Migration 085
        // handles the full merge; this is just opportunistic self-healing.
        if (e.code !== "23505") {
          console.error("[Leads] phone self-heal failed leadId=%s err=%s", lead.id, e.message);
        }
      }
    }

    // If we have a name now but didn't before, update it.
    if (name && !lead.name) {
      const updated = await db.query(
        "UPDATE leads SET name = $1, updated_at = now() WHERE id = $2 RETURNING *",
        [name, lead.id]
      );
      return updated.rows[0];
    }
    // NOTE: contact_method is intentionally NOT updated on existing leads.
    // It represents original acquisition channel and is immutable after INSERT.
    return lead;
  }

  // ── 2. Create new ──────────────────────────────────────────────────
  const facebook_id = isFb ? raw.replace("fb-", "") : null;
  const web_id      = isWeb ? raw.replace("web-", "") : null;
  const resolvedContactMethod = deriveContactMethod(contactMethod, raw, leadSource);

  try {
    res = await db.query(
      `INSERT INTO leads (tenant_id, phone, name, status, lead_source, facebook_id, web_id, contact_method)
       VALUES ($1, $2, $3, 'New Lead', $4, $5, $6, $7)
       RETURNING *`,
      // Store the CANONICAL phone, not the raw input. This is what makes
      // the UNIQUE (tenant_id, phone) constraint actually dedupe.
      [tenantId, canonical, name, leadSource, facebook_id, web_id, resolvedContactMethod]
    );
    const newLead = res.rows[0];

    // 🆕 Fire new-lead notification (never blocks lead creation)
    notificationService.notifyNewLead(tenantId, {
      customer_name:  newLead.name,
      phone:          newLead.phone,
      source:         newLead.lead_source,
      contact_method: newLead.contact_method,
      lead_id:        newLead.id,
    }).catch((e) => console.error("[Leads] notifyNewLead failed:", e.message));

    return newLead;
  } catch (err) {
    // Race condition: a concurrent call inserted the same canonical phone
    // between our SELECT and INSERT. Now that we store canonical form, the
    // retry SELECT will actually FIND that row (previously it missed because
    // the two requests may have used different raw formats). This makes the
    // retry path correct instead of an infinite-miss loop.
    if (err.code === "23505") {
      return getOrCreateLead(tenantId, phoneOrId, name, leadSource, contactMethod);
    }
    throw err;
  }
}

async function updateLeadStatus(id, status) {
  return db.query(
    "UPDATE leads SET status = $1, updated_at = now() WHERE id = $2 RETURNING id, status",
    [status, id]
  );
}

async function updateLeadInfo(id, data) {
  const fields = [];
  const values = [];
  let i = 1;

  // NOTE: contact_method is NOT in this allow-list — immutable after INSERT by design.
  // do_not_contact is also NOT in this allow-list — must go through setDoNotContact()
  // so the cascade (cancel recoveries + nurtures) and the audit fields fire correctly.
  // If an admin needs to bypass, do it via direct SQL.
  const allowed = [
    'name', 'email', 'address', 'project_type', 'notes', 'status',
    'estimated_revenue_cents', 'actual_revenue_cents', 'lead_source', 'has_sms_consent', 'last_consent_at',
    'last_consent_id', 'phone', 'facebook_id', 'web_id'
  ];
  for (const key of allowed) {
    if (data[key] !== undefined) {
      // Normalize phone on update too, so the dashboard editing a lead's
      // phone can't reintroduce a non-canonical format.
      if (key === "phone" && typeof data[key] === "string") {
        const v = data[key].trim();
        const normalized =
          v.startsWith("fb-") || v.startsWith("web-") ? v : (normalizeE164Phone(v) || v);
        fields.push(`${key} = $${i++}`);
        values.push(normalized);
      } else {
        fields.push(`${key} = $${i++}`);
        values.push(data[key]);
      }
    }
  }

  if (fields.length === 0) return null;

  values.push(id);
  const query = `UPDATE leads SET ${fields.join(', ')}, updated_at = now() WHERE id = $${i} RETURNING *`;
  const res = await db.query(query, values);
  return res.rows[0];
}

async function getLeadById(id) {
  const res = await db.query(`
    SELECT l.*,
           sc.consent_text, sc.ip_address, sc.user_agent, sc.page_url, sc.source as consent_source,
           du.email as do_not_contact_set_by_name
    FROM leads l
    LEFT JOIN sms_consents sc   ON l.last_consent_id      = sc.id
    LEFT JOIN dashboard_users du ON l.do_not_contact_set_by = du.id
    WHERE l.id = $1
  `, [id]);
  return res.rows[0];
}

async function getLeadsByTenant(tenantIds, limit = 50, offset = 0) {
  // Accept either a single ID string or an array
  const ids = Array.isArray(tenantIds) ? tenantIds : [tenantIds];
  const res = await db.query(
    "SELECT * FROM leads WHERE tenant_id = ANY($1) ORDER BY updated_at DESC LIMIT $2 OFFSET $3",
    [ids, limit, offset]
  );
  return res.rows;
}

/**
 * Set / clear the do_not_contact flag for a lead.
 *
 * When flipping ON (value=true), this also CANCELS any active estimate
 * recoveries and pending nurturing schedule rows for the lead, so the
 * dashboard reflects clean state immediately and no cron tick can fire
 * a stray text. The cron-level suppression checks (services/estimateRecovery
 * and services/nurturing) are the durable defense — this cascade is the
 * "make it instant" cleanup.
 *
 * When flipping OFF (value=false), the lead is reopened to future
 * automation, but previously cancelled sequences stay cancelled. This is
 * intentional — un-cancelling old sequences would surprise users.
 *
 * AUDIT LOG — Migration 060 (May 9, 2026):
 * This function now writes the audit_logs entry directly via logAction(),
 * so EVERY caller path (dashboard PATCH, SMS keyword, SMS intent, voice
 * intent) gets logged identically without duplication. The previous
 * logAction call in routes/leads.js for DNC flips has been removed —
 * routes/leads.js now ONLY passes ip_address + user_agent through options
 * so this function can record them for SOC 2 evidence.
 *
 * Returns: { lead, cancelled_recoveries, cancelled_nurtures }
 *
 * options:
 *   - userId: dashboard_users.id of the person flipping the toggle
 *   - reason: optional free-text reason ("customer asked us to stop")
 *   - cascade: defaults true; set false to flip the flag without
 *     cancelling sequences (rarely needed — admin debugging only)
 *   - trigger_source: where the flip originated, for TCPA audit
 *       'owner_dashboard' (default) — manual toggle in CRM
 *       'sms_keyword'      — STOP/UNSUBSCRIBE/etc carrier keyword
 *       'sms_intent'       — AI classified soft phrase as opt-out
 *       'voice_intent'     — caller said opt-out during a call
 *       'compliance_email' — admin support ticket
 *   - ip_address / user_agent: optional request context for SOC 2.
 *     Dashboard PATCH path passes these; SMS/voice paths pass null.
 */
async function setDoNotContact(leadId, value, options = {}) {
  if (!leadId) throw new Error("setDoNotContact: leadId required");
  const {
    userId = null,
    reason = null,
    cascade = true,
    trigger_source = 'owner_dashboard',
    ip_address = null,
    user_agent = null,
  } = options;
  const flagging = Boolean(value);

  // 1. Update the lead row. Source of truth.
  const leadRes = await db.query(
    `UPDATE leads
        SET do_not_contact         = $1,
            do_not_contact_set_at  = CASE WHEN $1 THEN now() ELSE NULL END,
            do_not_contact_set_by  = CASE WHEN $1 THEN $2::uuid ELSE NULL END,
            do_not_contact_reason  = CASE WHEN $1 THEN $3 ELSE NULL END,
            updated_at             = now()
      WHERE id = $4::uuid
      RETURNING *`,
    [flagging, userId, reason, leadId]
  );

  const lead = leadRes.rows[0];
  if (!lead) {
    throw new Error(`setDoNotContact: lead ${leadId} not found`);
  }

  let cancelled_recoveries = 0;
  let cancelled_nurtures = 0;

  // 2. Cascade only when turning ON. Best-effort: log + continue on errors.
  // The cron-level checks would catch anything we miss here on the next tick.
  if (flagging && cascade) {
    try {
      const recRes = await db.query(
        `UPDATE estimate_recoveries
            SET status = 'cancelled', updated_at = now()
          WHERE tenant_id = $1
            AND lead_id   = $2
            AND status IN ('active', 'paused', 'dormant')
          RETURNING id`,
        [lead.tenant_id, leadId]
      );
      cancelled_recoveries = recRes.rowCount || 0;
    } catch (err) {
      console.error("[Leads] setDoNotContact: recovery cascade failed leadId=%s err=%s",
        leadId, err.message);
    }

    try {
      const nurRes = await db.query(
        `UPDATE nurturing_schedule
            SET status = 'cancelled', updated_at = now()
          WHERE lead_id = $1
            AND status IN ('pending', 'scheduled')
          RETURNING id`,
        [leadId]
      );
      cancelled_nurtures = nurRes.rowCount || 0;
    } catch (err) {
      console.error("[Leads] setDoNotContact: nurture cascade failed leadId=%s err=%s",
        leadId, err.message);
    }
  }

  // 3. Audit log via canonical logAction() helper. This is the ONLY place
  // DNC events get audited now — routes/leads.js used to call logAction
  // itself after this function returned; that call has been removed in
  // the same rollout. If you re-introduce a logAction call for DNC events
  // elsewhere, you'll get double-writes.
  //
  // logAction() is internally wrapped with try/catch + logs SDK errors, so
  // a Supabase outage or column mismatch will not crash the DNC flip.
  // The flag on leads is the durable source of truth; audit_logs is for
  // compliance reporting only.
  await logAction({
    tenant_id: lead.tenant_id,
    user_id: userId,
    action: flagging ? "lead_dnc_enabled" : "lead_dnc_disabled",
    entity_type: "lead",
    entity_id: leadId,
    old_value: {
      do_not_contact: !flagging, // we just flipped, so old state was the opposite
    },
    new_value: {
      do_not_contact: flagging,
      reason,
      cancelled_recoveries,
      cancelled_nurtures,
      trigger_source,
      lead_phone: lead.phone || null,
    },
    ip_address,
    user_agent,
    dnc_trigger_source: trigger_source,
  });

  console.log(
    "[Leads] setDoNotContact leadId=%s flag=%s userId=%s trigger_source=%s cancelled_recoveries=%d cancelled_nurtures=%d reason=%s",
    leadId, flagging, userId || "(none)", trigger_source, cancelled_recoveries, cancelled_nurtures, reason || "(none)"
  );

  return { lead, cancelled_recoveries, cancelled_nurtures };
}

module.exports = {
  getOrCreateLead,
  updateLeadStatus,
  updateLeadInfo,
  getLeadById,
  getLeadsByTenant,
  setDoNotContact,
};
