"use strict";

const WebSocket = require("ws");

const REALTIME_URL = "wss://api.openai.com/v1/realtime?intent=transcription";
const MAX_RECONNECT_ATTEMPTS = 3;
const WAV_HEADER_SIZE = 44;

class RealtimeTranscriber {
  constructor({ apiKey, onTranscript, onError }) {
    this.apiKey = apiKey;
    this.onTranscript = onTranscript;
    this.onError = onError || (() => {});
    this.ws = null;
    this.connected = false;
    this.buffer = [];
    this.reconnectAttempts = 0;
    this.intentionallyClosed = false;
  }

  connect() {
    if (this.ws) return;
    this.intentionallyClosed = false;

    this.ws = new WebSocket(REALTIME_URL, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
    });

    this.ws.on("open", () => {
      this.connected = true;
      this.reconnectAttempts = 0;
      console.log("[realtimeTranscriber] connected to OpenAI Realtime");

      this.ws.send(JSON.stringify({
        type: "session.update",
        session: {
          type: "transcription",
          audio: {
            input: {
              format: { type: "audio/pcm", rate: 24000 },
              transcription: { model: "gpt-4o-transcribe" },
              turn_detection: {
                type: "server_vad",
                threshold: 0.5,
                prefix_padding_ms: 300,
                silence_duration_ms: 500,
              },
            },
          },
        },
      }));

      for (const chunk of this.buffer) {
        this._sendAudio(chunk);
      }
      this.buffer = [];
    });

    this.ws.on("message", (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      this._handleEvent(msg);
    });

    this.ws.on("error", (err) => {
      console.error("[realtimeTranscriber] ws error:", err.message);
      this.onError(err);
    });

    this.ws.on("close", () => {
      this.connected = false;
      this.ws = null;
      if (!this.intentionallyClosed && this.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        const delay = 1000 * Math.pow(2, this.reconnectAttempts);
        this.reconnectAttempts += 1;
        console.log("[realtimeTranscriber] reconnecting in %dms (attempt %d)", delay, this.reconnectAttempts);
        setTimeout(() => this.connect(), delay);
      }
    });
  }

  feedAudio(rawBuffer) {
    let pcm = Buffer.isBuffer(rawBuffer) ? rawBuffer : Buffer.from(rawBuffer);
    if (pcm.length > WAV_HEADER_SIZE && pcm.slice(0, 4).toString() === "RIFF") {
      pcm = pcm.slice(WAV_HEADER_SIZE);
    }
    this._frames = (this._frames || 0) + 1;
    if (this._frames % 10 === 0) {
      console.log("[realtimeTranscriber] audio frames received: %d (last chunk %d bytes, connected=%s)", this._frames, pcm.length, this.connected);
    }
    if (!this.connected) {
      this.buffer.push(pcm);
      return;
    }
    this._sendAudio(pcm);
  }

  _sendAudio(pcmBuffer) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({
      type: "input_audio_buffer.append",
      audio: pcmBuffer.toString("base64"),
    }));
  }

  _handleEvent(msg) {
    if (msg.type && msg.type !== "error") {
      console.log("[realtimeTranscriber] event:", msg.type);
    }
    if (
      msg.type === "conversation.item.input_audio_transcription.completed" ||
      msg.type === "conversation.item.input_audio_transcription.delta" ||
      msg.type === "transcription_session.transcript.done"
    ) {
      const text = (msg.transcript || msg.delta || msg.text || "").trim();
      if (text) {
        console.log("[realtimeTranscriber] TRANSCRIPT:", text);
        this.onTranscript({
          speaker: "unknown",
          text,
          at: new Date().toISOString(),
          item_id: msg.item_id || msg.id,
        });
      }
    }

    if (msg.type === "error") {
      console.error("[realtimeTranscriber] API error:", msg.error);
      this.onError(new Error(msg.error?.message || "Realtime API error"));
    }
  }

  close() {
    this.intentionallyClosed = true;
    this.connected = false;
    this.buffer = [];
    if (this.ws) {
      try { this.ws.close(); } catch {}
      this.ws = null;
    }
  }
}

module.exports = { RealtimeTranscriber };
