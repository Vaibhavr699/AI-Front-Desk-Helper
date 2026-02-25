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

app.get("/health/details", (_req, res) => {
  res.status(200).json({
    status: "ok",
    hasOpenAIKey: Boolean(process.env.OPENAI_API_KEY),
    hasTwilioAccountSid: Boolean(process.env.TWILIO_ACCOUNT_SID),
    hasTwilioAuthToken: Boolean(process.env.TWILIO_AUTH_TOKEN),
    hasBaseUrl: Boolean(process.env.BASE_URL),
    baseUrlMode: process.env.BASE_URL ? "env" : "derived_from_request",
    wsBaseUrlPreview: toWebSocketBaseUrl(process.env.BASE_URL || "https://example.com")
  });
});

function isBusinessHours(tenant) {
  const hour = new Date().getHours();
  return hour >= tenant.businessHours.start && hour < tenant.businessHours.end;
}

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || "").trim().replace(/\/+$/, "");
}

function toWebSocketBaseUrl(baseUrl) {
  const normalized = normalizeBaseUrl(baseUrl);
  if (!normalized) return "";

  try {
    const parsed = new URL(normalized);
    parsed.protocol = "wss:";
    parsed.pathname = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return normalized.replace(/^https?:\/\//, "wss://").replace(/^ws:\/\//, "wss://").replace(/\/+$/, "");
  }
}

function resolveBaseUrl(req) {
  if (BASE_URL) return normalizeBaseUrl(BASE_URL);
  const forwardedProto = req.get("x-forwarded-proto");
  const proto = (forwardedProto || req.protocol || "https").split(",")[0].trim();
  const host = req.get("x-forwarded-host") || req.get("host");
  if (!host) return "";
  return normalizeBaseUrl(`${proto}://${host}`);
}

function buildTenantWsUrl(baseUrl, tenantId) {
  const wsBaseUrl = toWebSocketBaseUrl(baseUrl);
  return `${wsBaseUrl}/twilio-media/${tenantId}`;
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
