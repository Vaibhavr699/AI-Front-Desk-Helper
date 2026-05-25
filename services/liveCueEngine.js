"use strict";

const OpenAI = require("openai");
const db = require("../lib/db");

let _openai = null;
function getOpenAI() {
  if (!_openai) {
    _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _openai;
}

const CUE_MODEL = "gpt-4o-2024-08-06";

const WINDOW_SECONDS = 12;
const MIN_WINDOW_CHARS = 40;
const COOLDOWN_MS = 20_000;
const WPM_THRESHOLD = 180;
const WPM_SAMPLE_SECONDS = 10;

const CUE_TYPES = {
  ask_discovery: { watch: "ASK", urgency: "yellow", vibration: "single_tap" },
  listen: { watch: "LISTEN", urgency: "yellow", vibration: "single_tap" },
  disc_reframe: { watch: "DISC", urgency: "orange", vibration: "double_tap" },
  missing_close: { watch: "CLOSE", urgency: "orange", vibration: "double_tap" },
  address_objection: { watch: "OBJECT", urgency: "orange", vibration: "double_tap" },
  slow_down: { watch: "SLOW", urgency: "red", vibration: "long_buzz" },
  build_rapport: { watch: "RAPPORT", urgency: "yellow", vibration: "single_tap" },
  confirm_next_step: { watch: "CONFIRM", urgency: "green", vibration: "single_tap" },
};

const SYSTEM_PROMPT = `You are a real-time sales coaching engine for home services reps. You receive a rolling transcript window from a live in-home customer conversation. Your job is to decide if the rep needs a coaching cue RIGHT NOW.

AVAILABLE CUES (fire at most ONE per window, or null):
1. ask_discovery — Rep is presenting/pitching too early without understanding the customer's needs. They should ask a discovery question first.
2. listen — Rep is interrupting or talking over the customer. The customer is trying to speak. Rep should stop and listen.
3. disc_reframe — Rep's communication style mismatches the customer's DISC personality. Specify the detected type and suggest reframe.
4. missing_close — Conversation has been running long without any close attempt or next-step proposal.
5. address_objection — Customer raised an objection that the rep ignored, deflected, or changed subject from. They need to address it directly.
6. slow_down — Rep is talking too fast (high WPM data provided). They should slow their pace.
7. build_rapport — Customer's tone has shifted guarded/cold. Rep should pause selling and build personal connection.
8. confirm_next_step — Conversation is winding down without a committed next step (appointment, follow-up, signature).

RULES:
- Only fire a cue if it's clearly warranted by the transcript evidence. When in doubt, return null.
- Do NOT repeat the same cue type within 30 seconds.
- Keep headline under 50 chars, full_text under 120 chars.
- full_text should be actionable coaching advice, not a description of the problem.

Return ONLY valid JSON:
{ "cue": "ask_discovery" | "listen" | ... | null, "headline": "...", "full_text": "...", "disc_type": "D" | "I" | "S" | "C" | null, "confidence": 0.0-1.0 }

If no cue is warranted, return: { "cue": null }`;

class LiveCueEngine {
  constructor({ sessionId, tenantId, onCue, disabledCues }) {
    this.sessionId = sessionId;
    this.tenantId = tenantId;
    this.onCue = onCue;
    this.disabledCues = new Set(disabledCues || []);
    this.transcript = [];
    this.lastCueFiredAt = {};
    this.windowTimer = null;
    this.processing = false;
    this.sessionStartedAt = Date.now();
    this.wpmSamples = [];
    this.cuesFired = 0;
    this.closed = false;
    this._lastProcessedLength = 0;
  }

  start() {
    this.windowTimer = setInterval(() => this._processWindow(), WINDOW_SECONDS * 1000);
  }

  addTranscriptEntry(entry) {
    if (this.closed) return;
    this.transcript.push({
      ...entry,
      _ts: Date.now(),
    });
  }

  _getRecentWindow() {
    const cutoff = Date.now() - (WINDOW_SECONDS * 1000);
    return this.transcript.filter((e) => e._ts >= cutoff);
  }

  _computeWpm() {
    const cutoff = Date.now() - (WPM_SAMPLE_SECONDS * 1000);
    const recent = this.transcript.filter((e) => e._ts >= cutoff && e.speaker !== "customer");
    const totalWords = recent.reduce((sum, e) => sum + (e.text || "").split(/\s+/).length, 0);
    const wpm = Math.round((totalWords / WPM_SAMPLE_SECONDS) * 60);
    this.wpmSamples.push({ at: new Date().toISOString(), wpm });
    return wpm;
  }

  async _processWindow() {
    if (this.closed || this.processing) return;
    if (this.transcript.length === this._lastProcessedLength) return;
    const window = this._getRecentWindow();
    const windowText = window.map((e) => `[${e.speaker}]: ${e.text}`).join("\n");
    if (windowText.length < MIN_WINDOW_CHARS) return;

    this._lastProcessedLength = this.transcript.length;
    this.processing = true;
    try {
      const wpm = this._computeWpm();
      const elapsedMin = Math.round((Date.now() - this.sessionStartedAt) / 60_000);

      const userMessage = `TRANSCRIPT WINDOW (last ${WINDOW_SECONDS}s, session elapsed ${elapsedMin} min, rep WPM=${wpm}):\n\n${windowText}`;

      const resp = await getOpenAI().chat.completions.create({
        model: CUE_MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userMessage },
        ],
        temperature: 0.2,
        max_tokens: 200,
        response_format: { type: "json_object" },
      });

      const raw = resp.choices?.[0]?.message?.content || "{}";
      let result;
      try {
        result = JSON.parse(raw);
      } catch {
        return;
      }

      if (!result.cue) return;
      if (this.disabledCues.has(result.cue)) return;
      if (!CUE_TYPES[result.cue]) return;

      const now = Date.now();
      const lastFired = this.lastCueFiredAt[result.cue] || 0;
      if (now - lastFired < COOLDOWN_MS) return;

      if (result.cue === "slow_down" && wpm < WPM_THRESHOLD) return;

      this.lastCueFiredAt[result.cue] = now;
      this.cuesFired += 1;
      const meta = CUE_TYPES[result.cue];

      const alert = {
        id: `cue-${now}-${this.cuesFired}`,
        type: result.cue,
        cue_type: result.cue,
        urgency: meta.urgency,
        headline: result.headline || result.cue.replace(/_/g, " "),
        full_text: result.full_text || null,
        vibration: meta.vibration,
        watch_label: meta.watch,
        disc_type: result.disc_type || null,
        confidence: result.confidence || null,
        fired_at: new Date().toISOString(),
        window_start: window[0]?.at || null,
        window_end: window[window.length - 1]?.at || null,
      };

      await this._persistAlert(alert, window);
      this.onCue(alert);
    } catch (err) {
      console.error("[liveCueEngine] window analysis error:", err.message);
    } finally {
      this.processing = false;
    }
  }

  async _persistAlert(alert, window) {
    try {
      await db.query(
        `INSERT INTO in_home_alerts
           (session_id, alert_type, alert_content, alert_urgency, cue_type,
            watch_label, fired_at, window_start, window_end, transcript_window, payload)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          this.sessionId,
          alert.type,
          alert.headline,
          alert.urgency,
          alert.cue_type,
          alert.watch_label,
          alert.fired_at,
          alert.window_start,
          alert.window_end,
          JSON.stringify(window.map(({ _ts, ...e }) => e)),
          JSON.stringify({
            full_text: alert.full_text,
            disc_type: alert.disc_type,
            confidence: alert.confidence,
            vibration: alert.vibration,
          }),
        ],
      );

      await db.query(
        `UPDATE in_home_sessions
            SET total_cues_fired = $1,
                wpm_samples = $2::jsonb
          WHERE id = $3`,
        [this.cuesFired, JSON.stringify(this.wpmSamples.slice(-60)), this.sessionId],
      );
    } catch (err) {
      console.error("[liveCueEngine] persist error:", err.message);
    }
  }

  close() {
    this.closed = true;
    if (this.windowTimer) {
      clearInterval(this.windowTimer);
      this.windowTimer = null;
    }
  }
}

module.exports = { LiveCueEngine, CUE_TYPES, WINDOW_SECONDS };
