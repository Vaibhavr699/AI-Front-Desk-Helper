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
const TTS_VOICE = process.env.ROLEPLAY_TTS_VOICE || "ash";

const ROLEPLAY_INSTRUCTIONS =
  "You are a homeowner talking face to face with a home-services salesperson at your door or kitchen table. Speak naturally and conversationally, like a real customer — relaxed cadence, normal emotion that fits the words. Do not sound like a narrator, an assistant, or a recording.";

async function synthesizeRoleplayAudio(text) {
  const clean = (text || "").trim();
  if (!clean) return null;
  const openai = getOpenAI();
  const resp = await openai.audio.speech.create({
    model: TTS_MODEL,
    voice: TTS_VOICE,
    input: clean.slice(0, 1000),
    instructions: ROLEPLAY_INSTRUCTIONS,
    response_format: "mp3",
  });
  return Buffer.from(await resp.arrayBuffer());
}

module.exports = { synthesizeRoleplayAudio };
