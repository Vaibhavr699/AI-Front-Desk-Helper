"use strict";

/**
 * lib/leadHistory.js
 *
 * Phase 12 A2.1 (Jun 10, 2026) — cross-channel AI memory.
 *
 * The voice path already injects prior-call context into the Realtime
 * session via getCallerHistory(from) (server.js). The SMS / website AI
 * orchestrator (runSmsAiOrchestrator) never had an equivalent — it only
 * ever saw the in-memory thread.history (the CURRENT session's turns) plus
 * thread.leadCapture. So a customer who called yesterday and texts today,
 * or who chatted on the website last week and now texts, was treated as a
 * cold stranger by the SMS AI even though we had their whole history on
 * file in the messages table.
 *
 * This module closes that gap. buildLeadHistoryBlock(leadId, opts) pulls
 * the lead's recent messages ACROSS ALL CHANNELS (voice/sms/website/
 * facebook/email) from the messages table and renders a compact digest the
 * SMS prompt builder can splice in — the text analogue of what
 * getCallerHistory does for voice.
 *
 * IDENTITY SAFETY (the hard constraint):
 *   This keys STRICTLY off leadId — the lead resolved by getOrCreateLead's
 *   E.164 phone-match (verified) or the website session-id match. There is
 *   NO fuzzy matching here, no name matching, no phone re-derivation. If the
 *   wrong leadId comes in, the wrong history goes out — so we deliberately
 *   lean entirely on the already-hardened lead resolution upstream and do
 *   nothing clever of our own. The cost of a wrong match is leaking one
 *   person's conversation to another, so "do nothing speculative" is the
 *   correct posture.
 *
 * COST / SHAPE:
 *   - Recent N messages only (default 12), newest-first from the DB then
 *     reversed to chronological for the prompt.
 *   - We EXCLUDE the current session's turns where possible by accepting an
 *     `excludeAfter` timestamp (the moment this thread's first inbound was
 *     saved) — avoids showing the AI its own just-saved current-turn lines
 *     back to it as "history".
 *   - Each line is truncated; the whole block is capped. No LLM summary —
 *     that would add latency + cost + a second failure point to every SMS.
 *     Twelve recent lines is enough for continuity ("called Tue about
 *     exterior, texted yesterday") without prompt bloat.
 *
 * NEVER THROWS. On any DB error it returns "" so the SMS reply is never
 * blocked — same fail-open discipline as buildCoachingPromptInjection.
 */

const db = require("./db");

const DEFAULT_LIMIT = 12;
const MAX_LINE_CHARS = 160;     // per-message truncation
const MAX_BLOCK_CHARS = 1800;   // hard cap on the whole injected block

// Channel → short human label for the digest.
const CHANNEL_LABEL = {
  voice:    "Call",
  sms:      "SMS",
  website:  "Web chat",
  facebook: "Facebook",
  email:    "Email",
};

function labelFor(channel) {
  return CHANNEL_LABEL[channel] || (channel ? channel : "msg");
}

// "2026-06-09T14:03:00Z" → "Jun 9" (tenant tz-agnostic; coarse on purpose —
// we want "when roughly", not a precise timestamp, and avoiding tz math keeps
// this dependency-free and cheap).
function shortDate(value) {
  try {
    const d = new Date(value);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

function clip(text, max) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1) + "…";
}

/**
 * Fetch and format the lead's recent cross-channel history.
 *
 * @param {string} leadId            - REQUIRED. The resolved lead id.
 * @param {object} [opts]
 * @param {number} [opts.limit]      - max messages to pull (default 12)
 * @param {string|number|Date} [opts.excludeAfter]
 *        - if provided, messages with created_at >= this are dropped, so the
 *          current session's just-saved turns don't echo back as "history".
 * @param {string} [opts.currentChannel]
 *        - the channel of the live conversation; used only for the header
 *          wording ("They're now reaching out via SMS"). Optional.
 * @returns {Promise<string>} a prompt-ready block, or "" if nothing useful.
 */
async function buildLeadHistoryBlock(leadId, opts = {}) {
  if (!leadId) return "";

  const limit = Math.max(1, Math.min(40, Number(opts.limit) || DEFAULT_LIMIT));

  let rows = [];
  try {
    // Pull newest-first so LIMIT keeps the most recent; we reverse below.
    // direction + channel + body + created_at is everything the digest needs.
    const res = await db.query(
      `SELECT channel, direction, body, created_at
         FROM messages
        WHERE lead_id = $1
          AND body IS NOT NULL
          AND body <> ''
        ORDER BY created_at DESC
        LIMIT $2`,
      [leadId, limit]
    );
    rows = res.rows || [];
  } catch (e) {
    console.error("[LeadHistory] query failed leadId=%s: %s", leadId, e.message);
    return "";
  }

  if (rows.length === 0) return "";

  // Optionally drop the current session's own turns (created at/after the
  // moment this thread started), so we don't feed the AI its just-saved
  // current-turn lines back as "prior history".
  let cutoff = null;
  if (opts.excludeAfter != null) {
    const c = new Date(opts.excludeAfter);
    if (!isNaN(c.getTime())) cutoff = c.getTime();
  }
  if (cutoff != null) {
    rows = rows.filter((r) => {
      const t = new Date(r.created_at).getTime();
      return isNaN(t) ? true : t < cutoff;
    });
  }

  if (rows.length === 0) return "";

  // Reverse to chronological (oldest → newest) for natural reading.
  rows.reverse();

  // Render lines: "[Jun 9 · SMS] Customer: ..." / "... Us: ...".
  const lines = [];
  for (const r of rows) {
    const who = r.direction === "inbound" ? "Customer" : "Us";
    const when = shortDate(r.created_at);
    const chan = labelFor(r.channel);
    const head = when ? `[${when} · ${chan}]` : `[${chan}]`;
    lines.push(`${head} ${who}: ${clip(r.body, MAX_LINE_CHARS)}`);
  }

  // Assemble, capping total size from the OLDEST end (keep most recent if we
  // have to trim) — drop from the front until under the cap.
  let body = lines.join("\n");
  while (body.length > MAX_BLOCK_CHARS && lines.length > 1) {
    lines.shift();
    body = lines.join("\n");
  }

  const distinctChannels = new Set(rows.map((r) => r.channel).filter(Boolean));
  const crossChannelNote =
    distinctChannels.size > 1
      ? " This customer has reached us across more than one channel — treat it as one ongoing relationship, not separate strangers."
      : "";

  const header =
    "═══ PRIOR HISTORY WITH THIS CUSTOMER (read before replying) ═══\n" +
    "You've interacted with this person before. Below is the recent history " +
    "across all channels, oldest first. Use it for continuity — don't " +
    "re-introduce yourself or ask for details they've already given, and " +
    "acknowledge prior context naturally if relevant. Do NOT recite this " +
    "history back to them verbatim." +
    crossChannelNote;

  return `${header}\n\n${body}`;
}

module.exports = {
  buildLeadHistoryBlock,
  // exported for unit testing
  _clip: clip,
  _labelFor: labelFor,
};
