"use strict";

/**
 * lib/conversationState.js
 *
 * Phase 12 A2 (Jun 10, 2026) — durable backing for the in-memory SMS
 * conversation state machine (booking numbered-menu flow + cancellation flow).
 *
 * THE PROBLEM: server.js holds SMS conversation state in the in-memory
 * smsThreads Map. That survives across messages while the server is up, but is
 * wiped on every Render restart/redeploy. A customer mid-booking (or mid-cancel)
 * when we deploy hits a fresh empty thread on their next text and has to start
 * over — which feels broken and erodes trust in the AI.
 *
 * THE FIX: mirror the structured thread state into the conversation_states
 * table (migration 091), keyed on lead_id. On an inbound message, if the
 * in-memory thread has no active state but a persisted row exists AND is within
 * the TTL, rehydrate it and resume the flow.
 *
 * THREE FUNCTIONS:
 *   save(leadId, tenantId, state)  — UPSERT the state blob. Fire-and-forget at
 *                                    callsites; never blocks the customer reply.
 *   load(leadId)                   — return the state if within TTL, else null
 *                                    (and delete the stale row). Identity is the
 *                                    lead, so this is channel-agnostic.
 *   clear(leadId)                  — delete the row (state consumed: booked,
 *                                    cancelled, or aborted).
 *
 * TTL = 1 hour. Long enough that a customer who steps away (job site, lunch,
 * a deploy) can resume; short enough that we don't resurrect genuinely-dead
 * conversations. A held slot older than this is likely gone anyway — and
 * bookingEngine.book re-validates the slot at finalize time regardless, so a
 * stale-but-within-TTL slot can never double-book; the customer just re-picks
 * on slot_taken.
 *
 * NONE of these throw. Persistence is an enhancement, never a blocker — a DB
 * hiccup degrades gracefully to the old in-memory-only behavior (state lost on
 * restart), which is exactly where we are today without this.
 *
 * The `state` blob is whatever the caller hands us — currently the subset of
 * thread fields that make up the booking/cancel machines:
 *   bookingMenuState, bookingDayList, bookingChosenDate, bookingSlotList,
 *   bookingChosenSlot, bookingContactStep, bookingContact,
 *   cancelState, pendingCancelBookingId, pendingCancelBookingsList
 * Storing it as an opaque jsonb keeps this helper decoupled from the exact
 * shape of either state machine.
 */

const db = require("../lib/db");

// 1 hour, in milliseconds. Rows older than this on read are expired.
const TTL_MS = 60 * 60 * 1000;

/**
 * Persist (UPSERT) the conversation state for a lead. Fire-and-forget at
 * callsites — we never await this on the customer-reply path. Returns the
 * promise so a caller CAN await/catch if it wants, but failures are swallowed
 * and logged so they can't surface as a thrown error.
 *
 * @param {string} leadId
 * @param {string} tenantId
 * @param {object} state - opaque blob of thread fields to persist
 * @returns {Promise<boolean>} true on success, false on any failure
 */
async function save(leadId, tenantId, state) {
  if (!leadId || !tenantId || !state || typeof state !== "object") return false;
  try {
    await db.query(
      `INSERT INTO conversation_states (lead_id, tenant_id, state, updated_at)
         VALUES ($1, $2, $3::jsonb, now())
       ON CONFLICT (lead_id)
         DO UPDATE SET state = EXCLUDED.state,
                       tenant_id = EXCLUDED.tenant_id,
                       updated_at = now()`,
      [leadId, tenantId, JSON.stringify(state)]
    );
    return true;
  } catch (err) {
    console.error("[ConvState] save failed leadId=%s: %s", leadId, err.message);
    return false;
  }
}

/**
 * Load the conversation state for a lead, but ONLY if it's within the TTL.
 * If the row exists but is older than TTL_MS, it's treated as expired: we
 * delete it and return null (so the customer starts a fresh flow). If no row
 * exists, returns null. Never throws.
 *
 * @param {string} leadId
 * @returns {Promise<{ state: object, ageMs: number } | null>}
 *   state = the persisted blob; ageMs = how old it is (lets the caller decide
 *   whether to show a re-orienting "picking back up" line for older states).
 */
async function load(leadId) {
  if (!leadId) return null;
  try {
    const res = await db.query(
      `SELECT state, updated_at FROM conversation_states WHERE lead_id = $1 LIMIT 1`,
      [leadId]
    );
    const row = res.rows[0];
    if (!row) return null;

    const ageMs = Date.now() - new Date(row.updated_at).getTime();
    if (ageMs > TTL_MS) {
      // Expired — delete and treat as no state. Fire-and-forget the delete.
      db.query("DELETE FROM conversation_states WHERE lead_id = $1", [leadId]).catch((e) =>
        console.error("[ConvState] expired-delete failed leadId=%s: %s", leadId, e.message)
      );
      console.log("[ConvState] load: expired state leadId=%s ageMs=%d — starting fresh", leadId, ageMs);
      return null;
    }

    // pg returns jsonb already parsed into a JS object.
    const state = row.state && typeof row.state === "object" ? row.state : null;
    if (!state) return null;

    return { state, ageMs };
  } catch (err) {
    console.error("[ConvState] load failed leadId=%s: %s", leadId, err.message);
    return null;
  }
}

/**
 * Delete the persisted state for a lead (flow consumed: booked, cancelled,
 * or aborted). Fire-and-forget at callsites. Never throws.
 *
 * @param {string} leadId
 * @returns {Promise<boolean>}
 */
async function clear(leadId) {
  if (!leadId) return false;
  try {
    await db.query("DELETE FROM conversation_states WHERE lead_id = $1", [leadId]);
    return true;
  } catch (err) {
    console.error("[ConvState] clear failed leadId=%s: %s", leadId, err.message);
    return false;
  }
}

module.exports = { save, load, clear, TTL_MS };
