"use strict";

/**
 * lib/callRouting.js — Tenant-wide AI Control routing (Apr 23, 2026)
 *
 * Pivoted from per-phone routing (mig 039) to tenant-wide routing. Every
 * phone line on a tenant now follows the same AI Control settings, stored
 * on the tenants table (mig 040).
 *
 * The decideCallRouting signature still accepts `phoneNumber` so server.js
 * doesn't need to change, but that parameter is IGNORED. Mig 039 columns
 * on phone_numbers stay in the DB but are permanently dormant.
 *
 * Decision flow:
 *   1. ai_master_enabled=false → skip AI entirely. Still try to reach a
 *      human first if possible, falling through to voicemail:
 *        - ring_first_phone configured → dial it, voicemail on no-answer
 *        - else transfer_numbers[0] configured → dial it, voicemail on no-answer
 *        - else voicemail only
 *   2. ring_first_enabled=true AND caller != ring_first_phone → dial human
 *      first, then fall through to AI OR voicemail based on
 *      ai_answers_after_hours and current business hours
 *   3. ai_answers_after_hours=true AND currently within BH → voicemail
 *      (AI only answers after hours)
 *   4. ai_answers_after_hours=false OR currently outside BH → AI answers
 *
 * GOTCHA#23 (carried over from Build 1): if the caller's number matches
 * the ring-first destination, we MUST skip ring-first to avoid Twilio
 * self-bridge rejection (which drops the call with no graceful fallback).
 * That's why ring-first is short-circuited when `fromNumber === ring_first_phone`.
 *
 * Returns a plain object consumed by server.js handleTwilioVoice:
 *   {
 *     shouldRunAi: boolean,
 *     ringFirst: boolean,
 *     ringFirstPhone: string | null,
 *     ringFirstTimeoutSeconds: number,
 *     voicemailMessageUrl: string | null,
 *     reason: string              // human-readable debug tag
 *   }
 */

const { isWithinBusinessHours } = require("./timeUtils");

/**
 * Normalize a phone string for self-bridge comparison. Strips to digits,
 * then drops a leading US country code "1" when the result is 11 digits,
 * so that "(402) 555-9999", "402-555-9999", "+14025559999", and
 * "14025559999" all compare equal. Returns empty string on null/empty
 * input so the comparison cleanly fails.
 *
 * This matters because Twilio's `From` field on inbound calls is always
 * E.164 (+1XXXXXXXXXX) but the ring_first_phone column CAN receive
 * dashed input that normalizePhoneInput() missed somewhere upstream,
 * or the column could hold a raw 10-digit number from a legacy import.
 * Normalizing to the 10-digit core gives us a robust match regardless.
 */
function digitsOnly(phone) {
  if (!phone) return "";
  const raw = String(phone).replace(/\D/g, "");
  // Strip leading "1" if present and we're left with a 10-digit US number
  if (raw.length === 11 && raw.startsWith("1")) return raw.slice(1);
  return raw;
}

/**
 * decideCallRouting — pure function, no side effects.
 *
 * @param {object} args
 * @param {object} args.tenant       Full tenant row. MUST include the 6
 *                                   mig 040 cols. Missing cols fall back
 *                                   to AI-on / no ring-first for safety.
 * @param {object} [args.phoneNumber] Ignored (tenant-wide routing). Kept
 *                                    for signature compatibility with
 *                                    server.js handleTwilioVoice.
 * @param {string} [args.fromNumber]  Caller's number, any format. Used
 *                                    only for the GOTCHA#23 self-bridge
 *                                    check.
 * @returns {object} routing decision (see module docstring)
 */
function decideCallRouting({ tenant, phoneNumber: _ignored, fromNumber } = {}) {
  // Null-safe tenant access. If for some reason tenant is missing (should
  // never happen in the hot path, but defensive coding matters here), we
  // return the AI-on default so a misconfigured tenant doesn't silently
  // send every call to voicemail.
  const t = tenant || {};

  // ── 1. Master kill switch ────────────────────────────────────────────
  // `ai_master_enabled` defaults to true in the DB, so this check only
  // fires when the owner explicitly flips the toggle off in Settings →
  // AI Control. When off, the AI never answers — but we still try to get
  // a human on the phone before giving up to voicemail. Cascade:
  //   ring_first_phone > transfer_numbers[0] > voicemail
  // Why the cascade: "AI off" should behave like a normal business phone
  // system, not a broken one. If the owner already configured ring-first
  // or a transfer number, honor it so callers still reach someone.
  if (t.ai_master_enabled === false) {
    // Pick the best human destination we can.
    const ringDest = t.ring_first_phone || null;
    const transferNumbers = Array.isArray(t.transfer_numbers) ? t.transfer_numbers : [];
    const transferDest = transferNumbers.find((n) => typeof n === "string" && n.trim()) || null;
    const humanDest = ringDest || transferDest || null;

    // GOTCHA#23: never dial the caller's own number. If the only human
    // destination IS the caller, skip ring-first and go straight to voicemail.
    const selfBridge =
      !!humanDest && !!fromNumber && digitsOnly(fromNumber) === digitsOnly(humanDest);

    if (humanDest && !selfBridge) {
      return {
        shouldRunAi: false,
        ringFirst: true,
        ringFirstPhone: humanDest,
        ringFirstTimeoutSeconds: Math.min(60, Math.max(5, Number(t.ring_first_timeout_seconds) || 20)),
        voicemailMessageUrl: t.voicemail_message_url || null,
        reason: ringDest ? "ai_off_ring_first_then_voicemail" : "ai_off_transfer_then_voicemail",
      };
    }

    // No human destination configured (or self-bridge case) → voicemail only
    return {
      shouldRunAi: false,
      ringFirst: false,
      ringFirstPhone: null,
      ringFirstTimeoutSeconds: 20,
      voicemailMessageUrl: t.voicemail_message_url || null,
      reason: selfBridge ? "ai_off_self_bridge_voicemail" : "ai_off_voicemail_only",
    };
  }

  // ── 2. Determine if AI would answer this call ────────────────────────
  // When ai_answers_after_hours=false (default), AI answers 24/7.
  // When ai_answers_after_hours=true, AI only answers OUTSIDE business
  // hours — during business hours the call goes to voicemail (assuming
  // no ring-first) so a human can catch it.
  const afterHoursOnly = t.ai_answers_after_hours === true;
  const inBusinessHours = afterHoursOnly ? isWithinBusinessHours(t) : false;
  const aiWouldAnswer = !afterHoursOnly || !inBusinessHours;

  // ── 3. Ring-first logic ──────────────────────────────────────────────
  // If enabled and we have a destination phone, we dial that number first
  // and fall through to either AI or voicemail if no one picks up. The
  // fall-through target is whatever aiWouldAnswer decided above.
  const ringFirstEnabled = t.ring_first_enabled === true;
  const ringFirstPhone = t.ring_first_phone || null;

  // GOTCHA#23 — self-bridge prevention. If the caller IS the ring-first
  // destination (e.g. Drew calls his own business from his cell), Twilio
  // rejects the <Dial> because it won't bridge a number to itself. That
  // kills the call with no graceful fallback. Detect it here and skip
  // ring-first entirely so the caller hears AI or voicemail instead.
  const callerIsRingFirstTarget =
    ringFirstEnabled &&
    !!fromNumber &&
    !!ringFirstPhone &&
    digitsOnly(fromNumber) === digitsOnly(ringFirstPhone);

  const shouldRingFirst =
    ringFirstEnabled && !!ringFirstPhone && !callerIsRingFirstTarget;

  // ── 4. Build response ────────────────────────────────────────────────
  // If ring-first is active, we return shouldRunAi based on whether AI
  // would pick up on no-answer. server.js uses this to decide between
  // <Connect><Stream/> (AI fallback) and <Record> (voicemail fallback)
  // AFTER the <Dial>. If ring-first is NOT active, shouldRunAi directly
  // controls whether the call starts as AI or voicemail.
  const timeout = Number(t.ring_first_timeout_seconds) || 20;
  const clampedTimeout = Math.min(60, Math.max(5, timeout));

  // Reason tags are purely for the server.js log line. Makes debugging
  // "why did this call route this way?" trivial when reviewing logs.
  let reason;
  if (shouldRingFirst && aiWouldAnswer) reason = "ring_first_then_ai";
  else if (shouldRingFirst && !aiWouldAnswer) reason = "ring_first_then_voicemail";
  else if (!shouldRingFirst && aiWouldAnswer) reason = "ai_direct";
  else if (!shouldRingFirst && !aiWouldAnswer) reason = "voicemail_direct";
  else reason = "unknown";

  // Extra reason signals for the rare but important GOTCHA#23 and
  // after-hours-picker-inactive cases, so we can spot them in logs.
  if (callerIsRingFirstTarget) {
    reason = afterHoursOnly && inBusinessHours
      ? "ring_first_skipped_self_bridge_voicemail"
      : "ring_first_skipped_self_bridge_ai";
  }

  return {
    shouldRunAi: aiWouldAnswer,
    ringFirst: shouldRingFirst,
    ringFirstPhone: shouldRingFirst ? ringFirstPhone : null,
    ringFirstTimeoutSeconds: clampedTimeout,
    voicemailMessageUrl: t.voicemail_message_url || null,
    reason,
  };
}

module.exports = { decideCallRouting };
