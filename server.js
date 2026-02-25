"use strict";

require("dotenv").config();

const crypto = require("crypto");
const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const fetch = require("node-fetch");
const { Pool } = require("pg");

const PORT = Number(process.env.PORT || 3000);
const BASE_URL = process.env.BASE_URL || "";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-realtime-preview-2024-12-17";

const REQUIRED_ENV_VARS = ["OPENAI_API_KEY", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"];

const missingEnv = REQUIRED_ENV_VARS.filter((key) => !process.env[key]);
if (missingEnv.length) {
  console.warn(`⚠️ Missing required env vars: ${missingEnv.join(", ")}`);
}

if (!process.env.BASE_URL) {
  console.warn("⚠️ BASE_URL not set; deriving URL from incoming request headers.");
}

const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    })
  : null;

const TENANTS = {
  gladiators: {
    name: "Gladiators Painting",
    transferNumber: "+14022907925",
    businessHours: { start: 8, end: 17 },
    voice: "verse",
    instructions: [
      "You are the professional receptionist for Gladiators Painting.",
      "Use a warm, concise, professional tone.",
      "Ask one question at a time.",
      "Collect name, phone, address, requested service, and timeline.",
      "Offer a free estimate.",
      "If the caller asks for a human, explain you can transfer after a few qualification questions.",
      "Never mention AI.",
      "Speak only English."
    ].join("\n")
  }
};

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

app.get("/", (_req, res) => {
  res.status(200).send("AI front desk backend is running");
});

app.get("/health", (_req, res) => {
  res.status(200).send("OK");
});

function isBusinessHours(tenant) {
  const hour = new Date().getHours();
  return hour >= tenant.businessHours.start && hour < tenant.businessHours.end;
}

function toWebSocketBaseUrl(baseUrl) {
  return baseUrl.replace("https://", "wss://").replace("http://", "ws://");
}

function resolveBaseUrl(req) {
  if (BASE_URL) return BASE_URL;
  const forwardedProto = req.get("x-forwarded-proto");
  const proto = (forwardedProto || req.protocol || "https").split(",")[0].trim();
  const host = req.get("x-forwarded-host") || req.get("host");
  if (!host) return "";
  return `${proto}://${host}`;
}

function buildTenantWsUrl(baseUrl, tenantId) {
  return `${toWebSocketBaseUrl(baseUrl)}/twilio-media/${tenantId}`;
}

function buildFallbackTwiml(message) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>${message}</Say>
  <Hangup/>
</Response>`;
}

function buildTwilioAuthHeader() {
  const sid = process.env.TWILIO_ACCOUNT_SID || "";
  const token = process.env.TWILIO_AUTH_TOKEN || "";
  return `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`;
}

async function safePoolQuery(query, values) {
  if (!pool) return;
  try {
    await pool.query(query, values);
  } catch (error) {
    console.error("DB query failed:", error.message);
  }
}

async function attemptTransfer(callSid, tenant) {
  if (!callSid || !tenant.transferNumber) return false;

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls/${callSid}.json`;
  const twiml = `<Response><Dial>${tenant.transferNumber}</Dial></Response>`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: buildTwilioAuthHeader(),
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({ Twiml: twiml }).toString()
  });

  if (!response.ok) {
    const body = await response.text();
    console.error("Twilio transfer failed:", response.status, body);
    return false;
  }

  return true;
}

function handleTwilioVoice(req, res, tenantId) {
  const resolvedTenantId = TENANTS[tenantId] ? tenantId : "gladiators";
  const tenant = TENANTS[resolvedTenantId];

  if (!OPENAI_API_KEY) {
    const fallbackTwiml = buildFallbackTwiml(
      "We are temporarily unable to connect your call. Please try again shortly."
    );
    res.type("text/xml").send(fallbackTwiml);
    return;
  }

  const requestBaseUrl = resolveBaseUrl(req);
  if (!requestBaseUrl) {
    const fallbackTwiml = buildFallbackTwiml(
      "We are temporarily unable to connect your call. Please call again in a few minutes."
    );
    res.type("text/xml").send(fallbackTwiml);
    return;
  }

  const wsUrl = buildTenantWsUrl(requestBaseUrl, resolvedTenantId);
  const greetingPrefix = isBusinessHours(tenant) ? "Thanks for calling." : "Thanks for calling after hours.";

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>${greetingPrefix} ${tenant.name} will assist you now.</Say>
  <Connect>
    <Stream url="${wsUrl}" />
  </Connect>
</Response>`;

  res.type("text/xml").send(twiml);
}

app.all(["/twilio-voice", "/twilio-voice/"], (req, res) => {
  handleTwilioVoice(req, res, "gladiators");
});

app.all(["/twilio-voice/:tenantId", "/twilio-voice/:tenantId/"], (req, res) => {
  const { tenantId } = req.params;
  handleTwilioVoice(req, res, tenantId);
});

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

wss.on("connection", (twilioSocket, req) => {
  const rawUrl = req.url || "";
  const parsedUrl = new URL(rawUrl, "http://localhost");
  const pathname = parsedUrl.pathname || "";
  const pathSegments = pathname.split("/").filter(Boolean);
  const tenantIdFromPath = pathSegments.length >= 2 ? pathSegments[1] : "";
  const tenantId = TENANTS[tenantIdFromPath] ? tenantIdFromPath : "gladiators";
  const tenant = TENANTS[tenantId];

  if (!pathname.startsWith("/twilio-media/")) {
    console.error("Invalid Twilio media stream path:", pathname);
    twilioSocket.close();
    return;
  }

  if (!OPENAI_API_KEY) {
    console.error("❌ Missing OPENAI_API_KEY env var. Closing stream.");
    twilioSocket.close();
    return;
  }

  const callId = crypto.randomUUID();
  let callSid = null;
  let streamSid = null;
  let transcript = "";
  let transferAttempted = false;

  const pendingTwilioAudio = [];
  const openaiQueue = [];
  let openaiReady = false;

  const openaiSocket = new WebSocket(
    `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(OPENAI_MODEL)}`,
    {
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "OpenAI-Beta": "realtime=v1"
      }
    }
  );

  function sendToOpenAI(payload) {
    const message = typeof payload === "string" ? payload : JSON.stringify(payload);
    if (openaiReady && openaiSocket.readyState === WebSocket.OPEN) {
      openaiSocket.send(message);
      return;
    }
    openaiQueue.push(message);
  }

  function sendAudioToTwilio(base64Audio) {
    if (!streamSid || twilioSocket.readyState !== WebSocket.OPEN) {
      pendingTwilioAudio.push(base64Audio);
      return;
    }

    twilioSocket.send(
      JSON.stringify({
        event: "media",
        streamSid,
        media: { payload: base64Audio }
      })
    );
  }

  openaiSocket.on("open", () => {
    openaiReady = true;

    sendToOpenAI({
      type: "session.update",
      session: {
        voice: tenant.voice,
        instructions: tenant.instructions,
        modalities: ["audio", "text"],
        input_audio_format: "g711_ulaw",
        output_audio_format: "g711_ulaw",
        input_audio_transcription: { model: "gpt-4o-mini-transcribe" },
        turn_detection: { type: "server_vad" }
      }
    });

    while (openaiQueue.length && openaiSocket.readyState === WebSocket.OPEN) {
      openaiSocket.send(openaiQueue.shift());
    }
  });

  openaiSocket.on("message", async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if ((msg.type === "response.audio.delta" || msg.type === "response.output_audio.delta") && msg.delta) {
      sendAudioToTwilio(msg.delta);
      return;
    }

    if (msg.type === "response.output_text.delta" && msg.delta) {
      transcript += msg.delta;
      return;
    }

    if (msg.type === "conversation.item.input_audio_transcription.completed" && msg.transcript) {
      transcript += `\nCALLER: ${msg.transcript}`;
      return;
    }

    if (msg.type === "input_audio_buffer.speech_stopped") {
      sendToOpenAI({
        type: "response.create",
        response: {
          modalities: ["audio", "text"],
          audio: { output: { format: "g711_ulaw" } },
          instructions: "Speak only English. Be warm and concise. Ask one follow-up question."
        }
      });
      return;
    }

    if (msg.type === "response.completed") {
      const callerAskedHuman = /human|person|representative|manager|transfer/i.test(transcript);
      if (callerAskedHuman && !transferAttempted && isBusinessHours(tenant)) {
        transferAttempted = true;
        await attemptTransfer(callSid, tenant);
      }

      await safePoolQuery(
        `UPDATE calls
         SET transcript = $2,
             duration_minutes = EXTRACT(EPOCH FROM (now() - started_at)) / 60
         WHERE id = $1`,
        [callId, transcript]
      );
      return;
    }

    if (msg.type === "error" || (msg.type && msg.type.includes("error"))) {
      console.error("OpenAI error event:", msg);
    }
  });

  openaiSocket.on("error", (error) => {
    console.error("OpenAI socket error:", error.message);
  });

  openaiSocket.on("close", () => {
    openaiReady = false;
    if (twilioSocket.readyState === WebSocket.OPEN) {
      twilioSocket.close();
    }
  });

  twilioSocket.on("message", async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.event === "start") {
      streamSid = msg.start?.streamSid || null;
      callSid = msg.start?.callSid || null;

      while (pendingTwilioAudio.length && streamSid && twilioSocket.readyState === WebSocket.OPEN) {
        const chunk = pendingTwilioAudio.shift();
        twilioSocket.send(
          JSON.stringify({
            event: "media",
            streamSid,
            media: { payload: chunk }
          })
        );
      }

      sendToOpenAI({
        type: "response.create",
        response: {
          modalities: ["audio", "text"],
          audio: { output: { format: "g711_ulaw" } },
          instructions: `Say exactly: \"Thanks for calling ${tenant.name}. We specialize in high-quality interior and exterior painting. What can we help you with today?\"`
        }
      });

      await safePoolQuery(
        `INSERT INTO calls (id, tenant_id, call_sid, started_at, status)
         VALUES ($1, $2, $3, now(), $4)
         ON CONFLICT (id) DO NOTHING`,
        [callId, tenantId, callSid, "in_progress"]
      );
      return;
    }

    if (msg.event === "media" && msg.media?.payload) {
      sendToOpenAI({ type: "input_audio_buffer.append", audio: msg.media.payload });
      return;
    }

    if (msg.event === "stop") {
      if (openaiSocket.readyState === WebSocket.OPEN) {
        openaiSocket.close();
      }

      await safePoolQuery(
        `UPDATE calls
         SET ended_at = now(),
             status = $2,
             transcript = $3,
             duration_minutes = EXTRACT(EPOCH FROM (now() - started_at)) / 60
         WHERE id = $1`,
        [callId, transferAttempted ? "transferred" : "completed", transcript]
      );
    }
  });

  twilioSocket.on("close", () => {
    if (openaiSocket.readyState === WebSocket.OPEN) {
      openaiSocket.close();
    }
  });

  twilioSocket.on("error", (error) => {
    console.error("Twilio socket error:", error.message);
  });
});

server.listen(PORT, () => {
  console.log(`AI front desk backend listening on port ${PORT}`);
});
