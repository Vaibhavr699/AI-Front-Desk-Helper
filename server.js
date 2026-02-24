"use strict";

const express = require("express");
const http = require("http");
const WebSocket = require("ws");

// -------------------- App --------------------
const app = express();
app.use(express.urlencoded({ extended: false })); // Twilio sends form-encoded
app.use(express.json());

const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL; // e.g. https://ai-front-desk-backend.onrender.com
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

app.get("/health", (req, res) => res.status(200).send("OK"));

// -------------------- Twilio Voice Entry --------------------
app.post("/twilio-voice", (req, res) => {
  if (!BASE_URL) {
    console.error("❌ BASE_URL missing. Set it in Render env vars.");
  }

  // Twilio needs wss:// in production
  const wsUrl =
    (BASE_URL || "")
      .replace("https://", "wss://")
      .replace("http://", "ws://") + "/twilio-media";

  res.type("text/xml").send(`
  <Response>
    <Say voice="Polly.Joanna">Connecting you now.</Say>
    <Connect>
      <Stream url="${wsUrl}" />
    </Connect>
  </Response>
`); 
});

// -------------------- HTTP + WebSocket Server --------------------
const server = http.createServer(app);

const wss = new WebSocket.Server({
  server,
  path: "/twilio-media",
});

wss.on("connection", (twilioSocket) => {
  console.log("✅ Twilio Media Stream connected");

  let streamSid = null;

  // Buffer OpenAI audio until Twilio start arrives (streamSid exists)
  let pendingTwilioAudio = [];

  // OpenAI readiness + queue (prevents readyState 0 CONNECTING crash)
  let openaiReady = false;
  const openaiQueue = [];

  if (!OPENAI_API_KEY) {
    console.error("❌ Missing OPENAI_API_KEY env var. Closing stream.");
    try { twilioSocket.close(); } catch {}
    return;
  }

  // -------------------- OpenAI Realtime Socket --------------------
  const openaiSocket = new WebSocket(
    "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview",
    {
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "OpenAI-Beta": "realtime=v1",
      },
    }
  );

  // Helper: safe send to OpenAI
  function sendToOpenAI(obj) {
    const msg = JSON.stringify(obj);
    if (openaiReady && openaiSocket.readyState === WebSocket.OPEN) {
      openaiSocket.send(msg);
    } else {
      openaiQueue.push(msg);
    }
  }

  // Helper: send audio back to Twilio
  function sendAudioToTwilio(base64UlawChunk) {
    if (!streamSid) {
      pendingTwilioAudio.push(base64UlawChunk);
      return;
    }
    twilioSocket.send(
      JSON.stringify({
        event: "media",
        streamSid,
        media: { payload: base64UlawChunk },
      })
    );
  }

  // -------------------- OpenAI lifecycle --------------------
  openaiSocket.on("open", () => {
    console.log("✅ Connected to OpenAI Realtime");
    openaiReady = true;

    // Flush queued sends
    while (openaiQueue.length) openaiSocket.send(openaiQueue.shift());

    // Session config MUST match Twilio Media Streams (g711_ulaw @ 8k)
   sendToOpenAI({
  type: "session.update",
  session: {
    audio: {
      input: { format: "g711_ulaw" },
      output: { format: "g711_ulaw" }
    },
    turn_detection: { type: "server_vad" },
    voice: "verse",
instructions:
  "You are the professional receptionist for Gladiators Painting.\n\n" +
  "Personality:\n" +
  "- Warm, confident, human, and helpful.\n" +
  "- 1–2 sentences at a time.\n" +
  "- Ask ONE question at a time.\n" +
  "- Never mention AI, system, tools, or JSON.\n\n" +
  "Business goals:\n" +
  "- Capture: name, phone, address/city, interior or exterior, scope, and timeline.\n" +
  "- Offer a FREE on-site estimate.\n" +
  "- If asked about pricing, give a helpful range and pivot to booking an estimate.\n\n" +
  "Conversation rules:\n" +
  "- If caller is in a hurry: grab best contact + quick summary, then confirm next steps.\n" +
  "- Keep it friendly and brief.\n\n" +
  "Speak ONLY English.\n",
      },
    });

  openaiSocket.on("message", (msg) => {
    let data;
    try {
      data = JSON.parse(msg.toString());
    } catch (e) {
      console.error("OpenAI parse error:", e);
      return;
    }

    // AUDIO OUT: OpenAI -> Twilio
   // Handle both possible OpenAI audio delta event types
if (
  (data.type === "response.audio.delta" ||
   data.type === "response.output_audio.delta") &&
  data.delta
) {
  sendAudioToTwilio(data.delta);
  return;
}

    // Helpful error visibility
    if (data.type && data.type.includes("error")) {
      console.error("OpenAI error event:", data);
    }
  });

  openaiSocket.on("error", (err) => console.error("OpenAI socket error:", err));
  openaiSocket.on("close", () => {
    console.log("⚠️ OpenAI socket closed");
    openaiReady = false;
  });

  // -------------------- Twilio -> OpenAI (audio in) --------------------
  twilioSocket.on("message", (message) => {
    let data;
    try {
      data = JSON.parse(message.toString());
    } catch (e) {
      console.error("Twilio parse error:", e);
      return;
    }

    if (data.event === "start") {
      streamSid = data.start.streamSid;
      console.log("▶️ Stream started:", streamSid);

      // Flush any buffered audio that arrived before streamSid existed
      if (pendingTwilioAudio.length) {
        for (const chunk of pendingTwilioAudio) sendAudioToTwilio(chunk);
        pendingTwilioAudio = [];
      }

sendToOpenAI({
  type: "response.create",
  response: {
    modalities: ["audio", "text"],
    instructions:
      "Speak ONLY English.\n\n" +
      "Say exactly (warm + confident):\n" +
      "\"Thanks for calling Gladiators Painting — we specialize in high-quality interior and exterior painting. What can we help you with today? Would you like to schedule a free on-site estimate?\"\n\n" +
      "Then stop and wait for their answer."
  }
});

      return;
    }

    if (data.event === "media" && data.media?.payload) {
      // AUDIO IN: Twilio -> OpenAI
      sendToOpenAI({
        type: "input_audio_buffer.append",
        audio: data.media.payload,
      });
      return;
    }

    if (data.event === "stop") {
      console.log("⏹️ Stream stopped");
      try { openaiSocket.close(); } catch {}
      return;
    }
  });

  twilioSocket.on("close", () => {
    console.log("⚠️ Twilio socket closed");
    try { openaiSocket.close(); } catch {}
  });

  twilioSocket.on("error", (err) => console.error("Twilio socket error:", err));
});

// -------------------- Listen --------------------
server.listen(PORT, () => {
  console.log(`Server running on ${PORT}`);
});
