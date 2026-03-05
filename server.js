"use strict";

require("dotenv").config();

const crypto = require("crypto");
const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const fetch = require("node-fetch");
const cors = require("cors");
const { Pool } = require("pg");
const calendar = require("./calendar");
const path = require("path");
const cron = require("node-cron");

// Multi-tenant platform imports
const twilioRoutes = require("./routes/twilio");
const dashboardRoutes = require("./routes/dashboard");
const authRoutes = require("./routes/auth");
const { authMiddleware } = require("./lib/auth");
const { listPlans } = require("./lib/plans");
const estimateRecoveryService = require("./services/estimateRecovery");

async function sendTypingIndicator(recipientId, action = "typing_on") {
  const PAGE_ACCESS_TOKEN = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
  if (!PAGE_ACCESS_TOKEN) return;

  await fetch(
    `https://graph.facebook.com/v18.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipient: { id: recipientId },
        sender_action: action
      })
    }
  );
}

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
const OPENAI_TEXT_MODEL = process.env.OPENAI_TEXT_MODEL || "gpt-4o-mini";
const TWILIO_PHONE_NUMBER = String(process.env.TWILIO_PHONE_NUMBER || "").trim();
const SMS_FOLLOW_UP_DELAY_MINUTES = Number(process.env.SMS_FOLLOW_UP_DELAY_MINUTES || 30);
const SMS_FOLLOW_UP_CHECK_INTERVAL_MS = Number(process.env.SMS_FOLLOW_UP_CHECK_INTERVAL_MS || 5 * 60 * 1000);
const smsThreads = new Map();
let callsTableHasTranscriptColumn = true;

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

const pgIpFamily = Number(process.env.PGIP_FAMILY || 4);
const pool = process.env.DATABASE_URL
  ? new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    family: Number.isFinite(pgIpFamily) && (pgIpFamily === 4 || pgIpFamily === 6) ? pgIpFamily : 4
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

const SERVE_DASHBOARD = process.env.SERVE_DASHBOARD === "true";
const FRONTEND_URL = process.env.FRONTEND_URL || "";

const app = express();
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

// Stripe webhook MUST be before express.json() — needs raw body for signature verification
const stripeLib = require("./lib/stripe");
if (stripeLib.stripe) {
  app.post("/stripe/webhook", express.raw({ type: "application/json" }), async (req, res) => {
    const sig = req.headers["stripe-signature"];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    try {
      let event;
      if (webhookSecret && sig) {
        event = stripeLib.stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
      } else {
        event = JSON.parse(req.body.toString());
        console.warn("[Stripe] No STRIPE_WEBHOOK_SECRET — skipping signature verification (dev mode)");
      }
      await stripeLib.handleWebhookEvent(event);
      res.json({ received: true });
    } catch (err) {
      console.error("[Stripe] Webhook error:", err.message);
      res.status(400).json({ error: err.message });
    }
  });
}

app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(express.static("public"));

app.get("/", (_req, res) => {
  if (FRONTEND_URL) return res.redirect(302, FRONTEND_URL);
  res.status(200).send("AI front desk backend is running");
});

app.get("/health", (_req, res) => {
  res.status(200).send("OK");
});

// Public: plans list (no auth)
app.get("/api/plans", (req, res) => {
  try {
    res.json({ plans: listPlans() });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

// Multi-tenant platform routes
app.use("/twilio", twilioRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/stripe", authMiddleware, require("./routes/stripe"));
app.use("/api", authMiddleware, dashboardRoutes);

app.get("/health/details", (_req, res) => {
  res.status(200).json({
    status: "ok",
    hasOpenAIKey: Boolean(process.env.OPENAI_API_KEY),
    hasTwilioAccountSid: Boolean(process.env.TWILIO_ACCOUNT_SID),
    hasTwilioAuthToken: Boolean(process.env.TWILIO_AUTH_TOKEN),
    hasBaseUrl: Boolean(process.env.BASE_URL),
    baseUrlMode: process.env.BASE_URL ? "env" : "derived_from_request",
    wsBaseUrlPreview: toWebSocketBaseUrl(process.env.BASE_URL || "https://example.com"),
    hasGoogleCalendar: Boolean(calendar)
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

app.get("/health/sms", (_req, res) => {
  res.status(200).json({
    status: "ok",
    hasTwilioCredentials: hasTwilioCredentials(),
    hasTwilioPhoneNumber: Boolean(TWILIO_PHONE_NUMBER),
    activeThreads: smsThreads.size
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

function escapeXml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildFallbackTwiml(message, transferNumber) {
  if (transferNumber) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>${escapeXml(message)}</Say>
  <Dial>${transferNumber}</Dial>
</Response>`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>${escapeXml(message)}</Say>
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


async function safeUpdateCallSummary(callId, options = {}) {
  if (!pool || !callId) return;

  const status = Object.prototype.hasOwnProperty.call(options, "status") ? options.status : undefined;
  const transcript = typeof options.transcript === "string" ? options.transcript : "";
  const markEnded = Boolean(options.markEnded);

  async function runUpdate(includeTranscriptColumn) {
    const setParts = [];
    const values = [callId];

    if (markEnded) {
      setParts.push("ended_at = now()");
    }

    if (typeof status === "string") {
      values.push(status);
      setParts.push(`status = $${values.length}`);
    }

    if (includeTranscriptColumn) {
      values.push(transcript);
      setParts.push(`transcript = $${values.length}`);
    }

    setParts.push("duration_minutes = EXTRACT(EPOCH FROM (now() - started_at)) / 60");

    const query = `UPDATE calls
         SET ${setParts.join(",\n             ")}
         WHERE id = $1`;

    await pool.query(query, values);
  }

  try {
    await runUpdate(callsTableHasTranscriptColumn);
  } catch (error) {
    if (callsTableHasTranscriptColumn && error.code === "42703" && /transcript/i.test(error.message)) {
      callsTableHasTranscriptColumn = false;
      console.warn("calls.transcript column not found; continuing without transcript persistence.");
      await runUpdate(false);
      return;
    }

    console.error("DB query failed:", error.message);
  }
}

async function sendToCRM(leadCapture) {
  if (!process.env.CRM_WEBHOOK_URL) {
    console.warn("CRM webhook not configured. Skipping lead push.");
    return;
  }

  try {
    const response = await fetch(process.env.CRM_WEBHOOK_URL, {
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


function normalizePhone(value) {
  return String(value || "").trim();
}

function getOrCreateSmsThread(phone) {
  const normalizedPhone = normalizePhone(phone);
  const existing = smsThreads.get(normalizedPhone);
  if (existing) return existing;

  const created = {
    phone: normalizedPhone,
    history: [],
    leadCapture: {},
    bookedEventId: "",
    needsFollowUpAt: null,
    lastInboundAt: null,
    lastOutboundAt: null
  };
  smsThreads.set(normalizedPhone, created);
  return created;
}

async function sendTwilioSms(to, body) {
  if (!hasTwilioCredentials() || !TWILIO_PHONE_NUMBER) {
    console.warn("Twilio SMS skipped: missing credentials or TWILIO_PHONE_NUMBER.");
    return { ok: false, reason: "missing_sms_configuration" };
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  const payload = new URLSearchParams({
    To: to,
    From: TWILIO_PHONE_NUMBER,
    Body: body
  }).toString();

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: buildTwilioAuthHeader(),
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: payload
  });

  if (!response.ok) {
    const errBody = await response.text();
    console.error("Twilio SMS failed:", response.status, errBody);
    return { ok: false, reason: "twilio_sms_error", status: response.status };
  }

  const msg = await response.json();
  return { ok: true, sid: msg.sid };
}

function buildSmsSystemPrompt(thread) {
  return [
    "You are an SMS receptionist for Gladiators Painting.",
    "Flow: qualify lead, gather full_name, project_type, project_details, address, preferred appointment_date and appointment_time.",
    "Be concise, friendly, and use one short text message.",
    "If enough details exist to request booking, set should_book true and provide appointment_date/time.",
    "Return strict JSON only with keys: reply, lead_capture, should_book, appointment_date, appointment_time, follow_up_minutes.",
    `Known lead data: ${JSON.stringify(thread.leadCapture)}`
  ].join("\n");
}

async function runSmsAiOrchestrator(thread, incomingText) {
  const input = [
    { role: "system", content: buildSmsSystemPrompt(thread) },
    ...thread.history.map((msg) => ({
      role: msg.role,
      content: String(msg.text || "")
    })),
    { role: "user", content: String(incomingText || "") }
  ];

  const payload = {
    model: OPENAI_TEXT_MODEL,
    input,
    text: {
      format: {
        type: "json_schema",
        name: "sms_orchestrator",
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            reply: { type: "string" },
            lead_capture: {
              type: "object",
              additionalProperties: false,
              properties: {
                full_name: { type: ["string", "null"] },
                phone: { type: ["string", "null"] },
                email: { type: ["string", "null"] },
                address: { type: ["string", "null"] },
                project_type: { type: ["string", "null"] },
                project_details: { type: ["string", "null"] },
                timeline: { type: ["string", "null"] },
                appointment_date: { type: ["string", "null"] },
                appointment_time: { type: ["string", "null"] }
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
            },
            should_book: { type: "boolean" },
            appointment_date: { type: "string" },
            appointment_time: { type: "string" },
            follow_up_minutes: { type: "number" }
          },
          required: [
            "reply",
            "lead_capture",
            "should_book",
            "appointment_date",
            "appointment_time",
            "follow_up_minutes"
          ]
        },
        strict: true
      }
    }
  };

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI SMS orchestration failed (${response.status}): ${body}`);
  }

  const parsed = await response.json();
  const outputText = parsed.output_text
    || parsed.output?.[0]?.content?.find((item) => item.type === "output_text")?.text
    || "{}";
  try {
    return JSON.parse(outputText);
  } catch {
    throw new Error(`OpenAI SMS orchestration returned non-JSON output: ${outputText}`);
  }
}
function mergeLeadCapture(thread, incomingLeadCapture) {
  if (!incomingLeadCapture || typeof incomingLeadCapture !== "object") return;
  for (const field of LEAD_CAPTURE_FIELDS) {
    const value = incomingLeadCapture[field];
    if (typeof value === "string" && value.trim()) {
      thread.leadCapture[field] = value.trim();
    }
  }
}

async function processSmsConversation(phone, incomingText) {
  const thread = getOrCreateSmsThread(phone);
  thread.lastInboundAt = Date.now();
  thread.history.push({ role: "user", text: incomingText, at: new Date().toISOString() });

  let ai;
  try {
    ai = await runSmsAiOrchestrator(thread, incomingText);

    console.log("AI STRUCTURED OUTPUT:", JSON.stringify(ai, null, 2));

  } catch (error) {
    console.error("SMS AI orchestration failed:", error.message);
    ai = {
      reply: "Got it 👍 Let me take a closer look at that for you.",
      should_book: false,
      follow_up_minutes: SMS_FOLLOW_UP_DELAY_MINUTES,
      lead_capture: {}
    };
  }

  mergeLeadCapture(thread, ai.lead_capture);

  if (thread.leadCapture?.full_name || thread.phone) {
    await sendToCRM({
      source: thread.channel || "unknown",
      full_name: thread.leadCapture?.full_name || "",
      phone: thread.phone || thread.leadCapture?.phone || "",
      email: thread.leadCapture?.email || "",
      address: thread.leadCapture?.address || "",
      project_type: thread.leadCapture?.project_type || "",
      project_details: thread.leadCapture?.project_details || "",
      lead_type: ai.should_book ? "BOOKED" : "INQUIRY",
      timestamp: new Date().toISOString()
    });
  }
  if (!thread.leadCapture.phone) thread.leadCapture.phone = thread.phone;

  let replyText = ai.reply || "Thanks for reaching out!";

  if (ai.should_book && ai.appointment_date && ai.appointment_time) {

    let parsedDate = new Date(ai.appointment_date);
    const now = new Date();
    const currentYear = now.getFullYear();

    if (parsedDate.getFullYear() < currentYear) {
      parsedDate.setFullYear(currentYear);
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    parsedDate.setHours(0, 0, 0, 0);

    if (parsedDate < now) {
      parsedDate.setFullYear(parsedDate.getFullYear() + 1);
    }

    ai.appointment_date = parsedDate.toISOString().split("T")[0];

    if (ai.appointment_time === "morning") {
      ai.appointment_time = "9:00 AM";
    }

    if (ai.appointment_time === "afternoon") {
      ai.appointment_time = "1:00 PM";
    }

    if (ai.appointment_time === "evening") {
      ai.appointment_time = "6:00 PM";
    }

    const availability = await checkAvailability({
      appointment_date: ai.appointment_date,
      appointment_time: ai.appointment_time,
      duration_minutes: 60
    });

    if (availability.ok && availability.available) {
      const booked = await bookAppointment({
        appointment_date: ai.appointment_date,
        appointment_time: ai.appointment_time,
        duration_minutes: 60,
        full_name: thread.leadCapture.full_name || "New Lead",
        phone: thread.phone,
        email: thread.leadCapture.email || "",
        address: thread.leadCapture.address || "",
        project_details: thread.leadCapture.project_details || ""
      });

      if (booked.ok) {
        thread.bookedEventId = booked.eventId || "";
        thread.needsFollowUpAt = Date.now() + 24 * 60 * 60 * 1000;
        replyText = `${replyText} ✅ You are booked for ${ai.appointment_date} at ${ai.appointment_time}.`;
      } else {
        replyText = `${replyText} I couldn't complete booking yet. Can I offer another time?`;
      }
    } else {
      replyText = `${replyText} That time is no longer available. Please share another preferred time.`;
      thread.needsFollowUpAt = Date.now() + 30 * 60 * 1000;
    }
  } else {
    const followUpMinutes = Number(ai.follow_up_minutes);
    thread.needsFollowUpAt = Date.now() + (Number.isFinite(followUpMinutes) && followUpMinutes > 0
      ? followUpMinutes
      : SMS_FOLLOW_UP_DELAY_MINUTES) * 60 * 1000;
  }

  await forwardLeadCaptureToCRM(thread.leadCapture, { sent: false });

  thread.history.push({ role: "assistant", text: replyText, at: new Date().toISOString() });
  thread.lastOutboundAt = Date.now();

  return replyText;
}
async function processFacebookConversation(senderId, messageText) {
  const threadKey = `fb-${senderId}`;
  const thread = getOrCreateSmsThread(threadKey);

  thread.lastInteractionAt = Date.now();

  if (!thread.greeted) {
    thread.greeted = true;
    return "👋 Hi! Thanks for messaging Gladiators Painting! Want a fast, free estimate? Tap below to get started.";
  }

  // Send directly to AI (NOT SMS fallback)
  const replyText = await processSmsConversation(threadKey, messageText);

  thread.history.push({
    role: "assistant",
    text: replyText,
    at: new Date().toISOString()
  });

  return replyText;
}
async function sendFacebookMessage(recipientId, messageText, quickReplies = []) {
  const PAGE_ACCESS_TOKEN = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;

  if (!PAGE_ACCESS_TOKEN) {
    console.error("Missing FACEBOOK_PAGE_ACCESS_TOKEN");
    return;
  }

  const payload = {
    recipient: { id: recipientId },
    message: { text: messageText }
  };

  if (quickReplies.length) {
    payload.message.quick_replies = quickReplies.map(title => ({
      content_type: "text",
      title,
      payload: title
    }));
  }

  await fetch(
    `https://graph.facebook.com/v18.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }
  );
}
async function runSmsFollowUps() {
  const now = Date.now();
  for (const thread of smsThreads.values()) {
    if (!thread.needsFollowUpAt || thread.needsFollowUpAt > now) continue;
    const recentInboundMs = thread.lastInboundAt ? now - thread.lastInboundAt : Infinity;
    if (recentInboundMs < 10 * 60 * 1000) continue;

    const followUpText = thread.bookedEventId
      ? "Quick follow-up: your appointment is on our schedule. Reply here if you need to reschedule."
      : "Just checking in — would you like me to help you lock in a time for your estimate?";

    let sent;

    if (thread.phone.startsWith("fb-")) {
      const fbId = thread.phone.replace("fb-", "");
      await sendFacebookMessage(fbId, followUpText);
      sent = { ok: true };
    } else {
      sent = await sendTwilioSms(thread.phone, followUpText);
    }
    if (sent.ok) {
      thread.history.push({ role: "assistant", text: followUpText, at: new Date().toISOString() });
      thread.lastOutboundAt = now;
      thread.needsFollowUpAt = now + 24 * 60 * 60 * 1000;
    } else {
      thread.needsFollowUpAt = now + 15 * 60 * 1000;
    }
  }
}
app.get("/setup-facebook-menu", async (req, res) => {
  const PAGE_ACCESS_TOKEN = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;

  if (!PAGE_ACCESS_TOKEN) {
    return res.status(400).send("Missing FACEBOOK_PAGE_ACCESS_TOKEN");
  }

  const menuData = {
    get_started: {
      payload: "GET_STARTED"
    },
    persistent_menu: [
      {
        locale: "default",
        composer_input_disabled: false,
        call_to_actions: [
          {
            type: "postback",
            title: "📝 Get Free Quote",
            payload: "GET_QUOTE"
          },
          {
            type: "postback",
            title: "📅 Book Estimate",
            payload: "BOOK_ESTIMATE"
          },
          {
            type: "postback",
            title: "👤 Talk to Human",
            payload: "TALK_HUMAN"
          }
        ]
      }
    ]
  };

  try {
    const response = await fetch(
      `https://graph.facebook.com/v18.0/me/messenger_profile?access_token=${PAGE_ACCESS_TOKEN}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(menuData)
      }
    );

    const result = await response.json();
    res.json(result);
  } catch (error) {
    res.status(500).send(error.message);
  }
});
const DEFAULT_CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID || "primary";
const BUSINESS_TIMEZONE = process.env.BUSINESS_TIMEZONE || "America/Chicago";

function normalizeTimeString(timeValue) {
  const raw = String(timeValue || "").trim();
  if (!raw) return "";

  const ampmMatch = raw.match(/^(\d{1,2})(?::(\d{2}))?\s*([ap]m)$/i);
  if (ampmMatch) {
    let hour = Number(ampmMatch[1]);
    const minutes = Number(ampmMatch[2] || "0");
    const suffix = ampmMatch[3].toLowerCase();
    if (suffix === "pm" && hour < 12) hour += 12;
    if (suffix === "am" && hour === 12) hour = 0;
    if (hour >= 0 && hour < 24 && minutes >= 0 && minutes < 60) {
      return `${String(hour).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:00`;
    }
  }

  const twentyFourHourMatch = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (twentyFourHourMatch) {
    const hour = Number(twentyFourHourMatch[1]);
    const minutes = Number(twentyFourHourMatch[2]);
    const seconds = Number(twentyFourHourMatch[3] || "0");
    if (hour >= 0 && hour < 24 && minutes >= 0 && minutes < 60 && seconds >= 0 && seconds < 60) {
      return `${String(hour).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    }
  }

  return "";
}

function buildAppointmentWindow(dateValue, timeValue, durationMinutes = 60) {
  const normalizedDate = String(dateValue || "").trim();
  const normalizedTime = normalizeTimeString(timeValue);
  const duration = Number(durationMinutes) > 0 ? Number(durationMinutes) : 60;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedDate) || !normalizedTime) {
    return null;
  }

  const start = new Date(`${normalizedDate}T${normalizedTime}`);
  if (Number.isNaN(start.getTime())) return null;

  const end = new Date(start.getTime() + duration * 60 * 1000);
  return { start, end };
}

async function checkAvailability(args = {}) {
  if (!calendar) {
    return { ok: false, reason: "calendar_not_configured" };
  }

  const window = buildAppointmentWindow(args.appointment_date, args.appointment_time, args.duration_minutes || 60);
  if (!window) {
    return { ok: false, reason: "invalid_datetime", message: "Use appointment_date (YYYY-MM-DD) and appointment_time (HH:MM or 1:30 PM)." };
  }

  const response = await calendar.freebusy.query({
    requestBody: {
      timeMin: window.start.toISOString(),
      timeMax: window.end.toISOString(),
      timeZone: BUSINESS_TIMEZONE,
      items: [{ id: args.calendar_id || DEFAULT_CALENDAR_ID }]
    }
  });

  const calendarId = args.calendar_id || DEFAULT_CALENDAR_ID;
  const busy = response?.data?.calendars?.[calendarId]?.busy || [];
  return {
    ok: true,
    available: busy.length === 0,
    busySlots: busy,
    startIso: window.start.toISOString(),
    endIso: window.end.toISOString(),
    timezone: BUSINESS_TIMEZONE
  };
}

async function bookAppointment(args = {}) {
  if (!calendar) return { ok: false, reason: "calendar_not_configured" };

  const window = buildAppointmentWindow(args.appointment_date, args.appointment_time, args.duration_minutes || 60);
  if (!window) {
    return { ok: false, reason: "invalid_datetime", message: "Use appointment_date (YYYY-MM-DD) and appointment_time (HH:MM or 1:30 PM)." };
  }

  const event = {
    summary: args.summary || `Painting Estimate - ${args.full_name || "New Lead"}`,
    description: args.description || [
      args.full_name ? `Name: ${args.full_name}` : "",
      args.phone ? `Phone: ${args.phone}` : "",
      args.email ? `Email: ${args.email}` : "",
      args.address ? `Address: ${args.address}` : "",
      args.project_details ? `Project: ${args.project_details}` : ""
    ].filter(Boolean).join("\n"),
    start: { dateTime: window.start.toISOString(), timeZone: BUSINESS_TIMEZONE },
    end: { dateTime: window.end.toISOString(), timeZone: BUSINESS_TIMEZONE }
  };

  const response = await calendar.events.insert({
    calendarId: args.calendar_id || DEFAULT_CALENDAR_ID,
    requestBody: event
  });

  return {
    ok: true,
    eventId: response?.data?.id,
    htmlLink: response?.data?.htmlLink,
    status: response?.data?.status
  };
}

async function cancelAppointment(args = {}) {
  if (!calendar) return { ok: false, reason: "calendar_not_configured" };
  if (!args.event_id) return { ok: false, reason: "missing_event_id" };

  await calendar.events.delete({
    calendarId: args.calendar_id || DEFAULT_CALENDAR_ID,
    eventId: args.event_id
  });

  return { ok: true, cancelled: true, eventId: args.event_id };
}

async function rescheduleAppointment(args = {}) {
  if (!calendar) return { ok: false, reason: "calendar_not_configured" };
  if (!args.event_id) return { ok: false, reason: "missing_event_id" };

  const window = buildAppointmentWindow(args.appointment_date, args.appointment_time, args.duration_minutes || 60);
  if (!window) {
    return { ok: false, reason: "invalid_datetime", message: "Use appointment_date (YYYY-MM-DD) and appointment_time (HH:MM or 1:30 PM)." };
  }

  const response = await calendar.events.patch({
    calendarId: args.calendar_id || DEFAULT_CALENDAR_ID,
    eventId: args.event_id,
    requestBody: {
      start: { dateTime: window.start.toISOString(), timeZone: BUSINESS_TIMEZONE },
      end: { dateTime: window.end.toISOString(), timeZone: BUSINESS_TIMEZONE }
    }
  });

  return {
    ok: true,
    eventId: response?.data?.id,
    htmlLink: response?.data?.htmlLink,
    status: response?.data?.status
  };
}

const OPENAI_FUNCTION_HANDLERS = {
  create_lead: async (args, context) => {
    await forwardLeadCaptureToCRM(args, context.crmLeadSentRef);
    return { ok: true, leadForwarded: true };
  },
  checkAvailability,
  bookAppointment,
  cancelAppointment,
  rescheduleAppointment
};

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

  try {
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
    if (!/^wss:\/\//i.test(wsUrl)) {
      const fallbackTwiml = buildFallbackTwiml(
        "Please hold while we connect you to the team.",
        tenant.transferNumber
      );
      res.type("text/xml").send(fallbackTwiml);
      return;
    }

    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>${escapeXml(WARM_GREETING)}</Say>
  <Connect>
    <Stream url="${wsUrl}" />
  </Connect>
</Response>`;

    res.type("text/xml").send(twiml);
  } catch (error) {
    console.error("Twilio voice webhook error:", error.message);
    const fallbackTwiml = buildFallbackTwiml(
      "Please hold while we connect you to the team.",
      tenant.transferNumber
    );
    res.type("text/xml").send(fallbackTwiml);
  }
}

function registerTwilioVoiceRoutes(pathPatterns, tenantScoped) {
  const handler = (req, res) => {
    const tenantId = tenantScoped ? req.params.tenantId : "gladiators";
    handleTwilioVoice(req, res, tenantId);
  };

  const normalizedPatterns = Array.isArray(pathPatterns) ? pathPatterns : [pathPatterns];

  for (const pathPattern of normalizedPatterns) {
    app.get(pathPattern, handler);
    app.post(pathPattern, handler);
    app.all(pathPattern, handler);
  }
}

registerTwilioVoiceRoutes(["/twilio-voice", "/twilio-voice/"], false);
registerTwilioVoiceRoutes(["/twilio-voice/:tenantId", "/twilio-voice/:tenantId/"], true);

// Backward compatibility with older webhook paths that may still be configured in Twilio.
registerTwilioVoiceRoutes(["/twilio/voice", "/twilio/voice/"], false);
registerTwilioVoiceRoutes(["/twilio/voice/:tenantId", "/twilio/voice/:tenantId/"], true);

app.post("/twilio-missed-call", async (req, res) => {
  const from = normalizePhone(req.body?.From || req.body?.from);
  const callStatus = String(req.body?.CallStatus || req.body?.call_status || "").toLowerCase();

  if (!from) {
    res.status(400).json({ ok: false, reason: "missing_from" });
    return;
  }

  const isMissed = ["no-answer", "busy", "failed", "canceled", "cancelled"].includes(callStatus);
  if (!isMissed) {
    res.status(200).json({ ok: true, skipped: true, reason: "not_missed_call" });
    return;
  }

  const thread = getOrCreateSmsThread(from);
  const autoText = "Sorry we missed your call — this is Gladiators Painting. I can help with a fast quote and get your appointment booked. What kind of project are you planning?";
  const sent = await sendTwilioSms(from, autoText);

  if (sent.ok) {
    thread.history.push({ role: "assistant", text: autoText, at: new Date().toISOString() });
    thread.lastOutboundAt = Date.now();
    thread.needsFollowUpAt = Date.now() + SMS_FOLLOW_UP_DELAY_MINUTES * 60 * 1000;
  }

  res.status(200).json({ ok: true, sent: sent.ok });
});

app.post("/twilio-sms", async (req, res) => {
  const from = normalizePhone(req.body?.From || req.body?.from);
  const body = String(req.body?.Body || req.body?.body || "").trim();

  if (!from || !body) {
    res.status(400).send("Missing From or Body");
    return;
  }

  try {
    const reply = await processSmsConversation(from, body);
    res.type("text/xml").status(200).send(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(reply)}</Message></Response>`);
  } catch (error) {
    console.error("Twilio SMS webhook error:", error.message);
    res.type("text/xml").status(200).send(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>Thanks — we received your message and will text you shortly.</Message></Response>`);
  }
});

app.use((req, res, next) => {
  if (!/^\/twilio(?:-|\/)/i.test(req.path)) {
    next();
    return;
  }

  console.warn(`Unhandled Twilio route: ${req.method} ${req.originalUrl}`);
  if (req.method !== "GET" && req.method !== "POST") {
    res.status(405).send("Method Not Allowed");
    return;
  }

  const tenant = TENANTS.gladiators;
  const fallbackTwiml = buildFallbackTwiml(
    "Please hold while we connect you to the team.",
    tenant.transferNumber
  );
  res.type("text/xml").status(200).send(fallbackTwiml);
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
            ,
            {
              type: "function",
              name: "checkAvailability",
              description: "Check whether the requested appointment window is free on Google Calendar.",
              parameters: {
                type: "object",
                properties: {
                  appointment_date: { type: "string" },
                  appointment_time: { type: "string" },
                  duration_minutes: { type: "number" }
                },
                required: ["appointment_date", "appointment_time"]
              }
            },
            {
              type: "function",
              name: "bookAppointment",
              description: "Book a new appointment on Google Calendar for the caller.",
              parameters: {
                type: "object",
                properties: {
                  appointment_date: { type: "string" },
                  appointment_time: { type: "string" },
                  duration_minutes: { type: "number" },
                  full_name: { type: "string" },
                  phone: { type: "string" },
                  email: { type: "string" },
                  address: { type: "string" },
                  project_details: { type: "string" },
                  summary: { type: "string" },
                  description: { type: "string" }
                },
                required: ["appointment_date", "appointment_time"]
              }
            },
            {
              type: "function",
              name: "cancelAppointment",
              description: "Cancel an existing Google Calendar appointment by event_id.",
              parameters: {
                type: "object",
                properties: {
                  event_id: { type: "string" }
                },
                required: ["event_id"]
              }
            },
            {
              type: "function",
              name: "rescheduleAppointment",
              description: "Move an existing Google Calendar appointment to a new date/time.",
              parameters: {
                type: "object",
                properties: {
                  event_id: { type: "string" },
                  appointment_date: { type: "string" },
                  appointment_time: { type: "string" },
                  duration_minutes: { type: "number" }
                },
                required: ["event_id", "appointment_date", "appointment_time"]
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

      if (msg.type === "response.output_item.done" && msg.item?.type === "function_call" && msg.item?.name) {
        const handler = OPENAI_FUNCTION_HANDLERS[msg.item.name];
        if (!handler) return;

        let functionArgs = {};
        if (msg.item.arguments) {
          try {
            functionArgs = JSON.parse(msg.item.arguments);
          } catch {
            functionArgs = {};
          }
        }

        let result;
        try {
          result = await handler(functionArgs, { crmLeadSentRef });
        } catch (error) {
          result = { ok: false, reason: "handler_error", message: error.message };
        }

        if (msg.item.call_id) {
          sendToOpenAI({
            type: "conversation.item.create",
            item: {
              type: "function_call_output",
              call_id: msg.item.call_id,
              output: JSON.stringify(result)
            }
          });

          sendToOpenAI({
            type: "response.create",
            response: {
              modalities: ["audio", "text"]
            }
          });
        }
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

        await safeUpdateCallSummary(callId, { transcript });
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

      await safeUpdateCallSummary(callId, {
        status: transferAttempted ? "transferred" : "completed",
        transcript,
        markEnded: true
      });
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
setInterval(() => {
  runSmsFollowUps().catch((error) => {
    console.error("SMS follow-up loop error:", error.message);
  });
}, Math.max(60000, SMS_FOLLOW_UP_CHECK_INTERVAL_MS));

app.post("/website-chat", async (req, res) => {
  const message = String(req.body?.message || "").trim();

  if (!message) {
    res.status(400).json({ reply: "Missing message." });
    return;
  }

  try {
    // Reuse SMS AI engine for web chat
    const sessionId = String(req.body?.sessionId || "").trim();

    if (!sessionId) {
      res.status(400).json({ reply: "Missing session ID." });
      return;
    }
    const reply = await processSmsConversation(sessionId, message);
    res.json({ reply });
  } catch (error) {
    console.error("Website chat error:", error.message);
    res.status(500).json({ reply: "Something went wrong." });
  }
});

app.get("/facebook-webhook", (req, res) => {
  const VERIFY_TOKEN = process.env.FACEBOOK_VERIFY_TOKEN;

  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

app.post("/facebook-webhook", async (req, res) => {
  try {
    const entry = req.body.entry?.[0];
    const messaging = entry?.messaging?.[0];
    // 🔥 Handle Persistent Menu / Postback Buttons
    if (messaging?.postback) {
      const senderId = messaging.sender.id;
      const payload = messaging.postback.payload;

      if (payload === "GET_STARTED") {
        await sendFacebookMessage(
          senderId,
          "👋 Welcome to Gladiators Painting! How can we help you today?"
        );
        return res.sendStatus(200);
      }

      if (payload === "GET_QUOTE") {
        await sendFacebookMessage(
          senderId,
          "Great! What type of painting project are you planning?"
        );
        return res.sendStatus(200);
      }

      if (payload === "BOOK_ESTIMATE") {
        await sendFacebookMessage(
          senderId,
          "Perfect. What day works best for your estimate?"
        );
        return res.sendStatus(200);
      }

      if (payload === "TALK_HUMAN") {
        await sendFacebookMessage(
          senderId,
          "No problem 👍 A team member will reach out shortly."
        );
        return res.sendStatus(200);
      }
    }
    if (!messaging || !messaging.message?.text) {
      return res.sendStatus(200);
    }

    const senderId = messaging.sender.id;
    const messageText = messaging.message.text;

    // Show typing indicator
    await sendTypingIndicator(senderId, "typing_on");

    // 2–3 second delay
    await delay(2000 + Math.random() * 1000);

    // Stop typing indicator
    await sendTypingIndicator(senderId, "typing_off");

    const reply = await processFacebookConversation(senderId, messageText);

    await sendFacebookMessage(
      senderId,
      reply,
      ["Get a Free Quote", "Talk to a Human", "Book Estimate"]
    );

    res.sendStatus(200);
  } catch (error) {
    console.error("Facebook webhook error:", error.message);
    res.sendStatus(500);
  }
});

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// -------------------- SERVE_DASHBOARD (optional) --------------------
if (SERVE_DASHBOARD) {
  app.use(express.static(path.join(__dirname, "dashboard", "dist")));
  app.get("*", (req, res) => {
    if (req.path.startsWith("/api") || req.path.startsWith("/twilio") || req.path.startsWith("/stripe")) return;
    res.sendFile(path.join(__dirname, "dashboard", "dist", "index.html"));
  });
}

// -------------------- Cron: estimate recovery every 5 min --------------------
cron.schedule("*/5 * * * *", () => {
  estimateRecoveryService.processDueRecoveries().catch((e) => console.error("Recovery cron:", e));
});

// -------------------- Listen --------------------
server.listen(PORT, () => {
  console.log(`AI front desk backend listening on port ${PORT}`);
});
