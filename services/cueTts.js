"use strict";

const OpenAI = require("openai");

let _openai = null;
function getOpenAI() {
  if (!_openai) {
    _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _openai;
}

const TTS_MODEL = "gpt-4o-mini-tts";
const TTS_VOICE = process.env.CUE_TTS_VOICE || "sage";

const WHISPER_INSTRUCTIONS =
  "You are a discreet live sales coach speaking privately into the rep's earbud during a customer meeting. Speak in a soft, quick, low whisper — calm and under your breath, like a caddie giving a one-line tip. Keep it terse and natural. Never announce yourself or add filler.";

async function synthesizeCueAudio(text) {
  const clean = (text || "").trim();
  if (!clean) return null;
  const openai = getOpenAI();
  const resp = await openai.audio.speech.create({
    model: TTS_MODEL,
    voice: TTS_VOICE,
    input: clean.slice(0, 300),
    instructions: WHISPER_INSTRUCTIONS,
    response_format: "mp3",
  });
  return Buffer.from(await resp.arrayBuffer());
}

module.exports = { synthesizeCueAudio };
