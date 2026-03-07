"use strict";

require("dotenv").config();
const { handleWebhookEvent, stripe } = require("./lib/stripe");
// BASE_URL must be the backend root (no /dashboard). Strip if set wrong so Twilio/webhooks work.
if (process.env.BASE_URL) {
  process.env.BASE_URL = process.env.BASE_URL.replace(/\/dashboard\/?$/, "").replace(/\/$/, "") || process.env.BASE_URL;
}

const cors = require("cors");
const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const fetch = require("node-fetch");
const db = require("./lib/db");
const pool = db.pool;
const calendar = require("./calendar");
const path = require("path");
const cron = require("node-cron");

const { getTenantByPhone, getTenantById, getAllTenants, getTenantByFacebookPageId } = require("./lib/tenant");
const callsService = require("./services/calls");
const recordingService = require("./services/recording");
const transferService = require("./services/transfer");
const bookingsService = require("./services/bookings");
const followUpService = require("./services/followUp");
const estimateRecoveryService = require("./services/estimateRecovery");

const twilioRoutes = require("./routes/twilio");
const dashboardRoutes = require("./routes/dashboard");
const authRoutes = require("./routes/auth");
const { authMiddleware } = require("./lib/auth");

const WEBSITE_CONTEXT_URL = process.env.WEBSITE_CONTEXT_URL || "https://www.gladiatorspainting.com";
const WEBSITE_CONTEXT_MAX_CHARS = 10000;
const OPENAI_TEXT_MODEL = "gpt-4o";
const SMS_FOLLOW_UP_DELAY_MINUTES = 15;
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

function isValidE164(phone) {
  return /^\+?[1-9]\d{1,14}$/.test(String(phone || ""));
}

const REALTIME_TOOLS = [
  {
    type: "function",
    name: "book_appointment",
    description: "Finalize and save the booking. Call this when you have at least: contact name, contact phone, and address OR city. Include EVERY detail the caller gave: contact_name, contact_phone, address, city, scope (interior/exterior/both/rooms), preferred_date, notes (pets, access, etc.). Do not omit any field the caller provided—all fields are saved to the database and sent to CRM. Use for normal residential estimate requests.",
    parameters: {
      type: "object",
      properties: {
        contact_name: { type: "string" },
        contact_phone: { type: "string" },
        contact_email: { type: "string" },
        address: { type: "string" },
        city: { type: "string" },
        scope: { type: "string" },
        job_type: { type: "string" },
        preferred_date: { type: "string" },
        notes: { type: "string" },
      },
      required: ["contact_phone"],
    },
  },
  {
    type: "function",
    name: "request_human_transfer",
    description: "Transfer the caller to a live team member. Trigger this ONLY when one of these conditions is clearly met: (1) caller explicitly says it is a COMMERCIAL job, (2) caller states a project budget or value OVER $10,000, (3) caller is clearly frustrated, angry, confused, or repeatedly asks for a real person, (4) caller identifies themselves as a VIP, returning customer, or says they've called before. Do NOT transfer for normal residential estimates—use book_appointment instead. Before transferring, try to collect the caller's name and what they need so the agent receiving the call has context.",
    parameters: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          enum: ["commercial_job", "high_value_over_10k", "frustrated_caller", "vip_repeat_customer", "caller_requested_human"]
        },
        caller_name: { type: "string" },
        caller_phone: { type: "string" },
        project_type: { type: "string" },
        budget_estimate: { type: "string" },
        sentiment: { type: "string", enum: ["positive", "neutral", "frustrated", "angry"] },
        summary: { type: "string" },
      },
      required: ["reason", "summary"],
    },
  },
  {
    type: "function",
    name: "change_language",
    description: "Call this when the caller asks to speak in a different language. Use the ISO 639-1 code: en=English, es=Spanish, fr=French, hi=Hindi, zh=Chinese, ar=Arabic, etc.",
    parameters: {
      type: "object",
      properties: {
        language: { type: "string" },
      },
      required: ["language"],
    },
  },
];

const RECOVERY_TOOLS = [
  {
    type: "function",
    name: "book_appointment",
    description: "The customer agreed to book! Collect name, phone, address, scope, and finalize. This also marks the recovery as converted.",
    parameters: {
      type: "object",
      properties: {
        contact_name: { type: "string", description: "Full name" },
        contact_phone: { type: "string", description: "Phone number" },
        contact_email: { type: "string", description: "Email if given" },
        address: { type: "string", description: "Street address" },
        city: { type: "string", description: "City" },
        scope: { type: "string", description: "Interior, exterior, both, rooms" },
        job_type: { type: "string", description: "Residential or commercial" },
        preferred_date: { type: "string", description: "Preferred date" },
        notes: { type: "string", description: "Extra notes" },
      },
      required: ["contact_phone"],
    },
  },
  {
    type: "function",
    name: "detect_objection",
    description: "Call this when the customer expresses a specific objection. Types: 'price' (they say it's expensive, comparing quotes), 'thinking' (need to think about it, not sure yet), 'spouse' (need to talk to partner/spouse). This adjusts the follow-up sequence after the call.",
    parameters: {
      type: "object",
      properties: {
        objection_type: {
          type: "string",
          enum: ["price", "thinking", "spouse"],
          description: "The type of objection detected",
        },
        details: { type: "string", description: "What exactly they said" },
      },
      required: ["objection_type"],
    },
  },
  {
    type: "function",
    name: "change_language",
    description: "Switch to another language if the customer asks.",
    parameters: {
      type: "object",
      properties: {
        language: { type: "string" },
      },
      required: ["language"],
    },
  },
];

// -------------------- App --------------------
const app = express();

// Twilio status / <Connect> action callback. MUST be registered BEFORE body
// parsers so Express cannot reject a large Twilio payload with 413 (whose HTML
// error page exceeds Twilio's 64 KB response limit, triggering warning 11750).
// We respond immediately with minimal TwiML, then best-effort parse the body in
// the background for the DB update.
app.post("/twilio/status", (req, res) => {
  const twiml = '<?xml version="1.0" encoding="UTF-8"?><Response/>';
  res.writeHead(200, {
    "Content-Type": "text/xml",
    "Content-Length": Buffer.byteLength(twiml).toString(),
  });
  res.end(twiml);

  // Best-effort: read raw body and update DB in background
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    try {
      const params = new URLSearchParams(Buffer.concat(chunks).toString());
      const CallSid = params.get("CallSid");
      const CallStatus = params.get("CallStatus");
      if (CallSid && (CallStatus === "completed" || CallStatus === "busy" || CallStatus === "failed" || CallStatus === "no-answer")) {
        callsService.updateCallByTwilioSid(CallSid, { status: CallStatus, ended_at: new Date().toISOString() }).catch(() => { });
      }
    } catch (_) { /* ignore parse errors */ }
  });
  req.on("error", () => { });
});

// --- Stripe Webhook ---
// Must be handled before express.json() so we can verify the raw body signature
app.post("/stripe/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  const sig = req.headers["stripe-signature"];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!secret || !stripe) {
    console.error("[Stripe] Webhook error: Missing STRIPE_WEBHOOK_SECRET or missing STRIPE_SECRET_KEY in environment.");
    return res.status(400).send("Webhook configuration error");
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, secret);
  } catch (err) {
    console.error(`[Stripe] Webhook signature verification failed: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    await handleWebhookEvent(event);
    res.json({ received: true });
  } catch (err) {
    console.error("[Stripe] Webhook handler failed:", err);
    res.status(500).json({ error: "Webhook handler failed" });
  }
});

app.get("/chat-widget.js", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "chat-widget.js"));
});

app.use(express.static(path.join(__dirname, "public")));
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// CORS: reflect request origin so any frontend origin is allowed (e.g. :3089 → :3001).
// Required for credentials. Set CORS_ORIGINS to restrict in production (comma-separated list).
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      const restrict = process.env.CORS_ORIGINS;
      if (restrict) {
        const list = restrict.split(",").map((o) => o.trim()).filter(Boolean);
        return cb(null, list.includes(origin) ? origin : false);
      }
      cb(null, origin);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

const PORT = process.env.PORT;
const BASE_URL = process.env.BASE_URL;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
// Default: API-only (no /dashboard). Set SERVE_DASHBOARD=true for one-service deploy (API + dashboard on same URL).
const SERVE_DASHBOARD = process.env.SERVE_DASHBOARD === "true";
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER || "";
const smsThreads = new Map();
let callsTableHasTranscriptColumn = true;
let callsTableHasDurationColumn = true; // optimistic; set to false if column is missing

// Tenant map by slug/id -> { ...tenant, transferNumber }. Populated at startup so voice/WebSocket routes can resolve tenant.
let TENANTS = {};

async function loadTenants() {
  try {
    const rows = await getAllTenants();
    const map = {};
    for (const t of rows || []) {
      const transferNumber = (t.transfer_numbers && t.transfer_numbers[0]) || null;
      const entry = { ...t, transferNumber };
      map[t.slug] = entry;
      map[t.id] = entry;
    }
    if (map["gladiators-painting"]) map.gladiators = map["gladiators-painting"];
    else if (rows && rows[0]) map.gladiators = { ...rows[0], transferNumber: (rows[0].transfer_numbers && rows[0].transfer_numbers[0]) || null };
    TENANTS = map;
  } catch (e) {
    console.error("loadTenants error:", e.message);
  }
}

app.get("/health", (req, res) => res.status(200).send("OK"));

app.get("/api/public-tenant/:id", async (req, res) => {
  try {
    const tenant = await getTenantById(req.params.id);
    if (!tenant) return res.status(404).json({ error: "Tenant not found" });

    // Return only safe fields needed by the website chat widget
    res.json({
      id: tenant.id,
      name: tenant.name,
      company_name: tenant.company_name,
      welcome_message: tenant.welcome_message,
      timezone: tenant.timezone
    });
  } catch (error) {
    console.error("Public tenant API error:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});
app.use("/twilio", twilioRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/stripe", authMiddleware, require("./routes/stripe"));
app.use("/api", authMiddleware, dashboardRoutes);

if (SERVE_DASHBOARD) {
  app.use(express.static(path.join(__dirname, "dashboard", "dist")));
  app.get("*", (req, res) => {
    res.sendFile(path.join(__dirname, "dashboard", "dist", "index.html"));
  });
} else {
  const FRONTEND_URL = process.env.FRONTEND_URL || "";
  app.get("/", (req, res) => {
    if (FRONTEND_URL) return res.redirect(302, FRONTEND_URL);
    res.set("Content-Type", "text/plain").status(200).send(
      "AI Front Desk API. Dashboard is deployed separately. Use your frontend URL to sign in, or set FRONTEND_URL to redirect / here."
    );
  });
}

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
  if (!pool) return null;
  try {
    return await pool.query(query, values);
  } catch (error) {
    console.error("DB query failed:", error.message);
    return null;
  }
}


async function safeUpdateCallSummary(callId, options = {}) {
  try {
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

      if (callsTableHasDurationColumn) {
        setParts.push("duration_minutes = EXTRACT(EPOCH FROM (now() - started_at)) / 60");
      }

      const query = `UPDATE calls
           SET ${setParts.join(",\n             ")}
           WHERE id = $1`;

      if (!pool) return;
      await pool.query(query, values);
    }

    try {
      await runUpdate(callsTableHasTranscriptColumn);
    } catch (error) {
      // Check if it's a "column does not exist" error (Postgres error code 42703)
      if (error.code === "42703") {
        if (callsTableHasTranscriptColumn && /transcript/i.test(error.message)) {
          callsTableHasTranscriptColumn = false;
          console.warn("calls.transcript column not found; continuing without transcript persistence.");
          return safeUpdateCallSummary(callId, options); // Retry without transcript
        }
        if (callsTableHasDurationColumn && /duration_minutes/i.test(error.message)) {
          callsTableHasDurationColumn = false;
          console.warn("calls.duration_minutes column not found; continuing without duration calculation.");
          return safeUpdateCallSummary(callId, options); // Retry without duration
        }
      }
      console.error("DB query failed in safeUpdateCallSummary:", error.message);
    }
  } catch (criticalErr) {
    console.error("Critical error in safeUpdateCallSummary wrapper:", criticalErr.message);
  }
}

async function sendToCRM(leadCapture, tenantId = null) {
  let url = process.env.CRM_WEBHOOK_URL || process.env.ZAPIER_WEBHOOK_URL;

  // If a tenantId is provided, try to use their specific webhook
  if (tenantId && TENANTS[tenantId] && TENANTS[tenantId].crm_webhook_url) {
    url = TENANTS[tenantId].crm_webhook_url;
  }

  if (!url) {
    console.warn(`CRM webhook not configured for tenant ${tenantId || "global"}. Skipping lead push.`);
    return;
  }

  try {
    const response = await fetch(url, {
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
    followUpCount: 0, // 0 = no follow-ups sent yet. Max is 2.
    channel: normalizedPhone.startsWith("fb-") ? "facebook" : (normalizedPhone.startsWith("web-") ? "website" : "sms"),
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

function buildSmsSystemPrompt(thread, tenant = null) {
  const companyName = tenant?.company_name || tenant?.name || "Gladiators Painting";
  const instructions = tenant?.instructions || [
    "Flow: qualify lead, gather full_name, project_type, project_details, address, preferred appointment_date and appointment_time.",
    "Be concise, friendly, and use one short text message.",
    "If enough details exist to request booking, set should_book true and provide appointment_date/time."
  ].join("\n");

  return [
    `You are an SMS receptionist for ${companyName}.`,
    `Instructions: ${instructions}`,
    "Return strict JSON only with keys: reply, lead_capture, should_book, appointment_date, appointment_time, follow_up_minutes.",
    `Known lead data: ${JSON.stringify(thread.leadCapture)}`
  ].join("\n");
}

async function runSmsAiOrchestrator(thread, incomingText, tenant = null) {
  const input = [
    { role: "system", content: buildSmsSystemPrompt(thread, tenant) },
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

async function handleLeadBooking(thread, ai, tenantOverride = null) {
  if (!ai.should_book || !ai.appointment_date || !ai.appointment_time) return null;

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

  // Use local date components to avoid timezone shift from toISOString()
  const y = parsedDate.getFullYear();
  const m = String(parsedDate.getMonth() + 1).padStart(2, '0');
  const d = String(parsedDate.getDate()).padStart(2, '0');
  ai.appointment_date = `${y}-${m}-${d}`;

  if (ai.appointment_time === "morning") ai.appointment_time = "9:00 AM";
  if (ai.appointment_time === "afternoon") ai.appointment_time = "1:00 PM";
  if (ai.appointment_time === "evening") ai.appointment_time = "6:00 PM";

  const availability = await checkAvailability({
    appointment_date: ai.appointment_date,
    appointment_time: ai.appointment_time,
    duration_minutes: 60
  });

  const isAvailable = (availability.ok && availability.available) || (availability.reason === "calendar_not_configured");

  if (isAvailable) {
    let booked = { ok: false };
    if (availability.reason !== "calendar_not_configured") {
      booked = await bookAppointment({
        appointment_date: ai.appointment_date,
        appointment_time: ai.appointment_time,
        duration_minutes: 60,
        full_name: thread.leadCapture.full_name || "New Lead",
        phone: thread.leadCapture?.phone || thread.phone,
        email: thread.leadCapture.email || "",
        address: thread.leadCapture.address || "",
        project_details: thread.leadCapture.project_details || ""
      });
    } else {
      // Fallback: assume OK if calendar is disabled
      booked = { ok: true, fallback: true };
    }

    if (booked.ok) {
      thread.bookedEventId = booked.eventId || "";
      thread.needsFollowUpAt = Date.now() + 24 * 60 * 60 * 1000;

      // PERSIST TO LOCAL DATABASE
      try {
        const tenant = tenantOverride || TENANTS.gladiators;
        if (tenant) {
          await bookingsService.createBooking(tenant.id, null, {
            contact_name: thread.leadCapture.full_name || "New Lead",
            contact_phone: thread.leadCapture?.phone || thread.phone,
            contact_email: thread.leadCapture.email || "",
            address: thread.leadCapture.address || "",
            city: "",
            scope: thread.leadCapture.project_type || "",
            job_type: "Residential",
            preferred_date: ai.appointment_date,
            notes: thread.leadCapture.project_details || ""
          });
        }
      } catch (dbErr) {
        console.error("[Booking] Local DB persistence failed:", dbErr.message);
      }

      return `✅ You are booked for ${ai.appointment_date} at ${ai.appointment_time}.`;
    } else {
      return "I couldn't complete booking yet. Can I offer another time?";
    }
  } else {
    thread.needsFollowUpAt = Date.now() + 30 * 60 * 1000;
    return "That time is no longer available. Please share another preferred time.";
  }
}

async function processSmsConversation(phone, incomingText, tenant = null) {
  const thread = getOrCreateSmsThread(phone);
  thread.lastInboundAt = Date.now();
  thread.history.push({ role: "user", text: incomingText, at: new Date().toISOString() });

  let ai;
  try {
    ai = await runSmsAiOrchestrator(thread, incomingText, tenant);

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
      phone: thread.leadCapture?.phone || thread.phone || "",
      email: thread.leadCapture?.email || "",
      address: thread.leadCapture?.address || "",
      project_type: thread.leadCapture?.project_type || "",
      project_details: thread.leadCapture?.project_details || "",
      lead_type: ai.should_book ? "BOOKED" : "INQUIRY",
      timestamp: new Date().toISOString(),
      tenant_id: tenant?.id || null,
      tenant_name: tenant?.name || null,
      company_name: tenant?.company_name || null
    }, tenant?.id);
  }
  if (!thread.leadCapture.phone && !thread.phone.startsWith("fb-") && !thread.phone.startsWith("web-")) {
    thread.leadCapture.phone = thread.phone;
  }

  let replyText = ai.reply || "Thanks for reaching out!";

  const bookingResult = await handleLeadBooking(thread, ai, tenant);
  if (bookingResult) {
    replyText = `${replyText} ${bookingResult}`;
  } else if (!ai.should_book) {
    // If not booking, default to a 2-hour delay for the primary follow-up unless the AI specified
    const followUpMinutes = Number(ai.follow_up_minutes) || 120;
    thread.needsFollowUpAt = Date.now() + followUpMinutes * 60 * 1000;
  }

  // Reset follow up count because they just replied
  thread.followUpCount = 0;
  await forwardLeadCaptureToCRM(thread.leadCapture, { sent: false }, tenant?.id);

  thread.history.push({ role: "assistant", text: replyText, at: new Date().toISOString() });
  thread.lastOutboundAt = Date.now();

  return replyText;
}
async function processFacebookConversation(senderId, messageText, tenant = null) {
  const threadKey = `fb-${senderId}`;
  const thread = getOrCreateSmsThread(threadKey);

  // Set the channel explicitly so Zapier/CRM knows it came from Facebook
  thread.channel = "facebook";

  thread.lastInboundAt = Date.now();
  thread.history.push({ role: "user", text: messageText, at: new Date().toISOString() });

  let ai;
  try {
    // We reuse the exact same AI orchestrator as SMS and Web Chat
    ai = await runSmsAiOrchestrator(thread, messageText, tenant);
    console.log("[Facebook] AI STRUCTURED OUTPUT:", JSON.stringify(ai, null, 2));
  } catch (error) {
    console.error("[Facebook] AI orchestration failed:", error.message);
    ai = {
      reply: "Got it 👍 Let me take a closer look at that for you.",
      should_book: false,
      follow_up_minutes: SMS_FOLLOW_UP_DELAY_MINUTES,
      lead_capture: {}
    };
  }

  // Update thread with any captured lead info
  mergeLeadCapture(thread, ai.lead_capture);

  // If we have a name or an actual phone number (not the fb- thread key), send to CRM/Zapier
  // We check that thread.phone exists and isn't just the fb- string if we are relying on that
  const hasPhoneToSend = thread.leadCapture?.phone || (thread.phone && !thread.phone.startsWith("fb-") && !thread.phone.startsWith("web-"));

  if (thread.leadCapture?.full_name || hasPhoneToSend) {
    await sendToCRM({
      source: thread.channel || "facebook",
      full_name: thread.leadCapture?.full_name || "",
      phone: thread.leadCapture?.phone || thread.phone || "",
      email: thread.leadCapture?.email || "",
      address: thread.leadCapture?.address || "",
      project_type: thread.leadCapture?.project_type || "",
      project_details: thread.leadCapture?.project_details || "",
      lead_type: ai.should_book ? "BOOKED" : "INQUIRY",
      timestamp: new Date().toISOString(),
      tenant_id: tenant?.id || null,
      tenant_name: tenant?.name || null,
      company_name: tenant?.company_name || null
    }, tenant?.id);
  }

  // Ensure the phone field is hydrated in the lead capture object for future reference
  if (!thread.leadCapture.phone && hasPhoneToSend) {
    thread.leadCapture.phone = thread.phone;
  }

  let replyText = ai.reply || "Thanks for reaching out!";

  const bookingResult = await handleLeadBooking(thread, ai, tenant);
  if (bookingResult) {
    replyText = `${replyText} ${bookingResult}`;
  } else if (!ai.should_book) {
    // Default follow up for inquiry
    const followUpMinutes = Number(ai.follow_up_minutes) || 120;
    thread.needsFollowUpAt = Date.now() + followUpMinutes * 60 * 1000;
  }

  // Reset follow up count because they just replied
  thread.followUpCount = 0;

  // Record response in history
  thread.history.push({ role: "assistant", text: replyText, at: new Date().toISOString() });
  thread.lastOutboundAt = Date.now();

  return replyText;
}



async function sendTypingIndicator(recipientId, action = "typing_on", accessTokenOverride = null) {
  const PAGE_ACCESS_TOKEN = accessTokenOverride || process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
  if (!PAGE_ACCESS_TOKEN) return;

  try {
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
  } catch (err) {
    console.error("[Facebook] Typing indicator error:", err.message);
  }
}

async function sendFacebookMessage(recipientId, messageText, quickReplies = [], accessTokenOverride = null) {
  const PAGE_ACCESS_TOKEN = accessTokenOverride || process.env.FACEBOOK_PAGE_ACCESS_TOKEN;

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

  try {
    const response = await fetch(
      `https://graph.facebook.com/v18.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      }
    );

    if (!response.ok) {
      const errorBody = await response.text();
      console.error("[Facebook] Failed to send message:", response.status, errorBody);
    } else {
      console.log(`[Facebook] Successfully sent message to ${recipientId}`);
    }
  } catch (err) {
    console.error("[Facebook] fetch error:", err.message);
  }
}
async function runSmsFollowUps() {
  const now = Date.now();
  for (const thread of smsThreads.values()) {
    if (!thread.needsFollowUpAt || thread.needsFollowUpAt > now) continue;

    // Enforce 2-touch limit: Do not follow up if we have already reached out twice
    if (thread.followUpCount >= 2) {
      thread.needsFollowUpAt = null; // Mark as done
      continue;
    }

    const recentInboundMs = thread.lastInboundAt ? now - thread.lastInboundAt : Infinity;
    if (recentInboundMs < 10 * 60 * 1000) continue; // Don't follow up if they just messaged us

    const followUpText = thread.bookedEventId
      ? "Quick follow-up: your appointment is on our schedule. Reply here if you need to reschedule."
      : "Just checking in — would you like me to help you lock in a time for your estimate?";

    let sent = { ok: false };

    // Transition channel logic for Web Widget
    if (thread.channel === "website") {
      // If we captured their real phone number during the website chat, we transition to SMS.
      if (thread.leadCapture.phone) {
        sent = await sendTwilioSms(thread.leadCapture.phone, followUpText);
      } else {
        // Can't follow up on a web widget if we don't have their phone number, so mark as complete
        thread.needsFollowUpAt = null;
        continue;
      }
    } else if (thread.channel === "facebook") {
      const fbId = thread.phone.replace("fb-", "");
      await sendFacebookMessage(fbId, followUpText);
      sent = { ok: true };
    } else {
      // SMS channel
      sent = await sendTwilioSms(thread.phone, followUpText);
    }

    if (sent.ok) {
      thread.history.push({ role: "assistant", text: followUpText, at: new Date().toISOString() });
      thread.lastOutboundAt = now;
      thread.followUpCount++;

      // If this was Touch 1, schedule Touch 2 for 24 hours later. Check if it's the 2nd touch, mark completed.
      if (thread.followUpCount < 2) {
        thread.needsFollowUpAt = now + 24 * 60 * 60 * 1000;
      } else {
        thread.needsFollowUpAt = null;
      }
    } else {
      // If it failed, retry in 15 mins
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

async function forwardLeadCaptureToCRM(rawPayload, crmLeadSentRef, tenantId = null) {
  if (crmLeadSentRef.sent) return;
  const leadCapture = parsePotentialLeadCapture(rawPayload);
  if (!leadCapture) return;

  crmLeadSentRef.sent = true;
  await sendToCRM(leadCapture, tenantId);
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
    const tenant = await getTenantByPhone(req.body?.To || req.body?.to);
    const reply = await processSmsConversation(from, body, tenant);
    res.type("text/xml").status(200).send(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(reply)}</Message></Response>`);
  } catch (error) {
    console.error("Twilio SMS webhook error:", error.message);
    res.type("text/xml").status(200).send(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>Thanks — we received your message and will text you shortly.</Message></Response>`);
  }
});

app.get("/twilio/recovery-call", (req, res) => {
  const recoveryId = req.query.recoveryId;
  const script = req.query.script;

  if (!recoveryId || !script) {
    res.status(400).send("Missing recoveryId or script");
    return;
  }

  const requestBaseUrl = resolveBaseUrl(req);
  if (!requestBaseUrl) {
    res.status(500).send("Cannot resolve base URL");
    return;
  }

  // The wss:// url that Twilio will use to stream audio back to the server
  // We pass type=recovery so the websocket connection knows how to handle it
  const wssUrl = `${requestBaseUrl.replace(/^http/, "ws")}/twilio-media?type=recovery&recoveryId=${encodeURIComponent(recoveryId)}&script=${encodeURIComponent(script)}`;

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${wssUrl}" />
  </Connect>
</Response>`;

  res.type("text/xml").send(twiml);
});

app.post("/twilio/recovery-call-status", (req, res) => {
  const recoveryId = req.query.recoveryId;
  const callStatus = req.body.CallStatus;
  const callDuration = req.body.CallDuration;

  console.log(`[Recovery] Call status update for recoveryId=${recoveryId}: ${callStatus} (Duration: ${callDuration}s)`);
  res.sendStatus(200);
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
  const q = Object.fromEntries(parsedUrl.searchParams.entries());

  const isRecovery = q.type === "recovery";
  const recoveryId = q.recoveryId;
  const recoveryScript = q.script ? decodeURIComponent(q.script) : "";

  console.log("[AI-Desk] Connection path=%s isRecovery=%s recoveryId=%s", pathname, isRecovery, recoveryId);

  const pathSegments = pathname.split("/").filter(Boolean);
  const tenantIdFromPath = pathSegments.length >= 2 ? pathSegments[1] : "";
  const tenantId = TENANTS[tenantIdFromPath] ? tenantIdFromPath : "gladiators";
  let tenant = TENANTS[tenantId];

  if (!tenant && !isRecovery) {
    console.error("[AI-Desk] No tenant for path segment:", tenantIdFromPath, "- ensure DB is seeded and loadTenants ran.");
    twilioSocket.close();
    return;
  }

  if (!pathname.startsWith("/twilio-media")) {
    console.error("Invalid Twilio media stream path:", pathname);
    twilioSocket.close();
    return;
  }

  if (!OPENAI_API_KEY) {
    console.error("❌ Missing OPENAI_API_KEY env var. Closing stream.");
    twilioSocket.close();
    return;
  }

  let callId = crypto.randomUUID();
  let callSid = null;
  let streamSid = null;
  let from = null;
  let to = null;
  let transcript = "";
  let transferAttempted = false;

  const pendingTwilioAudio = [];
  const openaiQueue = [];
  let openaiReady = false;
  let openaiSocket = null;
  const crmLeadSentRef = { sent: false };
  const openaiModelCandidates = [...new Set([process.env.OPENAI_MODEL, "gpt-4o-realtime-preview-2024-12-17", "gpt-realtime"])]
    .filter(Boolean);

  function sendToOpenAI(payload) {
    const message = typeof payload === "string" ? payload : JSON.stringify(payload);
    if (!message.includes("input_audio_buffer.append")) {
      console.log("[DEBUG] sendToOpenAI:", message.slice(0, 500));
    }
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
    const model = openaiModelCandidates[modelIndex] || openaiModelCandidates[0];
    const url = `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`;
    openaiSocket = new WebSocket(url, {
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "OpenAI-Beta": "realtime=v1"
      },
    });
    openaiSocket.on("open", async () => {
      openaiReady = true;
      while (openaiQueue.length) {
        const msg = openaiQueue.shift();
        console.log("[DEBUG] Flushing from openaiQueue:", msg.slice(0, 500));
        openaiSocket.send(msg);
      }

      let recoveryRecord = null;
      if (isRecovery && recoveryId) {
        try {
          recoveryRecord = await estimateRecoveryService.getRecoveryById(recoveryId);
          if (recoveryRecord) {
            tenant = await getTenantById(recoveryRecord.tenant_id);
            console.log("[AI-Desk] Recovery call loaded recoveryId=%s tenant=%s contact=%s", recoveryId, tenant?.company_name, recoveryRecord.contact_name);
          }
        } catch (e) {
          console.error("[AI-Desk] Recovery load error:", e.message);
        }
      }

      if (callSid) {
        const call = await callsService.getCallByTwilioSid(callSid);
        if (call) {
          callId = call.id;
          if (!tenant) tenant = await getTenantById(call.tenant_id);
        }
        if (!tenant && (to || from)) {
          tenant = await getTenantByPhone(to);
          if (!tenant && from) tenant = await getTenantByPhone(from);
        }
        if (tenant) {
          console.log("[AI-Desk] Realtime stream ready callSid=%s tenantId=%s callId=%s from=%s to=%s recovery=%s", callSid, tenant?.id, callId || "(none)", from, to, isRecovery);
          if (tenant.id && callSid) {
            recordingService.startRecording(callSid, tenant).catch((e) => console.error("Start recording error:", e));
          }
        } else {
          console.log("[AI-Desk] Realtime stream no tenant callSid=%s callFound=%s to=%s from=%s recovery=%s", callSid, !!call, to, from, isRecovery);
        }
      }

      const defaultInstructions = [
        "You are a professional receptionist. Be warm and helpful.",
        "Default language is English. If the caller asks to speak in another language (e.g. Spanish, French, Hindi), immediately call the change_language tool with the ISO 639-1 code (es, fr, hi, zh, ar, etc.), then confirm in that language and continue the entire conversation in that language.",
        "Ask one question at a time. Wait for the caller to finish speaking before you reply—do not interrupt.",
        "Collect these details before booking: (1) full name, (2) phone number, (3) address or city, (4) what they need—interior, exterior, both, or rooms (scope), (5) preferred date if they give one, (6) any extra notes (pets, access, etc.). Offer a free on-site estimate.",
        "When you have at least name, phone, and address OR city: call book_appointment with ALL the details the caller gave—include contact_name, contact_phone, address or city, scope, preferred_date, and notes. Do not omit fields they provided.",
        "Right after calling book_appointment successfully, say clearly and then stop: 'You're all set—your estimate is scheduled. We've sent your details to our team and you'll get a confirmation by text. Thank you for calling. Have a great day. Goodbye.' Then allow the call to end naturally.",
        "Do NOT say you are transferring or connecting to someone unless you actually need a live agent. Only use request_human_transfer for: commercial job, project over $10k, caller clearly frustrated or angry, or VIP/repeat customer. For normal residential estimates, always complete the booking with book_appointment.",
        "Repeat back key details (name, phone, address, scope) before finalizing so the caller can correct you if needed.",
      ].join(" ");
      let instructions = (tenant && tenant.instructions)
        ? tenant.instructions
        : defaultInstructions;

      if (isRecovery && recoveryScript) {
        instructions = `You are performing an automated outbound follow-up call.
        START the call by saying EXACTLY this: "${recoveryScript}". 
        
        YOUR GOAL: Open conversation and move them toward booking the estimate they received. 
        
        OBJECTION HANDLING:
        1. If they say "I need to think about it" or similar:
           Your response: "Totally understand — it’s a big decision. Is there anything specific you’re weighing that I can help with?"
           Immediately call 'detect_objection' with type 'thinking'.
        
        2. If they say "The price is high", "Getting other quotes", or similar:
           Your response: "I completely understand — most homeowners compare 2–3 options. Besides price, is there anything else important in your decision?"
           Immediately call 'detect_objection' with type 'price'.
           
        3. If they say "I need to talk to my wife/spouse/partner" or similar:
           Your response: "Of course — would it help if I sent over a quick summary you can share?"
           Immediately call 'detect_objection' with type 'spouse'.
           
        4. If they are ready to book:
           Collect any missing details (name, phone, address, scope, preferred date) and call 'book_appointment'. 
           
        Be warm, helpful, and professional. The goal is to open conversation, not pressure them.`;
      }

      const voice = process.env.OPENAI_REALTIME_VOICE || "shimmer";
      const silenceMs = parseInt(process.env.REALTIME_SILENCE_MS, 10) || 800;
      const payloadToOpenAI = {
        type: "session.update",
        session: {
          input_audio_format: "g711_ulaw",
          output_audio_format: "g711_ulaw",
          voice,
          instructions: `${instructions}\n\nSpeak clearly at a moderate pace. Let the caller finish before you respond. Always speak in English.`,
          tools: isRecovery ? RECOVERY_TOOLS : REALTIME_TOOLS,
          turn_detection: {
            type: "server_vad",
            threshold: 0.5,
            prefix_padding_ms: 300,
            silence_duration_ms: silenceMs,
          },
        },
      };

      console.log("[DEBUG] Sending payload to OpenAI:", JSON.stringify(payloadToOpenAI, null, 2));
      sendToOpenAI(payloadToOpenAI);

      if (isRecovery && recoveryScript) {
        console.log("[AI-Desk] Triggering recovery greeting: %s", recoveryScript);
        sendToOpenAI({
          type: "response.create",
          response: {
            modalities: ["audio", "text"],
            instructions: `Greet the user by saying EXACTLY this and nothing else yet: "${recoveryScript}"`
          }
        });
      }
    });

    openaiSocket.on("message", async (msg) => {
      let data;
      try {
        data = JSON.parse(msg.toString());
      } catch (e) {
        return;
      }

      if (data.type === "response.audio.delta" && data.delta) {
        // console.log("[DEBUG] Received audio delta from OpenAI (length: %d)", data.delta.length);
        sendAudioToTwilio(data.delta);
        return;
      }

      if (data.type === "input_audio_buffer.speech_started") {
        console.log("[AI-Desk] User started speaking");
      }

      if (data.type === "response.function_call_arguments.done") {
        const { name, arguments: argsJson } = data;
        let output = "";
        let args = {};
        try {
          if (argsJson != null) {
            if (typeof argsJson === "object" && !Array.isArray(argsJson)) {
              args = argsJson;
            } else {
              const raw = typeof argsJson === "string" ? argsJson : String(argsJson);
              try {
                args = JSON.parse(raw);
              } catch (parseErr) {
                const repaired = raw.trim().replace(/,(\s*[}\]])/g, "$1");
                try {
                  args = JSON.parse(repaired);
                } catch (_) {
                  console.error("[AI-Desk] Realtime tool args parse failed name=%s error=%s raw=%s", name, parseErr.message, raw.slice(0, 200));
                  output = JSON.stringify({ success: false, error: "Invalid format. Please ask the caller again for their name, phone, and address, then complete the booking." });
                  sendToOpenAI({
                    type: "conversation.item.create",
                    item: { type: "function_call_output", call_id: data.call_id, output },
                  });
                  return;
                }
              }
            }
          }
          try {
            if (name === "book_appointment" && tenant && callId) {
              console.log("[AI-Desk] Realtime book_appointment callSid=%s tenantId=%s callId=%s recovery=%s", callSid, tenant.id, callId, isRecovery);
              const { booking, crmSynced } = await bookingsService.createBooking(tenant.id, callId, args);
              console.log("[AI-Desk] Realtime booking done id=%s crmSynced=%s", booking.id, crmSynced);

              if (isRecovery && recoveryRecord) {
                await estimateRecoveryService.markConverted(recoveryRecord.id);
                console.log("[AI-Desk] Recovery CONVERTED id=%s 🎉", recoveryRecord.id);
              }

              const message = crmSynced
                ? "Estimate scheduled. Details synced to Zapier/DripJobs. Say to the caller: You're all set—your estimate is scheduled. We've sent your details to our team and you'll get a confirmation by text. Thank you for calling. Have a great day. Goodbye."
                : "Estimate scheduled and saved. Say to the caller: You're all set—your estimate is scheduled. You'll get a confirmation by text. Thank you for calling. Have a great day. Goodbye.";
              output = JSON.stringify({ success: true, message });
            } else if (name === "detect_objection" && isRecovery && recoveryRecord) {
              const objType = args.objection_type;
              console.log("[AI-Desk] Recovery objection detected id=%s type=%s details=%s", recoveryRecord.id, objType, args.details || "(none)");
              await estimateRecoveryService.setObjection(recoveryRecord.id, objType);
              await estimateRecoveryService.recordResponse(recoveryRecord.id);
              output = JSON.stringify({ success: true, message: `Objection ${objType} recorded. Adjusting follow-up sequence.` });
            } else if (name === "request_human_transfer" && callSid && tenant) {
              const result = await transferService.initiateTransfer(
                callSid,
                null,
                args.reason,
                args.summary
              );
              output = JSON.stringify(result);
            } else if (name === "change_language" && args.language) {
              const lang = String(args.language).trim().toLowerCase().slice(0, 2) || "en";
              sendToOpenAI({
                type: "session.update",
                session: {
                  input_audio_transcription: {
                    model: "whisper-1",
                    language: lang,
                  },
                },
              });
              const langNames = { en: "English", es: "Spanish", fr: "French", hi: "Hindi", zh: "Chinese", ar: "Arabic" };
              const langName = langNames[lang] || lang;
              output = JSON.stringify({ success: true, language: lang, message: `Switched to ${langName}. Respond in ${langName} from now on and confirm briefly to the caller.` });
            } else {
              console.log("[AI-Desk] Realtime book_appointment skipped (missing context) hasTenant=%s hasCallId=%s", !!tenant, !!callId);
              output = JSON.stringify({ success: false, error: "Missing context" });
            }
          } catch (err) {
            console.error("[AI-Desk] Realtime tool error name=%s error=%s", name, err.message);
            output = JSON.stringify({ success: false, error: err.message });
          }
        } catch (err) {
          console.error("[AI-Desk] Realtime tool error name=%s error=%s", name, err.message);
          output = JSON.stringify({ success: false, error: err.message });
        }
        if (!output) return;
        sendToOpenAI({
          type: "conversation.item.create",
          item: {
            type: "function_call_output",
            call_id: data.call_id,
            output,
          },
        });
        return;
      }

      if (data.type === "response.completed") {
        const callerAskedHuman = /human|person|representative|manager|transfer/i.test(transcript);
        if (callerAskedHuman && !transferAttempted && isBusinessHours(tenant)) {
          transferAttempted = true;
          await attemptTransfer(callSid, tenant);
        }
        await safeUpdateCallSummary(callId, { transcript });
        return;
      }

      if (data.type && data.type.includes("error")) {
        console.error("[AI-Desk] OpenAI error type=%s", data.type, data);
      }
    });

    openaiSocket.on("error", (err) => console.error("OpenAI socket error:", err));
    openaiSocket.on("close", () => { openaiReady = false; });
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

      const insertRes = await safePoolQuery(
        `INSERT INTO calls (id, tenant_id, twilio_call_sid, started_at, status)
         VALUES ($1, $2, $3, now(), $4)
         ON CONFLICT (twilio_call_sid) DO UPDATE SET status = 'in_progress'
         RETURNING id`,
        [callId, tenant.id, callSid, "in_progress"]
      );

      if (insertRes && insertRes.rows && insertRes.rows.length > 0) {
        callId = insertRes.rows[0].id;
      }
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
}, Math.max(60000, parseInt(process.env.SMS_FOLLOW_UP_CHECK_INTERVAL_MS, 10) || 60000));

app.post("/website-chat", async (req, res) => {
  const message = String(req.body?.message || "").trim();
  const tenantId = req.body?.tenantId;

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

    const tenant = tenantId ? await getTenantById(tenantId) : null;

    // Explicitly set channel as website
    const thread = getOrCreateSmsThread(sessionId);
    thread.channel = "website";

    const reply = await processSmsConversation(sessionId, message, tenant);
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
    console.log("[Facebook Webhook] Payload:", JSON.stringify(req.body, null, 2));

    const entry = req.body.entry?.[0];
    const messaging = entry?.messaging?.[0];
    const pageId = entry?.id; // The Page ID receiving the message

    // Look up the tenant for this Page ID
    const tenant = pageId ? await getTenantByFacebookPageId(pageId) : null;
    const pageAccessToken = tenant?.facebook_page_access_token || process.env.FACEBOOK_PAGE_ACCESS_TOKEN;

    if (!pageAccessToken) {
      console.warn("[Facebook] No access token for Page ID:", pageId);
      return res.sendStatus(200);
    }

    // 🔥 Handle Persistent Menu / Postback Buttons
    if (messaging?.postback) {
      const senderId = messaging.sender.id;
      const payload = messaging.postback.payload;

      if (payload === "GET_STARTED") {
        await sendFacebookMessage(
          senderId,
          "👋 Welcome to Gladiators Painting! How can we help you today?",
          [],
          pageAccessToken
        );
        return res.sendStatus(200);
      }

      if (payload === "GET_QUOTE") {
        await sendFacebookMessage(
          senderId,
          "Great! What type of painting project are you planning?",
          [],
          pageAccessToken
        );
        return res.sendStatus(200);
      }

      if (payload === "BOOK_ESTIMATE") {
        await sendFacebookMessage(
          senderId,
          "Perfect. What day works best for your estimate?",
          [],
          pageAccessToken
        );
        return res.sendStatus(200);
      }

      if (payload === "TALK_HUMAN") {
        await sendFacebookMessage(
          senderId,
          "No problem 👍 A team member will reach out shortly.",
          [],
          pageAccessToken
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
    await sendTypingIndicator(senderId, "typing_on", pageAccessToken);

    // 2–3 second delay
    await delay(2000 + Math.random() * 1000);

    // Stop typing indicator
    await sendTypingIndicator(senderId, "typing_off", pageAccessToken);

    const reply = await processFacebookConversation(senderId, messageText, tenant);

    await sendFacebookMessage(
      senderId,
      reply,
      ["Get a Free Quote", "Talk to a Human", "Book Estimate"],
      pageAccessToken
    );

    res.sendStatus(200);
  } catch (error) {
    console.error("Facebook webhook error:", error.message);
    res.sendStatus(200); // Always 200 to FB
  }
});

app.post("/data-deletion", (req, res) => {
  // Facebook requires a data deletion callback url to publish the app.
  // We just return a mock confirmation code.
  const confirmationCode = "del_" + Date.now();
  res.json({
    url: `${process.env.BASE_URL}/data-deletion?id=${confirmationCode}`,
    confirmation_code: confirmationCode
  });
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
loadTenants().then(() => {
  server.listen(PORT, () => {
    console.log(`AI front desk backend listening on port ${PORT}`);
  });
});
