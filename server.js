"use strict";

require("dotenv").config();

const crypto = require("crypto");
const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const fetch = require("node-fetch");
const { Pool } = require("pg");

// ================= CONFIG =================
const PORT = Number(process.env.PORT || 3000);
const BASE_URL = process.env.BASE_URL || "";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-realtime-preview-2024-12-17";

const REQUIRED_ENV_VARS = [
  "BASE_URL",
  "OPENAI_API_KEY",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_PHONE_NUMBER",
  "DATABASE_URL"
];

const missingEnv = REQUIRED_ENV_VARS.filter((key) => !process.env[key]);
if (missingEnv.length) {
  console.warn(`⚠️ Missing env vars: ${missingEnv.join(", ")}`);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ================= TENANTS =================
const TENANTS = {
  gladiators: {
    name: "Gladiators Painting",
    transferNumber: "+14022907925",
    notifySms: "+14022907925",
    businessHours: { start: 8, end: 17 }, // 8am–5pm local server time
    voice: "verse",
    instructions: [
      "You are the professional receptionist for Gladiators Painting.",
      "Warm and confident tone.",
      "Ask ONE question at a time.",
      "Capture: full name, phone, address, service type, and timeline.",
      "You are the receptionist for Gladiators Painting.",
      "Use a warm, concise, professional tone.",
      "Ask one question at a time.",
      "Collect name, phone, address, requested service, and timeline.",
      "Offer a free estimate.",
      "If the caller asks for a human, explain you can transfer after a few qualification questions.",
      "Never mention AI.",
      "Speak ONLY English."
      "Never mention AI."
    ].join("\n")
  }
};

// -------------------- App --------------------
// ================= EXPRESS =================
const app = express();
app.use(express.urlencoded({ extended: false })); // Twilio sends form-encoded
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL; // e.g. https://your-app.onrender.com
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
app.get("/health", (_, res) => res.status(200).send("OK"));

// ================= HELPERS =================
function isBusinessHours(tenant) {
  const now = new Date();
  const hour = now.getHours();
  return hour >= tenant.businessHours.start && hour < tenant.businessHours.end;
}

function buildTwilioAuthHeader() {
  return (
    "Basic " +
    Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64")
  );
}

function buildTenantWsUrl(tenantId) {
  return (
    process.env.BASE_URL.replace("https://", "wss://").replace("http://", "ws://") +
    `/twilio-media/${tenantId}`
  );
}

async function safePoolQuery(query, values) {
  if (!process.env.DATABASE_URL) return;

app.get("/health", (req, res) => res.status(200).send("OK"));
  try {
    await pool.query(query, values);
  } catch (error) {
    console.error("DB query failed:", error.message);
  }
}
app.get("/health", (_req, res) => {
  res.status(200).send("OK");
});

// -------------------- Twilio Voice Entry --------------------
app.post("/twilio-voice", (req, res) => {
  if (!BASE_URL) console.error("❌ BASE_URL missing. Set it in Render env vars.");
// ================= TWILIO ENTRY =================
app.post("/twilio-voice/:tenantId", (req, res) => {
  const tenant = TENANTS[req.params.tenantId];
  if (!tenant) {
    return res.status(404).send("Unknown tenant");
  }

  // Twilio needs wss:// in production
  if (!BASE_URL) {
    return res.status(500).send("BASE_URL is not configured");
  }

  const wsUrl =
    (BASE_URL || "")
      .replace("https://", "wss://")
      .replace("http://", "ws://") + "/twilio-media";
  const wsUrl = buildTenantWsUrl(req.params.tenantId);
    BASE_URL.replace("https://", "wss://").replace("http://", "ws://") +
    `/twilio-media/${req.params.tenantId}`;

  res.type("text/xml").send(`
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">Connecting you now.</Say>
  <Say voice="Polly.Joanna">Thanks for calling ${tenant.name}. Connecting you now.</Say>
  <Connect>
    <Stream url="${wsUrl}" />
  </Connect>
</Response>
`);
</Response>`;

  res.type("text/xml").send(twiml);
});

// -------------------- HTTP + WebSocket Server --------------------
// ================= SERVER =================
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: "/twilio-media" });
const wss = new WebSocket.Server({ server });

wss.on("connection", (twilioSocket) => {
  console.log("✅ Twilio Media Stream connected");
wss.on("connection", (twilioSocket, req) => {
  const tenantId = (req.url || "").split("/").pop();
  const tenant = TENANTS[tenantId];

  let streamSid = null;
  let openaiReady = false;
  const openaiQueue = [];

  // Buffer OpenAI audio until Twilio start arrives (streamSid exists)
  let pendingTwilioAudio = [];
  if (!tenant) {
    twilioSocket.close();
    return;
  }

  if (!OPENAI_API_KEY) {
    console.error("❌ Missing OPENAI_API_KEY env var. Closing stream.");
    try { twilioSocket.close(); } catch {}
  if (!tenant) {
    console.error("Missing OPENAI_API_KEY");
    twilioSocket.close();
    return;
  }

  // -------------------- OpenAI Realtime Socket --------------------
  let streamSid = null;
  const pendingAudio = [];

  const openaiSocket = new WebSocket(
    "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview",
    `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(OPENAI_MODEL)}`,
    {
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "OpenAI-Beta": "realtime=v1",
      },
  const callId = crypto.randomUUID();
  let callSid;
  let streamSid;
  let transcript = "";
  const startTime = Date.now();
  let qualificationComplete = false;
  let transferAttempted = false;

  const openaiSocket = new WebSocket(`wss://api.openai.com/v1/realtime?model=${OPENAI_MODEL}`, {
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "OpenAI-Beta": "realtime=v1"
        "OpenAI-Beta": "realtime=v1"
      }
    }
  );
  });

  // Helper: safe send to OpenAI (prevents double-stringify)
  function sendToOpenAI(payload) {
    const msg = typeof payload === "string" ? payload : JSON.stringify(payload);
    if (openaiReady && openaiSocket.readyState === WebSocket.OPEN) {
      openaiSocket.send(msg);
    } else {
      openaiQueue.push(msg);
    if (openaiSocket.readyState === WebSocket.OPEN) {
      openaiSocket.send(JSON.stringify(payload));
    }
  }

  // Helper: send audio back to Twilio
  function sendAudioToTwilio(base64UlawChunk) {
    if (!streamSid) {
      pendingTwilioAudio.push(base64UlawChunk);
      return;
    }
  function sendAudioToTwilio(base64Audio) {
    if (!streamSid || twilioSocket.readyState !== WebSocket.OPEN) return;

    twilioSocket.send(
  openaiSocket.on("open", () => {
    openaiSocket.send(
      JSON.stringify({
        event: "media",
        streamSid,
        media: { payload: base64UlawChunk },
        media: { payload: base64Audio }
        type: "session.update",
        session: {
          voice: tenant.voice,
          input_audio_format: "g711_ulaw",
          output_audio_format: "g711_ulaw",
          modalities: ["audio", "text"],
          instructions: tenant.instructions
        }
      })
    );
  }

  // -------------------- OpenAI lifecycle --------------------
  openaiSocket.on("open", () => {
    console.log("✅ Connected to OpenAI Realtime");
    openaiReady = true;

    while (openaiQueue.length) openaiSocket.send(openaiQueue.shift());

    // IMPORTANT: force Twilio-compatible audio (mulaw 8k)
 sendToOpenAI({
  type: "response.create",
  response: {
    modalities: ["audio", "text"],
    instructions:
      "Speak ONLY English.\n\n" +
      "Say exactly (warm + confident):\n" +
      "\"Thanks for calling Gladiators Painting — we specialize in high-quality interior and exterior painting. What can we help you with today? Would you like to schedule a free on-site estimate?\"\n\n" +
      "Then stop and wait for their answer."
  async function sendSMS(message) {
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: buildTwilioAuthHeader(),
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body:
          `From=${encodeURIComponent(process.env.TWILIO_PHONE_NUMBER)}` +
          `&To=${encodeURIComponent(tenant.notifySms)}` +
          `&Body=${encodeURIComponent(message)}`
      }
    );

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Twilio SMS failed (${response.status}): ${errorBody}`);
    }
  }
});

  async function warmTransfer() {
    if (transferAttempted || !callSid) return;
    transferAttempted = true;

    if (!isBusinessHours(tenant)) {
      console.log("Outside business hours. Transfer skipped.");
      return;
    }

    await sendSMS(`Incoming qualified lead for ${tenant.name}. Call ID: ${callId}`);

    const twiml = `
<Response>
  <Say>Please hold while I connect you to our team.</Say>
  <Dial>${tenant.transferNumber}</Dial>
</Response>`;

    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Calls/${callSid}.json`,
      {
        method: "POST",
        headers: {
          Authorization: buildTwilioAuthHeader(),
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: `Twiml=${encodeURIComponent(twiml)}`
      }
    openaiSocket.send(
      JSON.stringify({
        type: "response.create",
        response: {
          modalities: ["audio", "text"],
          instructions: "Greet the caller and ask how you can help today."
        }
      })
    );

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Warm transfer failed (${response.status}): ${errorBody}`);
    }
  }

  openaiSocket.on("open", () => {
    sendToOpenAI({
      type: "session.update",
      session: {
        audio: {
          input: { format: "g711_ulaw" },
          output: { format: "g711_ulaw" }
        },
        turn_detection: { type: "server_vad" },
        voice: tenant.voice,
        instructions: tenant.instructions
      }
    });
  });

  openaiSocket.on("message", (msg) => {
  openaiSocket.on("message", async (msg) => {
    let data;
  openaiSocket.on("message", (raw) => {
    try {
      data = JSON.parse(msg.toString());
    } catch (e) {
      console.error("OpenAI parse error:", e);
    } catch {
      return;
    }

    // ---- AUDIO OUT: OpenAI -> Twilio ----
    // Handle both common audio delta event names.
    if (
      (data.type === "response.output_audio.delta" ||
        data.type === "response.audio.delta") &&
      data.delta
    ) {
    if ((data.type === "response.audio.delta" || data.type === "response.output_audio.delta") && data.delta) {
      sendAudioToTwilio(data.delta);
      return;
    }

    // ---- AUTO-RESPOND after caller speech stops ----
    // With server_vad, OpenAI emits speech start/stop events; on stop we ask it to respond.
    if (data.type === "response.output_text.delta" && data.delta) {
      transcript += data.delta;

      const lowerTranscript = transcript.toLowerCase();
      if (
        lowerTranscript.includes("human") ||
        lowerTranscript.includes("representative") ||
        lowerTranscript.includes("person")
      ) {
        qualificationComplete = true;
      }
      return;
    }
      const msg = JSON.parse(raw.toString());

    if (data.type === "input_audio_buffer.speech_stopped") {
      sendToOpenAI({
        type: "response.create",
        response: {
          modalities: ["audio", "text"],
          // EXTRA SAFETY: force mulaw per response to prevent static
          audio: { output: { format: "g711_ulaw" } },
          instructions:
            "Speak ONLY English.\n" +
            "Be warm and concise. Continue the conversation and ask ONE question to move the booking forward.",
        },
          audio: { output: { format: "g711_ulaw" } }
      if (msg.type === "response.audio.delta" && msg.delta) {
        if (!streamSid) {
          pendingAudio.push(msg.delta);
          return;
        }
      });
      return;
    }

    // Helpful error visibility
    if (data.type === "error" || (data.type && data.type.includes("error"))) {
      console.error("OpenAI error event:", data);
    if (data.type === "response.completed") {
      try {
        if (qualificationComplete) {
          await warmTransfer();
        }
      } catch (error) {
        console.error("Transfer flow failed:", error.message);
        twilioSocket.send(
          JSON.stringify({
            event: "media",
            streamSid,
            media: { payload: msg.delta }
          })
        );
      }

      const durationMinutes = (Date.now() - startTime) / 60000;
      await safePoolQuery(
        "INSERT INTO calls (id, tenant_id, transcript, duration_minutes) VALUES ($1, $2, $3, $4)",
        [callId, tenantId, transcript, durationMinutes]
      );
    } catch (err) {
      console.error("OpenAI message parse error:", err.message);
    }
  });

  openaiSocket.on("error", (err) => console.error("OpenAI socket error:", err));
  openaiSocket.on("close", () => {
    console.log("⚠️ OpenAI socket closed");
    openaiReady = false;
  openaiSocket.on("error", (error) => {
    console.error("OpenAI socket error:", error.message);
  });

  // -------------------- Twilio -> OpenAI (audio in) --------------------
  twilioSocket.on("message", (message) => {
  twilioSocket.on("message", (rawMessage) => {
    let data;
    try {
      data = JSON.parse(message.toString());
    } catch (e) {
      console.error("Twilio parse error:", e);
      data = JSON.parse(rawMessage.toString());
    } catch {
      return;
    if (twilioSocket.readyState === WebSocket.OPEN) {
      twilioSocket.close();
    }
  });

    if (data.event === "start") {
      streamSid = data.start.streamSid;
      console.log("▶️ Stream started:", streamSid);

      // Flush any buffered OpenAI audio that arrived before streamSid existed
      if (pendingTwilioAudio.length) {
        for (const chunk of pendingTwilioAudio) sendAudioToTwilio(chunk);
        pendingTwilioAudio = [];
      }
      streamSid = data.start?.streamSid;
      callSid = data.start?.callSid;
  openaiSocket.on("error", (err) => {
    console.error("OpenAI socket error:", err.message);
  });

      // GREETING (force mulaw per response)
      sendToOpenAI({
        type: "response.create",
        response: {
          modalities: ["audio", "text"],
          modalities: ["audio"],
          audio: { output: { format: "g711_ulaw" } },
          instructions:
            "Speak ONLY English.\n\n" +
            "Say exactly (warm + confident):\n" +
            "\"Thanks for calling Gladiators Painting — we specialize in high-quality interior and exterior painting. What can we help you with today? Would you like to schedule a free on-site estimate?\"\n\n" +
            "Then stop and wait for their answer.",
        },
          instructions: `Say: "Thanks for calling ${tenant.name}. How can we help today?"`
  twilioSocket.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString());

      if (msg.event === "start") {
        streamSid = msg.start?.streamSid || null;

        while (pendingAudio.length && twilioSocket.readyState === WebSocket.OPEN && streamSid) {
          const chunk = pendingAudio.shift();
          twilioSocket.send(
            JSON.stringify({
              event: "media",
              streamSid,
              media: { payload: chunk }
            })
          );
        }
      });

      return;
    }
        return;
      }

    if (data.event === "media" && data.media?.payload) {
      // AUDIO IN: Twilio -> OpenAI
      sendToOpenAI({
        type: "input_audio_buffer.append",
        audio: data.media.payload,
        audio: data.media.payload
      });
      return;
    }
      if (msg.event === "media" && msg.media?.payload && openaiSocket.readyState === WebSocket.OPEN) {
        openaiSocket.send(
          JSON.stringify({
            type: "input_audio_buffer.append",
            audio: msg.media.payload
          })
        );
      }

    if (data.event === "stop") {
      console.log("⏹️ Stream stopped");
      try { openaiSocket.close(); } catch {}
      return;
      sendToOpenAI({ type: "input_audio_buffer.commit" });
      if (msg.event === "stop" && openaiSocket.readyState === WebSocket.OPEN) {
        openaiSocket.close();
      }
    } catch (err) {
      console.error("Twilio message parse error:", err.message);
    }
  });

  twilioSocket.on("close", () => {
    console.log("⚠️ Twilio socket closed");
    try { openaiSocket.close(); } catch {}
    if (openaiSocket.readyState === WebSocket.OPEN) {
      openaiSocket.close();
    }
  });

  twilioSocket.on("error", (err) => console.error("Twilio socket error:", err));
  twilioSocket.on("error", (err) => {
    console.error("Twilio socket error:", err.message);
  });
});

// -------------------- Listen --------------------
server.listen(PORT, () => {
  console.log(`Server running on ${PORT}`);
  console.log(`🚀 Enterprise AI Front Desk running on port ${PORT}`);
  console.log(`AI front desk backend listening on port ${PORT}`);
});
