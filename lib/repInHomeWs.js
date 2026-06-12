"use strict";

const { WebSocketServer } = require("ws");
const auth = require("./auth");
const db = require("./db");
const { ChunkTranscriber } = require("../services/chunkTranscriber");
const { LiveCueEngine } = require("../services/liveCueEngine");
const pushNotifications = require("../services/pushNotifications");
const { synthesizeCueAudio } = require("../services/cueTts");
const chunkStore = require("./inHomeChunkStore");

const HEARTBEAT_INTERVAL_MS = 15_000;
const PATH_PREFIX = "/ws/rep/in-home/";
const TIER_RANK = { standard: 0, pro: 1, elite: 2 };

const activeSessions = new Map();

function createInHomeWss() {
  const wss = new WebSocketServer({ noServer: true });

  wss.on("connection", async (ws) => {
    const ctx = ws.repContext;
    console.log(
      "[repInHomeWs] connected session=%s user=%s",
      ctx.session_id,
      ctx.user_id,
    );

    send(ws, {
      type: "session_status",
      status: "connected",
      session_id: ctx.session_id,
      server_time: new Date().toISOString(),
    });

    const heartbeat = setInterval(() => {
      if (ws.readyState !== ws.OPEN) return;
      send(ws, { type: "heartbeat", t: Date.now() });
    }, HEARTBEAT_INTERVAL_MS);

    let disabledCues = [];
    let deliveryPrefs = { popup: true, sidebar: true, watch: true, audio: true };
    let seatTier = "standard";
    try {
      const prefR = await db.query(
        `SELECT cue_preferences, coaching_delivery_prefs, rep_seat_tier
           FROM dashboard_users WHERE id = $1`,
        [ctx.user_id],
      );
      const row = prefR.rows[0] || {};
      const cuePrefs = row.cue_preferences || {};
      disabledCues = Object.entries(cuePrefs)
        .filter(([, v]) => v === false)
        .map(([k]) => k);
      deliveryPrefs = { ...deliveryPrefs, ...(row.coaching_delivery_prefs || {}) };
      seatTier = row.rep_seat_tier || "standard";
    } catch {}

    const popupEnabled = deliveryPrefs.popup !== false;
    const watchEnabled = deliveryPrefs.watch !== false && (TIER_RANK[seatTier] || 0) >= TIER_RANK.elite;
    const audioEnabled = deliveryPrefs.audio !== false && (TIER_RANK[seatTier] || 0) >= TIER_RANK.pro;
    const audioMinGapMs = Math.max(0, (deliveryPrefs.audio_min_gap_seconds || 60) * 1000);
    let lastAudioCueAt = 0;
    let audioMuted = false;

    const cueEngine = new LiveCueEngine({
      sessionId: ctx.session_id,
      tenantId: ctx.tenant_id,
      disabledCues,
      onCue: (alert) => {
        const channels = [];
        if (popupEnabled) channels.push("popup");
        if (watchEnabled) channels.push("watch");
        if (audioEnabled) channels.push("audio");

        if (channels.length === 0) return;

        send(ws, { type: "coaching_cue", cue: alert, channels });

        if (watchEnabled) {
          pushNotifications.sendPushToUsers([ctx.user_id], {
            title: alert.watch_label,
            body: alert.headline,
            priority: "high",
            data: { type: "coaching_cue", session_id: ctx.session_id, cue_type: alert.cue_type },
          }).catch((err) => {
            console.error("[repInHomeWs] watch push failed:", err.message);
          });
        }

        // Elite/Pro audio coaching — whisper the cue to the rep's earbud.
        // Globally throttled (default 1/60s) and runtime-mutable.
        if (audioEnabled && !audioMuted) {
          const now = Date.now();
          if (now - lastAudioCueAt >= audioMinGapMs) {
            lastAudioCueAt = now;
            const audioText = alert.full_text || alert.headline;
            synthesizeCueAudio(audioText)
              .then((buf) => {
                if (buf) {
                  send(ws, {
                    type: "cue_audio",
                    cue_id: alert.id,
                    format: "mp3",
                    data: buf.toString("base64"),
                  });
                }
              })
              .catch((err) => console.error("[repInHomeWs] cue TTS failed:", err.message));
          }
        }
      },
      onChecklistUpdate: (key) => {
        send(ws, { type: "checklist_update", key, completed: true });
      },
    });

    let transcriber = null;
    if (process.env.OPENAI_API_KEY) {
      transcriber = new ChunkTranscriber({
        apiKey: process.env.OPENAI_API_KEY,
        extension: "m4a",
        onTranscript: (entry) => {
          cueEngine.addTranscriptEntry(entry);
          send(ws, { type: "transcript_update", entry });
          persistTranscriptEntry(ctx.session_id, entry);
        },
        onError: (err) => {
          send(ws, { type: "transcriber_error", message: err.message });
        },
      });
      transcriber.connect();
    }

    cueEngine.start();

    const sessionState = { ws, cueEngine, transcriber, heartbeat };
    activeSessions.set(ctx.session_id, sessionState);

    ws.on("message", (raw, isBinary) => {
      if (isBinary) {
        const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
        if (buf.length <= 4) return;
        const seq = buf.readUInt32BE(0);
        const audio = buf.subarray(4);
        try {
          chunkStore.writeChunk(ctx.session_id, seq, audio);
        } catch (err) {
          console.error("[repInHomeWs] chunk persist failed:", err.message);
        }
        if (transcriber) {
          transcriber.feedAudio(audio);
        }
        send(ws, { type: "chunk_ack", seq });
        return;
      }

      let parsed = null;
      const text = raw.toString();
      try {
        parsed = JSON.parse(text);
      } catch {}

      if (!parsed) return;

      if (parsed.type === "client_heartbeat") {
        return;
      }

      if (parsed.type === "transcript_manual") {
        const entry = {
          speaker: parsed.speaker || "rep",
          text: parsed.text || "",
          at: parsed.at || new Date().toISOString(),
        };
        cueEngine.addTranscriptEntry(entry);
        persistTranscriptEntry(ctx.session_id, entry);
        return;
      }

      if (parsed.type === "cue_dismissed") {
        dismissCue(parsed.cue_id);
        return;
      }

      if (parsed.type === "set_audio_mute") {
        audioMuted = !!parsed.muted;
        return;
      }

      send(ws, { type: "echo", received: parsed });
    });

    ws.on("close", () => {
      clearInterval(heartbeat);
      cueEngine.close();
      if (transcriber) transcriber.close();
      activeSessions.delete(ctx.session_id);
      console.log("[repInHomeWs] closed session=%s", ctx.session_id);
    });

    ws.on("error", (err) => {
      console.error(
        "[repInHomeWs] error session=%s:",
        ctx.session_id,
        err.message,
      );
    });
  });

  async function routeUpgrade(req, socket, head, url) {
    const sessionId = url.pathname.slice(PATH_PREFIX.length).split("/")[0];
    const token = url.searchParams.get("token");

    if (!sessionId || !token) {
      rejectSocket(socket, 401, "Missing session_id or token");
      return;
    }

    let decoded;
    try {
      decoded = auth.verifyToken(token);
    } catch {
      rejectSocket(socket, 401, "Invalid token");
      return;
    }
    if (decoded.scope !== "rep") {
      rejectSocket(socket, 403, "Not a rep token");
      return;
    }

    let session;
    try {
      const r = await db.query(
        `SELECT id, tenant_id, user_id, started_at, ended_at
           FROM in_home_sessions
          WHERE id = $1 AND user_id = $2 AND tenant_id = $3`,
        [sessionId, decoded.sub, decoded.tenant_id],
      );
      session = r.rows[0];
    } catch (err) {
      console.error("[repInHomeWs] session lookup failed:", err.message);
      rejectSocket(socket, 500, "Server error");
      return;
    }

    if (!session) {
      rejectSocket(socket, 404, "Session not found");
      return;
    }
    if (session.ended_at) {
      rejectSocket(socket, 409, "Session already ended");
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.repContext = {
        session_id: session.id,
        user_id: session.user_id,
        tenant_id: session.tenant_id,
      };
      wss.emit("connection", ws, req);
    });
  }

  return { wss, routeUpgrade, PATH_PREFIX, activeSessions };
}

function send(ws, payload) {
  try {
    ws.send(JSON.stringify(payload));
  } catch (err) {
    console.error("[repInHomeWs] send failed:", err.message);
  }
}

function rejectSocket(socket, status, reason) {
  socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

async function persistTranscriptEntry(sessionId, entry) {
  try {
    await db.query(
      `UPDATE in_home_sessions
          SET transcript = transcript || $1::jsonb
        WHERE id = $2`,
      [JSON.stringify([{ speaker: entry.speaker, text: entry.text, at: entry.at }]), sessionId],
    );
  } catch (err) {
    console.error("[repInHomeWs] transcript persist error:", err.message);
  }
}

async function dismissCue(cueId) {
  try {
    await db.query(
      `UPDATE in_home_alerts SET dismissed_at = now() WHERE id = $1`,
      [cueId],
    );
  } catch {}
}

module.exports = { createInHomeWss };
