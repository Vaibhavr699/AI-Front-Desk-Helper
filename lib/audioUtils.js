"use strict";

const { spawn } = require("child_process");
const alawmulaw = require("alawmulaw");

const SAMPLE_RATE = 8000;
const BITS_PER_SAMPLE = 16;
const NUM_CHANNELS = 1;

/**
 * Decode base64-encoded μ-law audio to 16-bit PCM (Int16Array).
 * @param {string} base64Mulaw
 * @returns {Int16Array}
 */
function decodeMulawToPcm(base64Mulaw) {
  const buffer = Buffer.from(base64Mulaw, "base64");
  const mulawSamples = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.length);
  return alawmulaw.mulaw.decode(mulawSamples);
}

/**
 * Build a WAV file buffer from 16-bit PCM (8 kHz mono).
 * Whisper accepts WAV; we use 8 kHz to match Twilio's stream.
 * @param {Int16Array} pcm
 * @returns {Buffer}
 */
function pcmToWav(pcm) {
  const dataLength = pcm.length * 2; // 16-bit = 2 bytes per sample
  const buffer = Buffer.alloc(44 + dataLength);
  let o = 0;
  buffer.write("RIFF", o); o += 4;
  buffer.writeUInt32LE(36 + dataLength, o); o += 4;
  buffer.write("WAVE", o); o += 4;
  buffer.write("fmt ", o); o += 4;
  buffer.writeUInt32LE(16, o); o += 4;
  buffer.writeUInt16LE(1, o); o += 2;
  buffer.writeUInt16LE(NUM_CHANNELS, o); o += 2;
  buffer.writeUInt32LE(SAMPLE_RATE, o); o += 4;
  buffer.writeUInt32LE(SAMPLE_RATE * NUM_CHANNELS * (BITS_PER_SAMPLE / 8), o); o += 4;
  buffer.writeUInt16LE(NUM_CHANNELS * (BITS_PER_SAMPLE / 8), o); o += 2;
  buffer.writeUInt16LE(BITS_PER_SAMPLE, o); o += 2;
  buffer.write("data", o); o += 4;
  buffer.writeUInt32LE(dataLength, o); o += 4;
  for (let i = 0; i < pcm.length; i++) {
    buffer.writeInt16LE(pcm[i], o);
    o += 2;
  }
  return buffer;
}

/**
 * Convert μ-law base64 chunks (from Twilio) to a WAV buffer for Whisper.
 * @param {string[]} base64Chunks
 * @returns {Buffer}
 */
function mulawChunksToWav(base64Chunks) {
  const combined = base64Chunks.join("");
  const pcm = decodeMulawToPcm(combined);
  return pcmToWav(pcm);
}

/**
 * Convert MP3 buffer (e.g. from OpenAI TTS) to 8 kHz μ-law for Twilio Media Streams.
 * Uses ffmpeg; returns null if ffmpeg is not available or conversion fails.
 * @param {Buffer} mp3Buffer
 * @returns {Promise<Buffer|null>} Raw μ-law bytes (not base64).
 */
function mp3ToMulaw(mp3Buffer) {
  return new Promise((resolve) => {
    const ffmpeg = spawn("ffmpeg", [
      "-loglevel", "error", "-hide_banner", "-nostdin",
      "-i", "pipe:0",
      "-ar", String(SAMPLE_RATE),
      "-ac", "1",
      "-f", "mulaw",
      "pipe:1",
    ], { stdio: ["pipe", "pipe", "pipe"] });

    const chunks = [];
    ffmpeg.stdout.on("data", (chunk) => chunks.push(chunk));
    ffmpeg.stdout.on("end", () => resolve(Buffer.concat(chunks)));
    ffmpeg.on("error", () => resolve(null));
    ffmpeg.stderr.on("data", () => {});

    ffmpeg.stdin.write(mp3Buffer);
    ffmpeg.stdin.end();

    ffmpeg.on("close", (code) => {
      if (code !== 0 && chunks.length === 0) resolve(null);
    });
  });
}

module.exports = {
  decodeMulawToPcm,
  pcmToWav,
  mulawChunksToWav,
  mp3ToMulaw,
  SAMPLE_RATE,
};
