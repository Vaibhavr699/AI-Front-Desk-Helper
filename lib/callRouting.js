"use strict";

/**
 * lib/callRouting.js — Build 1 inbound routing decision engine.
 *
 * Pure, side-effect-free function that inspects the tenant + called phone +
 * caller ID and returns a routing plan for the TwiML builder to render.
 *
 * Decides:
 *   1. Should the AI answer, or go straight to voicemail?
 *   2. Should we ring a human first, or stream to AI immediately?
 *   3. GOTCHA#23: if the caller IS the ring-first target, skip <Dial>
 *      (Twilio rejects self-bridge, and there's no graceful fallback
 *      if we let it try and fail mid-call).
 *
 * Tenant-level business hours live in tenants.business_hours (jsonb) +
 * tenants.timezone. A phone opts in via phone_numbers.business_hours_enabled.
 *
 * ASSUMPTION: isWithinBusinessHours(tenant) is synchronous and returns a
 * boolean. If your impl is async, wrap the call here with await and make
 * decideCallRouting async — 2-line change.
 */

const { isWithinBusinessHours } = require("./timeUtils");

/**
 * Normalize any phone-looking string to a canonical E.164 form for
 * comparison. Tolerant of dashes, spaces, parens, leading 1. Returns "" for
 * anything unusable — all downstream comparisons with "" are false.
 *
 * Twilio's `From` is always E.164, so in practice this mostly handles the
 * ring_first_phone value that came through user input.
 */
function normalizePhoneForCompare(raw) {
  if (!raw || typeof raw !== "string") return "";
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length >= 7) return `+${digits}`;
  return "";
}

/**
 * Decide how to route an inbound call. Pure function. No I/O.
 *
 * @param {object}  opts
 * @param {object}  opts.tenant        - tenant row (business_hours, timezone)
 * @param {object?} opts.phoneNumber   - phone_numbers row for the `To` number;
 *                                       null-safe (treated as AI-on, no ring-first
 *                                       so un-migrated tenants don't regress)
 * @param {string?} opts.fromNumber    - Twilio caller ID (E.164 or null)
 *
 * @returns {{
 *   shouldRunAi:             boolean,
 *   ringFirst:               boolean,
 *   ringFirstPhone:          string|null,
 *   ringFirstTimeoutSeconds: number,
 *   voicemailMessageUrl:     string|null,
 *   reason:                  string
 * }}
 */
function decideCallRouting({ tenant, phoneNumber, fromNumber }) {
  const pn = phoneNumber || {};

  // Defaults chosen so a tenant created BEFORE migration 039 ran (and thus
  // has no values on these columns) behaves exactly like pre-Build-1: AI
  // answers 24/7, no ring-first, no per-phone BH. Safe to deploy before
  // every tenant is migrated.
  const aiStatus             = pn.ai_status || "on";
  const bhEnabled            = pn.business_hours_enabled === true;
  const ringFirstEnabled     = pn.ring_first_enabled === true;
  const ringFirstPhone       = pn.ring_first_phone || null;
  const voicemailMessageUrl  = pn.voicemail_message_url || null;
  const ringFirstTimeout     = Number.isFinite(pn.ring_first_timeout_seconds)
    ? Math.min(60, Math.max(5, pn.ring_first_timeout_seconds))
    : 20;

  // Business hours gate — only evaluated when the PHONE opts in. A tenant
  // may have a BH schedule but still want 24/7 AI on certain numbers
  // (e.g. an emergency line). Default bhEnabled=false means no gating.
  let inBusinessHours = true;
  if (bhEnabled) {
    try {
      inBusinessHours = !!isWithinBusinessHours(tenant);
    } catch (err) {
      // Fail OPEN: mis-configured tenants (missing timezone, corrupt BH
      // jsonb) should keep answering rather than silently drop calls.
      // Log loud so this doesn't hide in production.
      console.error(
        "[callRouting] isWithinBusinessHours threw — failing open to AI-on:",
        err.message
      );
      inBusinessHours = true;
    }
  }

  // Core decision from spec:
  //   shouldRunAi = (ai_status === 'on') AND (!bh_enabled OR inBusinessHours)
  // Ring-first is ORTHOGONAL — ring-first still runs even when AI is off
  // (rings human; if no-answer, falls through to voicemail instead of AI).
  const shouldRunAi = aiStatus === "on" && (!bhEnabled || inBusinessHours);

  // ── GOTCHA#23 ───────────────────────────────────────────────────────
  // If the caller IS the ring-first target (e.g. the tenant's own cell
  // number calling their AI line to test it), Twilio rejects the self-
  // bridge and there's no graceful fallback mid-call. Skip <Dial>
  // entirely and route straight to AI (or voicemail).
  const fromNormalized      = normalizePhoneForCompare(fromNumber);
  const ringFirstNormalized = normalizePhoneForCompare(ringFirstPhone);
  const callerIsRingFirstTarget =
    fromNormalized !== "" &&
    ringFirstNormalized !== "" &&
    fromNormalized === ringFirstNormalized;

  const ringFirst =
    ringFirstEnabled &&
    !!ringFirstPhone &&
    !callerIsRingFirstTarget;

  // Human-readable reason string for logging + future support tickets.
  let reason;
  if (callerIsRingFirstTarget)                        reason = "caller_is_ring_first_target";
  else if (!shouldRunAi && bhEnabled && !inBusinessHours) reason = "outside_business_hours";
  else if (!shouldRunAi && aiStatus === "off")        reason = "ai_disabled";
  else if (ringFirst && shouldRunAi)                  reason = "ring_first_then_ai";
  else if (ringFirst && !shouldRunAi)                 reason = "ring_first_then_voicemail";
  else if (!ringFirst && shouldRunAi)                 reason = "ai_direct";
  else                                                reason = "voicemail_direct";

  return {
    shouldRunAi,
    ringFirst,
    ringFirstPhone,
    ringFirstTimeoutSeconds: ringFirstTimeout,
    voicemailMessageUrl,
    reason,
  };
}

module.exports = {
  decideCallRouting,
  normalizePhoneForCompare, // exported for tests
};
