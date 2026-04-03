"use strict";

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

process.on("uncaughtException", (err) => {
  console.error("FATAL: Uncaught Exception:", err.stack || err);
  // Give logs a moment to flush
  setTimeout(() => process.exit(1), 500);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("FATAL: Unhandled Rejection at:", promise, "reason:", reason?.stack || reason);
  // Give logs a moment to flush
  setTimeout(() => process.exit(1), 500);
});

const { handleWebhookEvent, stripe } = require("./lib/stripe");
// BASE_URL must be the backend root (no /dashboard). Strip if set wrong so Twilio/webhooks work.
if (process.env.BASE_URL) {
  process.env.BASE_URL = process.env.BASE_URL.replace(/\/dashboard\/?$/, "").replace(/\/$/, "") || process.env.BASE_URL;
}

const cors = require("cors");
const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const crypto = require("crypto");
const fetch = require("node-fetch");
const db = require("./lib/db");
const pool = db.pool;
const calendar = require("./calendar");
const { getCalendarForTenant } = require("./calendar");
const cron = require("node-cron");

const { getTenantByPhone, getTenantById, getAllTenants, getTenantByFacebookPageId, getTenantBySlug } = require("./lib/tenant");
const callsService = require("./services/calls");
const recordingService = require("./services/recording");
const transferService = require("./services/transfer");
const bookingsService = require("./services/bookings");
const followUpService = require("./services/followUp");
const nurturingService = require("./services/nurturing");
const estimateRecoveryService = require("./services/estimateRecovery");
const twilioLib = require("./lib/twilio");
const salesEngine = require("./services/salesEngine");
const leadsService = require("./services/leads");
const messagesService = require("./services/messages");
const emailService = require("./services/email");
const { getAIConfig, REALTIME_TOOLS, RECOVERY_TOOLS } = require("./lib/orchestrator");
const { isWithinBusinessHours } = require("./lib/timeUtils");

const _resetBase = (process.env.DASHBOARD_URL || process.env.BASE_URL || "").replace(/\/$/, "");
console.log("[Startup] Password reset: Resend=" + (process.env.RESEND_API_KEY && process.env.EMAIL_FROM ? "yes" : "no") + ", ResetLinkBase=" + (_resetBase || "NOT SET – set DASHBOARD_URL or BASE_URL"));

const twilioRoutes = require("./routes/twilio");
const dashboardRoutes = require("./routes/dashboard");
const authRoutes = require("./routes/auth");
const leadRoutes = require("./routes/leads");
const billingRoutes = require("./routes/billing");
const outboundRoutes = require("./routes/outbound");
const { startOutboundEngine } = require("./services/outboundEngine");
const { authMiddleware, requireSuperAdmin } = require("./lib/auth");

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

// Resend inbound webhook: must receive raw body for signature verification (Svix)
app.post("/webhooks/resend/inbound", express.raw({ type: "application/json", limit: "1mb" }), async (req, res) => {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  const rawBody = req.body;
  if (secret && Buffer.isBuffer(rawBody)) {
    try {
      const { Webhook } = require("svix");
      const wh = new Webhook(secret);
      wh.verify(rawBody, {
        "svix-id": req.headers["svix-id"],
        "svix-timestamp": req.headers["svix-timestamp"],
        "svix-signature": req.headers["svix-signature"],
      });
    } catch (e) {
      console.error("[Resend Inbound] Webhook signature verification failed:", e.message);
      return res.status(401).send("Invalid signature");
    }
  }
  let event;
  try {
    event = typeof rawBody === "object" && !Buffer.isBuffer(rawBody) ? rawBody : JSON.parse(rawBody.toString());
  } catch (_) {
    return res.status(400).send("Invalid JSON");
  }
  res.status(200).send();
  if (!event || event.type !== "email.received" || !event.data) return;
  const data = event.data;
  console.log("[Resend Inbound] Full Data:", JSON.stringify(data, null, 2));
  const fromRaw = data.from || "";
  const toList = Array.isArray(data.to) ? data.to : [data.to].filter(Boolean);
  const subject = data.subject || "(No subject)";
  const emailId = data.email_id;
  const fromEmail = fromRaw.includes("<") ? fromRaw.replace(/^.*<([^>]+)>.*$/, "$1").trim() : fromRaw.trim();
  if (!fromEmail || !fromEmail.includes("@")) return;
  try {
    const leadRow = await db.query(
      "SELECT id, tenant_id FROM leads WHERE email = $1 ORDER BY updated_at DESC LIMIT 1",
      [fromEmail]
    ).then((r) => r.rows[0]);
    if (!leadRow) {
      console.log("[Resend Inbound] No lead found for reply from:", fromEmail, "subject:", subject);
      return;
    }
    console.log("[Resend Inbound] Data Keys:", Object.keys(data).join(", "));
    const bodyText = data.text || data.body_text || "";
    const bodyHtml = data.html || data.body_html || "";
    const snippet = data.snippet || "";
    // Priority: text, then stripped-down-ish html, then snippet, then fallback
    let body = bodyText.trim();
    if (!body && bodyHtml) {
      body = bodyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      if (body.length > 500) body = body.slice(0, 500) + "...";
    }
    if (!body && snippet) body = snippet;
    if (!body) body = `Re: ${subject}`;

    await messagesService.saveMessage(leadRow.tenant_id, leadRow.id, "email", "inbound", body, { resend_email_id: emailId, from: fromEmail, to: toList });
    console.log("[Resend Inbound] Saved email reply for lead:", leadRow.id, "tenant:", leadRow.tenant_id);
  } catch (e) {
    console.error("[Resend Inbound] Error:", e.message);
  }
});

// Widget routes defined after body parsers and CORS
app.get("/chat-widget.js", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "chat-widget.js"));
});
app.get("/dashboard/chat-widget.js", (req, res) => {
  res.sendFile(path.join(__dirname, "dashboard", "public", "chat-widget.js"));
});

app.use(express.static(path.join(__dirname, "public")));
// Increase body size limits slightly to support small logo uploads (e.g. base64 images) in dashboard settings.
app.use(express.urlencoded({ extended: true, limit: "2mb" }));
app.use(express.json({ limit: "2mb" }));

// CORS: allow frontend origin (e.g. dashboard :3089 → API :3001).
const BASE_URL_FOR_CORS = process.env.BASE_URL || "";
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      const restrict = process.env.CORS_ORIGINS;
      if (restrict === "*") return cb(null, origin);
      if (restrict) {
        const list = restrict.split(",").map((o) => o.trim()).filter(Boolean);
        if (list.includes(origin)) return cb(null, origin);
        try {
          const reqHost = new URL(origin).hostname;
          const baseHost = new URL(BASE_URL_FOR_CORS || "http://localhost").hostname;
          if (reqHost === baseHost) return cb(null, origin);
        } catch (_) {}
        return cb(null, false);
      }
      cb(null, origin);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.post("/api/widget/start-sms", async (req, res) => {
  const { tenantId, phone, consent, consentText, source, pageUrl, sessionId } = req.body;

  if (!tenantId || !phone || consent !== true) {
    return res.status(400).json({ error: "Missing required fields or consent not given" });
  }

  try {
    const tenant = await getTenantById(tenantId);
    if (!tenant) return res.status(404).json({ error: "Tenant not found" });

    // 1. Record Consent
    const consentRes = await db.query(
      `INSERT INTO sms_consents (tenant_id, phone, consent_text, source, ip_address, user_agent, page_url, session_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, consent_given_at`,
      [tenantId, phone, consentText || "Consent given via widget", source || "widget_sms_popup", req.ip, req.headers["user-agent"], pageUrl, sessionId]
    );
    const consent = consentRes.rows[0];

    // 2. Find or Create Lead
    let lead = await db.query("SELECT id FROM leads WHERE tenant_id = $1 AND phone = $2", [tenantId, phone]).then(r => r.rows[0]);
    if (!lead) {
      const leadRes = await db.query(
        "INSERT INTO leads (tenant_id, phone, lead_source, created_at, updated_at) VALUES ($1, $2, $3, now(), now()) RETURNING id",
        [tenantId, phone, source || "widget_sms_popup"]
      );
      lead = leadRes.rows[0];
    }

    // 3. Link Consent to Lead
    await leadsService.updateLeadInfo(lead.id, {
      has_sms_consent: true,
      last_consent_at: consent.consent_given_at,
      last_consent_id: consent.id
    }).catch(e => console.error("[SMS Opt-in] Failed to update lead consent status:", e.message));

    // 3. Send Initial SMS
    try {
      const twilioClient = twilioLib.getClientForTenant(tenant);
      const fromPhone = (await db.query("SELECT phone FROM phone_numbers WHERE tenant_id = $1 ORDER BY is_primary DESC LIMIT 1", [tenantId]).then(r => r.rows[0]?.phone)) || process.env.TWILIO_PHONE_NUMBER;

      if (twilioClient && fromPhone) {
        const brandName = tenant.company_name || tenant.name || "Front Desk";
        const body = `Hi, this is ${brandName} — let’s get that appointment booked. Msg/data rates may apply. Reply STOP to opt out, HELP for help.`;
        
        await twilioClient.messages.create({ to: phone, from: fromPhone, body });
        
        // 4. Save outbound message to dashboard
        await messagesService.saveMessage(tenantId, lead.id, "sms", "outbound", body, { source: "widget_optin" });
      }
    } catch (smsErr) {
      console.error("[SMS Opt-in] Automated SMS failed but consent recorded:", smsErr.message);
    }

    res.json({ success: true, leadId: lead.id });
  } catch (error) {
    console.error("[SMS Opt-in] Error:", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

const PORT = process.env.PORT;
const BASE_URL = process.env.BASE_URL;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
// Default: API-only (no /dashboard). Set SERVE_DASHBOARD=true for one-service deploy (API + dashboard on same URL).
const SERVE_DASHBOARD = process.env.SERVE_DASHBOARD === "true";
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER || "";
const smsThreads = new Map();
const fbProcessedMessageIds = new Map();
const FB_DEDUPE_MS = 60000;
let callsTableHasTranscriptColumn = true;
let callsTableHasDurationColumn = true;

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
    let tenant = await getTenantById(req.params.id).catch(() => null);
    if (!tenant) {
      tenant = await getTenantBySlug(req.params.id).catch(() => null);
    }
    if (!tenant) return res.status(404).json({ error: "Tenant not found" });

    // Return only safe fields needed by the website chat widget
    res.json({
      id: tenant.id,
      name: tenant.name,
      company_name: tenant.company_name,
      welcome_message: tenant.welcome_message,
      twilio_phone_number: tenant.twilio_phone_number,
      timezone: tenant.timezone
    });
  } catch (error) {
    console.error("Public tenant API error:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});
app.use("/api/public", require("./routes/public"));
app.use("/twilio", twilioRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/billing", authMiddleware, billingRoutes);
app.use("/api/outbound", authMiddleware, outboundRoutes);
app.use("/api/leads", leadRoutes);
app.use("/api/stripe", authMiddleware, require("./routes/stripe"));
app.use("/api/admin", authMiddleware, requireSuperAdmin, require("./routes/admin"));
app.use("/api/team", authMiddleware, require("./routes/team"));
app.use("/api", authMiddleware, dashboardRoutes);
app.use("/auth/google/calendar", require("./routes/google-calendar"));
app.use("/api/google-calendar", authMiddleware, require("./routes/google-calendar"));

// Serve dashboard static assets early so JS/CSS/images load,
// but do NOT register the wildcard catch-all here — it goes at the very end
// of all route definitions (see bottom of file) so it doesn't shadow later GET routes.
if (SERVE_DASHBOARD) {
  app.use(express.static(path.join(__dirname, "dashboard", "dist")));
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

app.get("/health/email", (_req, res) => {
  const hasResendKey = Boolean(process.env.RESEND_API_KEY);
  const fromRaw = (process.env.EMAIL_FROM || "").trim();
  const hasEmailFrom = fromRaw.length > 0;
  const fromDomain = fromRaw.includes("@") ? fromRaw.split("@")[1] : "";
  const base = (process.env.DASHBOARD_URL || process.env.BASE_URL || "").replace(/\/$/, "");
  res.status(200).json({
    status: "ok",
    resendConfigured: hasResendKey && hasEmailFrom,
    hasResendApiKey: hasResendKey,
    hasEmailFrom,
    fromDomain: fromDomain || "(not set)",
    hasResetBaseUrl: base.length > 0,
    resetBaseUrlPreview: base ? `${base}/reset-password?token=...` : "(not set – set DASHBOARD_URL or BASE_URL)"
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
  const companyName = tenant.company_name || "our team";
  const personalizedSalesPrompt = SALES_CLOSE_PROMPT.replace(/{{company_name}}/g, companyName);

  const faqText = (Array.isArray(tenant.faqs) && tenant.faqs.length > 0)
    ? "\n\nFrequently Asked Questions:\n" + tenant.faqs.map(f => `Q: ${f.question}\nA: ${f.answer}`).join("\n\n")
    : "";

  return `${tenant.instructions}

${personalizedSalesPrompt}${faqText}

Website knowledge context from ${WEBSITE_CONTEXT_URL}:
${websiteKnowledgeContext}`;
}

async function getCallerHistory(phone) {
  if (!pool || !phone) return null;
  const result = await pool.query(
    "SELECT transcript FROM calls WHERE from_number = $1 AND transcript IS NOT NULL AND transcript != '' ORDER BY started_at DESC LIMIT 1",
    [phone]
  );
  return result.rows[0]?.transcript || null;
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

function buildTenantWsUrl(baseUrl, tenantId, leadSource = null) {
  const wsBaseUrl = toWebSocketBaseUrl(baseUrl);
  let url = `${wsBaseUrl}/twilio-media/${tenantId}`;
  if (leadSource) {
    url += `?leadSource=${encodeURIComponent(leadSource)}`;
  }
  return url;
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
  console.log("[AI-Desk] safeUpdateCallSummary callId=%s options=%j", callId, options);
  try {
    if (!pool || !callId) return;
    const status = Object.prototype.hasOwnProperty.call(options, "status") ? options.status : undefined;
    const disposition = Object.prototype.hasOwnProperty.call(options, "disposition") ? options.disposition : undefined;
    const transcript = typeof options.transcript === "string" ? options.transcript : "";
    const metadata = (options.metadata && typeof options.metadata === "object") ? options.metadata : null;
    const leadId = options.leadId || undefined;
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

      if (typeof disposition === "string") {
        values.push(disposition);
        setParts.push(`disposition = $${values.length}`);
      }

      if (includeTranscriptColumn) {
        values.push(transcript);
        setParts.push(`transcript = $${values.length}`);
      }

      if (metadata) {
        values.push(JSON.stringify(metadata));
        setParts.push(`metadata = $${values.length}`);
      }

      if (leadId) {
        values.push(leadId);
        setParts.push(`lead_id = $${values.length}`);
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
  let webhookUrls = [];
  
  // Use tenant-specific webhooks if tenantId is provided
  if (tenantId) {
    try {
      const dbRes = await db.query(
        "SELECT crm_webhook_url, zapier_webhook_url FROM tenants WHERE id = $1",
        [tenantId]
      );
      const t = dbRes.rows[0];
      if (t) {
        if (t.crm_webhook_url?.trim()) webhookUrls.push(t.crm_webhook_url.trim());
        if (t.zapier_webhook_url?.trim()) webhookUrls.push(t.zapier_webhook_url.trim());
      }
    } catch (err) {
      console.error("[CRM] DB hook lookup failed:", err.message);
    }

    // Fallback to memory cache if DB fetch didn't yield URLs
    if (webhookUrls.length === 0 && TENANTS[tenantId]) {
      const t = TENANTS[tenantId];
      if (t.crm_webhook_url?.trim()) webhookUrls.push(t.crm_webhook_url.trim());
      if (t.zapier_webhook_url?.trim()) webhookUrls.push(t.zapier_webhook_url.trim());
    }
  }

  // Fallback to system envs if STILL no URLs
  if (webhookUrls.length === 0) {
    if (process.env.CRM_WEBHOOK_URL) webhookUrls.push(process.env.CRM_WEBHOOK_URL.trim());
    if (process.env.ZAPIER_WEBHOOK_URL) webhookUrls.push(process.env.ZAPIER_WEBHOOK_URL.trim());
  }


  // Filter unique URLs
  webhookUrls = [...new Set(webhookUrls)];

  if (webhookUrls.length === 0) {
    console.warn(`CRM webhooks not configured for tenant ${tenantId || "global"}. Skipping lead push.`);
    return;
  }

  for (const url of webhookUrls) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(leadCapture)
      });

      if (!response.ok) {
        const body = await response.text();
        console.error(`CRM push failed for url=${url}:`, response.status, body);
      } else {
        console.log(`CRM push success for url=${url}`);
      }
    } catch (error) {
      console.error(`CRM push error for url=${url}:`, error.message);
    }
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
    leadId: null,
    tenantId: null,
    needsFollowUpAt: null,
    followUpCount: 0, // 0 = no follow-ups sent yet. Max is 2.
    channel: normalizedPhone.startsWith("fb-") ? "facebook" : (normalizedPhone.startsWith("web-") ? "website" : "sms"),
    lastInboundAt: null,
    lastOutboundAt: null
  };
  smsThreads.set(normalizedPhone, created);
  return created;
}

async function sendTwilioSms(to, body, tenantId = null) {
  // Try tenant-specific credentials and phone number first
  let accountSid = process.env.TWILIO_ACCOUNT_SID || "";
  let authToken = process.env.TWILIO_AUTH_TOKEN || "";
  let fromNumber = TWILIO_PHONE_NUMBER;

  if (tenantId) {
    try {
      // Get tenant's primary phone number
      const phoneRow = await db.query(
        `SELECT phone FROM phone_numbers WHERE tenant_id = $1 AND twilio_sid IS NOT NULL ORDER BY is_primary DESC NULLS LAST LIMIT 1`,
        [tenantId]
      );
      if (phoneRow.rows.length > 0) {
        fromNumber = phoneRow.rows[0].phone;
      }
      // Check for tenant-specific Twilio credentials
      const tenantRow = await db.query(
        `SELECT twilio_account_sid, twilio_auth_token FROM tenants WHERE id = $1 LIMIT 1`,
        [tenantId]
      );
      if (tenantRow.rows.length > 0 && tenantRow.rows[0].twilio_account_sid && tenantRow.rows[0].twilio_auth_token) {
        accountSid = tenantRow.rows[0].twilio_account_sid;
        authToken = tenantRow.rows[0].twilio_auth_token;
      }
    } catch (e) {
      console.error("[SMS] Tenant lookup error:", e.message);
    }
  }

  if (!accountSid || !authToken || !fromNumber) {
    console.warn("Twilio SMS skipped: missing credentials or from number.", { accountSid: !!accountSid, authToken: !!authToken, fromNumber });
    return { ok: false, reason: "missing_sms_configuration" };
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  const payload = new URLSearchParams({
    To: to,
    From: fromNumber,
    Body: body
  }).toString();

  const authHeader = `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: payload
  });

  if (!response.ok) {
    const errBody = await response.text();
    console.error("Twilio SMS failed:", response.status, errBody, { from: fromNumber, to, tenantId });
    return { ok: false, reason: "twilio_sms_error", status: response.status };
  }

  const msg = await response.json();
  console.log("[SMS] Sent sid=%s from=%s to=%s tenant=%s", msg.sid, fromNumber, to, tenantId || "global");
  return { ok: true, sid: msg.sid };
}

function buildSmsSystemPrompt(thread, tenant = null, availableSlots = []) {
  const companyName = tenant?.company_name || tenant?.name || "our team";
  const toneOfVoice = tenant?.tone_of_voice || "professional";

  // 1. CORE SMS RULES
  const coreSmsRules = [
    `You are an SMS receptionist for ${companyName}.`,
    `TONE OF VOICE: Your tone of voice is ${toneOfVoice}. Maintain this personality in your texts.`,
    "Flow: qualify lead, gather full_name, contact email, contact phone, project_type, project_details, address, preferred appointment_date and appointment_time.",
    "MANDATORY CONTACT INFO: You MUST collect the customer's full_name, a valid phone number, and a valid email address BEFORE setting should_book=true. If any of these are missing, ask for them politely (e.g., 'To confirm your spot, could I also get your email address?').",
    "Be concise, friendly, and use one short text message. Avoid long paragraphs.",
    "SERVICE TYPES: Do NOT assume the customer wants a specific service (like interior or exterior painting) unless they mention it or it is in the business details. Ask: 'What type of service are you looking for?'",
    "IMPORTANT: When the customer provides a date/time and you set should_book=true, do NOT say 'I have scheduled' or 'You are booked'. Instead say something like 'Let me check availability for that time' or 'I'll confirm that slot for you shortly'. The system will check the calendar and provide the final confirmation.",
    "If enough details exist (including name, phone, and email) to request booking, set should_book true.",
    "If the customer wants to cancel, set should_cancel true.",
    "If the customer wants to reschedule, set should_reschedule true and provide the new appointment_date/time.",
    "REVENUE ESTIMATION: Always provide an estimated_value (number, in dollars) based on the project_details (e.g., Room: 500, Interior: 2500, Exterior: 5000)."
  ].join("\n");

  // 2. TENANT CUSTOM INSTRUCTIONS
  let combinedInstructions = coreSmsRules;
  if (tenant?.instructions) {
    combinedInstructions += "\n\nBUSINESS SPECIFIC INSTRUCTIONS:\n" + tenant.instructions;
  }

  // 3. CALENDAR CONTEXT (if available)
  if (availableSlots && availableSlots.length > 0) {
    combinedInstructions += `\n\nCALENDAR AVAILABILITY: The following slots are currently open for the requested day: ${availableSlots.join(", ")}. Suggest these to the customer if they ask for available times or if their requested time is taken.`;
  } else if (availableSlots && availableSlots.info) {
    combinedInstructions += `\n\nCALENDAR CONTEXT: ${availableSlots.info}`;
  }

  // 4. OBJECTION HANDLING
  if (tenant && tenant.objection_handling_config) {
    const oh = tenant.objection_handling_config;
    let lines = [];
    if (Array.isArray(oh) && oh.length) {
      lines = oh
        .filter(c => c && (c.script || "").trim())
        .map(c => `- If they say "${(c.trigger || "").trim() || "..."}": respond with: ${(c.script || "").trim()}`);
    } else if (typeof oh === "object") {
      if (oh.price) lines.push(`- If price is a concern: ${oh.price}`);
      if (oh.thinking) lines.push(`- If they need to think about it: ${oh.thinking}`);
      if (oh.spouse) lines.push(`- If they need to talk to a spouse: ${oh.spouse}`);
    }
    if (lines.length) {
      combinedInstructions += "\n\nOBJECTION HANDLING STRATEGIES:\n" + lines.join("\n");
    }
  }

  // 4. KNOWLEDGE BASE (FAQs)
  if (tenant && Array.isArray(tenant.faqs) && tenant.faqs.length > 0) {
    const faqText = "\n\nFrequently Asked Questions:\n" + tenant.faqs.map(f => `Q: ${f.question}\nA: ${f.answer}`).join("\n\n");
    combinedInstructions += faqText;
  }

  return [
    combinedInstructions,
    "\nReturn strict JSON only with keys: reply, lead_capture, should_book, should_cancel, should_reschedule, appointment_date, appointment_time, follow_up_minutes.",
    `Known lead data: ${JSON.stringify(thread.leadCapture)}`
  ].join("\n");
}

async function runSmsAiOrchestrator(thread, incomingText, tenant = null) {
  // Determine if we should fetch available slots
  let availableSlots = [];
  const text = (incomingText || "").toLowerCase();
  const dateMentioned = text.match(/tomorrow|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday|(\d{4}-\d{2}-\d{2})/);
  const askingAvailability = text.includes("available") || text.includes("time") || text.includes("when");

  if (tenant && (dateMentioned || askingAvailability)) {
    try {
      // Default to checking tomorrow if no specific date is clear, for simplicity
      let dateToCheck = new Date();
      dateToCheck.setDate(dateToCheck.getDate() + 1); // Tomorrow
      if (text.includes("today")) dateToCheck = new Date();
      
      const dateStr = dateToCheck.toISOString().split("T")[0];
      availableSlots = await getAvailableSlots(tenant, dateStr);
      if (availableSlots.length > 0) {
        availableSlots.info = `Available on ${dateStr}: ${availableSlots.join(", ")}`;
      }
    } catch (err) {
      console.error("[Orchestrator] Failed to fetch slots:", err.message);
    }
  }

  const input = [
    { role: "system", content: buildSmsSystemPrompt(thread, tenant, availableSlots) },
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
                appointment_time: { type: ["string", "null"] },
                estimated_value: { type: ["number", "null"] }
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
                "appointment_time",
                "estimated_value"
              ]
            },
            should_book: { type: "boolean" },
            should_cancel: { type: "boolean" },
            should_reschedule: { type: "boolean" },
            appointment_date: { type: "string" },
            appointment_time: { type: "string" },
            follow_up_minutes: { type: "number" }
          },
          required: [
            "reply",
            "lead_capture",
            "should_book",
            "should_cancel",
            "should_reschedule",
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
  let tenant = tenantOverride;
  if (!tenant && thread.tenantId) {
    tenant = TENANTS[thread.tenantId];
  }
  if (!tenant) {
    console.warn("[Booking] No tenant resolved for booking flow. thread.phone=%s", thread.phone);
    return null;
  }

  // HANDLE CANCELLATION
  if (ai.should_cancel) {
    const booking = await bookingsService.findLatestBookingByPhone(tenant.id, thread.leadCapture?.phone || thread.phone);
    if (!booking) return "I couldn't find an appointment for this phone number to cancel. Could you double-check the number?";
    
    await bookingsService.cancelBooking(booking.id);
    return "✅ Your appointment has been successfully cancelled.";
  }

  // HANDLE RESCHEDULING
  if (ai.should_reschedule && ai.appointment_date && ai.appointment_time) {
    const booking = await bookingsService.findLatestBookingByPhone(tenant.id, thread.leadCapture?.phone || thread.phone);
    if (!booking) return "I couldn't find an existing appointment to reschedule. Would you like to schedule a new one instead?";

    await bookingsService.updateBooking(booking.id, {
      preferred_date: ai.appointment_date,
      appointment_time: ai.appointment_time,
      notes: ai.lead_capture?.project_details || booking.notes
    });
    return `✅ Your appointment has been rescheduled for ${ai.appointment_date} at ${ai.appointment_time}.`;
  }

  if (!ai.should_book || !ai.appointment_date || !ai.appointment_time) return null;

  // ENSURE CONTACT INFO IS PRESENT
  const fullName = ai.lead_capture?.full_name || thread.leadCapture?.full_name;
  const phone = ai.lead_capture?.phone || thread.leadCapture?.phone || thread.phone;
  const email = ai.lead_capture?.email || thread.leadCapture?.email;

  if (!fullName || !phone || !email) {
    let missing = [];
    if (!fullName) missing.push("full name");
    if (!phone) missing.push("phone number");
    if (!email) missing.push("email address");
    
    return `To finalize your booking, I just need your ${missing.join(" and ")}. Please share that and I'll get you scheduled!`;
  }

  // Parse date string safely — avoid new Date("YYYY-MM-DD") which interprets as UTC midnight
  const dateParts = String(ai.appointment_date).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  let parsedDate;
  if (dateParts) {
    parsedDate = new Date(Number(dateParts[1]), Number(dateParts[2]) - 1, Number(dateParts[3]));
  } else {
    parsedDate = new Date(ai.appointment_date);
  }
  const now = new Date();
  const currentYear = now.getFullYear();

  if (parsedDate.getFullYear() < currentYear) {
    parsedDate.setFullYear(currentYear);
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  parsedDate.setHours(0, 0, 0, 0);

  while (parsedDate < today) {
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
  }, tenant);

  // Allow booking if: (1) calendar says available, (2) calendar not configured
  // 🔥 TIGHTENED: Do NOT proceed if there was a calendar_error to prevent double bookings
  const calendarNotConfigured = availability.reason === "calendar_not_configured";
  const isAvailable = (availability.ok && availability.available) || calendarNotConfigured;
  
  if (availability.reason === "calendar_error") {
    console.warn("[Booking] Calendar error (likely API disabled) — falling back to local booking only:", availability.message || "unknown");
    // We proceed anyway to at least capture the lead and record the preference locally.
  }

  if (isAvailable) {
    let booked = { ok: true, fallback: true }; // Default to success so local booking happens

    // Only attempt Google Calendar sync if it's configured and was reachable during check
    const shouldTryGoogle = availability.reason !== "calendar_not_configured" && availability.reason !== "calendar_error";

    if (shouldTryGoogle) {
      try {
        const syncResult = await bookAppointment({
          appointment_date: ai.appointment_date,
          appointment_time: ai.appointment_time,
          duration_minutes: 60,
          full_name: thread.leadCapture.full_name || "New Lead",
          phone: thread.leadCapture?.phone || thread.phone,
          email: thread.leadCapture.email || "",
          address: thread.leadCapture.address || "",
          project_details: thread.leadCapture.project_details || ""
        }, tenant);
        
        if (syncResult && syncResult.ok) {
          booked = syncResult;
        } else {
          console.warn("[Booking] Google Calendar sync failed:", syncResult?.reason || "unknown");
          // We still keep booked.ok = true (from initialization) to allow local booking to proceed
        }
      } catch (err) {
        console.error("[Booking] Google Calendar bookAppointment exception:", err.message);
        // Fallback to local-only success
      }
    }

    if (booked.ok) {
      thread.bookedEventId = booked.eventId || (booked.fallback ? "LOCAL_ONLY" : "");
      thread.needsFollowUpAt = null;
      thread.followUpCount = 0;

      // PERSIST TO LOCAL DATABASE
      try {
        const t = tenantOverride || (thread.tenantId ? TENANTS[thread.tenantId] : null);
        if (t) {
          await bookingsService.createBooking(t.id, null, {
            contact_name: thread.leadCapture.full_name || "New Lead",
            contact_phone: thread.leadCapture?.phone || thread.phone,
            contact_email: thread.leadCapture.email || "",
            address: thread.leadCapture.address || "",
            city: "",
            scope: thread.leadCapture.project_type || "",
            job_type: "Residential",
            preferred_date: ai.appointment_date,
            appointment_time: ai.appointment_time,
            notes: thread.leadCapture.project_details || "",
            estimated_value: thread.leadCapture.estimated_value
          }, thread.leadId);

          if (thread.leadId) {
            leadsService.updateLeadStatus(thread.leadId, 'Booked').catch(e => console.error("Lead status update error:", e));
          }
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

  if (tenant) {
    const lead = await leadsService.getOrCreateLead(tenant.id, thread.phone, thread.leadCapture?.full_name);
    if (lead) {
      thread.leadId = lead.id;
      thread.tenantId = tenant.id;
      messagesService.saveMessage(tenant.id, lead.id, thread.channel || "sms", "inbound", incomingText);
      try {
        const parsed = await nurturingService.tryParseReferralReply(tenant.id, lead.id, incomingText);
        if (parsed.isReferralReply && parsed.referralPhone) {
          const recentRef = await db.query(
            "SELECT booking_id FROM campaign_log WHERE tenant_id = $1 AND lead_id = $2 AND campaign_type = 'referral_request' ORDER BY sent_at DESC LIMIT 1",
            [tenant.id, lead.id]
          ).then((r) => r.rows[0]);
          await nurturingService.createReferralAndOutreach(
            tenant.id, lead.id, recentRef?.booking_id || null,
            parsed.referralName, parsed.referralPhone, parsed.referralEmail, null
          );
          thread.referralReplyHandled = true;
          thread.referralReplyText = "Thanks! We'll reach out to them.";
        }
      } catch (e) {
        console.error("[Nurturing] Referral parse/outreach:", e.message || e);
      }
    }
  }

  let ai;
  try {
    if (thread.referralReplyHandled) {
      ai = { reply: thread.referralReplyText, should_book: false, follow_up_minutes: SMS_FOLLOW_UP_DELAY_MINUTES, lead_capture: thread.leadCapture || {} };
    } else {
      ai = await runSmsAiOrchestrator(thread, incomingText, tenant);
    }

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
  if (tenant && thread.leadId && ai.lead_capture && Object.keys(ai.lead_capture).length > 0) {
    const updateData = {
      name: thread.leadCapture.full_name,
      email: thread.leadCapture.email,
      address: thread.leadCapture.address,
      project_type: thread.leadCapture.project_type,
      notes: thread.leadCapture.project_details
    };

    // If we captured an actual phone number (during a website chat or similar session), update it in the CRM lead record
    if (thread.leadCapture.phone && !thread.leadCapture.phone.startsWith("fb-") && !thread.leadCapture.phone.startsWith("web-")) {
      updateData.phone = thread.leadCapture.phone;
    }

    leadsService.updateLeadInfo(thread.leadId, updateData).catch(e => console.error("[Sync] Lead info update failed:", e.message));
  }

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
    replyText = bookingResult;
  } else if (!ai.should_book) {
    // If not booking, default to a 2-hour delay for the primary follow-up unless the AI specified
    const followUpMinutes = Number(ai.follow_up_minutes) || 120;
    thread.needsFollowUpAt = Date.now() + followUpMinutes * 60 * 1000;
  }

  // Reset follow up count because they just replied
  thread.followUpCount = 0;

  // Record response in history
  thread.history.push({ role: "assistant", text: replyText, at: new Date().toISOString() });
  thread.lastOutboundAt = Date.now();

  // CRM: Save outbound message
  if (tenant && thread.leadId) {
    messagesService.saveMessage(tenant.id, thread.leadId, thread.channel || "sms", "outbound", replyText);
  }

  return {
    reply: replyText,
    lead_capture: ai.lead_capture,
    booking_confirmed: (ai.should_book && bookingResult && bookingResult.includes("✅")) ? {
      date: ai.appointment_date,
      time: ai.appointment_time
    } : null
  };
}
async function processFacebookConversation(senderId, messageText, tenant = null, pageAccessToken = null) {
  const threadKey = `fb-${senderId}`;
  const thread = getOrCreateSmsThread(threadKey);

  // Set the channel explicitly so Zapier/CRM knows it came from Facebook
  thread.channel = "facebook";

  thread.lastInboundAt = Date.now();
  thread.history.push({ role: "user", text: messageText, at: new Date().toISOString() });

  // CRM: Ensure Lead exists and save message
  if (tenant) {
    // If we don't have a name yet, try to fetch it from Facebook
    if (!thread.leadCapture?.full_name && pageAccessToken) {
      const profile = await getFacebookUserProfile(senderId, pageAccessToken);
      if (profile && (profile.first_name || profile.last_name)) {
        const fullName = `${profile.first_name || ""} ${profile.last_name || ""}`.trim();
        thread.leadCapture.full_name = fullName;
        console.log(`[Facebook] Fetched profile for ${senderId}: ${fullName}`);
      }
    }

    const lead = await leadsService.getOrCreateLead(tenant.id, thread.phone, thread.leadCapture?.full_name);
    if (lead) {
      thread.leadId = lead.id;
      // If the lead was just created and we just got the name, it's already in there.
      // If it existed but had no name, getOrCreateLead updates it.
      messagesService.saveMessage(tenant.id, lead.id, "facebook", "inbound", messageText);
    }
  }

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
  if (tenant && thread.leadId && ai.lead_capture && Object.keys(ai.lead_capture).length > 0) {
    const updateData = {
      name: thread.leadCapture.full_name,
      email: thread.leadCapture.email,
      address: thread.leadCapture.address,
      project_type: thread.leadCapture.project_type,
      notes: thread.leadCapture.project_details
    };

    // If we captured an actual phone number, update it in the CRM lead record
    if (thread.leadCapture.phone && !thread.leadCapture.phone.startsWith("fb-") && !thread.leadCapture.phone.startsWith("web-")) {
      updateData.phone = thread.leadCapture.phone;
      console.log(`[Facebook] Updating lead ${thread.leadId} phone to real number: ${thread.leadCapture.phone}`);
    }

    leadsService.updateLeadInfo(thread.leadId, updateData).catch(e => console.error("[Sync] FB Lead info update failed:", e.message));
  }

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
    replyText = bookingResult;
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

  // CRM: Save outbound message
  if (tenant && thread.leadId) {
    messagesService.saveMessage(tenant.id, thread.leadId, "facebook", "outbound", replyText);
  }

  return {
    reply: replyText,
    lead_capture: ai.lead_capture,
    booking_confirmed: (ai.should_book && bookingResult && bookingResult.includes("✅")) ? {
      date: ai.appointment_date,
      time: ai.appointment_time
    } : null
  };
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

async function getFacebookUserProfile(senderId, pageAccessToken) {
  try {
    const url = `https://graph.facebook.com/v18.0/${senderId}?fields=first_name,last_name,profile_pic&access_token=${pageAccessToken}`;
    const resp = await fetch(url);
    if (!resp.ok) {
      const errText = await resp.text();
      console.warn(`[Facebook] Profile fetch failed for ${senderId}: ${resp.status} ${errText}`);
      return null;
    }
    return await resp.json();
  } catch (err) {
    console.error("[Facebook] Error fetching user profile:", err.message);
    return null;
  }
}

async function sendFacebookMessage(recipientId, messageText, quickReplies = [], accessTokenOverride = null, tenantId = null) {
  console.log(`[Facebook Send] recipient=${recipientId}, hasOverride=${!!accessTokenOverride}, overrideStart=${accessTokenOverride ? accessTokenOverride.substring(0, 10) : 'NONE'}`);
  const PAGE_ACCESS_TOKEN = accessTokenOverride || process.env.FACEBOOK_PAGE_ACCESS_TOKEN;

  if (!PAGE_ACCESS_TOKEN) {
    console.error("Missing FACEBOOK_PAGE_ACCESS_TOKEN");
    return;
  }

  const payload = {
    messaging_type: "RESPONSE",
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
    const url = `https://graph.facebook.com/v18.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`;
    console.log(`[Facebook] Sending to ${recipientId} via ${PAGE_ACCESS_TOKEN.substring(0, 10)}...`);
    const response = await fetch(
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      }
    );

    if (!response.ok) {
      const errorBody = await response.text();
      let parsedError;
      try { parsedError = JSON.parse(errorBody); } catch (e) { }

      const errorCode = parsedError?.error?.code;
      if (errorCode === 190 && tenantId) {
        console.warn(`[Facebook] Token EXPIRED for tenant ${tenantId}. Marking in DB.`);
        await db.query("UPDATE tenants SET facebook_token_error = 'expired', updated_at = now() WHERE id = $1", [tenantId]);
      }
      console.error("[Facebook] Failed to send message:", response.status, errorBody);
    } else {
      if (tenantId) {
        // Clear error on success
        await db.query("UPDATE tenants SET facebook_token_error = NULL WHERE id = $1", [tenantId]);
      }
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
        sent = await sendTwilioSms(thread.leadCapture.phone, followUpText, thread.tenantId);
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
      sent = await sendTwilioSms(thread.phone, followUpText, thread.tenantId);
    }

    if (sent.ok) {
      thread.history.push({ role: "assistant", text: followUpText, at: new Date().toISOString() });
      thread.lastOutboundAt = now;
      thread.followUpCount++;

      // CRM: Save follow-up message
      if (thread.leadId) {
        // Find tenantId for this thread
        // For now, assume gladiators or lookup from DB if needed. 
        // But thread.leadId should have tenant_id in DB. 
        // Let's use a safe lookup or pass it if possible.
        // Actually thread is in-memory, we can try to guess tenant from channel/phone.
        // Or better, get lead by ID.
        leadsService.getLeadById(thread.leadId).then(lead => {
          if (lead) {
            messagesService.saveMessage(lead.tenant_id, lead.id, thread.channel || "sms", "outbound", followUpText, { is_followup: true });
          }
        }).catch(err => console.error("[FollowUp] CRM log failed:", err.message));
      }

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

function getTzOffsetString(timeZone, dateStr) {
  try {
    const dateToCheck = new Date(dateStr + "T12:00:00Z"); // Midday UTC to avoid edge cases
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'shortOffset' }).formatToParts(dateToCheck);
    const o = parts.find(p => p.type === 'timeZoneName').value;
    
    if (o === "GMT") return "Z";
    let offset = o.replace("GMT", "");
    if (!offset.includes(":")) {
      const sign = offset[0];
      const hours = offset.slice(1).padStart(2, "0");
      return `${sign}${hours}:00`;
    } else {
      const sign = offset[0];
      let [hours, mins] = offset.slice(1).split(":");
      hours = hours.padStart(2, "0");
      return `${sign}${hours}:${mins}`;
    }
  } catch(e) { 
    return "Z"; 
  }
}

function buildAppointmentWindow(dateValue, timeValue, durationMinutes = 60, timeZone = "UTC") {
  const normalizedDate = String(dateValue || "").trim();
  const normalizedTime = normalizeTimeString(timeValue);
  const duration = Number(durationMinutes) > 0 ? Number(durationMinutes) : 60;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedDate) || !normalizedTime) {
    return null;
  }

  const offset = getTzOffsetString(timeZone, normalizedDate);
  const start = new Date(`${normalizedDate}T${normalizedTime}${offset}`);
  if (Number.isNaN(start.getTime())) return null;

  const end = new Date(start.getTime() + duration * 60 * 1000);
  return { start, end };
}

async function getAvailableSlots(tenant, dateStr) {
  const cal = tenant ? getCalendarForTenant(tenant) : calendar.instance;
  if (!cal) return [];

  const tz = (tenant && tenant.timezone) || BUSINESS_TIMEZONE || "America/Chicago";
  const offset = getTzOffsetString(tz, dateStr);
  
  // Define working hours: 8 AM to 5 PM
  const startOfDay = new Date(`${dateStr}T08:00:00${offset}`);
  const endOfDay = new Date(`${dateStr}T17:00:00${offset}`);

  if (Number.isNaN(startOfDay.getTime()) || Number.isNaN(endOfDay.getTime())) return [];

  const calendarId = (tenant && tenant.google_calendar_id) || DEFAULT_CALENDAR_ID;

  try {
    const res = await cal.freebusy.query({
      requestBody: {
        timeMin: startOfDay.toISOString(),
        timeMax: endOfDay.toISOString(),
        timeZone: tz,
        items: [{ id: calendarId }],
      },
    });

    const busy = res.data.calendars[calendarId].busy || [];
    
    // Fetch local bookings to ensure they are also blocked
    try {
      const dbRes = await db.query(
        "SELECT appointment_time FROM bookings WHERE tenant_id = $1 AND preferred_date = $2 AND status != 'Cancelled'",
        [tenant?.id, dateStr]
      );
      dbRes.rows.forEach(row => {
        const lbStart = new Date(`${dateStr}T${row.appointment_time}${offset}`);
        const lbEnd = new Date(lbStart.getTime() + 60 * 60 * 1000);
        busy.push({ start: lbStart.toISOString(), end: lbEnd.toISOString() });
      });
    } catch (dbErr) {
      console.error("[Calendar] Local busy fetch failed:", dbErr.message);
    }

    const slots = [];
    let current = startOfDay.getTime();
    const duration = 60 * 60 * 1000; // 1 hour

    while (current + duration <= endOfDay.getTime()) {
      const slotStart = current;
      const slotEnd = current + duration;

      const isBusy = busy.some(b => {
        const bStart = new Date(b.start).getTime();
        const bEnd = new Date(b.end).getTime();
        return (slotStart < bEnd && slotEnd > bStart);
      });

      if (!isBusy) {
        const d = new Date(slotStart);
        slots.push(d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: tz }));
      }
      current += duration;
    }
    return slots;
  } catch (err) {
    console.error(`[Calendar] getAvailableSlots failed date=${dateStr}:`, err.message);
    return [];
  }
}

async function checkAvailability(args = {}, tenant = null) {
  // 1. Check Local Database first (fast and always available)
  if (tenant) {
    try {
      const localRes = await db.query(
        `SELECT id FROM bookings 
         WHERE tenant_id = $1 
         AND preferred_date = $2 
         AND status != 'Cancelled'
         AND appointment_time >= ($3::time - interval '59 minutes')
         AND appointment_time <= ($3::time + interval '59 minutes')`,
        [tenant.id, args.appointment_date, args.appointment_time]
      );
      if (localRes.rows.length > 0) {
        console.log("[Calendar] Local booking conflict found for tenant %s at %s %s", tenant.id, args.appointment_date, args.appointment_time);
        return { ok: true, available: false, reason: "busy" };
      }
    } catch (err) {
      console.error("[Calendar] Local availability check failed:", err.message);
      // Continue to Google check even if DB fails
    }
  }

  const cal = tenant ? getCalendarForTenant(tenant) : calendar.instance;

  if (!cal) {
    return { ok: false, reason: "calendar_not_configured" };
  }

  const tz = (tenant && tenant.timezone) || BUSINESS_TIMEZONE || "America/Chicago";
  const window = buildAppointmentWindow(args.appointment_date, args.appointment_time, args.duration_minutes || 60, tz);
  if (!window) {
    return { ok: false, reason: "invalid_datetime", message: "Use appointment_date (YYYY-MM-DD) and appointment_time (HH:MM or 1:30 PM)." };
  }

  const calendarId = (tenant && tenant.google_calendar_id) || args.calendar_id || DEFAULT_CALENDAR_ID;

  try {
    const response = await cal.freebusy.query({
      requestBody: {
        timeMin: window.start.toISOString(),
        timeMax: window.end.toISOString(),
        timeZone: tz,
        items: [{ id: calendarId }]
      }
    });

    const busy = response?.data?.calendars?.[calendarId]?.busy || [];
    
    // Clear any previous error if we succeeded
    if (tenant && tenant.google_calendar_error) {
      db.query("UPDATE tenants SET google_calendar_error = NULL WHERE id = $1", [tenant.id]).catch(e => console.error("[Calendar] Failed to clear error:", e.message));
    }

    return {
      ok: true,
      available: busy.length === 0,
      busySlots: busy,
      startIso: window.start.toISOString(),
      endIso: window.end.toISOString(),
      timezone: tz
    };
  } catch (err) {
    const errMsg = err.message || (err.response && err.response.data && err.response.data.error && err.response.data.error.message) || String(err);
    console.error("[Calendar] Availability check failed:", errMsg);

    if (errMsg.includes("invalid_grant") && tenant) {
      db.query("UPDATE tenants SET google_calendar_error = 'invalid_grant' WHERE id = $1", [tenant.id]).catch(e => console.error("[Calendar] Failed to save error:", e.message));
    }

    if (errMsg.includes("unregistered callers")) {
      return { ok: false, reason: "calendar_not_configured" };
    }
    // Fail semi-safe: return true for available but indicate it was a calendar error
    return { ok: true, available: true, reason: "calendar_error", message: errMsg };
  }
}

async function bookAppointment(args = {}, tenant = null) {
  const cal = tenant ? getCalendarForTenant(tenant) : calendar.instance;
  if (!cal) return { ok: false, reason: "calendar_not_configured" };

  const tz = (tenant && tenant.timezone) || BUSINESS_TIMEZONE || "America/Chicago";
  const window = buildAppointmentWindow(args.appointment_date, args.appointment_time, args.duration_minutes || 60, tz);
  if (!window) {
    return { ok: false, reason: "invalid_datetime", message: "Use appointment_date (YYYY-MM-DD) and appointment_time (HH:MM or 1:30 PM)." };
  }

  const calendarId = (tenant && tenant.google_calendar_id) || args.calendar_id || DEFAULT_CALENDAR_ID;
  const companyName = (tenant && tenant.company_name) || "Service";

  const event = {
    summary: args.summary || `${companyName} Estimate - ${args.full_name || "New Lead"}`,
    description: args.description || [
      args.full_name ? `Name: ${args.full_name}` : "",
      args.phone ? `Phone: ${args.phone}` : "",
      args.email ? `Email: ${args.email}` : "",
      args.address ? `Address: ${args.address}` : "",
      args.project_details ? `Project: ${args.project_details}` : ""
    ].filter(Boolean).join("\n"),
    start: { dateTime: window.start.toISOString(), timeZone: tz },
    end: { dateTime: window.end.toISOString(), timeZone: tz }
  };

  try {
    const response = await cal.events.insert({
      calendarId,
      requestBody: event
    });

    return {
      ok: true,
      eventId: response?.data?.id,
      htmlLink: response?.data?.htmlLink,
      status: response?.data?.status
    };
  } catch (err) {
    const errMsg = err.message || (err.response && err.response.data && err.response.data.error && err.response.data.error.message) || String(err);
    console.error("[Calendar] Booking failed:", errMsg);
    if (errMsg.includes("invalid_grant") && tenant) {
      db.query("UPDATE tenants SET google_calendar_error = 'invalid_grant' WHERE id = $1", [tenant.id]).catch(e => console.error("[Calendar] Failed to save error:", e.message));
    }

    if (errMsg.includes("unregistered callers")) {
      return { ok: false, reason: "calendar_not_configured" };
    }
    return { ok: false, reason: "calendar_error", message: errMsg };
  }
}

async function cancelAppointment(args = {}) {
  if (!calendar) return { ok: false, reason: "calendar_not_configured" };
  if (!args.event_id) return { ok: false, reason: "missing_event_id" };

  try {
    await calendar.events.delete({
      calendarId: args.calendar_id || DEFAULT_CALENDAR_ID,
      eventId: args.event_id
    });

    return { ok: true, cancelled: true, eventId: args.event_id };
  } catch (err) {
    console.error("[Calendar] Cancel failed:", err.message);
    return { ok: false, reason: "calendar_error", message: err.message };
  }
}

async function rescheduleAppointment(args = {}) {
  if (!calendar) return { ok: false, reason: "calendar_not_configured" };
  if (!args.event_id) return { ok: false, reason: "missing_event_id" };

  const window = buildAppointmentWindow(args.appointment_date, args.appointment_time, args.duration_minutes || 60);
  if (!window) {
    return { ok: false, reason: "invalid_datetime", message: "Use appointment_date (YYYY-MM-DD) and appointment_time (HH:MM or 1:30 PM)." };
  }

  try {
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
      status: response?.data?.status
    };
  } catch (err) {
    console.error("[Calendar] Reschedule failed:", err.message);
    return { ok: false, reason: "calendar_error", message: err.message };
  }
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
  
  try {
    const result = await transferService.initiateTransfer(
      callSid,
      tenant.transferNumber,
      "caller_requested_human",
      "The caller repeatedly asked to speak with a human or manager."
    );
    return result.success;
  } catch (e) {
    console.error("[AI-Desk] direct attemptTransfer failed:", e.message);
    return false;
  }
}



const WARM_GREETING = "Thanks for calling. How can I help you today?";

async function handleTwilioVoice(req, res, tenantId) {
  let resolvedTenantId = tenantId;
  let tenant = TENANTS[tenantId];

  // If not found in memory OR it is the default 'gladiators', try to look up by the 'To' OR 'From' phone number.
  // This allows multiple phone numbers to use the same generic /twilio/voice webhook.
  const toNum = req.body?.To || req.query?.To;
  const fromNum = req.body?.From || req.query?.From;

  if (!tenant || resolvedTenantId === "gladiators") {
    const lookupNum = toNum || fromNum;
    if (lookupNum) {
      try {
        const dbTenant = await getTenantByPhone(lookupNum);
        if (dbTenant) {
          tenant = dbTenant;
          resolvedTenantId = dbTenant.slug || dbTenant.id;
        }
      } catch (err) {
        console.error("[AI-Desk] Tenant lookup by phone failed:", err.message);
      }
    }
  }

  // Final fallback
  if (!tenant) {
    tenant = TENANTS["gladiators"];
    resolvedTenantId = "gladiators";
  }

  // Business hours gating removed to allow 24/7 AI answering.

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

    const wsUrl = buildTenantWsUrl(requestBaseUrl, resolvedTenantId, tenant.lead_source);
    if (!/^wss:\/\//i.test(wsUrl)) {
      const fallbackTwiml = buildFallbackTwiml(
        "Please hold while we connect you to the team.",
        tenant.transferNumber
      );
      res.type("text/xml").send(fallbackTwiml);
      return;
    }

    const greeting = tenant.welcome_message || WARM_GREETING;
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>${escapeXml(greeting)}</Say>
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
  const handler = async (req, res) => {
    const tenantId = tenantScoped ? req.params.tenantId : "gladiators";
    await handleTwilioVoice(req, res, tenantId);
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
  const to = normalizePhone(req.body?.To || req.body?.to);
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

  const tenant = to ? await getTenantByPhone(to) : null;
  const thread = getOrCreateSmsThread(from);
  const companyName = tenant?.company_name || "our team";
  const autoText = `Sorry we missed your call — this is ${companyName}. I can help with a fast quote and get your appointment booked. What kind of project are you planning?`;
  const sent = await sendTwilioSms(from, autoText, tenant?.id);

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
    const toNum = req.body?.To || req.body?.to;
    const tenant = await getTenantByPhone(toNum);

    const result = await processSmsConversation(from, body, tenant);
    const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(result.reply)}</Message></Response>`;
    res.type("text/xml").send(twiml);
  } catch (error) {
    console.error("Twilio SMS webhook error:", error.stack || error.message);
    const fallbackTwiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>Thanks — we received your message and will text you shortly.</Message></Response>`;
    res.type("text/xml").send(fallbackTwiml);
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

app.get("/twilio/nurturing-call", (req, res) => {
  const scheduleId = req.query.scheduleId;
  const script = req.query.script;

  if (!scheduleId || !script) {
    res.status(400).send("Missing scheduleId or script");
    return;
  }

  const requestBaseUrl = resolveBaseUrl(req);
  if (!requestBaseUrl) {
    res.status(500).send("Cannot resolve base URL");
    return;
  }

  const wssUrl = `${requestBaseUrl.replace(/^http/, "ws")}/twilio-media?type=nurturing&scheduleId=${encodeURIComponent(scheduleId)}&script=${encodeURIComponent(script)}`;

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${wssUrl}" />
  </Connect>
</Response>`;

  res.type("text/xml").send(twiml);
});

app.post("/twilio/nurturing-call-status", (req, res) => {
  const scheduleId = req.query.scheduleId;
  console.log(`[Nurturing] Call status update for scheduleId=${scheduleId}:`, req.body?.CallStatus);
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

server.on("upgrade", (request, socket, head) => {
  console.log("[DEBUG] WebSocket upgrade request received for URL:", request.url);
});

wss.on("connection", async (twilioSocket, req) => {
  let isInitializing = true;
  const twilioMessageQueue = [];

  twilioSocket.on("message", (raw) => {
    if (isInitializing) {
      twilioMessageQueue.push(raw);
    } else {
      handleTwilioMessage(raw);
    }
  });

  let instructions = "";
  const rawUrl = req.url || "";
  const parsedUrl = new URL(rawUrl, "http://localhost");
  const pathname = parsedUrl.pathname || "";
  const q = Object.fromEntries(parsedUrl.searchParams.entries());

  let isNurturing = q.type === "nurturing";
  const recoveryId = q.recoveryId;
  const scheduleId = q.scheduleId;
  const campaignId = q.campaignId;
  const contactId = q.contactId;
  const scriptId = q.scriptId;
  const recoveryScript = q.script ? decodeURIComponent(q.script) : "";
  const leadSource = q.leadSource || null;

  // PATH-BASED METADATA EXTRACTION (Robust against query-string stripping)
  // Patterns: 
  // 1. /twilio-media/{tenantId}/{callSid}
  // 2. /twilio-media/{tenantId}/outbound/{callSid}
  // 3. /twilio-media/{tenantId}/recovery/{callSid}
  const pathSegments = pathname.split("/").filter(Boolean); // e.g. ["twilio-media", "{tenantId}", "{type or callSid}", "{callSid}"]
  
  let tenantId = pathSegments[1] || "";
  let callSidFromPath = "";
  let typeFromPath = "";

  if (pathSegments.length === 3) {
    // Standard Inbound: /twilio-media/{tenantId}/{callSid}
    callSidFromPath = pathSegments[2];
  } else if (pathSegments.length === 4) {
    // Outbound or Recovery: /twilio-media/{tenantId}/{type}/{callSid}
    typeFromPath = pathSegments[2];
    callSidFromPath = pathSegments[3];
  }

  let callSid = callSidFromPath || q.CallSid || q.callSid;
  let isOutboundFromPath = typeFromPath === "outbound";
  let isOutbound = isOutboundFromPath || q.type === "outbound" || q.direction === "outbound";
  if (q.direction === "inbound") isOutbound = false;
  let isRecovery = typeFromPath === "recovery" || q.type === "recovery";
  
  console.log("[AI-Desk] Connection Context: tenantId=%s type=%s callSid=%s (extracted from %s segments)", 
    tenantId, (isOutbound ? "outbound" : (isRecovery ? "recovery" : "inbound")), callSid, pathSegments.length);

  // Use CallSid context if we have it for direction detection
  if (!isOutbound && callSid) {
     try {
       // BUG FIX: The column name is twilio_call_sid, not twilio_sid
       const callDirRes = await db.query("SELECT direction, tenant_id FROM calls WHERE twilio_call_sid = $1", [callSid]);
       if (callDirRes.rows[0]?.direction === 'outbound') {
         isOutbound = true;
         // Sync tenantId if it was missing from path
         if (!tenantId) tenantId = callDirRes.rows[0].tenant_id;
         console.log("[AI-Desk] Robust Detect SUCCESS: Call %s is OUTBOUND to tenant %s from DB", callSid, tenantId);
       } else {
         console.log("[AI-Desk] Direction lookup: Found call %s but direction is %s", callSid, callDirRes.rows[0]?.direction || "unknown");
       }
     } catch (e) {
       console.error("[AI-Desk] Direction lookup CRITICAL fail:", e.message);
     }
  }

  console.log("[AI-Desk] Connection path=%s isRecovery=%s isNurturing=%s isOutbound=%s tenantId=%s", pathname, isRecovery, isNurturing, isOutbound, tenantId);

  const isTurnBased = q.turnBased === "1";
  if (isTurnBased) {
    console.log("[AI-Desk] Handoff to Turn-Based Stream Handler (Owner/Test Mode)");
    const { handleTurnBasedStream } = require("./handlers/turnBasedStream");
    handleTurnBasedStream(twilioSocket, { 
      callSid: callSidFromPath, 
      from: q.From, 
      to: q.To,
      isOutbound 
    }, getTenantByPhone, callsService, recordingService);
    return;
  }

  let tenant = null;

  // 1. PRIORITIZE RESOLVING TENANT FROM CAMPAIGN/RECOVERY/NURTURING
  if (isOutbound && campaignId) {
    try {
      const cRes = await db.query("SELECT tenant_id FROM outbound_campaigns WHERE id = $1", [campaignId]);
      if (cRes.rows[0]) {
        tenantId = cRes.rows[0].tenant_id;
        tenant = await getTenantById(tenantId);
      }
    } catch (e) {
      console.error("[Outbound] Campaign tenant lookup failed:", e.message);
    }
  } else if (isRecovery && recoveryId) {
     try {
       const rRes = await db.query("SELECT tenant_id FROM estimate_recovery WHERE id = $1", [recoveryId]);
       if (rRes.rows[0]) {
         tenantId = rRes.rows[0].tenant_id;
         tenant = await getTenantById(tenantId);
       }
     } catch (e) {
       console.error("[Recovery] lookup failed:", e.message);
     }
  } else if (isNurturing && scheduleId) {
     try {
       const sRes = await db.query("SELECT tenant_id FROM nurturing_schedule WHERE id = $1", [scheduleId]);
       if (sRes.rows[0]) {
         tenantId = sRes.rows[0].tenant_id;
         tenant = await getTenantById(tenantId);
       }
     } catch (e) {
       console.error("[Nurturing] lookup failed:", e.message);
     }
  }

  // 2. FALLBACK TO PATH SEGMENT OR DEFAULT "GLADIATORS"
  if (!tenant) {
    if (!tenantId) tenantId = "gladiators";
    tenant = TENANTS[tenantId];
    
    // If slug lookup failed, try finding first Available if path was empty
    if (!tenant && !tenantId) {
      const availableTenantIds = Object.keys(TENANTS);
      if (availableTenantIds.length > 0) {
        tenant = TENANTS[availableTenantIds[0]];
        console.log("[AI-Desk] Tenant lookup fallback to first available:", tenant?.slug);
      }
    }

    // Try DB lookup if not in cache (handles new tenants without server restart)
    if (!tenant && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenantId)) {
      try {
        tenant = await getTenantById(tenantId);
      } catch (e) {
        console.error("[AI-Desk] WebSocket tenant lookup failed:", e.message);
      }
    }
  }

  if (!tenant && !isRecovery && !isNurturing && !isOutbound) {
    console.error("[AI-Desk] No tenant for path segment:", tenantId, "- ensure DB is seeded and loadTenants ran.");
    twilioSocket.close();
    return;
  }

  // RELOAD TENANT FROM DB to ensure we have the latest Settings (instructions, FAQs, etc.)
  if (tenant && tenant.id) {
    try {
      const freshTenant = await getTenantById(tenant.id);
      if (freshTenant) {
        // Carry over transferNumber which is calculated in loadTenants
        const transferNumber = (freshTenant.transfer_numbers && freshTenant.transfer_numbers[0]) || null;
        tenant = { ...freshTenant, transferNumber };
      }
    } catch (e) {
      console.error("[AI-Desk] Failed to refresh tenant data:", e.message);
    }
  }

  // OUTBOUND SCRIPT RESOLUTION
  let outboundScript = null;
  if (isOutbound && campaignId) {
    try {
      const cRes = await db.query("SELECT * FROM outbound_campaigns WHERE id = $1", [campaignId]);
      const campaign = cRes.rows[0];
      if (campaign) {
        // AI PERSONA OVERRIDES (Strict Priority: Campaign > Outbound Settings > Defaults)
        tenant.outbound_agent_name = campaign.agent_name || tenant.outbound_agent_name || "Alex";
        tenant.outbound_instructions = campaign.persona_instructions || tenant.outbound_instructions || "";
        tenant.outbound_voice = campaign.agent_voice || tenant.outbound_voice || tenant.openai_realtime_voice || "ash";

        if (campaign.mode === 'manual') {
          outboundScript = campaign.prompt_description;
        } else if (scriptId) {
          try {
            const sRes = await db.query("SELECT content FROM outbound_scripts WHERE id = $1", [scriptId]);
            outboundScript = sRes.rows[0]?.content;
            if (outboundScript) {
              console.log("[Outbound] Success: Using script variation %s", scriptId);
            } else {
              console.warn("[Outbound] Warning: Script variation %s not found in DB. Falling back to default.", scriptId);
            }
          } catch (err) {
             console.error("[Outbound] Error fetching script %s:", scriptId, err.message);
          }
        }
        
        // Final fallback to campaign-wide prompt if variation failed/missing
        if (!outboundScript && campaign.prompt_description) {
           outboundScript = campaign.prompt_description;
        }
        
        // Fetch contact details if available
        if (q.contactId) {
          const contactRes = await db.query("SELECT * FROM outbound_contacts WHERE id = $1", [q.contactId]);
          const contact = contactRes.rows[0];
          if (contact) {
            tenant.contactName = contact.name || null;
            tenant.contactPhone = contact.phone || null;
          }
        }

        // Overwrite tenant if campaign belongs to another tenant (safety)
        if (campaign.tenant_id !== tenant?.id) {
          tenant = await getTenantById(campaign.tenant_id);
        }

        // AUTO INTRODUCTION FALLBACK if no script found
        if (!outboundScript && isOutbound) {
          const biz = tenant?.company_name || 'the team';
          const agent = tenant?.outbound_agent_name || 'Alex';
          outboundScript = tenant.contactName 
            ? `Hi {contact_name}, this is ${agent} from ${biz}. I was calling to follow up on your recent request, how are you doing today?`
            : `Hello, this is ${agent} from ${biz}. I was calling to follow up on your recent inquiry, how are you doing today?`;
        }

        // DYNAMIC VARIABLE INJECTION (Placeholders: {contact_name})
        if (outboundScript) {
          const displayName = tenant.contactName || "there";
          outboundScript = outboundScript.replace(/\{contact_name\}/gi, displayName);
        }
      }
    } catch (e) {
      console.error("[Outbound] Failed to fetch campaign/contact data:", e.message);
    }
  }

  if (tenant && tenant.is_suspended) {
    console.warn("[AI-Desk] Call blocked for suspended tenant:", tenant.slug);
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
  // callSid and isOutbound are handled at the top of handleConnection
  let streamSid = null;
  let from = null;
  let to = null;
  let transcript = "";
  let transferAttempted = false;
  let hasBooked = false;
  let hasScheduledHangup = false;
  let shouldIgnoreSpeech = false;
  let currentLeadCapture = {};
  let leadId = null;

  const pendingTwilioAudio = [];
  const openaiQueue = [];
  let openaiReady = false;
  let openaiSocket = null;
  let streamStarted = false;
  let greetingTriggered = false;
  let sessionUpdated = false;
  let responseInProgress = false;

  function triggerGreetingIfReady() {
    if (openaiReady && streamStarted && !greetingTriggered) {
        if (!sessionUpdated) {
          console.log("[AI-Desk] triggerGreetingIfReady waiting for sessionUpdated (Outbound/Recovery)");
          return;
        }
      greetingTriggered = true;
      const useRecoveryFlow = isRecovery || isOutbound || (isNurturing && recoveryScript);
      
      console.log("[AI-Desk] triggerGreetingIfReady useRecoveryFlow=%s isOutbound=%s", useRecoveryFlow, isOutbound);

      if (!useRecoveryFlow) {
        console.log("[AI-Desk] Triggering initial INBOUND greeting");
        sendToOpenAI({
          type: "response.create",
          response: {
            modalities: ["audio", "text"],
            instructions: "Greet the user warmly IN ENGLISH as a professional receptionist for " + (tenant?.company_name || "the business") + ". Ask how you can help them today. DO NOT USE ANY OTHER LANGUAGE."
          }
        });
      } else {
        // For OUTBOUND/RECOVERY, initiate response using campaign persona set in session.update
        console.log("[AI-Desk] Triggering initial OUTBOUND/RECOVERY introduction");
        sendToOpenAI({
          type: "response.create",
          response: {
            modalities: ["audio", "text"]
          }
        });
      }
    }
  }

  const crmLeadSentRef = { sent: false };
  const openaiModelCandidates = [...new Set([process.env.OPENAI_MODEL, "gpt-4o-realtime-preview-2024-12-17", "gpt-realtime"])]
    .filter(Boolean);

  function sendToOpenAI(payload) {
    const message = typeof payload === "string" ? payload : JSON.stringify(payload);
    if (!message.includes("input_audio_buffer.append")) {
      console.log("[DEBUG] sendToOpenAI type=%s queueSize=%d content=%s", 
        payload.type || "unknown", 
        openaiQueue.length,
        message.slice(0, 300)
      );
    }
    if (openaiReady && openaiSocket.readyState === WebSocket.OPEN) {
      openaiSocket.send(message);
      return;
    }
    openaiQueue.push(message);
    if (openaiQueue.length > 500 && message.includes("input_audio_buffer.append")) {
       // Optional: Drop oldest audio if queue is getting too big to avoid memory pressure or backlog
       openaiQueue.shift();
    }
  }

  let audioChunkCount = 0;
  function sendAudioToTwilio(base64Audio) {
    if (!streamSid || twilioSocket.readyState !== WebSocket.OPEN) {
      if (pendingTwilioAudio.length < 100) { // Limit cache to avoid memory issues
        pendingTwilioAudio.push(base64Audio);
      }
      return;
    }

    try {
      audioChunkCount++;
      if (audioChunkCount % 20 === 0) {
        console.log(`[AI-Desk] Sent ${audioChunkCount} audio chunks to Twilio streamSid=${streamSid}`);
      }
      twilioSocket.send(
        JSON.stringify({
          event: "media",
          streamSid,
          media: { payload: base64Audio }
        })
      );
    } catch (e) {
      console.error("[AI-Desk] Error sending audio to Twilio:", e.message);
    }
  }

  function connectOpenAI(modelIndex) {
    let model = (tenant && tenant.voice_model) ? tenant.voice_model : (openaiModelCandidates[modelIndex] || openaiModelCandidates[0]);
    
    // Safeguard: Ensure we use a valid realtime model name
    if (model === "gpt-4o-realtime") {
      console.warn(`[AI-Desk] Invalid model "gpt-4o-realtime" detected for tenant ${tenant?.slug || "unknown"}. Falling back to "gpt-4o-realtime-preview".`);
      model = "gpt-4o-realtime-preview";
    }

    const url = `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`;
    openaiSocket = new WebSocket(url, {
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "OpenAI-Beta": "realtime=v1"
      },
    });
    console.log("[DEBUG] Connecting to OpenAI Realtime API:", url);

    openaiSocket.on("open", async () => {
      openaiReady = true;
      while (openaiQueue.length) {
        const msg = openaiQueue.shift();
        openaiSocket.send(msg);
      }

      triggerGreetingIfReady();

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
      if (isNurturing && scheduleId) {
        try {
          const scheduleRow = await db.query(
            "SELECT tenant_id, lead_id FROM nurturing_schedule WHERE id = $1",
            [scheduleId]
          ).then((r) => r.rows[0]);
          if (scheduleRow) {
            tenant = await getTenantById(scheduleRow.tenant_id);
            leadId = scheduleRow.lead_id;
            console.log("[AI-Desk] Nurturing call loaded scheduleId=%s tenant=%s leadId=%s", scheduleId, tenant?.company_name, leadId);
          }
        } catch (e) {
          console.error("[AI-Desk] Nurturing schedule load error:", e.message);
        }
      }
      const useRecoveryFlow = isRecovery || isOutbound || (isNurturing && recoveryScript);

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

      // Use Orchestrator for tools, instructions and voice
      const aiConfig = getAIConfig({
        tenant,
        isOutbound,
        isRecovery,
        isNurturing,
        recoveryScript,
        outboundScript,
      });

      const silenceMs = parseInt(process.env.REALTIME_SILENCE_MS, 10) || 1000;
      const vadThreshold = parseFloat(process.env.REALTIME_VAD_THRESHOLD) || 0.6;
      const sessionUpdate = {
  type: "session.update",
  session: {
    input_audio_format: "g711_ulaw",
    output_audio_format: "g711_ulaw",
    voice: aiConfig.voice,
    instructions: `${aiConfig.instructions}\n\nSpeak clearly at a moderate pace. Let the caller finish before you respond. Always speak in English. DO NOT USE ANY OTHER LANGUAGE AT THE START OF THE CALL.`,
    tools: aiConfig.tools,
    turn_detection: {
      type: "server_vad",
      threshold: vadThreshold,
      prefix_padding_ms: 500,
      silence_duration_ms: silenceMs,
    },
    input_audio_transcription: { model: "whisper-1" },
  },
};
 
console.log("[DEBUG] Sending session.update to OpenAI:", JSON.stringify(sessionUpdate, null, 2));
sendToOpenAI(sessionUpdate);
      
    });

    openaiSocket.on("message", async (msg) => {
      let data;
      try {
        data = JSON.parse(msg.toString());
        if (data.type !== "response.audio.delta") {
           console.log("[DEBUG] OpenAI Event:", data.type, data.event_id || "");
        }
      } catch (e) {
        return;
      }

      if (data.type === "session.updated") {
        console.log("[AI-Desk] OpenAI session.updated received. Instructions established.");
        sessionUpdated = true;
        triggerGreetingIfReady();
      }

      if (data.type === "response.created") {
        responseInProgress = true;
      }
      if (data.type === "response.done" || data.type === "response.cancelled") {
        responseInProgress = false;
      }

      if (data.type === "response.audio.delta" && data.delta) {
        // console.log("[DEBUG] Received audio delta from OpenAI (length: %d)", data.delta.length);
        sendAudioToTwilio(data.delta);
        return;
      }

      if (data.type === "input_audio_buffer.speech_started") {
        if (shouldIgnoreSpeech) {
          console.log("[AI-Desk] Ignoring user speech during finalization");
          return;
        }
        console.log("[AI-Desk] User started speaking - interrupting AI");
        
        // 1. Tell OpenAI to stop current response only if one is active
        if (responseInProgress) {
          sendToOpenAI({ type: "response.cancel" });
          responseInProgress = false;
        } else {
          console.log("[AI-Desk] Skipped response.cancel (no active response)");
        }

        // 2. Tell Twilio to clear any queued audio ONLY if we just interrupted a live response
        if (twilioSocket.readyState === WebSocket.OPEN && streamSid && responseInProgress) {
          twilioSocket.send(JSON.stringify({
            event: "clear",
            streamSid: streamSid
          }));
        }
      }

      if (data.type === "input_audio_buffer.speech_stopped") {
        console.log("[AI-Desk] User stopped speaking");
      }

      if (data.type === "conversation.item.input_audio_transcription.completed") {
        const text = data.transcript || "";
        console.log("[AI-Desk] User Transcript:", text);
        if (text) {
          transcript += `User: ${text}\n`;
          if (leadId && tenant) {
            messagesService.saveMessage(tenant.id, leadId, "voice", "inbound", text);
          }
        }
      }

      if (data.type === "response.audio_transcription.completed") {
        const text = data.transcript || "";
        console.log("[AI-Desk] Assistant Transcript:", text);
        if (text) {
          transcript += `Assistant: ${text}\n`;
          if (leadId && tenant) {
            messagesService.saveMessage(tenant.id, leadId, "voice", "outbound", text);
          }
        }
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
            if (name === "check_availability" && tenant) {
              const { appointment_date, appointment_time } = args;
              const av = await calendar.checkAvailability(appointment_date, appointment_time, tenant);
              output = JSON.stringify({ 
                success: true, 
                available: av.available, 
                suggested_alternatives: av.suggestedTimes,
                message: av.available 
                  ? "That time is available. You can proceed with book_appointment." 
                  : `That time is unfortunately taken. I found these available slots on ${appointment_date}: ${av.suggestedTimes.join(", ")}. Please suggest these to the caller or ask for another time.` 
              });
            } else if (name === "cancel_appointment" && tenant && callId) {
              const { contact_phone, reason } = args;
              const booking = await bookingsService.findLatestBookingByPhone(tenant.id, contact_phone);
              if (!booking) {
                output = JSON.stringify({ success: false, message: "No appointment found for this phone number." });
              } else {
                await bookingsService.cancelBooking(booking.id);
                output = JSON.stringify({ success: true, message: "Appointment cancelled successfully." });
              }
            } else if (name === "reschedule_appointment" && tenant && callId) {
              const { contact_phone, new_date, new_time, notes } = args;
              const booking = await bookingsService.findLatestBookingByPhone(tenant.id, contact_phone);
              if (!booking) {
                output = JSON.stringify({ success: false, message: "No appointment found for this phone number." });
              } else {
                await bookingsService.updateBooking(booking.id, {
                  preferred_date: new_date,
                  appointment_time: new_time,
                  notes: notes || booking.notes
                });
                output = JSON.stringify({ success: true, message: "Appointment rescheduled successfully." });
              }
            } else if (name === "capture_lead_info" && tenant) {
              console.log("[AI-Desk] Realtime capture_lead_info tenantId=%s leadId=%s props=%j", tenant.id, leadId, args);
              currentLeadCapture = { ...currentLeadCapture, ...args };
              if (leadId) {
                await leadsService.updateLeadInfo(leadId, {
                  name: args.contact_name,
                  email: args.contact_email,
                  address: args.address || args.city,
                  project_type: args.project_type || args.job_type,
                  notes: args.notes || args.details || args.scope
                }).catch(e => console.error("[AI-Desk] Lead update failed:", e.message));
              }
              output = JSON.stringify({ success: true, message: "Lead info captured. Continue the conversation." });
            } else if (name === "book_appointment" && tenant && callId) {
              console.log("[AI-Desk] Realtime book_appointment callSid=%s tenantId=%s callId=%s recovery=%s", callSid, tenant.id, callId, isRecovery);
              currentLeadCapture = { ...currentLeadCapture, ...args };
              
              // 1. Create local booking
              const { booking, crmSynced } = await bookingsService.createBooking(tenant.id, callId, args, leadId, leadSource);
              console.log("[AI-Desk] Realtime booking done id=%s crmSynced=%s", booking.id, crmSynced);
              
              // 2. Sync to Google Calendar
              calendar.syncToGoogleCalendar(booking, tenant).catch(e => console.error("[Calendar] Auto-sync failed:", e.message));

              // 3. Update lead status to 'Booked'
              if (leadId) {
                leadsService.updateLeadStatus(leadId, 'Booked').catch(e => console.error("Lead status update error:", e));
              }

              // 4. Trigger estimate follow-up engine
              salesEngine.createEstimateFollowUp({
                full_name: args.contact_name || args.full_name,
                phone: args.contact_phone || args.phone,
                project_details: args.notes || args.project_details || args.scope
              }, tenant.id).catch(err => {
                console.error("[Sales-Engine] Trigger error:", err.message);
              });

              // 5. Mark any active estimate recovery as CONVERTED (Sales Win)
              const bookingPhone = args.contact_phone || args.phone;
              if (bookingPhone) {
                try {
                  const activeRecovery = await db.query(
                    "SELECT id FROM estimate_recoveries WHERE tenant_id = $1 AND contact_phone = $2 AND status IN ('active', 'paused', 'dormant') LIMIT 1",
                    [tenant.id, normalizePhone(bookingPhone)]
                  );
                  if (activeRecovery.rows.length > 0) {
                    await estimateRecoveryService.markConverted(activeRecovery.rows[0].id);
                    console.log("[AI-Desk] Recovery CONVERTED (via booking) id=%s 🎉", activeRecovery.rows[0].id);
                  }
                  // Also stop any sales engine follow-up
                  await salesEngine.stopEstimateFollowUp(normalizePhone(bookingPhone), 'converted');
                } catch (e) {
                  console.error("[AI-Desk] Recovery conversion error:", e.message);
                }
              }

              const confirmedDate = args.preferred_date || args.appointment_date || "";
              const confirmedTime = args.appointment_time || "";
              const message = crmSynced
                ? `Estimate scheduled for ${confirmedDate} at ${confirmedTime}. Details synced. Say to the caller: "I have scheduled that for ${confirmedDate} at ${confirmedTime}. You will receive a confirmation text shortly. Is there anything else I can help you with today?". Wait for their response. ONLY call the 'hang_up' tool if they say no or if the conversation is clearly finished.`
                : `Estimate scheduled for ${confirmedDate} at ${confirmedTime}. Saved locally. Say to the caller: "I have scheduled that for ${confirmedDate} at ${confirmedTime}. You will receive a confirmation text shortly. Is there anything else I can help you with today?". Wait for their response. ONLY call the 'hang_up' tool if they say no or if the conversation is clearly finished.`;
              
              output = JSON.stringify({ success: true, message });
              hasBooked = true;
              // we don't session.update to "STOP SPEAKING" here anymore, 
              // we letting AI say the message and then it calls hang_up tool.
              // shouldIgnoreSpeech = true; // Still useful to prevent user from interrupting the final goodbye
            } else if (name === "detect_objection" && isRecovery && recoveryRecord) {
              const objType = args.objection_type;
              console.log("[AI-Desk] Recovery objection detected id=%s type=%s details=%s", recoveryRecord.id, objType, args.details || "(none)");
              await estimateRecoveryService.setObjection(recoveryRecord.id, objType);
              await estimateRecoveryService.recordResponse(recoveryRecord.id);
              output = JSON.stringify({ success: true, message: `Objection ${objType} recorded. Adjusting follow-up sequence.` });
            } else if (name === "request_human_transfer" && callSid && tenant) {
              if (!isWithinBusinessHours(tenant)) {
                output = JSON.stringify({ success: false, error: "Office is currently closed. Tell the caller the office is closed and you cannot transfer them right now, but you can help take a message or schedule a callback." });
              } else {
                const result = await transferService.initiateTransfer(
                  callSid,
                  null,
                  args.reason,
                  args.summary,
                  {
                    caller_name: args.caller_name,
                    caller_phone: args.caller_phone,
                    project_type: args.project_type,
                    budget_estimate: args.budget_estimate,
                    sentiment: args.sentiment,
                    location: args.location
                  }
                );
                output = JSON.stringify(result);
              }
            } else if (name === "hang_up" && callSid) {
              console.log("[AI-Desk] Realtime hang_up trigger callSid=%s", callSid);
              output = JSON.stringify({ success: true, message: "Call ending." });
              
              // Give AI a moment to finish speaking if needed, then terminate
              setTimeout(async () => {
                try {
                  const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
                  await client.calls(callSid).update({ status: "completed" });
                  console.log("[AI-Desk] Call terminated via hang_up tool callSid=%s", callSid);
                } catch (e) {
                  console.error("[AI-Desk] Hang up error:", e.message);
                }
              }, 1500); // 1.5s delay to ensure the goodbye audio is sent
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
        
        // Force the AI to respond immediately with the new context
        sendToOpenAI({ type: "response.create" });
        return;
      }

      if (data.type === "response.done") {
        const response = data.response;
        if (response && response.output) {
          response.output.forEach(item => {
            if (item.type === "message" && item.content) {
              item.content.forEach(c => {
                if (c.type === "audio" && c.transcript) {
                  // Ensure we don't duplicate if already added by response.audio_transcription.completed
                  const assistantLine = `Assistant: ${c.transcript}\n`;
                  if (!transcript.includes(assistantLine)) {
                    transcript += assistantLine;
                  }
                } else if (c.type === "text" && c.text) {
                  const assistantLine = `Assistant: ${c.text}\n`;
                  if (!transcript.includes(assistantLine)) {
                    transcript += assistantLine;
                  }
                }
              });
            }
          });
        }
      }

      if (data.type === "response.done") {
        const callerAskedHuman = /human|person|representative|manager|transfer/i.test(transcript);
        if (callerAskedHuman && !transferAttempted && isWithinBusinessHours(tenant)) {
          transferAttempted = true;
          await attemptTransfer(callSid, tenant);
        }
        await safeUpdateCallSummary(callId, { transcript, metadata: { leadCapture: currentLeadCapture } });

        if (hasBooked && !hasScheduledHangup) {
          hasScheduledHangup = true;
          console.log("[AI-Desk] Booking confirmed, closing call in 6s...");
          setTimeout(async () => {
            try {
              const client = twilioLib.getClientForTenant(tenant);
              if (client && callSid) {
                await client.calls(callSid).update({ status: "completed" });
                console.log("[AI-Desk] Explicitly HUNG UP callSid=%s", callSid);
              }
            } catch (e) {
              console.error("[AI-Desk] Explicit hangup failed:", e.message);
            }
            if (twilioSocket.readyState === WebSocket.OPEN) {
              console.log("[AI-Desk] Closing Twilio socket now.");
              twilioSocket.close();
            }
            // Final summary update inside timeout
            await safeUpdateCallSummary(callId, {
              transcript,
              disposition: 'booked',
              status: 'completed',
              markEnded: true
            });
          }, 6000);
        }
        return;
      }

      if (data.type && data.type.includes("error")) {
        // Ignore harmless race condition error when cancelling a finishing response
        if (data.error && data.error.code === "response_cancel_not_active") {
          return;
        }
        
        console.error("[AI-Desk] OpenAI error type=%s", data.type, data);
        
        // Handle invalid_model error by attempting fallback to a known good model
        if (data.error && data.error.code === "invalid_model") {
           console.error("[AI-Desk] Critical: Invalid model error from OpenAI. Attempting fallback to gpt-4o-realtime-preview.");
           if (openaiSocket && openaiSocket.readyState === WebSocket.OPEN) {
             openaiSocket.close();
           }
           // Force fallback to gpt-4o-realtime-preview explicitly
           if (tenant) tenant.voice_model = "gpt-4o-realtime-preview";
           connectOpenAI(0);
        }
      }
    });

    openaiSocket.on("error", (err) => console.error("OpenAI socket error:", err));
    openaiSocket.on("close", () => { openaiReady = false; });
  }
  connectOpenAI(0);

  isInitializing = false;
  while (twilioMessageQueue.length > 0) {
    handleTwilioMessage(twilioMessageQueue.shift());
  }

  async function handleTwilioMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (e) {
      console.log("[DEBUG] Twilio JSON parse failed:", e.message, raw.toString().slice(0, 100));
      return;
    }
    console.log("[DEBUG] Twilio WS msg.event =", msg.event);

    if (msg.event === "start") {
      streamSid = msg.start?.streamSid || msg.streamSid || null;
      callSid = msg.start?.callSid || null;
      streamStarted = true;
      console.log("[AI-Desk] Twilio Stream started streamSid=%s callSid=%s", streamSid, callSid);

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
        `INSERT INTO calls (id, tenant_id, twilio_call_sid, started_at, status, lead_source)
         VALUES ($1, $2, $3, now(), $4, $5)
         ON CONFLICT (twilio_call_sid) DO UPDATE SET status = 'in_progress'
         RETURNING id`,
        [callId, tenant.id, callSid, "in_progress", leadSource]
      );

      if (insertRes && insertRes.rows && insertRes.rows.length > 0) {
        callId = insertRes.rows[0].id;
      }

      // --- Lead/CRM Integration ---
      from = msg.start?.customParameters?.From || msg.start?.from || null;
      if (from && tenant) {
        leadsService.getOrCreateLead(tenant.id, from, null, leadSource).then(lead => {
          if (lead) {
            leadId = lead.id;
            console.log("[AI-Desk] Lead linked callSid=%s leadId=%s", callSid, leadId);
            // Update call record with leadId
            safeUpdateCallSummary(callId, { leadId });
          }
        }).catch(err => console.error("[AI-Desk] Lead lookup failed:", err.message));
      }

      // --- Caller Memory Upgrade ---
      if (callSid) {
        from = msg.start?.customParameters?.From || msg.start?.from || null; // Twilio might pass it
        // If not in start params, we might need to get it from the call log or metadata
        // But let's check if we can get it from msg.start.callSid
        if (!from) {
          // Fallback: use the 'from' value we already have if any
        }

        if (from) {
          let history = null;
          try {
            history = await getCallerHistory(from);
          } catch (err) {
            console.error("[AI-Desk] Caller history lookup failed:", err.message);
          }

          if (history) {
            console.log("[AI-Desk] Returning caller detected: %s", from);
            sendToOpenAI({
              type: "session.update",
              session: {
                instructions: `THIS CALLER HAS CONTACTED BEFORE. Greet them like a returning customer.\n\nPrevious conversation summary/transcript:\n${history}\n\n${instructions}`
              }
            });
          }
        }
      }

      // Trigger greeting AFTER any history lookups are finished and applied
      triggerGreetingIfReady();

      return;
    }

    if (msg.event === "media" && msg.media?.payload) {
      if (!shouldIgnoreSpeech) {
        sendToOpenAI({ type: "input_audio_buffer.append", audio: msg.media.payload });
      }
      return;
    }

    if (msg.event === "stop") {
      if (openaiSocket?.readyState === WebSocket.OPEN) {
        openaiSocket.close();
      }

      await safeUpdateCallSummary(callId, {
        status: transferAttempted ? "transferred" : "completed",
        disposition: hasBooked ? "booked" : (transferAttempted ? "transferred" : "completed"),
        transcript,
        metadata: { leadCapture: currentLeadCapture },
        markEnded: true
      });
    }
  };

  twilioSocket.on("close", async () => {
    if (openaiSocket?.readyState === WebSocket.OPEN) {
      openaiSocket.close();
    }
    if (!hasScheduledHangup) {
      await safeUpdateCallSummary(callId, {
        status: transferAttempted ? "transferred" : "completed",
        disposition: hasBooked ? "booked" : (transferAttempted ? "transferred" : "completed"),
        transcript,
        metadata: { leadCapture: currentLeadCapture },
        markEnded: true
      });

      // Trigger inquiry follow-up if they didn't book
      if (!hasBooked && !transferAttempted && leadId && from && tenant) {
        estimateRecoveryService.startInquiryRecovery(tenant.id, {
          id: leadId,
          phone: from,
          name: currentLeadCapture.full_name || currentLeadCapture.name || null
        }, { call_id: callId }).catch(err => console.error("[AI-Desk] Inquiry follow-up trigger failed:", err.message));
      }
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

// ── Visitor tracking (chat widget) ──
app.post("/visitor-event", async (req, res) => {
  try {
    const { tenantId, sessionId, event, url, timestamp } = req.body || {};
    console.log("[Widget] visitor-event tenant=%s session=%s event=%s url=%s", tenantId, sessionId, event, url);
    // Best-effort: record the event for analytics if needed later
    res.json({ ok: true });
  } catch (err) {
    console.error("[Widget] visitor-event error:", err.message);
    res.json({ ok: true }); // Never fail the widget
  }
});

// ── Lead capture from chat widget ──
app.post("/lead-capture", async (req, res) => {
  try {
    const { tenantId, sessionId, lead } = req.body || {};
    console.log("[Widget] lead-capture tenant=%s session=%s lead=%j", tenantId, sessionId, lead);

    let tenant = null;
    if (tenantId) {
      tenant = await getTenantById(tenantId).catch(() => null);
      if (!tenant) tenant = await getTenantBySlug(tenantId).catch(() => null);
    }

    if (tenant && lead) {
      const leadRecord = await leadsService.getOrCreateLead(tenant.id, lead.phone || sessionId, lead.full_name || lead.name);
      if (leadRecord && Object.keys(lead).length > 0) {
        await leadsService.updateLeadInfo(leadRecord.id, {
          name: lead.full_name || lead.name,
          email: lead.email,
          address: lead.address,
          project_type: lead.project_type,
          notes: lead.project_details
        }).catch(e => console.error("[Widget] lead update error:", e.message));
      }
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("[Widget] lead-capture error:", err.message);
    res.json({ ok: true }); // Never fail the widget
  }
});

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

let tenant = null;

if (tenantId) {
  tenant = await getTenantById(tenantId).catch(() => null);

  if (!tenant) {
    tenant = await getTenantBySlug(tenantId).catch(() => null);
  }
}

// Fallback to website-chat slug if nothing else found
if (!tenant) {
  tenant = await getTenantBySlug("website-chat").catch(() => null);
  if (tenantId) {
    console.warn(`[WebsiteChat] Tenant lookup failed for ID/Slug: ${tenantId}. Falling back to global "website-chat" tenant.`);
  }
}

// Remove the unsafe tenants[0] fallback to prevent wrong business name attribution

    // Explicitly set channel as website
    const thread = getOrCreateSmsThread(sessionId);
    thread.channel = "website";

    const result = await processSmsConversation(sessionId, message, tenant);
    const isFallback = (tenant && tenant.slug === "website-chat");
    const tenantName = tenant ? (tenant.company_name || tenant.name || "Website Chat") : "Website Chat";
    
    emailService
      .sendWebsiteChatNotificationEmail({ message, sessionId, reply: result.reply, tenantName: isFallback ? "Website Chat" : tenantName })
      .catch((err) => console.error("Website chat email to Drew:", err.message));
    res.json(result);
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
    console.log("[Facebook Webhook] Raw Payload:", JSON.stringify(req.body, null, 2));

    const entry = req.body.entry?.[0];
    const messaging = entry?.messaging?.[0];
    const pageId = entry?.id || messaging?.recipient?.id; // The Page ID receiving the message

    // Look up the tenant for this Page ID
    const tenant = pageId ? await getTenantByFacebookPageId(pageId) : null;
    
    let pageAccessToken = tenant?.facebook_page_access_token;
    let tokenSource = "TENANT_DB";

    if (!pageAccessToken) {
      pageAccessToken = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
      tokenSource = "ENV_FALLBACK";
    }

    console.log(`[Facebook Webhook] Page ID: ${pageId}, Tenant resolved: ${tenant ? tenant.name : "NONE"}, Token Source: ${tokenSource}, Token Start: ${pageAccessToken ? pageAccessToken.substring(0, 10) : "MISSING"}`);

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
          `Hi 👋 Thanks for reaching out to ${tenant?.company_name || "us"}! Need a quote or want to schedule a service? I can help you right away.`,
          ["Get a Free Quote", "Book Estimate", "Talk to a Human"],
          pageAccessToken,
          tenant?.id
        );
        return res.sendStatus(200);
      }

      if (payload === "GET_QUOTE") {
        await sendFacebookMessage(
          senderId,
          "Great! What type of painting project are you planning?",
          [],
          pageAccessToken,
          tenant?.id
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
    // Skip echoes: Facebook sends back our own outbound messages; replying to them would send duplicate replies
    if (messaging.message.is_echo === true) {
      return res.sendStatus(200);
    }
    const mid = messaging.message.mid;
    if (mid) {
      const now = Date.now();
      for (const [k, t] of fbProcessedMessageIds.entries()) {
        if (now - t > FB_DEDUPE_MS) fbProcessedMessageIds.delete(k);
      }
      if (fbProcessedMessageIds.has(mid)) {
        return res.sendStatus(200);
      }
      fbProcessedMessageIds.set(mid, now);
    }

    // 🔥 Send 200 OK immediately to prevent Facebook from timing out.
    res.sendStatus(200);

    const senderId = messaging.sender.id;
    const messageText = messaging.message.text;

    // Show typing indicator
    await sendTypingIndicator(senderId, "typing_on", pageAccessToken);

    // 2–3 second delay
    await delay(2000 + Math.random() * 1000);

    // Stop typing indicator
    await sendTypingIndicator(senderId, "typing_off", pageAccessToken);

    const result = await processFacebookConversation(senderId, messageText, tenant, pageAccessToken);

    await sendFacebookMessage(
      senderId,
      result.reply,
      ["Get a Free Quote", "Talk to a Human", "Book Estimate"],
      pageAccessToken,
      tenant?.id
    );
  } catch (error) {
    console.error("Facebook webhook error:", error.stack || error.message);
    if (!res.headersSent) res.sendStatus(200); // Always 200 to FB
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

// -------------------- SPA catch-all (MUST be last) --------------------
// This wildcard route serves index.html for any GET request that didn't match
// an API or webhook endpoint, enabling client-side routing (React Router).
if (SERVE_DASHBOARD) {
  app.get("*", (req, res) => {
    if (req.path.startsWith("/api") || req.path.startsWith("/twilio") || req.path.startsWith("/stripe") || req.path.startsWith("/auth") || req.path.startsWith("/webhooks") || req.path.startsWith("/health")) return;
    res.sendFile(path.join(__dirname, "dashboard", "dist", "index.html"));
  });
}

app.post("/webhooks/sales/stop", async (req, res) => {
  const phone = normalizePhone(req.body?.phone || req.body?.contact_phone);
  const status = req.body?.status || "converted"; // 'converted' or 'cancelled'

  if (!phone) {
    return res.status(400).json({ ok: false, error: "Missing phone number" });
  }

  try {
    const result = await salesEngine.stopEstimateFollowUp(phone, status);
    res.json(result);
  } catch (error) {
    console.error("Stop follow-up error:", error.message);
    res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

// -------------------- Webhook: CRM Job Completed (DripJobs → Zapier → here) --------------------
app.post("/webhooks/crm/job-completed", async (req, res) => {
  console.log("[CRM Webhook] Received job-completed for phone=%s", req.body?.phone || req.body?.contact_phone);
  const phone = normalizePhone(req.body?.phone || req.body?.contact_phone);
  const contactName = req.body?.contact_name || null;
  const serviceDate = req.body?.service_date || new Date().toISOString().slice(0, 10);
  const jobType = req.body?.job_type || null;
  let tenantId = req.body?.tenant_id || null;

  if (!phone) {
    return res.status(400).json({ ok: false, error: "Missing phone or contact_phone" });
  }

  // Auth: Bearer <api_key> → look up tenant by api_key
  const authHeader = (req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
  if (authHeader) {
    try {
      const tenantRow = await db.query(
        "SELECT id FROM tenants WHERE api_key = $1 LIMIT 1",
        [authHeader]
      );
      if (tenantRow.rows.length > 0) {
        tenantId = tenantRow.rows[0].id;
      }
    } catch (e) {
      console.error("[CRM Webhook] api_key lookup error:", e.message);
    }
  }

  if (!tenantId) {
    return res.status(401).json({ ok: false, error: "Could not identify tenant. Provide Authorization: Bearer <api_key> or tenant_id in body." });
  }

  try {
    // 1. Find the lead by phone + tenant
    const leadResult = await db.query(
      "SELECT id, name FROM leads WHERE tenant_id = $1 AND phone = $2 LIMIT 1",
      [tenantId, phone]
    );
    if (leadResult.rows.length === 0) {
      console.log("[CRM Webhook] No lead found for phone=%s tenantId=%s", phone, tenantId);
      return res.status(404).json({ ok: false, error: "No lead found for this phone number" });
    }
    const lead = leadResult.rows[0];

    // 2. Update last_service_date on the lead
    await db.query(
      "UPDATE leads SET last_service_date = $1::date, updated_at = now() WHERE id = $2",
      [serviceDate, lead.id]
    );
    console.log("[CRM Webhook] Updated last_service_date=%s for leadId=%s", serviceDate, lead.id);

    // 3. Find the latest booking for this lead and mark it Completed (if not already)
    const bookingResult = await db.query(
      "SELECT id, status, lead_id, tenant_id, preferred_date FROM bookings WHERE tenant_id = $1 AND lead_id = $2 ORDER BY created_at DESC LIMIT 1",
      [tenantId, lead.id]
    );
    let booking = bookingResult.rows[0] || null;
    if (booking && booking.status !== "Completed") {
      await db.query(
        "UPDATE bookings SET status = 'Completed', updated_at = now() WHERE id = $1",
        [booking.id]
      );
      console.log("[CRM Webhook] Marked booking=%s as Completed", booking.id);
    }

    // 4. Schedule post-service nurturing campaigns (same as PATCH /api/bookings/:id)
    if (booking) {
      nurturingService.schedulePostServiceCampaigns(tenantId, booking).catch((e) =>
        console.error("[CRM Webhook] Schedule nurturing campaigns:", e)
      );
    } else {
      // No booking found — create a minimal one so nurturing can still work
      console.log("[CRM Webhook] No booking found for lead=%s, scheduling nurturing directly", lead.id);
      nurturingService.schedulePostServiceCampaigns(tenantId, {
        id: null,
        lead_id: lead.id,
        preferred_date: serviceDate,
      }).catch((e) =>
        console.error("[CRM Webhook] Schedule nurturing campaigns (no booking):", e)
      );
    }

    // 5. Mark any active estimate recovery as CONVERTED
    try {
      // Find active recovery in estimate_recoveries
      const activeRecovery = await db.query(
        "SELECT id FROM estimate_recoveries WHERE tenant_id = $1 AND contact_phone = $2 AND status IN ('active', 'paused', 'dormant') LIMIT 1",
        [tenantId, phone]
      );
      if (activeRecovery.rows.length > 0) {
        await estimateRecoveryService.markConverted(activeRecovery.rows[0].id);
        console.log("[CRM Webhook] Converted estimate_recovery id=%s", activeRecovery.rows[0].id);
      }
      
      // Also stop any sales engine follow-up
      await salesEngine.stopEstimateFollowUp(phone, 'converted');
    } catch (e) {
      console.error("[CRM Webhook] Recovery conversion error:", e.message);
    }

    res.json({
      ok: true,
      lead_id: lead.id,
      booking_id: booking?.id || null,
      last_service_date: serviceDate,
      nurturing_scheduled: true,
    });
  } catch (error) {
    console.error("[CRM Webhook] job-completed error:", error.message);
    res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

// -------------------- Cron: estimate recovery every 5 min --------------------
cron.schedule("*/5 * * * *", () => {
  estimateRecoveryService.processDueRecoveries().catch((e) => console.error("Recovery cron:", e));
});

// -------------------- Cron: Sales Engine follow-up every 10 min --------------------
cron.schedule("*/10 * * * *", () => {
  salesEngine.runEstimateFollowUps().catch((e) => console.error("Sales Engine cron:", e));
});

// -------------------- Cron: Follow-ups (24h, 3d, 5d, 10d after booking) every 10 min --------------------
cron.schedule("*/10 * * * *", () => {
  followUpService.processDueFollowUps().catch((e) => console.error("Follow-up cron:", e));
});

cron.schedule("*/10 * * * *", () => {
  nurturingService.processDueNurturing().catch((e) => console.error("Nurturing cron:", e));
});

cron.schedule("0 9 * * *", () => {
  nurturingService.processMaintenanceReminders().catch((e) => console.error("Nurturing maintenance:", e));
  nurturingService.processReengagement().catch((e) => console.error("Nurturing reengagement:", e));
  nurturingService.processSeasonalCampaigns().catch((e) => console.error("Nurturing seasonal:", e));
});

// -------------------- Listen --------------------
loadTenants().then(() => {
  server.listen(PORT, () => {
    console.log(`AI front desk backend listening on port ${PORT}`);
    startOutboundEngine().catch(e => console.error("Outbound Engine start failed:", e));
  });
});
