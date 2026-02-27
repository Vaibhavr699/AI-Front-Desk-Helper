"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const OpenAI = require("openai").default;
const { mulawChunksToWav, mp3ToMulaw } = require("../lib/audioUtils");

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const SILENCE_MS = 1500;   // Process after this many ms with no new audio
const MIN_AUDIO_MS = 400;  // Ignore utterances shorter than this
const SAMPLE_RATE = 8000;
const BYTES_PER_MS = SAMPLE_RATE / 1000; // 8 bytes/ms for 8kHz mulaw
const CHUNK_MS = 20;      // Twilio sends 20ms chunks; we send back in similar size
const CHUNK_BYTES = Math.floor(BYTES_PER_MS * CHUNK_MS);

const openai = OPENAI_API_KEY ? new OpenAI() : null;

/**
 * Run the turn-based voice loop: buffer caller audio → Whisper → LLM → TTS → play back.
 * @param {import("ws").WebSocket} twilioSocket
 * @param {{ callSid?: string, from?: string, to?: string }} parsed
 * @param {object} getTenantByPhone
 * @param {object} callsService
 * @param {object} recordingService
 */
function handleTurnBasedStream(twilioSocket, parsed, getTenantByPhone, callsService, recordingService) {
  const { callSid, from, to } = parsed;
  let streamSid = null;
  let tenant = null;
  const audioBuffer = [];
  let lastChunkAt = 0;
  let silenceTimer = null;
  let isProcessing = false;
  let isSpeaking = false;

  function sendMediaToTwilio(base64Payload) {
    if (!streamSid || twilioSocket.readyState !== 1) return;
    twilioSocket.send(
      JSON.stringify({
        event: "media",
        streamSid,
        media: { payload: base64Payload },
      })
    );
  }

  function scheduleProcess() {
    if (silenceTimer) clearTimeout(silenceTimer);
    silenceTimer = setTimeout(() => {
      silenceTimer = null;
      if (audioBuffer.length > 0 && !isProcessing && !isSpeaking) {
        processBuffer();
      }
    }, SILENCE_MS);
  }

  async function processBuffer() {
    if (audioBuffer.length === 0 || !openai) return;
    isProcessing = true;
    const chunks = [...audioBuffer];
    audioBuffer.length = 0;

    const base64Len = chunks.join("").length;
    const byteCount = Math.floor((base64Len * 3) / 4);
    const durationMs = byteCount / BYTES_PER_MS;
    if (durationMs < MIN_AUDIO_MS) {
      isProcessing = false;
      return;
    }

    let tmpPath;
    try {
      const wavBuffer = mulawChunksToWav(chunks);
      tmpPath = path.join(os.tmpdir(), `turnbased-${Date.now()}-${Math.random().toString(36).slice(2)}.wav`);
      fs.writeFileSync(tmpPath, wavBuffer);
      const transcript = await openai.audio.transcriptions.create({
        file: fs.createReadStream(tmpPath),
        model: "whisper-1",
      });
      const text = (transcript && transcript.text && transcript.text.trim()) || "";
      if (!text) {
        isProcessing = false;
        return;
      }

      const instructions = (tenant && tenant.instructions)
        ? tenant.instructions
        : "You are a professional receptionist. Be warm and helpful. Capture name, phone, address. Offer a free estimate. Keep responses concise and natural for phone.";
      const welcome = (tenant && tenant.welcome_message)
        ? tenant.welcome_message
        : "Thanks for calling. What can we help you with today? Would you like to schedule a free estimate?";

      const messages = [
        { role: "system", content: `${instructions}\n\nIf this is the first exchange, you may say: "${welcome}" Otherwise respond naturally to the caller. Keep replies short (1-3 sentences) for phone.` },
        { role: "user", content: text },
      ];

      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages,
        max_tokens: 150,
      });
      const reply = (completion.choices && completion.choices[0] && completion.choices[0].message && completion.choices[0].message.content)
        ? completion.choices[0].message.content.trim()
        : "I didn't catch that. Could you repeat?";
      if (!reply) {
        isProcessing = false;
        return;
      }

      const ttsModel = process.env.OPENAI_TTS_MODEL || "tts-1-hd";
      const ttsVoice = process.env.OPENAI_TTS_VOICE || "nova";
      const speech = await openai.audio.speech.create({
        model: ttsModel,
        voice: ttsVoice,
        input: reply,
      });
      const mp3Buffer = Buffer.from(await speech.arrayBuffer());
      const mulawBuffer = await mp3ToMulaw(mp3Buffer);
      if (!mulawBuffer || mulawBuffer.length === 0) {
        isProcessing = false;
        return;
      }

      isSpeaking = true;
      for (let i = 0; i < mulawBuffer.length; i += CHUNK_BYTES) {
        const chunk = mulawBuffer.slice(i, i + CHUNK_BYTES);
        sendMediaToTwilio(chunk.toString("base64"));
        await new Promise((r) => setTimeout(r, CHUNK_MS));
      }
      isSpeaking = false;
    } catch (err) {
      console.error("Turn-based voice error:", err);
      try {
        const ttsModel = process.env.OPENAI_TTS_MODEL || "tts-1-hd";
        const ttsVoice = process.env.OPENAI_TTS_VOICE || "nova";
        const fallback = await openai.audio.speech.create({
          model: ttsModel,
          voice: ttsVoice,
          input: "Sorry, I had a small hiccup. Please try again.",
        });
        const mp3Buffer = Buffer.from(await fallback.arrayBuffer());
        const mulawBuffer = await mp3ToMulaw(mp3Buffer);
        if (mulawBuffer) {
          isSpeaking = true;
          for (let i = 0; i < mulawBuffer.length; i += CHUNK_BYTES) {
            sendMediaToTwilio(mulawBuffer.slice(i, i + CHUNK_BYTES).toString("base64"));
            await new Promise((r) => setTimeout(r, CHUNK_MS));
          }
          isSpeaking = false;
        }
      } catch (_) {}
    } finally {
      if (tmpPath && fs.existsSync(tmpPath)) try { fs.unlinkSync(tmpPath); } catch (_) {}
    }
    isProcessing = false;
  }

  async function playWelcome() {
    if (!openai || !tenant) return;
    const welcome = (tenant.welcome_message && tenant.welcome_message.trim())
      ? tenant.welcome_message.trim()
      : "Thanks for calling. What can we help you with today? Would you like to schedule a free estimate?";
    try {
      const ttsModel = process.env.OPENAI_TTS_MODEL || "tts-1-hd";
      const ttsVoice = process.env.OPENAI_TTS_VOICE || "nova";
      const speech = await openai.audio.speech.create({
        model: ttsModel,
        voice: ttsVoice,
        input: welcome,
      });
      const mp3Buffer = Buffer.from(await speech.arrayBuffer());
      const mulawBuffer = await mp3ToMulaw(mp3Buffer);
      if (mulawBuffer && streamSid) {
        isSpeaking = true;
        for (let i = 0; i < mulawBuffer.length; i += CHUNK_BYTES) {
          sendMediaToTwilio(mulawBuffer.slice(i, i + CHUNK_BYTES).toString("base64"));
          await new Promise((r) => setTimeout(r, CHUNK_MS));
        }
        isSpeaking = false;
      }
    } catch (err) {
      console.error("Turn-based welcome TTS error:", err);
    }
  }

  twilioSocket.on("message", async (message) => {
    let data;
    try {
      data = JSON.parse(message.toString());
    } catch (e) {
      return;
    }

    if (data.event === "start") {
      streamSid = data.start && data.start.streamSid;
      if (callSid && to) {
        tenant = await getTenantByPhone(to);
        if (!tenant && from) tenant = await getTenantByPhone(from);
        if (tenant && callSid) {
          const call = await callsService.getCallByTwilioSid(callSid);
          if (call) {
            if (tenant.id && callSid) {
              recordingService.startRecording(callSid, tenant).catch((e) => console.error("Start recording error:", e));
            }
          }
        }
      }
      setImmediate(() => playWelcome());
      return;
    }

    if (data.event === "media" && data.media && data.media.payload) {
      audioBuffer.push(data.media.payload);
      lastChunkAt = Date.now();
      scheduleProcess();
      return;
    }

    if (data.event === "stop") {
      if (silenceTimer) clearTimeout(silenceTimer);
    }
  });

  twilioSocket.on("close", () => {
    if (silenceTimer) clearTimeout(silenceTimer);
  });
  twilioSocket.on("error", (err) => console.error("Turn-based Twilio socket error:", err));
}

module.exports = { handleTurnBasedStream };
