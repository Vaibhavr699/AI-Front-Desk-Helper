"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const OpenAI = require("openai").default;
const { mulawChunksToWav, mp3ToMulaw } = require("../lib/audioUtils");
const bookingsService = require("../services/bookings");
const calendar = require("../calendar");

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const { getAIConfig } = require("../lib/orchestrator");


const SILENCE_MS = 1500;   // Process after this many ms with no new audio
const MIN_AUDIO_MS = 400;  // Ignore utterances shorter than this
const SAMPLE_RATE = 8000;
const BYTES_PER_MS = SAMPLE_RATE / 1000; // 8 bytes/ms for 8kHz mulaw
const CHUNK_MS = 160;      // Larger chunks to reduce jitter
const CHUNK_BYTES = Math.floor(BYTES_PER_MS * CHUNK_MS);

const openai = OPENAI_API_KEY ? new OpenAI() : null;

/**
 * Run the turn-based voice loop: buffer caller audio → Whisper → LLM → TTS → play back.
 * @param {import("ws").WebSocket} twilioSocket
 * @param {{ callSid?: string, from?: string, to?: string, isOutbound?: boolean }} parsed
 * @param {object} getTenantByPhone
 * @param {object} callsService
 * @param {object} recordingService
 */
function handleTurnBasedStream(twilioSocket, parsed, getTenantByPhone, callsService, recordingService) {
  const { callSid, from, to, isOutbound } = parsed;
  let streamSid = null;
  let tenant = null;
  let callId = null;
  const conversationMessages = [];
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

      // Use Orchestrator for Config
      const aiConfig = getAIConfig({
        tenant,
        isOutbound,
        format: "chat"
      });

      if (conversationMessages.length === 0) {
        conversationMessages.push({
          role: "system",
          content: aiConfig.instructions,
        });
      }
      conversationMessages.push({ role: "user", content: text });

      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: conversationMessages,
        tools: aiConfig.tools,
        max_tokens: 300,
      });
      let assistantMessage = completion.choices && completion.choices[0] && completion.choices[0].message;
      let reply = assistantMessage && assistantMessage.content ? assistantMessage.content.trim() : "";

      if (assistantMessage && assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
        const toolCall = assistantMessage.tool_calls.find((tc) => tc.function && tc.function.name === "book_appointment");
        if (toolCall && tenant && callId) {
          let args = {};
          try {
            args = typeof toolCall.function.arguments === "string"
              ? JSON.parse(toolCall.function.arguments)
              : toolCall.function.arguments || {};
          } catch (_) {}
          console.log("[AI-Desk] Turn-based book_appointment callId=%s tenantId=%s args_keys=%s", callId, tenant.id, Object.keys(args).join(","));
          try {
            const { booking, crmSynced } = await bookingsService.createBooking(tenant.id, callId, args);
            console.log("[AI-Desk] Turn-based booking done id=%s crmSynced=%s", booking.id, crmSynced);
            conversationMessages.push(assistantMessage);
            conversationMessages.push({
              role: "tool",
              tool_call_id: toolCall.id,
              content: JSON.stringify({ 
                success: true, 
                message: "Booking saved. Confirm the details (date/time) to the caller, then ASK if there is anything else you can help them with. Do NOT say goodbye yet. Wait for their response." 
              }),
            });
            const followUp = await openai.chat.completions.create({
              model: "gpt-4o-mini",
              messages: conversationMessages,
              max_tokens: 150,
            });
            const followUpMsg = followUp.choices && followUp.choices[0] && followUp.choices[0].message;
            reply = (followUpMsg && followUpMsg.content && followUpMsg.content.trim()) || "You're all set—your estimate is scheduled. You'll get a confirmation by text. Thank you for calling. Goodbye.";
            conversationMessages.push(followUpMsg || { role: "assistant", content: reply });
          } catch (err) {
            console.error("[AI-Desk] Turn-based createBooking failed callId=%s error=%s", callId, err.message);
            conversationMessages.push(assistantMessage);
            conversationMessages.push({
              role: "tool",
              tool_call_id: toolCall.id,
              content: JSON.stringify({ success: false, error: err.message }),
            });
            const followUp = await openai.chat.completions.create({
              model: "gpt-4o-mini",
              messages: conversationMessages,
              max_tokens: 100,
            });
            reply = (followUp.choices && followUp.choices[0] && followUp.choices[0].message && followUp.choices[0].message.content) || "Sorry, I had trouble saving that. Please try again or call back.";
          }
        } else if (toolCall) {
          if (!tenant || !callId) console.error("[AI-Desk] Turn-based book_appointment skipped tenant=%s callId=%s", !!tenant, !!callId);
          conversationMessages.push(assistantMessage);
          conversationMessages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: JSON.stringify({ success: false, error: "Missing context" }),
          });
          reply = reply || "I'm sorry, I couldn't complete that. Please try again.";
        }

        const availabilityCall = assistantMessage.tool_calls.find((tc) => tc.function && tc.function.name === "check_availability");
        if (availabilityCall && tenant) {
          let args = {};
          try {
            args = JSON.parse(availabilityCall.function.arguments);
          } catch (_) {}
          const av = await calendar.checkAvailability(args.appointment_date, args.appointment_time, tenant);
          conversationMessages.push(assistantMessage);
          conversationMessages.push({
            role: "tool",
            tool_call_id: availabilityCall.id,
            content: JSON.stringify({ 
              success: true, 
              available: av.available, 
              suggested_alternatives: av.suggestedTimes 
            }),
          });
          const followUp = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: conversationMessages,
            max_tokens: 150,
          });
          const followUpMsg = followUp.choices && followUp.choices[0] && followUp.choices[0].message;
          reply = (followUpMsg && followUpMsg.content) || (av.available ? "That time is available! Would you like me to book it for you?" : "I'm sorry, that time is taken. I have other openings at...");
          conversationMessages.push(followUpMsg || { role: "assistant", content: reply });
        }

        const hangUpCall = assistantMessage.tool_calls.find((tc) => tc.function && tc.function.name === "hang_up");
        if (hangUpCall) {
          console.log("[AI-Desk] Turn-based hang_up requested by AI callId=%s", callId);
          conversationMessages.push(assistantMessage);
          conversationMessages.push({
            role: "tool",
            tool_call_id: hangUpCall.id,
            content: JSON.stringify({ success: true, message: "Hanging up now." }),
          });
          reply = "Thank you for calling. Have a great day!";
          setTimeout(() => {
            if (twilioSocket.readyState === 1) {
              twilioSocket.close();
            }
          }, 4000); 
        }
      }

      if (!reply) {
        reply = "I didn't catch that. Could you repeat?";
      }
      if (assistantMessage && !assistantMessage.tool_calls) {
        conversationMessages.push(assistantMessage);
      }

      const ttsModel = process.env.OPENAI_TTS_MODEL || "tts-1-hd";
      const ttsVoice = process.env.OPENAI_TTS_VOICE || "nova";
      const speech = await openai.audio.speech.create({
        model: aiConfig.voice === "ash" ? "tts-1-hd" : ttsModel, // Adjust based on voice if possible
        voice: aiConfig.voice === "ash" ? "onyx" : ttsVoice,
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

    const aiConfig = getAIConfig({
      tenant,
      isOutbound
    });

    let welcome = isOutbound
      ? (tenant.outbound_welcome_message || `Hi, this is ${tenant.outbound_agent_name || 'Alex'} from ${tenant.company_name}. I'm calling to follow up on your request.`)
      : (tenant.welcome_message || `Hi, thanks for calling ${tenant.company_name}. How can I help you today?`);
    try {
      const ttsModel = process.env.OPENAI_TTS_MODEL || "tts-1-hd";
      const ttsVoice = process.env.OPENAI_TTS_VOICE || "nova";
      const speech = await openai.audio.speech.create({
        model: aiConfig.voice === "ash" ? "tts-1-hd" : ttsModel,
        voice: aiConfig.voice === "ash" ? "onyx" : ttsVoice,
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
      console.log("[AI-Desk] Turn-based stream start callSid=%s from=%s to=%s", callSid, from, to);
      if (callSid && to) {
        tenant = await getTenantByPhone(to);
        if (!tenant && from) tenant = await getTenantByPhone(from);
        if (tenant && callSid) {
          const call = await callsService.getCallByTwilioSid(callSid);
          if (call) {
            callId = call.id;
            console.log("[AI-Desk] Turn-based callId resolved callId=%s tenantId=%s", callId, tenant.id);
            if (tenant.id && callSid) {
              recordingService.startRecording(callSid, tenant).catch((e) => console.error("Start recording error:", e));
            }
          } else {
            console.log("[AI-Desk] Turn-based no call row yet for callSid=%s (callId will be null)", callSid);
          }
        } else {
          if (!tenant) console.log("[AI-Desk] Turn-based no tenant for to=%s from=%s", to, from);
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
