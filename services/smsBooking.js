"use strict";

/**
 * services/smsBooking.js
 *
 * Phase 12 A1 (Jun 10, 2026) — SMS numbered slot-picker.
 *
 * The SMS-native analogue of the website widget's tappable booking flow.
 * Because SMS has no buttons, the customer books by replying with NUMBERS:
 *
 *   1. Booking intent on SMS (AI sets book_intent=true) → we text a numbered
 *      DAY menu built from bookingEngine.getAvailability() across the next
 *      few open days.
 *   2. Customer replies a day number → we text a numbered TIME menu for that
 *      day (real open slots from the engine).
 *   3. Customer replies a time number → slot is LOCKED, then we collect the
 *      4 contact fields deterministically, one text at a time (we already
 *      have phone from the inbound number, so: name → email → address).
 *   4. All 4 present → bookingEngine.book() with the locked slot. Same engine
 *      voice/website/SMS-cancel all use: slot check, DB row, lead link, CRM
 *      sync, confirmation SMS/email, Google Calendar event.
 *
 * WHY a deterministic state machine (no AI inside): SMS free-text date
 * parsing is exactly where the worst booking bug lived (the "✅ booked →
 * no longer available" loop). A numbered menu structurally removes that
 * failure mode — the customer can't typo a date or trigger a hallucinated
 * one. This mirrors services/sms.js's cancellation state machine deliberately:
 * state lives on the in-memory SMS thread, interception happens BEFORE the AI
 * orchestrator in processSmsConversation, and the handler returns { reply }
 * when it handled the message or null to fall through to the AI.
 *
 * FALLBACKS (Drew's choices, Jun 10):
 *   - Free-text still works alongside numbers. If the customer types "9am" or
 *     "Wednesday" instead of a number, the handler returns null and the AI
 *     orchestrator's existing should_book path handles it. We stash the chosen
 *     date on the thread first so the AI knows which day a free-text time means.
 *   - Escape hatch: "0" on either menu means "none of these / more options" →
 *     exits to the AI (same as free-text), discoverable for people who don't
 *     think to type a date.
 *
 * SCOPE: channel === 'sms' only. Facebook (also runs through the same
 * orchestrator) keeps its current free-text booking — it gets the native
 * quick-reply BUTTON treatment in A4 (Instagram/Facebook together), not a
 * numbered-text hack. WhatsApp (A3) likewise gets native buttons.
 *
 * Escape hatches (DNC / complaint) reuse the exported detectors from
 * services/sms.js verbatim — same Bob Prange lesson: a customer mid-menu who
 * texts "take me off your list" must NOT be bounced against "reply a number".
 */

const bookingEngine = require("../lib/bookingEngine");
const leadsService = require("./leads");
const { isDncPhrase, isComplaintPhrase } = require("./sms");
const conversationState = require("../lib/conversationState");

// How many upcoming days to scan for open slots when building the day menu.
// We collect days that actually HAVE availability, up to MAX_DAYS_SHOWN.
const DAY_SCAN_HORIZON = 14;   // look up to 14 days out
const MAX_DAYS_SHOWN   = 6;    // show at most 6 days in the menu
const MAX_SLOTS_SHOWN  = 6;    // show at most 6 times per day
const DEFAULT_DURATION_MIN = 60;

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function isValidEmail(text) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(text || "").trim());
}

// "2026-06-12" → "Thu Jun 12". Built in the tenant's timezone so the label
// matches what the customer expects locally.
function formatDayLabel(isoDate, timezone) {
  try {
    const d = new Date(`${isoDate}T12:00:00`);
    return d.toLocaleDateString("en-US", {
      weekday: "short", month: "short", day: "numeric", timeZone: timezone || "America/Chicago",
    });
  } catch {
    return isoDate;
  }
}

// Picker-path revenue estimate (Jun 18, 2026).
// The numbered slot-picker bypasses the AI orchestrator, so the AI's
// "REVENUE ESTIMATION" rule never runs and thread.leadCapture.estimated_value
// is almost always empty here — that's the real cause of the $0 picker
// bookings (the Jun-15 lead), NOT a missing estimatedValue arg. When no AI
// estimate exists, derive one from project_type using the SAME mapping the
// SMS prompt uses (Room 500 / Interior 2500 / Exterior 5000) so picker
// bookings carry a non-zero estimate consistent with the free-text path.
// Returns a dollar number or null. Dollars, not cents — bookingEngine.book()
// takes the same dollar value the AI/voice paths pass.
function estimateValueFromProjectType(projectType) {
  const p = String(projectType || "").toLowerCase();
  if (!p) return null;
  if (p.includes("exterior")) return 5000;
  if (p.includes("interior")) return 2500;
  if (p.includes("cabinet")) return 2500;
  if (p.includes("deck") || p.includes("fence")) return 2500;
  if (p.includes("room")) return 500;
  return null;
}

function todayIsoInTz(timezone) {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric", month: "2-digit", day: "2-digit",
    timeZone: timezone || "America/Chicago",
  }).format(new Date());
}

function addDaysIso(isoDate, days) {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

// Pull a plain integer choice out of a reply, but ONLY if the message is
// "just a number" (optionally with trivial punctuation). "3" / "3." / " 3 "
// → 3.  "I want 3pm" → null (that's free-text, let the AI handle it). This
// keeps us from mis-reading a free-text time as a menu index.
function parseMenuNumber(text) {
  const t = String(text || "").trim();
  const m = t.match(/^#?\s*(\d{1,2})\s*[.)]?$/);
  if (!m) return null;
  return parseInt(m[1], 10);
}

// ─────────────────────────────────────────────────────────────────────
// Entry point 1 — start the booking menu (called when book_intent fires)
// ─────────────────────────────────────────────────────────────────────

/**
 * Build and send the numbered DAY menu. Returns { reply } with the menu
 * text, or { reply } with a graceful fallback if no availability could be
 * loaded. Sets thread.bookingMenuState = 'awaiting_day' on success.
 *
 * Never throws — on any failure it returns a reply that keeps the customer
 * moving (asks them to share a preferred day in text, which the AI then
 * handles), rather than dead-ending.
 */
async function initiateSmsBooking(thread, tenant) {
  if (!tenant) return null;
  const tz = tenant.timezone || "America/Chicago";

  let days = [];
  try {
    const start = todayIsoInTz(tz);
    for (let i = 0; i < DAY_SCAN_HORIZON && days.length < MAX_DAYS_SHOWN; i++) {
      const dateIso = addDaysIso(start, i);
      let avail;
      try {
        avail = await bookingEngine.getAvailability({
          tenantId: tenant.id,
          date: dateIso,
          durationMinutes: DEFAULT_DURATION_MIN,
        });
      } catch (e) {
        // One day's lookup failing shouldn't abort the whole menu.
        console.error("[SMS Booking] getAvailability failed date=%s tenant=%s: %s", dateIso, tenant.id, e.message);
        continue;
      }
      if (avail && avail.ok && Array.isArray(avail.slots) && avail.slots.length > 0) {
        days.push({ date: dateIso, label: formatDayLabel(dateIso, tz) });
      }
    }
  } catch (e) {
    console.error("[SMS Booking] initiate scan failed tenant=%s: %s", tenant.id, e.message);
  }

  if (days.length === 0) {
    // No open days found in the horizon — don't start the menu. Fall back to
    // free-text: clear menu state, let the AI collect a preferred day.
    thread.bookingMenuState = null;
    return {
      reply: "I'd love to get you scheduled! What day works best for you? You can tell me a day and I'll find a time.",
    };
  }

  thread.bookingMenuState = "awaiting_day";
  thread.bookingDayList = days;
  thread.bookingChosenDate = null;
  thread.bookingSlotList = null;
  thread.bookingChosenSlot = null;
  thread.bookingContactStep = null;
  thread.bookingContact = { name: "", phone: thread.phone || "", email: "", address: "" };

  const lines = days.map((d, i) => `${i + 1}) ${d.label}`).join("\n");
  persistBookingState(thread, tenant);
  console.log("[SMS Booking] day menu sent tenant=%s phone=%s days=%d", tenant.id, thread.phone, days.length);
  return {
    reply: `Let's get you on the calendar. Which day works? Reply with a number:\n${lines}\n\nOr reply 0 for a different date.`,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Entry point 2 — handle an incoming message while a menu is active
// ─────────────────────────────────────────────────────────────────────

/**
 * Drive the booking state machine. Returns { reply } when handled, or null
 * to fall through to the AI orchestrator (free-text, escape hatches, "0").
 *
 * Mirrors handleSmsCancellationIncoming: no-op when no menu is active, a
 * universal-abort phrase, then DNC/complaint escape hatches, then a switch
 * on the phase.
 */
async function handleSmsBookingIncoming(thread, incomingText, tenant) {
  if (!thread.bookingMenuState) return null;

  const text = (incomingText || "").trim();
  const lc = text.toLowerCase();

  // Universal abort — same set the cancel machine uses.
  if (/^(nevermind|never mind|forget it|stop|cancel)$/i.test(lc)) {
    console.log("[SMS Booking] Universal abort from state=%s", thread.bookingMenuState);
    resetBookingState(thread);
    return { reply: "No problem — let me know whenever you'd like to schedule." };
  }

  // Escape hatches (Bob Prange lesson) — exit to AI on DNC/complaint.
  if (isDncPhrase(text) || isComplaintPhrase(text)) {
    console.log("[SMS Booking] DNC/complaint phrase mid-menu state=%s — exiting to AI", thread.bookingMenuState);
    resetBookingState(thread);
    return null;
  }

  switch (thread.bookingMenuState) {

    case "awaiting_day": {
      const days = thread.bookingDayList || [];
      const num = parseMenuNumber(text);

      // "0" escape OR a non-number reply → fall through to AI (free-text day).
      if (num === 0) {
        console.log("[SMS Booking] awaiting_day → escape '0', exiting to AI");
        resetBookingState(thread);
        return null;
      }
      if (num === null) {
        // Free-text (e.g. "Wednesday", "next Friday"). Let the AI handle it.
        console.log("[SMS Booking] awaiting_day → free-text, exiting to AI: %s", text.slice(0, 60));
        resetBookingState(thread);
        return null;
      }
      if (num < 1 || num > days.length) {
        const reList = days.map((d, i) => `${i + 1}) ${d.label}`).join("\n");
        return { reply: `Hmm, please reply with a number from the list:\n${reList}\n\nOr reply 0 for a different date.` };
      }

      // Valid day picked — fetch that day's open times.
      const chosen = days[num - 1];
      thread.bookingChosenDate = chosen.date;
      return await sendTimeMenu(thread, tenant, chosen);
    }

    case "awaiting_time": {
      const slots = thread.bookingSlotList || [];
      const num = parseMenuNumber(text);

      if (num === 0) {
        console.log("[SMS Booking] awaiting_time → escape '0', exiting to AI");
        // Keep the chosen date stashed so the AI knows which day a follow-up
        // free-text time refers to, then reset menu state.
        const keptDate = thread.bookingChosenDate;
        resetBookingState(thread);
        thread.bookingFreeTextDate = keptDate || null;
        return null;
      }
      if (num === null) {
        // Free-text time (e.g. "9am"). Stash the chosen date so the AI's
        // should_book path can pair it with the day, then exit to AI.
        console.log("[SMS Booking] awaiting_time → free-text, exiting to AI: %s", text.slice(0, 60));
        const keptDate = thread.bookingChosenDate;
        resetBookingState(thread);
        thread.bookingFreeTextDate = keptDate || null;
        return null;
      }
      if (num < 1 || num > slots.length) {
        const reList = slots.map((s, i) => `${i + 1}) ${s.time}`).join("\n");
        return { reply: `Please reply with a number from the list:\n${reList}\n\nOr reply 0 for other times.` };
      }

      // Valid time picked — lock the slot, move to contact collection.
      const slot = slots[num - 1];
      thread.bookingChosenSlot = { date: thread.bookingChosenDate, value: slot.value, time: slot.time };
      thread.bookingMenuState = "awaiting_contact";
      thread.bookingContactStep = firstMissingContactStep(thread.bookingContact);
      persistBookingState(thread, tenant);
      console.log("[SMS Booking] slot locked tenant=%s date=%s value=%s", tenant.id, thread.bookingChosenDate, slot.value);
      return { reply: contactPrompt(thread.bookingContactStep, slot) };
    }

    case "awaiting_contact": {
      return await handleContactStep(thread, text, tenant);
    }

    default:
      console.warn("[SMS Booking] Unknown bookingMenuState=%s — resetting", thread.bookingMenuState);
      resetBookingState(thread);
      return null;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Internal — time menu
// ─────────────────────────────────────────────────────────────────────

async function sendTimeMenu(thread, tenant, chosenDay) {
  let slots = [];
  try {
    const avail = await bookingEngine.getAvailability({
      tenantId: tenant.id,
      date: chosenDay.date,
      durationMinutes: DEFAULT_DURATION_MIN,
    });
    if (avail && avail.ok && Array.isArray(avail.slots)) {
      slots = avail.slots.slice(0, MAX_SLOTS_SHOWN);
    }
  } catch (e) {
    console.error("[SMS Booking] sendTimeMenu getAvailability failed date=%s: %s", chosenDay.date, e.message);
  }

  if (slots.length === 0) {
    // The day had slots when we built the day menu but none now (raced/booked),
    // or lookup failed. Re-show the day menu so they can pick again.
    const days = thread.bookingDayList || [];
    thread.bookingMenuState = "awaiting_day";
    thread.bookingChosenDate = null;
    if (days.length === 0) {
      resetBookingState(thread);
      return { reply: "That day just filled up. What other day works for you?" };
    }
    const reList = days.map((d, i) => `${i + 1}) ${d.label}`).join("\n");
    return { reply: `Looks like ${chosenDay.label} just filled up. Pick another day:\n${reList}\n\nOr reply 0 for a different date.` };
  }

  thread.bookingSlotList = slots;
  thread.bookingMenuState = "awaiting_time";
  persistBookingState(thread, tenant);
  const lines = slots.map((s, i) => `${i + 1}) ${s.time}`).join("\n");
  console.log("[SMS Booking] time menu sent tenant=%s date=%s slots=%d", tenant.id, chosenDay.date, slots.length);
  return { reply: `Open times on ${chosenDay.label}. Reply with a number:\n${lines}\n\nOr reply 0 for other times.` };
}

// ─────────────────────────────────────────────────────────────────────
// Internal — deterministic contact collection (name → email → address)
// Phone already known from the inbound SMS number (thread.phone).
// ─────────────────────────────────────────────────────────────────────

const CONTACT_ORDER = ["name", "email", "address"];

function firstMissingContactStep(contact) {
  for (const field of CONTACT_ORDER) {
    if (!contact[field] || !String(contact[field]).trim()) return field;
  }
  return null;
}

function contactPrompt(step, slot) {
  const when = slot ? `${slot.time}` : "that time";
  switch (step) {
    case "name":
      return `Great — ${when} it is! To lock it in, what's your full name?`;
    case "email":
      return "Thanks! What's the best email for your confirmation?";
    case "address":
      return "Got it. And the service address for the appointment? (street, city, ZIP)";
    default:
      return "Thanks! Getting you booked now…";
  }
}

async function handleContactStep(thread, text, tenant) {
  const step = thread.bookingContactStep;
  const contact = thread.bookingContact || (thread.bookingContact = { name: "", phone: thread.phone || "", email: "", address: "" });

  if (step === "name") {
    if (text.replace(/\s/g, "").length < 2) {
      return { reply: "Sorry, I didn't catch your name — what's your full name?" };
    }
    contact.name = text.slice(0, 120);
  } else if (step === "email") {
    if (!isValidEmail(text)) {
      return { reply: "Hmm, that doesn't look like a valid email. Could you share it again? (e.g. you@example.com)" };
    }
    contact.email = text.trim();
  } else if (step === "address") {
    if (text.trim().length < 5) {
      return { reply: "I need the service address to send a crew out — street, city, and ZIP please." };
    }
    contact.address = text.slice(0, 240);
  }

  // Advance to the next missing field, if any.
  const next = firstMissingContactStep(contact);
  if (next) {
    thread.bookingContactStep = next;
    persistBookingState(thread, tenant);
    return { reply: contactPrompt(next, thread.bookingChosenSlot) };
  }

  // All four present (phone + name + email + address) — book the locked slot.
  return await finalizeSmsBooking(thread, tenant);
}

// ─────────────────────────────────────────────────────────────────────
// Internal — fire the engine with the locked slot
// ─────────────────────────────────────────────────────────────────────

async function finalizeSmsBooking(thread, tenant) {
  const slot = thread.bookingChosenSlot;
  const contact = thread.bookingContact;

  if (!slot || !slot.date || !slot.value) {
    console.error("[SMS Booking] finalize with no locked slot — resetting");
    resetBookingState(thread);
    return { reply: "Sorry, something went wrong holding that time. What day works for you and I'll pull fresh openings?" };
  }

  let result;
  try {
    result = await bookingEngine.book({
      tenantId: tenant.id,
      date: slot.date,
      time: slot.value,
      durationMinutes: DEFAULT_DURATION_MIN,
      contact: {
        name: contact.name || "New Lead",
        phone: contact.phone || thread.phone,
        email: contact.email || "",
        address: contact.address || "",
      },
      projectType: thread.leadCapture?.project_type || "",
      projectDetails: thread.leadCapture?.project_details || "",
      leadId: thread.leadId || null,
      source: thread.channel || "sms",
      // Est-Rev fix (Jun 11, 2026) — feed PR7's revenue plumbing on the
      // picker path too. Same field the AI should_book path passes; without
      // it the booking row lands with no estimated revenue (the Jun-15 $0
      // lead). The A2 resume path also finalizes through this function, so
      // one fix covers both entry points.
     estimatedValue:
        thread.leadCapture?.estimated_value ??
        estimateValueFromProjectType(thread.leadCapture?.project_type),
    });
  } catch (e) {
    console.error("[SMS Booking] engine.book threw tenant=%s: %s", tenant.id, e.message);
    resetBookingState(thread);
    return { reply: "Sorry, I hit a snag booking that. Could you try again, or I can have someone call you?" };
  }

  if (!result || !result.ok) {
    const reason = result?.reason;
    if (reason === "slot_taken") {
      // Slot got grabbed during contact collection — re-offer that day's times.
      const chosenDay = { date: slot.date, label: formatDayLabel(slot.date, tenant.timezone) };
      thread.bookingChosenSlot = null;
      // Keep contact we collected; just re-pick a time.
      const menu = await sendTimeMenu(thread, tenant, chosenDay);
      return { reply: `Ah — someone just grabbed ${slot.time}. ${menu.reply}` };
    }
    if (reason === "day_closed") {
      thread.bookingChosenSlot = null;
      thread.bookingMenuState = "awaiting_day";
      return { reply: "We're actually closed that day. What other day works?" };
    }
    if (reason === "outside_business_hours") {
      thread.bookingChosenSlot = null;
      thread.bookingMenuState = "awaiting_day";
      return { reply: `That time's outside our hours (${result.open}–${result.close}). What day works and I'll show times in range?` };
    }
    console.warn("[SMS Booking] engine.book failed reason=%s msg=%s", reason, result?.message || "");
    resetBookingState(thread);
    return { reply: "I couldn't complete that booking. Could you try again, or I can have someone reach out to you?" };
  }

  // Success. Mirror the bookkeeping handleLeadBooking does on the thread so
  // the re-book guard in processSmsConversation stops any further attempts.
  thread.bookedEventId = result.eventId || "LOCAL_ONLY";
  thread.needsFollowUpAt = null;
  thread.followUpCount = 0;

  // Stamp the captured contact onto the lead (best-effort) so the dashboard
  // shows name/email/address even though we collected them outside the AI.
  if (thread.leadId) {
    leadsService.updateLeadInfo(thread.leadId, {
      name: contact.name,
      email: contact.email,
      address: contact.address,
    }).catch((e) => console.error("[SMS Booking] lead stamp failed:", e.message));
  }

  const friendlyDay = formatDayLabel(slot.date, tenant.timezone);
  console.log("[SMS Booking] BOOKED tenant=%s bookingId=%s date=%s time=%s", tenant.id, result.bookingId, slot.date, slot.value);

  resetBookingState(thread);
  return {
    reply: `✅ You're all set for ${friendlyDay} at ${slot.time}! You'll get a confirmation text and email shortly. See you then.`,
    booked: true,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Persistence (Phase 12 A2) — snapshot the booking-machine fields to the
// conversation_states table so the flow survives a server restart/redeploy.
// Fire-and-forget; never blocks the customer reply. Called at the end of
// each transition that leaves a menu ACTIVE. Terminal transitions clear
// instead (see resetBookingState).
// ─────────────────────────────────────────────────────────────────────
function persistBookingState(thread, tenant) {
  if (!thread.leadId || !tenant || !thread.bookingMenuState) return;
  conversationState.save(thread.leadId, tenant.id, {
    bookingMenuState:   thread.bookingMenuState,
    bookingDayList:     thread.bookingDayList || null,
    bookingChosenDate:  thread.bookingChosenDate || null,
    bookingSlotList:    thread.bookingSlotList || null,
    bookingChosenSlot:  thread.bookingChosenSlot || null,
    bookingContactStep: thread.bookingContactStep || null,
    bookingContact:     thread.bookingContact || null,
  }).catch(() => {});
}

// ─────────────────────────────────────────────────────────────────────
// Reset — clear all booking-menu state off the thread (+ persisted row)
// ─────────────────────────────────────────────────────────────────────

function resetBookingState(thread) {
  if (thread.leadId) conversationState.clear(thread.leadId).catch(() => {});
  thread.bookingMenuState = null;
  thread.bookingDayList = null;
  thread.bookingChosenDate = null;
  thread.bookingSlotList = null;
  thread.bookingChosenSlot = null;
  thread.bookingContactStep = null;
  thread.bookingContact = null;
}

// ─────────────────────────────────────────────────────────────────────
// Resume (Phase 12 A2) — produce the "picking back up" message after a
// rehydrated state is copied onto the thread (by server.js on inbound).
//
// A human receptionist resuming a conversation reminds you where you were
// and re-shows what you need — they don't make you confirm a stale time.
// So:
//   awaiting_day     → re-show the day menu with a warm re-orient.
//   awaiting_time    → re-fetch + re-show that day's open times (they may
//                      have changed since the gap), re-orient to the day.
//   awaiting_contact → the slot was being held; RE-VALIDATE it. If still
//                      open, resume contact collection at the right field.
//                      If taken during the gap, tell them warmly and re-show
//                      that day's times instead of confirming a dead slot.
//
// `ageMs` lets the caller decide whether a re-orient is even warranted; this
// function assumes the caller already decided to resume (gap big enough to
// be worth a "picking back up" line). Returns { reply } or null if there's
// nothing meaningful to resume into (caller then proceeds normally).
// ─────────────────────────────────────────────────────────────────────
async function resumeBookingMessage(thread, tenant) {
  if (!thread.bookingMenuState || !tenant) return null;
  const tz = tenant.timezone || "America/Chicago";

  if (thread.bookingMenuState === "awaiting_day") {
    const days = thread.bookingDayList || [];
    if (days.length === 0) {
      resetBookingState(thread);
      return { reply: "Welcome back! What day works best for your appointment?" };
    }
    const lines = days.map((d, i) => `${i + 1}) ${d.label}`).join("\n");
    return { reply: `Welcome back — let's finish getting you scheduled. Which day works? Reply with a number:\n${lines}\n\nOr reply 0 for a different date.` };
  }

  if (thread.bookingMenuState === "awaiting_time") {
    const date = thread.bookingChosenDate;
    const label = date ? formatDayLabel(date, tz) : "that day";
    // Re-fetch fresh slots — availability may have changed during the gap.
    let slots = [];
    try {
      const avail = await bookingEngine.getAvailability({
        tenantId: tenant.id, date, durationMinutes: DEFAULT_DURATION_MIN,
      });
      if (avail && avail.ok && Array.isArray(avail.slots)) slots = avail.slots.slice(0, MAX_SLOTS_SHOWN);
    } catch (e) {
      console.error("[SMS Booking] resume awaiting_time getAvailability failed: %s", e.message);
    }
    if (slots.length === 0) {
      thread.bookingMenuState = "awaiting_day";
      thread.bookingChosenDate = null;
      const days = thread.bookingDayList || [];
      if (days.length === 0) {
        resetBookingState(thread);
        return { reply: `Welcome back! ${label} is full now — what other day works for you?` };
      }
      const reList = days.map((d, i) => `${i + 1}) ${d.label}`).join("\n");
      persistBookingState(thread, tenant);
      return { reply: `Welcome back! Looks like ${label} filled up. Pick another day:\n${reList}\n\nOr reply 0 for a different date.` };
    }
    thread.bookingSlotList = slots;
    persistBookingState(thread, tenant);
    const lines = slots.map((s, i) => `${i + 1}) ${s.time}`).join("\n");
    return { reply: `Welcome back — picking up where we left off on ${label}. Here are the open times, reply with a number:\n${lines}\n\nOr reply 0 for other times.` };
  }

  if (thread.bookingMenuState === "awaiting_contact") {
    const slot = thread.bookingChosenSlot;
    if (!slot || !slot.date || !slot.value) {
      // Corrupt/incomplete — restart cleanly.
      const keptDate = thread.bookingChosenDate;
      resetBookingState(thread);
      return { reply: "Welcome back! Let's pick a time — what day works for you?" };
    }
    // Re-validate the held slot — never make them confirm a time that's gone.
    let stillOpen = false;
    try {
      const slotCheck = await bookingEngine.getAvailability({
        tenantId: tenant.id, date: slot.date, durationMinutes: DEFAULT_DURATION_MIN,
      });
      if (slotCheck && slotCheck.ok && Array.isArray(slotCheck.slots)) {
        stillOpen = slotCheck.slots.some((s) => s.value === slot.value);
        // Refresh the slot list for a possible re-show.
        thread.bookingSlotList = slotCheck.slots.slice(0, MAX_SLOTS_SHOWN);
      }
    } catch (e) {
      console.error("[SMS Booking] resume awaiting_contact re-validate failed: %s", e.message);
      stillOpen = true; // fail open — let them continue; book() re-checks anyway.
    }
    const label = formatDayLabel(slot.date, tz);
    if (!stillOpen) {
      // Slot taken during the gap — drop back to the time menu for that day.
      thread.bookingChosenSlot = null;
      thread.bookingMenuState = "awaiting_time";
      const slots = thread.bookingSlotList || [];
      if (slots.length === 0) {
        thread.bookingMenuState = "awaiting_day";
        const days = thread.bookingDayList || [];
        const reList = days.map((d, i) => `${i + 1}) ${d.label}`).join("\n");
        persistBookingState(thread, tenant);
        return { reply: `Welcome back! The ${slot.time} slot on ${label} got booked while we were apart. What day works for you?${reList ? "\n" + reList : ""}` };
      }
      const lines = slots.map((s, i) => `${i + 1}) ${s.time}`).join("\n");
      persistBookingState(thread, tenant);
      return { reply: `Welcome back! Looks like ${slot.time} on ${label} got grabbed while we were apart. Here are the open times now, reply with a number:\n${lines}\n\nOr reply 0 for other times.` };
    }
    // Slot still open — resume collecting whatever contact field is next.
    const step = firstMissingContactStep(thread.bookingContact || {});
    if (!step) {
      // Everything's collected — just finalize.
      return await finalizeSmsBooking(thread, tenant);
    }
    thread.bookingContactStep = step;
    persistBookingState(thread, tenant);
    const stepPrompt = contactPrompt(step, slot);
    return { reply: `Welcome back! I've still got your ${label} at ${slot.time} held. ${stepPrompt}` };
  }

  return null;
}

module.exports = {
  initiateSmsBooking,
  handleSmsBookingIncoming,
  resumeBookingMessage,
  resetBookingState,
  // exported for unit testing
  parseMenuNumber,
  formatDayLabel,
};
