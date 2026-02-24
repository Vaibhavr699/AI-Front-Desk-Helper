"use strict";

const express = require("express");
const http = require("http");
const WebSocket = require("ws");

// -------------------- Config --------------------
const app = express();
app.use(express.urlencoded({ extended: false })); // Twilio sends form-encoded
app.use(express.json());

const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL; // ex: https://ai-front-desk-backend.onrender.com
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ZAPIER_WEBHOOK_URL = process.env.ZAPIER_WEBHOOK_URL; // optional

if (!BASE_URL) console.warn("⚠️ BASE_URL is missing (Render Env). Calls may fail.");
if (!OPENAI_API_KEY) console.warn("⚠️ OPENAI_API_KEY is missing (Render Env). AI will not speak.");

// In-memory call state (replace with DB later)
const callState = new Map(); // CallSid -> { lead, transcript, createdAt, pushedToZapier }

// Lead template
function emptyLead() {
  return {
    name: null,
    caller_phone: null,
    email: null,
    address: null,
    project_type: null,     // interior | exterior | both | null
    property_type: null,    // residential | commercial | null
    rooms_or_scope: null,
    square_footage: null,
    timeline: null,
    repairs_needed: null,
    decision_stage: null,
    estimate_requested: null,
    notes: null,
  };
}

// Basic server health check
app.get("/health", (req, res) => res.status(200).send("OK"));

// -------------------- Twilio: Entry (TwiML) --------------------
app.post("/twilio-voice", (req, res) => {
  const callSid = req.body.CallSid;
  const from = req.body.From;

  // Track call state
  if (callSid && !callState.has(callSid)) {
    callState.set(callSid, {
      lead: { ...emptyLead(), caller_phone: from || null },
      transcript: [],
      createdAt: Date.now(),
      pushedToZapier: false,
    });
  }

  // Build websocket URL
  const wsUrl = (BASE_URL || "").replace("https://", "wss://").replace("http://", "ws://") + "/twilio-media";

  res.type("text/xml").send(`
    <Response>
      <Say voice="Polly.Joanna">Connecting you now.</Say>
      <Connect>
        <Stream url="${wsUrl}" />
      </Connect>
    </Response>
  `);
});

// -------------------- Start Server (HTTP + WebSocket) --------------------
const server = http.createServer(app);

const wss = new WebSocket.Server({
  server,
  path: "/twilio-media",
});
wss.on("connection", (twilioSocket) => {
  console.log("✅ Twilio Media Stream connected");

  let streamSid = null;

  // Buffer any OpenAI audio that arrives before streamSid exists
  let pendingTwilioAudio = [];

  // OpenAI readiness + queue (prevents "readyState 0 (CONNECTING)" crashes)
  let openaiReady = false;
  const openaiQueue = [];

  // Connect to OpenAI Realtime
  const openaiSocket = new WebSocket(
    "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview",
    {
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "OpenAI-Beta": "realtime=v1",
      },
    }
  );

  function sendToOpenAI(obj) {
    const msg = JSON.stringify(obj);
    if (openaiReady && openaiSocket.readyState === WebSocket.OPEN) {
      openaiSocket.send(msg);
    } else {
      openaiQueue.push(msg);
    }
  }

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

  openaiSocket.on("open", () => {
    console.log("✅ Connected to OpenAI Realtime");
    openaiReady = true;

    // Flush queued sends
    while (openaiQueue.length) openaiSocket.send(openaiQueue.shift());

    // Configure session (Twilio media streams use g711_ulaw 8k)
    sendToOpenAI({
      type: "session.update",
      session: {
        input_audio_format: "g711_ulaw",
        output_audio_format: "g711_ulaw",
        voice: "verse",
        instructions: `You are the professional receptionist for Gladiators Painting.
Be warm, friendly, and concise. Ask one question at a time.
Do NOT mention AI.`,
      },
    });

  // OpenAI → Twilio (audio out)
  openaiSocket.on("message", (msg) => {
    try {
      const data = JSON.parse(msg.toString());

      if (data.type === "response.audio.delta" && data.delta) {
        sendAudioToTwilio(data.delta);
      }

      if (data.type && data.type.includes("error")) {
        console.error("OpenAI error event:", data);
      }
    } catch (err) {
      console.error("OpenAI parse error:", err);
    }
  });

  openaiSocket.on("error", (err) => console.error("OpenAI socket error:", err));
  openaiSocket.on("close", () => {
    console.log("⚠️ OpenAI socket closed");
    openaiReady = false;
  });

  // Twilio → OpenAI (audio in)
  twilioSocket.on("message", (message) => {
    try {
      const data = JSON.parse(message.toString());

      if (data.event === "start") {
        streamSid = data.start.streamSid;
        console.log("▶️ Stream started:", streamSid);

        // Flush any audio we buffered before streamSid existed
        if (pendingTwilioAudio.length) {
          for (const chunk of pendingTwilioAudio) sendAudioToTwilio(chunk);
          pendingTwilioAudio = [];
        }

        // ✅ THIS is your automatic warm welcome (fires right after start)
        sendToOpenAI({
          type: "response.create",
          response: {
            modalities: ["audio"],
            instructions:
              "Warmly say: Hi! Thanks for calling Gladiators Painting — how can I help you today?",
          },
        });

        return;
      }

      if (data.event === "media" && data.media?.payload) {
        sendToOpenAI({
          type: "input_audio_buffer.append",
          audio: data.media.payload,
        });
        return;
      }

      if (data.event === "stop") {
        console.log("⏹️ Stream stopped");
        try {
          openaiSocket.close();
        } catch {}
      }
    } catch (err) {
      console.error("Twilio parse error:", err);
    }
  });

  twilioSocket.on("close", () => {
    console.log("⚠️ Twilio socket closed");
    try {
      openaiSocket.close();
    } catch {}
  });

  twilioSocket.on("error", (err) => console.error("Twilio socket error:", err));
});

  // -------------------- Connect to OpenAI Realtime --------------------
  const openaiSocket = new WebSocket(
    "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview",
    {
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "OpenAI-Beta": "realtime=v1",
      },
    }
  );

  openaiSocket.on("open", () => {
    console.log("✅ Connected to OpenAI Realtime");
    openaiReady = true;

    // Flush any queued sends
    while (openaiQueue.length) openaiSocket.send(openaiQueue.shift());

    // Configure session (Twilio = g711_ulaw @ 8k)
    sendToOpenAI({
      type: "session.update",
      session: {
        input_audio_format: "g711_ulaw",
        output_audio_format: "g711_ulaw",
        voice: "verse",
        instructions: `You are the professional receptionist for Gladiators Painting.
Be warm, confident, and concise.
Ask one question at a time.
Start by saying: "Thanks for calling Gladiators Painting. How can I help you today?"
Then gather: name, phone, email, address, interior/exterior, scope, timeline, repairs.
Never mention AI.`,
      },
    });
  });

  openaiSocket.on("message", (msg) => {
    let data;
    try {
      data = JSON.parse(msg.toString());
    } catch (e) {
      console.error("OpenAI parse error:", e);
      return;
    }

    // Audio out from OpenAI -> Twilio
    if (data.type === "response.audio.delta" && data.delta) {
      sendAudioToTwilio(data.delta);
      return;
    }

    // Optional: log errors to debug quickly
    if (data.type && data.type.includes("error")) {
      console.error("OpenAI error event:", data);
    }
  });

  openaiSocket.on("close", () => {
    console.log("⚠️ OpenAI socket closed");
    openaiReady = false;
  });

  openaiSocket.on("error", (err) => {
    console.error("OpenAI socket error:", err);
  });

  // -------------------- Twilio -> OpenAI --------------------
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
      callSid = data.start.callSid || callSid;

      console.log("▶️ Stream started:", streamSid);

      // Flush any audio that arrived before streamSid
      if (pendingTwilioAudio.length) {
        for (const chunk of pendingTwilioAudio) sendAudioToTwilio(chunk);
        pendingTwilioAudio = [];
      }

      // Trigger greeting AFTER Twilio start (so audio won’t be dropped)
      sendToOpenAI({
        type: "response.create",
        response: { modalities: ["audio"] },
      });

      return;
    }

    if (data.event === "media" && data.media && data.media.payload) {
      // Forward caller audio to OpenAI (safe; queued if OpenAI not ready yet)
      sendToOpenAI({
        type: "input_audio_buffer.append",
        audio: data.media.payload,
      });
      return;
    }

    if (data.event === "stop") {
      console.log("⏹️ Stream stopped");
      try {
        openaiSocket.close();
      } catch {}
      return;
    }
  });

  twilioSocket.on("close", () => {
    console.log("⚠️ Twilio socket closed");
    try {
      openaiSocket.close();
    } catch {}
  });

  twilioSocket.on("error", (err) => {
    console.error("Twilio socket error:", err);
  });
});

// -------------------- Server listen --------------------
server.listen(PORT, () => {
  console.log(`Server running on ${PORT}`);
});
