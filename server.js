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
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-realtime";
const WEBSITE_CONTEXT_URL = process.env.WEBSITE_CONTEXT_URL || "https://www.gladiatorspainting.com";
const WEBSITE_CONTEXT_MAX_CHARS = Number(process.env.WEBSITE_CONTEXT_MAX_CHARS || 4000);
const CRM_WEBHOOK_URL = String(process.env.CRM_WEBHOOK_URL || "").trim();
const WARM_GREETING =
  "Hi there! Thanks so much for calling Gladiators Painting. We specialize in high-quality interior and exterior painting, and we'd love to help with your project. What can we help you with today?";

const LEAD_CAPTURE_FIELDS = [
  "full_name",
  "phone",
  "email",
  "address",
  "project_type",
  "project_details",
  "timeline",
  "appointment_date",
  "appointment_time"
];
const FOLLOW_UP_RESPONSE_DELAY_MS = Number(process.env.FOLLOW_UP_RESPONSE_DELAY_MS || 1600);

const REQUIRED_ENV_VARS = ["OPENAI_API_KEY", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"];

function isValidE164(value) {
  return /^\+[1-9]\d{6,14}$/.test(String(value || "").trim());
}

const missingEnv = REQUIRED_ENV_VARS.filter((key) => !process.env[key]);
if (missingEnv.length) {
  console.warn(`⚠️ Missing required env vars: ${missingEnv.join(", ")}`);
}

if (!process.env.BASE_URL) {
  console.warn("⚠️ BASE_URL not set; deriving URL from incoming request headers.");
}

const defaultTransferNumber = process.env.GLADIATORS_TRANSFER_NUMBER || "+14022907925";
if (!isValidE164(defaultTransferNumber)) {
  console.warn(`⚠️ Transfer number is not valid E.164 format: ${defaultTransferNumber}`);
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
    transferNumber: defaultTransferNumber,
    businessHours: { start: 8, end: 17 },
    voice: "ash",
    instructions: [
      "You are the receptionist for Gladiators Painting.",
      "Your goal is to naturally guide a friendly conversation while collecting: full_name, phone, email, address, project_type (interior or exterior), project_details, timeline, preferred appointment_date, and preferred appointment_time.",
      "Keep the conversation natural and flexible: combine related questions when appropriate, acknowledge answers, and avoid sounding like a rigid checklist.",
      "Your main objective is to help the caller get booked on the schedule with a clear appointment date and time window.",
      "Confirm the final appointment details back to the caller before finishing.",
      "When you have collected all required fields, you MUST respond with exactly this JSON structure and valid JSON only:",
      '{"lead_capture":{"full_name":"...","phone":"...","email":"...","address":"...","project_type":"...","project_details":"...","timeline":"...","appointment_date":"...","appointment_time":"..."}}',
      "Only output the JSON when all fields are collected.",
      "If any field is missing, continue the conversation and do not output JSON yet.",
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

app.get("/health/twilio", async (_req, res) => {
  const transferNumber = TENANTS.gladiators.transferNumber;
  const diagnostics = await checkTwilioAccountHealth();

  res.status(diagnostics.ok ? 200 : 503).json({
    status: diagnostics.ok ? "ok" : "degraded",
    hasTwilioCredentials: hasTwilioCredentials(),
    transferNumber,
    transferNumberValidE164: isValidE164(transferNumber),
    diagnostics
  });
});

let websiteKnowledgeContext = "Website knowledge not loaded yet.";

function extractWebsiteText(html) {
  return String(html || "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

async function loadWebsiteContext() {
  try {
    const response = await fetch(WEBSITE_CONTEXT_URL, { method: "GET" });
    if (!response.ok) {
      websiteKnowledgeContext = `Website context unavailable (HTTP ${response.status}).`;
      return;
    }

    const html = await response.text();
    const text = extractWebsiteText(html).slice(0, WEBSITE_CONTEXT_MAX_CHARS);
    websiteKnowledgeContext = text || "Website context unavailable (empty page content).";
  } catch (error) {
    websiteKnowledgeContext = `Website context unavailable (${error.message}).`;
  }
}

function buildRealtimeInstructions(tenant) {
  return `${tenant.instructions}

Website knowledge context from ${WEBSITE_CONTEXT_URL}:
${websiteKnowledgeContext}`;
}

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

function buildFallbackTwiml(message, transferNumber) {
  if (transferNumber) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>${message}</Say>
  <Dial>${transferNumber}</Dial>
</Response>`;
  }

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

function hasTwilioCredentials() {
  return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);
}

async function checkTwilioAccountHealth() {
  if (!hasTwilioCredentials()) {
    return { ok: false, reason: "missing_credentials" };
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}.json`;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { Authorization: buildTwilioAuthHeader() }
    });

    if (!response.ok) {
      const body = await response.text();
      return { ok: false, reason: "twilio_http_error", status: response.status, body };
    }

    const payload = await response.json();
    return { ok: true, accountSid: payload.sid, accountStatus: payload.status };
  } catch (error) {
    return { ok: false, reason: "network_error", error: error.message };
  }
}

async function safePoolQuery(query, values) {
  if (!pool) return;
  try {
    await pool.query(query, values);
  } catch (error) {
    console.error("DB query failed:", error.message);
  }
}

async function sendToCRM(leadCapture) {
  if (!CRM_WEBHOOK_URL) {
    console.warn("CRM webhook not configured. Skipping lead push.");
    return;
  }

  try {
    const response = await fetch(CRM_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(leadCapture)
    });

    if (!response.ok) {
      const body = await response.text();
      console.error("CRM push failed:", response.status, body);
    }
  } catch (error) {
    console.error("CRM push error:", error.message);
  }
}

function parsePotentialLeadCapture(rawPayload) {
  if (!rawPayload) return null;

  let parsed;
  if (typeof rawPayload === "string") {
    try {
      parsed = JSON.parse(rawPayload);
    } catch {
      return null;
    }
  } else if (typeof rawPayload === "object") {
    parsed = rawPayload;
  } else {
    return null;
  }

  const leadCapture = parsed?.lead_capture && typeof parsed.lead_capture === "object"
    ? parsed.lead_capture
    : parsed;

  if (!leadCapture || typeof leadCapture !== "object") return null;

  const normalized = {};
  for (const field of LEAD_CAPTURE_FIELDS) {
    const value = leadCapture[field];
    normalized[field] = typeof value === "string" ? value.trim() : "";
  }

  if (!normalized.full_name || !normalized.phone) return null;

  return normalized;
}

async function forwardLeadCaptureToCRM(rawPayload, crmLeadSentRef) {
  if (crmLeadSentRef.sent) return;
  const leadCapture = parsePotentialLeadCapture(rawPayload);
  if (!leadCapture) return;

  crmLeadSentRef.sent = true;
  await sendToCRM(leadCapture);
}

async function attemptTransfer(callSid, tenant) {
  if (!callSid || !tenant.transferNumber) return false;
  if (!hasTwilioCredentials()) {
    console.error("Twilio transfer skipped: missing TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN.");
    return false;
  }
  if (!isValidE164(tenant.transferNumber)) {
    console.error(`Twilio transfer skipped: invalid transfer number ${tenant.transferNumber}`);
    return false;
  }

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
      "Please hold while we connect you to the team.",
      tenant.transferNumber
    );
    res.type("text/xml").send(fallbackTwiml);
    return;
  }

  const requestBaseUrl = resolveBaseUrl(req);
  if (!requestBaseUrl) {
    const fallbackTwiml = buildFallbackTwiml(
      "Please hold while we connect you to the team.",
      tenant.transferNumber
    );
    res.type("text/xml").send(fallbackTwiml);
    return;
  }

  const wsUrl = buildTenantWsUrl(requestBaseUrl, resolvedTenantId);
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>${WARM_GREETING}</Say>
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
  let openaiSocket = null;
  const crmLeadSentRef = { sent: false };
  const openaiModelCandidates = [...new Set([OPENAI_MODEL, "gpt-4o-realtime-preview-2024-12-17", "gpt-realtime"])]
    .filter(Boolean);

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

  function connectOpenAI(modelIndex) {
    if (modelIndex >= openaiModelCandidates.length) {
      console.error("OpenAI realtime connection failed for all model candidates.");
      if (twilioSocket.readyState === WebSocket.OPEN) twilioSocket.close();
      return;
    }

    const activeModel = openaiModelCandidates[modelIndex];
    const socket = new WebSocket(`wss://api.openai.com/v1/realtime?model=${encodeURIComponent(activeModel)}`, {
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "OpenAI-Beta": "realtime=v1"
      }
    });

    openaiSocket = socket;
    let opened = false;

    socket.on("open", () => {
      opened = true;
      openaiReady = true;

      sendToOpenAI({
        type: "session.update",
        session: {
          voice: tenant.voice,
          instructions: buildRealtimeInstructions(tenant),
          modalities: ["audio", "text"],
          input_audio_format: "g711_ulaw",
          output_audio_format: "g711_ulaw",
          input_audio_transcription: { model: "gpt-4o-mini-transcribe" },
          turn_detection: { type: "server_vad" },
          tool_choice: "auto",
          tools: [
            {
              type: "function",
              name: "create_lead",
              description: "Submit the captured customer lead once required fields are collected.",
              parameters: {
                type: "object",
                properties: {
                  full_name: { type: "string" },
                  phone: { type: "string" },
                  email: { type: "string" },
                  address: { type: "string" },
                  project_type: { type: "string" },
                  project_details: { type: "string" },
                  timeline: { type: "string" },
                  appointment_date: { type: "string" },
                  appointment_time: { type: "string" }
                },
                required: [
                  "full_name",
                  "phone",
                  "email",
                  "address",
                  "project_type",
                  "project_details",
                  "timeline",
                  "appointment_date",
                  "appointment_time"
                ]
              }
            }
          ]
        }
      });

      while (openaiQueue.length && openaiSocket?.readyState === WebSocket.OPEN) {
        openaiSocket.send(openaiQueue.shift());
      }
    });

    socket.on("message", async (raw) => {
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

      if (msg.type === "response.output_text" && msg.output_text) {
        await forwardLeadCaptureToCRM(msg.output_text, crmLeadSentRef);
        return;
      }

      if (msg.type === "response.function_call_arguments.done" && msg.name === "create_lead" && msg.arguments) {
        await forwardLeadCaptureToCRM(msg.arguments, crmLeadSentRef);
        return;
      }

      if (msg.type === "response.output_item.done" && msg.item?.type === "function_call" && msg.item?.name === "create_lead") {
        await forwardLeadCaptureToCRM(msg.item.arguments, crmLeadSentRef);
        return;
      }

      if (msg.type === "conversation.item.input_audio_transcription.completed" && msg.transcript) {
        transcript += `\nCALLER: ${msg.transcript}`;
        return;
      }

      if (msg.type === "input_audio_buffer.speech_stopped") {
        setTimeout(() => {
          sendToOpenAI({
            type: "response.create",
            response: {
              modalities: ["audio", "text"],
              audio: { output: { format: "g711_ulaw" } },
              instructions:
                "Speak only English. Be upbeat, warm, and personable. Keep the conversation natural (not robotic), and focus on getting the caller booked with a confirmed appointment date/time. Do not repeat the greeting or thank-you line. Continue from the caller's last response after a brief pause and ask a helpful next question."
            }
          });
        }, Math.max(0, FOLLOW_UP_RESPONSE_DELAY_MS));
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

    socket.on("error", (error) => {
      console.error(`OpenAI socket error (${activeModel}):`, error.message);
    });

    socket.on("close", (code, reason) => {
      openaiReady = false;
      const reasonText = reason ? reason.toString() : "";
      console.error(`OpenAI socket closed (${activeModel}) code=${code} reason=${reasonText}`);

      if (!opened) {
        connectOpenAI(modelIndex + 1);
        return;
      }

      if (twilioSocket.readyState === WebSocket.OPEN) {
        twilioSocket.close();
      }
    });
  }

  connectOpenAI(0);

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
      if (openaiSocket?.readyState === WebSocket.OPEN) {
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
    if (openaiSocket?.readyState === WebSocket.OPEN) {
      openaiSocket.close();
    }
  });

  twilioSocket.on("error", (error) => {
    console.error("Twilio socket error:", error.message);
  });
});

loadWebsiteContext();

server.listen(PORT, () => {
  console.log(`AI front desk backend listening on port ${PORT}`);
});
