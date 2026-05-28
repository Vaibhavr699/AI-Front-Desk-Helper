"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const OpenAI = require("openai");

let _openai = null;
function getOpenAI() {
  if (!_openai) {
    _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _openai;
}

const MIN_CHUNK_BYTES = 2000;

// Drop-in replacement for RealtimeTranscriber that works with COMPRESSED audio
// chunks (e.g. Android .m4a). Each complete chunk is transcribed via Whisper REST.
// Android expo-av cannot produce raw PCM16, so the Realtime streaming API can't
// be used on Android — this batch approach accepts what the phone actually records.
class ChunkTranscriber {
  constructor({ apiKey, onTranscript, onError, extension = "m4a" }) {
    this.apiKey = apiKey;
    this.onTranscript = onTranscript;
    this.onError = onError || (() => {});
    this.extension = extension;
    this.closed = false;
    this.inFlight = 0;
    this._chunks = 0;
  }

  connect() {
    // No persistent connection needed — Whisper is request-per-chunk.
    console.log("[chunkTranscriber] ready (Whisper batch mode)");
  }

  feedAudio(rawBuffer) {
    if (this.closed) return;
    const buf = Buffer.isBuffer(rawBuffer) ? rawBuffer : Buffer.from(rawBuffer);
    if (buf.length < MIN_CHUNK_BYTES) return; // skip near-empty chunks
    this._chunks += 1;
    this._transcribe(buf, this._chunks);
  }

  async _transcribe(buf, n) {
    this.inFlight += 1;
    const tmp = path.join(os.tmpdir(), `cue-chunk-${Date.now()}-${n}.${this.extension}`);
    try {
      fs.writeFileSync(tmp, buf);
      const resp = await getOpenAI().audio.transcriptions.create({
        file: fs.createReadStream(tmp),
        model: "gpt-4o-transcribe",
        language: "en",
        prompt:
          "A live in-home sales conversation between a home-services sales rep and a homeowner discussing a project, pricing, timeline, and warranty.",
        response_format: "text",
      });
      const text = (typeof resp === "string" ? resp : resp.text || "").trim();
      if (text && !this.closed) {
        console.log("[chunkTranscriber] TRANSCRIPT:", text);
        this.onTranscript({
          speaker: "unknown",
          text,
          at: new Date().toISOString(),
        });
      }
    } catch (err) {
      console.error("[chunkTranscriber] whisper error:", err.message);
      this.onError(err);
    } finally {
      this.inFlight -= 1;
      try { fs.unlinkSync(tmp); } catch {}
    }
  }

  close() {
    this.closed = true;
  }
}

module.exports = { ChunkTranscriber };
