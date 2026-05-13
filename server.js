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
const { decideCallRouting } = require("./lib/callRouting");
const recordingService = require("./services/recording");
const transferService = require("./services/transfer");
const bookingsService = require("./services/bookings");
const followUpService = require("./services/followUp");
const nurturingService = require("./services/nurturing");
const estimateRecoveryService = require("./services/estimateRecovery");
const twilioLib = require("./lib/twilio");
const leadsService = require("./services/leads");
const messagesService = require("./services/messages");
const emailService = require("./services/email");
const { getAIConfig, REALTIME_TOOLS, RECOVERY_TOOLS } = require("./lib/orchestrator");
const { isWithinBusinessHours } = require("./lib/timeUtils");
const crmWebhookPayload = require("./lib/crmWebhookPayload");
const { getLast10Digits, normalizeE164Phone } = require("./lib/phone");

const _resetBase = (process.env.DASHBOARD_URL || process.env.BASE_URL || "").replace(/\/$/, "");
console.log("[Startup] Password reset: Resend=" + (process.env.RESEND_API_KEY && process.env.EMAIL_FROM ? "yes" : "no") + ", ResetLinkBase=" + (_resetBase || "NOT SET – set DASHBOARD_URL or BASE_URL"));

const twilioRoutes = require("./routes/twilio");
const dashboardRoutes = require("./routes/dashboard");
const authRoutes = require("./routes/auth");
const leadRoutes = require("./routes/leads");
const billingRoutes = require("./routes/billing");
const outboundRoutes = require("./routes/outbound");
const { startOutboundEngine } = require("./services/outboundEngine");
const { startResellerUsageReporter } = require("./services/reportResellerUsage");
const { authMiddleware, requireSuperAdmin } = require("./lib/auth");
const notificationsService = require("./services/notifications");
const metricAlerts = require("./services/metricAlerts");
const auditLogsRouter = require("./routes/auditLogs");
const { resolveHostnameToTenant } = require("./lib/hostnameResolver");

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
      if (typeof twilioRoutes.processStatusPayload === "function") {
        twilioRoutes.processStatusPayload({
          CallSid,
          CallStatus,
          From: params.get("From"),
          CallDuration: params.get("CallDuration"),
        });
      } else if (CallSid && (CallStatus === "completed" || CallStatus === "busy" || CallStatus === "failed" || CallStatus === "no-answer")) {
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
// Compliance pages — served as static HTML so Twilio reviewers + crawlers
// can read them without executing JavaScript. Apr 25 fix for 30896 rejection.
// Must be registered AFTER express.static and BEFORE the SPA wildcard.
app.get("/privacy-policy", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "privacy-policy.html"));
});
app.get("/sms-terms", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "sms-terms.html"));
});
app.get("/sms-consent", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "sms-consent.html"));
});
// Increase body size limits slightly to support small logo uploads (e.g. base64 images) in dashboard settings.
// Render runs us behind a load balancer. Without trust proxy, req.ip
// returns the proxy's internal IP instead of the actual visitor IP,
// which breaks SMS consent records (compliance / 10DLC dispute defense).
app.set("trust proxy", true);

app.use(express.urlencoded({ extended: true, limit: "2mb" }));
app.use(express.json({ limit: "2mb" }));

// ─── Hostname → tenant resolution (Phase 7 V2, May 13, 2026) ────
// Runs on every request. Sets req.tenantFromHost based on hostname.
// Non-blocking: null for our own domain / dev / unmatched hosts.
app.use(resolveHostnameToTenant);

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
    allowedHeaders: ["Content-Type", "Authorization", "x-tenant-id", "x-impersonate-tenant-id"],
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
    const consentRow = consentRes.rows[0];

  // 2. Find or Create Lead
    let lead = await db.query("SELECT id FROM leads WHERE tenant_id = $1 AND phone = $2", [tenantId, phone]).then(r => r.rows[0]);
    if (!lead) {
      const leadRes = await db.query(
        "INSERT INTO leads (tenant_id, phone, lead_source, contact_method, created_at, updated_at) VALUES ($1, $2, $3, $4, now(), now()) RETURNING id",
        [tenantId, phone, source || "widget_sms_popup", 'sms']
      );
      lead = leadRes.rows[0];
    }

    // 3. Link Consent to Lead
    await leadsService.updateLeadInfo(lead.id, {
      has_sms_consent: true,
      last_consent_at: consentRow.consent_given_at,
      last_consent_id: consentRow.id
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

// ═════════════════════════════════════════════════════════════════════
// Phase 8.3 (May 12, 2026) — Widget polling for owner-sent messages.
//
// Customer's chat widget polls this endpoint every ~5 seconds while
// open. We look up the lead for the (tenantId, sessionId) pair —
// website leads have lead.phone = sessionId (that's how the existing
// /website-chat handler routes via getOrCreateLead). Then return any
// new owner-sent outbound messages on channel='website' since the
// caller's `since` timestamp.
//
// Defensive: invalid params return empty arrays (200 OK, no error)
// so the widget can poll harmlessly even before a lead is created.
// Errors return 500 with empty messages so the widget keeps polling.
// ═════════════════════════════════════════════════════════════════════
app.get("/api/widget/poll-messages", async (req, res) => {
  try {
    const { tenantId, sessionId } = req.query;
    const since = req.query.since || new Date(Date.now() - 60 * 1000).toISOString();

    if (!tenantId || !sessionId) {
      return res.json({ messages: [] });
    }

    // Look up the lead for this session. For website leads, lead.phone
    // holds the sessionId — set in /website-chat → processSmsConversation
    // → getOrCreateLead(tenant.id, sessionId, ...).
    const leadRes = await db.query(
      "SELECT id FROM leads WHERE tenant_id = $1 AND phone = $2 LIMIT 1",
      [tenantId, sessionId]
    );

    if (!leadRes.rows[0]) {
      // No lead yet (customer hasn't sent anything) — nothing to poll
      return res.json({ messages: [] });
    }

    const leadId = leadRes.rows[0].id;

    const msgRes = await db.query(
      `SELECT id, body, created_at FROM messages
        WHERE lead_id = $1
          AND channel = 'website'
          AND direction = 'outbound'
          AND sent_by_user_id IS NOT NULL
          AND created_at > $2
        ORDER BY created_at ASC
        LIMIT 20`,
      [leadId, since]
    );

    res.json({ messages: msgRes.rows });
  } catch (err) {
    console.error("[Widget Poll] Error:", err.message);
    res.status(500).json({ messages: [] });
  }
});

const PORT = process.env.PORT;
const BASE_URL = process.env.BASE_URL;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
// Default: API-only (no /dashboard). Set SERVE_DASHBOARD=true for one-service deploy (API + dashboard on same URL).
const SERVE_DASHBOARD = process.env.SERVE_DASHBOARD === "true";
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER || "";
const smsThreads = new Map();

// Twilio retries unanswered webhooks after ~15s. Dedup by MessageSid so a
// retry doesn't re-trigger the orchestrator and emit duplicate replies.
// Bug observed May 7 2026: identical "✅ rescheduled" emitted twice in one minute.
const recentTwilioSmsSids = new Map(); // sid → timestamp ms
const TWILIO_SMS_DEDUP_MS = 5 * 60 * 1000;
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

    // Return only safe fields needed by the website chat widget.
    // Apr 21, 2026: added brand_color, accent_color, logo_url so widget
    // can render with tenant branding instead of default orange.
    res.json({
      id: tenant.id,
      name: tenant.name,
      company_name: tenant.company_name,
      welcome_message: tenant.welcome_message,
      chat_welcome_message: tenant.chat_welcome_message || null,
      twilio_phone_number: tenant.twilio_phone_number,
      timezone: tenant.timezone,
      brand_color: tenant.brand_color || null,
      accent_color: tenant.accent_color || null,
      logo_url: tenant.logo_url || null
    });
  } catch (error) {
    console.error("Public tenant API error:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});
app.post("/api/contact", async (req, res) => {
  const { name, email, message } = req.body || {};
  if (!name || !email) {
    return res.status(400).json({ error: "Name and email are required" });
  }
  try {
    await emailService.sendEmail({
      to: process.env.CONTACT_EMAIL || "drew@aifrontdeskhelper.com",
      subject: `📩 Contact form: ${name}`,
      html: `
        <h2>New message from Contact page</h2>
        <p><strong>Name:</strong> ${name}</p>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Message:</strong><br/>${(message || "").replace(/\n/g, "<br/>")}</p>
      `,
    });
    res.json({ ok: true });
  } catch (err) {
    console.error("[Contact] /api/contact failed:", err.message);
    res.status(500).json({ error: "Failed to send" });
  }
});

// Contact modal form (name, phone, email, enquiry, bestTime)
app.post("/api/public/contact", async (req, res) => {
  const { name, phone, email, enquiry, bestTime } = req.body || {};
  if (!name || !email) {
    return res.status(400).json({ error: "Name and email are required" });
  }
  try {
    await emailService.sendContactLeadEmail({ name, phone, email, enquiry, bestTime });
    res.json({ ok: true });
  } catch (err) {
    console.error("[Contact] /api/public/contact failed:", err.message);
    res.status(500).json({ error: "Failed to send" });
  }
});
app.use("/api/public", require("./routes/public"));
app.use("/api/estimator", require("./routes/estimator"));
app.use("/twilio", twilioRoutes);
app.use("/api/webhooks", require("./routes/webhooks"));
app.use("/api/auth", authRoutes);
app.use("/api/billing", authMiddleware, billingRoutes);
app.use("/api/outbound", authMiddleware, outboundRoutes);
app.use("/api/leads", leadRoutes);
app.use("/api/notifications", require("./routes/notifications"));
app.use("/api/stripe", authMiddleware, require("./routes/stripe"));
app.use("/api/admin", authMiddleware, requireSuperAdmin, require("./routes/admin"));
app.use("/api/admin/estimator", authMiddleware, requireSuperAdmin, require("./routes/estimatorAdmin"));
app.use("/api/team", authMiddleware, require("./routes/team"));
app.use("/api/audit-logs", authMiddleware, auditLogsRouter);
app.use("/api/franchisee", require("./routes/franchisee"));
app.use('/api/reseller-public', require('./routes/reseller-public'));
app.use('/api/reseller/usage', authMiddleware, require('./routes/resellerUsage'));
app.use("/api/churn-public", require("./routes/churn-public"));
app.use("/api/reviews", require("./routes/reviews"));
app.use("/", require("./routes/estimateLink"))
app.use('/api/reseller', require('./routes/reseller'));
app.use("/api/public/branding", require("./routes/publicBranding"));
app.use("/api", authMiddleware, dashboardRoutes);
app.use("/auth/google/calendar", require("./routes/google-calendar"));
app.use("/api/google-calendar", authMiddleware, require("./routes/google-calendar"));
app.use("/webhooks", require("./routes/webhooks"));
app.use("/api/coaching", authMiddleware, require("./routes/coaching"));
app.use("/api/ai-coach", authMiddleware, require("./routes/aicoach"));
app.use('/api/rollup-v5', authMiddleware, require('./routes/rollupV5'));
app.use("/api/scope-options", authMiddleware, require("./routes/scopeOptions"));
app.use("/api/vertical-services", authMiddleware, require("./routes/verticalServices"));
app.use("/api/branding", authMiddleware, require("./routes/branding"));
app.use('/churn', require('./routes/churnPublic'));

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

function buildTenantWsUrl(baseUrl, tenantId, leadSource = null, callContext = {}) {
  const wsBaseUrl = toWebSocketBaseUrl(baseUrl);
  const { callSid, fromNumber, toNumber, direction } = callContext;

  let url = callSid
    ? `${wsBaseUrl}/twilio-media/${tenantId}/${encodeURIComponent(callSid)}`
    : `${wsBaseUrl}/twilio-media/${tenantId}`;

  const params = new URLSearchParams();
  if (fromNumber) params.set("From", fromNumber);
  if (toNumber)   params.set("To",   toNumber);
  if (direction)  params.set("direction", direction);
  if (leadSource) params.set("leadSource", leadSource);

  const qs = params.toString();
  if (qs) url += `?${qs}`;

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

/**
 * TwiML for voicemail-only routing (AI off AND no ring-first).
 *
 * If the tenant configured a custom voicemail URL for this phone, play it
 * then <Record>. Otherwise fall back to a generic TTS greeting.
 *
 * Build 1 — Apr 23, 2026.
 */
function buildVoicemailTwiml(voicemailMessageUrl) {
  if (voicemailMessageUrl) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Play>${escapeXml(voicemailMessageUrl)}</Play>
  <Record maxLength="120" playBeep="true" trim="trim-silence" />
  <Hangup/>
</Response>`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">We're unable to take your call right now. Please leave a message after the tone.</Say>
  <Record maxLength="120" playBeep="true" trim="trim-silence" />
  <Hangup/>
</Response>`;
}

/**
 * TwiML for ring-first routing. Rings the configured human number, then
 * on no-answer falls through to either the AI stream or voicemail.
 *
 * <Dial> behavior: the verb completes and Twilio moves to the next verb
 * when the Dial times out OR the dialed party hangs up without answering.
 * So putting <Connect><Stream/> (or <Record>) after <Dial> is the correct
 * "if no-answer, do X" pattern.
 *
 * GOTCHA#23 already handled upstream in decideCallRouting — we never
 * produce ring-first TwiML when the caller IS the ring-first target.
 *
 * Build 1 — Apr 23, 2026.
 */
function buildRingFirstTwiml({
  ringFirstPhone,
  ringFirstTimeout,
  fallbackType,          // "ai_stream" | "voicemail"
  streamUrl,
  voicemailMessageUrl,
}) {
  const timeout = Math.min(60, Math.max(5, Number(ringFirstTimeout) || 20));

  let fallbackVerbs;
  if (fallbackType === "ai_stream") {
    fallbackVerbs = `<Connect>
    <Stream url="${escapeXml(streamUrl)}" />
  </Connect>`;
  } else if (voicemailMessageUrl) {
    fallbackVerbs = `<Play>${escapeXml(voicemailMessageUrl)}</Play>
  <Record maxLength="120" playBeep="true" trim="trim-silence" />
  <Hangup/>`;
  } else {
    fallbackVerbs = `<Say voice="Polly.Joanna">We're unable to take your call right now. Please leave a message after the tone.</Say>
  <Record maxLength="120" playBeep="true" trim="trim-silence" />
  <Hangup/>`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial timeout="${timeout}">${escapeXml(ringFirstPhone)}</Dial>
  ${fallbackVerbs}
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

   // Notification for spam detection
    if (status === "Spam") {
      try {
        const callRes = await pool.query("SELECT tenant_id, from_number FROM calls WHERE id = $1", [callId]);
        const call = callRes.rows[0];
        if (call && call.tenant_id) {
          await pool.query(
            "INSERT INTO notifications (tenant_id, type, title, body, data, created_at) VALUES ($1, $2, $3, $4, $5, now())",
            [call.tenant_id, 'spam_detected', 'Spam Call Detected', `Call from ${call.from_number || 'Unknown'} flagged as spam.`, JSON.stringify({ callId })]
          );
        }
      } catch (e) {
        console.error("Notification error:", e);
      }
    }

    // 📞 Missed call notification — fires when a call ends without booking/transfer/spam
    // Matches the logic in checkHungUpRates: short duration, no transfer, not booked,
    // not spam. Signals "AI couldn't handle this — a human should follow up."
    if (markEnded && status !== "Spam") {
      try {
        const callRes = await pool.query(
          `SELECT id, tenant_id, from_number, to_number, duration_minutes,
                  transfer_to, disposition, status, lead_id
           FROM calls WHERE id = $1`,
          [callId]
        );
        const call = callRes.rows[0];
        if (call && call.tenant_id) {
          const isShort        = (call.duration_minutes == null) || parseFloat(call.duration_minutes) < 1.0;
          const notTransferred = !call.transfer_to;
          const notBooked      = !(call.status && /booked/i.test(call.status))
                               && call.status !== "Estimate Scheduled"
                               && call.status !== "FollowUp Needed";
          const notSpamDisp    = !call.disposition || call.disposition !== "spam";

          if (isShort && notTransferred && notBooked && notSpamDisp) {
            // Dedup per callId — never fire twice for the same call
            const dup = await pool.query(
              `SELECT id FROM notifications
               WHERE tenant_id = $1 AND type = 'missed_call'
                 AND data->>'callId' = $2 LIMIT 1`,
              [call.tenant_id, String(callId)]
            );
            if (dup.rows.length === 0) {
              const fromLabel = call.from_number || "Unknown caller";
              await pool.query(
                "INSERT INTO notifications (tenant_id, type, title, body, data, created_at) VALUES ($1, $2, $3, $4, $5, now())",
                [
                  call.tenant_id,
                  'missed_call',
                  'Missed Call — Follow Up',
                  `${fromLabel} called but AI couldn't book or transfer. Consider a personal callback.`,
                  JSON.stringify({ callId, from_number: call.from_number, lead_id: call.lead_id }),
                ]
              );
              console.log("[Notification] missed_call fired for callId=%s tenant=%s", callId, call.tenant_id);
            }
          }
        }
      } catch (e) {
        console.error("[Notification] missed_call check failed:", e.message);
      }
    }

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

function normalizeCrmPreferredDate(value) {
  if (value == null || value === "") return "";
  const s = String(value).trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : s.slice(0, 10);
}

/** True when handleLeadBooking persisted a new appointment (not cancel/reschedule copy). */
function isNewBookingConfirmation(bookingResult) {
  return Boolean(bookingResult && /You are booked for/i.test(String(bookingResult)));
}

/** Ensures Zapier/DripJobs-friendly keys exist on any CRM lead webhook body. */
function finalizeCrmLeadPayload(obj) {
  if (!obj || typeof obj !== "object") return obj;
  const projectType = String(obj.project_type ?? obj.job_type ?? "").trim();
  const projectDetails = String(obj.project_details ?? "").trim();
  const rawAppt = String(obj.appointment_details ?? "").trim();
  const appointment_details =
    crmWebhookPayload.stripLiteralFieldLeak(rawAppt) ||
    crmWebhookPayload.stripLiteralFieldLeak(projectDetails) ||
    rawAppt ||
    projectDetails;
  const preferred = normalizeCrmPreferredDate(obj.preferred_date ?? obj.appointment_date ?? "");
  const phoneNorm = crmWebhookPayload.normalizePhoneForCrm(obj.phone || obj.contact_phone || "");
  const strippedFull = crmWebhookPayload.stripLiteralFieldLeak(String(obj.full_name ?? "").trim());
  const primaryName = String(strippedFull || String(obj.contact_name ?? "").trim() || "").trim();
  const nameParts = crmWebhookPayload.splitDisplayName(primaryName);
  const first_name = String(obj.first_name ?? "").trim() || nameParts.first_name;
  const last_name = String(obj.last_name ?? "").trim() || nameParts.last_name;
  const full_name = nameParts.full_name || primaryName || "";

  return {
    ...obj,
    full_name,
    first_name,
    last_name,
    phone: phoneNorm || String(obj.phone ?? "").trim(),
    contact_phone: phoneNorm || String(obj.contact_phone ?? obj.phone ?? "").trim(),
    job_type: String(obj.job_type ?? projectType).trim(),
    appointment_details,
    preferred_date: preferred,
  };
}

function buildThreadCrmLeadPayload(thread, ai, tenant, bookingResult) {
  const bookedOk = isNewBookingConfirmation(bookingResult);
  const scope = String(thread.leadCapture?.project_type ?? "").trim();
  const details = String(thread.leadCapture?.project_details ?? "").trim();
  const preferredRaw =
    bookedOk && ai?.appointment_date
      ? ai.appointment_date
      : (thread.leadCapture?.appointment_date || ai?.lead_capture?.appointment_date || "");
  const timeRaw =
    bookedOk && ai?.appointment_time
      ? ai.appointment_time
      : (thread.leadCapture?.appointment_time || ai?.lead_capture?.appointment_time || "");

  const rawName = String(thread.leadCapture?.full_name ?? "").trim();
  const nameParts = crmWebhookPayload.splitDisplayName(rawName);
  const displayName = nameParts.full_name || (crmWebhookPayload.stripLiteralFieldLeak(rawName) ? rawName : "");
  const phoneRaw = thread.leadCapture?.phone || thread.phone || "";
  const phone = crmWebhookPayload.normalizePhoneForCrm(phoneRaw) || String(phoneRaw).trim();
  const appointment_details = crmWebhookPayload.buildLeadThreadAppointmentDetails({
    jobType: scope,
    scope,
    details,
    timeRaw: timeRaw || "",
  });

  return finalizeCrmLeadPayload({
    event_type: "lead_capture",
    source: thread.channel || "unknown",
    full_name: displayName,
    first_name: nameParts.first_name,
    last_name: nameParts.last_name,
    contact_name: displayName,
    phone,
    contact_phone: phone,
    email: String(thread.leadCapture?.email ?? "").trim(),
    address: String(thread.leadCapture?.address ?? "").trim(),
    job_type: scope,
    appointment_details,
    appointment_time: timeRaw || "",
    preferred_date: normalizeCrmPreferredDate(preferredRaw),
    project_type: scope,
    project_details: details,
    lead_type: bookedOk ? "BOOKED" : "INQUIRY",
    timestamp: new Date().toISOString(),
    tenant_id: tenant?.id ?? null,
    tenant_name: tenant?.name ?? null,
    company_name: tenant?.company_name ?? null,
  });
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
    return false;
  }

  const payload = finalizeCrmLeadPayload(leadCapture);

  // --- CRM required-field gate ---
  // Only truly require a phone number (minimum to identify a lead).
  // All other CRM-required fields get smart fallbacks so no leads are lost.
  const ph = (payload.phone || payload.contact_phone || "").trim();

  if (!ph) {
    console.log("[CRM] Skipping webhook push – no phone number, tenant=%s", tenantId || "global");
    return false;
  }

  // Smart fallbacks for CRM-required fields
  if (!(payload.first_name || "").trim()) payload.first_name = "New Lead";
  if (!(payload.last_name || "").trim())  payload.last_name = ".";
  if (!(payload.email || "").trim() && !(payload.contact_email || "").trim()) {
    payload.email = `lead-${ph.replace(/\D/g, "").slice(-10)}@placeholder.local`;
    payload.contact_email = payload.email;
  }
  if (!(payload.address || "").trim()) payload.address = "Not provided";
  if (!(payload.city || "").trim()) payload.city = "Omaha";
  if (!(payload.state || "").trim()) payload.state = "Unknown";
  if (!(payload.zip || "").trim()) payload.zip = "00000";
  if (!(payload.preferred_date || "").trim()) payload.preferred_date = new Date().toISOString().split("T")[0];
  
  // Sync aliases
  if (!payload.full_name?.trim()) payload.full_name = `${payload.first_name} ${payload.last_name}`.trim();
  if (!payload.contact_name?.trim()) payload.contact_name = payload.full_name;
  if (!payload.contact_phone?.trim()) payload.contact_phone = ph;

  console.log("[CRM] Lead payload passed field gate – pushing to %d webhook(s)", webhookUrls.length);

  for (const url of webhookUrls) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
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

  return true;
}


function normalizePhone(value) {
  const raw = String(value || "").trim();
  return normalizeE164Phone(raw) || raw;
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
    lastOutboundAt: null,
    crmLeadSent: false,
    // Phase 4C (May 4, 2026) — SMS cancellation state machine.
    // null until customer asks to cancel; then awaiting_choice (multiple
    // bookings to disambiguate), awaiting_confirm (single booking, need
    // explicit YES), or awaiting_reason (asking why before firing cancel).
    // See services/sms.js handleSmsCancellationIncoming for transitions.
    cancelState: null,
    pendingCancelBookingId: null,
    pendingCancelBookingsList: null,
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
  const timezone    = tenant?.timezone || BUSINESS_TIMEZONE || "America/Chicago";

  // ─── DATE ANCHOR (Phase 7.6, May 7 2026) ──────────────────────────────
  // Without this block the AI hallucinates dates from training data.
  // Bug observed: "May 8th at 2:00" booked as 2023-05-08; "tomorrow late
  // morning" booked as 2026-10-06.
  const now = new Date();
  const dateFmt = new Intl.DateTimeFormat("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
    timeZone: timezone,
  }).format(now);
  const todayIso = new Intl.DateTimeFormat("en-CA", {
    year: "numeric", month: "2-digit", day: "2-digit",
    timeZone: timezone,
  }).format(now);
  const currentYear = parseInt(todayIso.slice(0, 4), 10);

  const dateAnchor = [
    "",
    "═══ TODAY'S DATE (read this every turn) ═══",
    `Today is ${dateFmt}.`,
    `ISO format: ${todayIso}. Current year: ${currentYear}.`,
    "",
    "When converting customer words to appointment_date (YYYY-MM-DD):",
    `  - "today" → ${todayIso}`,
    `  - "tomorrow" → the day after ${todayIso}`,
    `  - "next Monday" / "this Friday" → relative to ${todayIso}, NOT to your training data`,
    `  - Bare "May 8" with no year → May 8 of ${currentYear} if still upcoming, else ${currentYear + 1}`,
    `  - NEVER produce an appointment_date before ${todayIso}`,
    `  - NEVER produce an appointment_date more than 90 days after ${todayIso} unless the customer explicitly named a year more than 90 days out`,
    `  - NEVER use a year other than ${currentYear} or ${currentYear + 1}`,
    "",
  ].join("\n");

  const intentRules = [
    "═══ INTENT CLASSIFICATION (CRITICAL) ═══",
    "",
    "should_book: set TRUE ONLY when ALL of these are true:",
    "  - Customer named a specific date AND specific time",
    "  - We have full_name + phone + email already collected",
    "  - The question is about scheduling the CUSTOMER'S appointment, not asking when WE work",
    "",
    "should_cancel: set TRUE ONLY when customer EXPLICITLY says one of:",
    `  - "cancel my appointment" / "I want to cancel" / "no longer need this"`,
    `  - "not interested anymore"",
    "  - NOTE: \"remove me\" / \"take me off your list\" are DNC opt-out signals, NOT cancellation. Set should_dnc=true for those, not should_cancel.",
    "DO NOT set should_cancel for any of these (these are frustration, NOT cancellation):",
    `  - "stop calling me" / "this is annoying" / "you're not helping"`,
    `  - "Stop!!" / "Don't come" (without explicit cancellation language)`,
    `  - "you are no longer needed" (ambiguous — ASK to clarify before cancelling)`,
    `  - General negativity, rudeness, confusion`,
   "If the customer seems frustrated, apologize briefly, offer to have a human reach out, and DO NOT cancel anything.",
    "",
    "should_dnc: set TRUE ONLY when customer EXPLICITLY asks to stop being contacted (TCPA opt-out):",
    `  - "stop calling me" / "stop texting me" / "don't call me again"`,
    `  - "do not contact me" / "remove me from your list" / "take me off your list"`,
    `  - "I don't want to hear from you anymore" / "never message me again"`,
    "DO NOT set should_dnc for any of these:",
    `  - Single-word "STOP" / "UNSUBSCRIBE" / "CANCEL" — those fire BEFORE you see the message via the carrier keyword system. If you're seeing this message at all, those didn't trigger.`,
    `  - General frustration without explicit opt-out: "this is annoying", "you're not helping", "I'm busy"`,
    `  - Cancellation requests ("cancel my appointment") — that's should_cancel, not should_dnc`,
    "When should_dnc=true, keep your reply short and neutral — the system will overwrite it with the formal opt-out confirmation, so don't waste words trying to retain them.",
    "",
    "should_reschedule: set TRUE only when customer wants to MOVE an existing appointment AND has provided both a new date AND a new time.",
    "═══ SCHEDULE QUESTION DISAMBIGUATION ═══",
    "These ask about OUR work hours / OUR availability — answer informationally only, do NOT set should_book:",
    `  - "What's your schedule?" / "How busy are you?" / "When can you do the work?"`,
    `  - "Do you work weekends?" / "What hours are you open?"`,
    `  - "What is your work schedule" / "How long does this take?"`,
    "Example response: 'We're open Monday-Friday 8am-5pm. Once booked, we typically start within 1-2 weeks.'",
    "",
    "These ARE about scheduling the customer — you can pursue should_book once date+time+contact are present:",
    `  - "Can I come at 2pm Friday?" / "Are you free tomorrow?" / "What times are open?"`,
    "",
    "═══ STATE AWARENESS ═══",
    "If `Known lead data` below already has full_name/phone/email, do NOT ask for them again. Reference what you have.",
    "If the customer asks 'Will I hear from you?' or similar, they're checking on a prior request — acknowledge that and tell them next steps, don't re-introduce yourself.",
    "",
  ].join("\n");

  const coreSmsRules = [
    `You are an SMS receptionist for ${companyName}.`,
    `TONE OF VOICE: ${toneOfVoice}. Maintain this personality.`,
    "Flow: qualify lead, gather full_name, contact email, contact phone, project_type, project_details, address, preferred appointment_date and appointment_time.",
    "MANDATORY CONTACT INFO: collect full_name + valid phone + valid email BEFORE setting should_book=true.",
    "Be concise, friendly, one short text message. Avoid long paragraphs.",
    "SERVICE TYPES: Do NOT assume the customer wants a specific service. Ask what they need.",
    "When you set should_book=true, do NOT say 'I have scheduled' or 'You are booked' in your reply — say 'Let me confirm that slot' or similar. The system will send the official confirmation after writing to the calendar.",
    "REVENUE ESTIMATION: provide an estimated_value (number, USD) based on project_details (Room: 500, Interior: 2500, Exterior: 5000).",
  ].join("\n");

  let combined = dateAnchor + "\n" + intentRules + "\n" + coreSmsRules;

  const tenantPrompt = (tenant?.sms_instructions && tenant.sms_instructions.trim())
    ? tenant.sms_instructions
    : tenant?.instructions;
  if (tenantPrompt) {
    combined += "\n\nBUSINESS SPECIFIC INSTRUCTIONS:\n" + tenantPrompt;
  }

  if (availableSlots && availableSlots.length > 0) {
    combined += `\n\nCALENDAR AVAILABILITY: open slots for the requested day: ${availableSlots.join(", ")}. Suggest these if customer asks for available times or their requested time is taken.`;
  } else if (availableSlots && availableSlots.info) {
    combined += `\n\nCALENDAR CONTEXT: ${availableSlots.info}`;
  }

  if (tenant && tenant.objection_handling_config) {
    const oh = tenant.objection_handling_config;
    let lines = [];
    if (Array.isArray(oh) && oh.length) {
      lines = oh
        .filter(c => c && (c.script || "").trim())
        .map(c => `- If they say "${(c.trigger || "").trim() || "..."}": respond with: ${(c.script || "").trim()}`);
    } else if (typeof oh === "object") {
      if (oh.price)    lines.push(`- If price is a concern: ${oh.price}`);
      if (oh.thinking) lines.push(`- If they need to think about it: ${oh.thinking}`);
      if (oh.spouse)   lines.push(`- If they need to talk to a spouse: ${oh.spouse}`);
    }
    if (lines.length) {
      combined += "\n\nOBJECTION HANDLING STRATEGIES:\n" + lines.join("\n");
    }
  }

  if (tenant && Array.isArray(tenant.faqs) && tenant.faqs.length > 0) {
    combined += "\n\nFrequently Asked Questions:\n" + tenant.faqs.map(f => `Q: ${f.question}\nA: ${f.answer}`).join("\n\n");
  }

  return [
    combined,
    "\nReturn strict JSON only with keys: reply, lead_capture, should_book, should_cancel, should_reschedule, should_dnc, appointment_date, appointment_time, follow_up_minutes.",
    `Known lead data: ${JSON.stringify(thread.leadCapture)}`,
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
      let dateToCheck = new Date();
      dateToCheck.setDate(dateToCheck.getDate() + 1);
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
                "full_name", "phone", "email", "address",
                "project_type", "project_details", "timeline",
                "appointment_date", "appointment_time", "estimated_value"
              ]
            },
            should_book: { type: "boolean" },
            should_cancel: { type: "boolean" },
            should_reschedule: { type: "boolean" },
            should_dnc: { type: "boolean" },
            appointment_date: { type: "string" },
            appointment_time: { type: "string" },
            follow_up_minutes: { type: "number" }
          },
          required: [
            "reply", "lead_capture", "should_book", "should_cancel",
            "should_reschedule", "should_dnc", "appointment_date", "appointment_time",
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
    console.warn("[Booking] No tenant resolved. thread.phone=%s", thread.phone);
    return null;
  }

  // ── Cancellation flow (Phase 4C state machine) ─────────────────────
  if (ai.should_cancel) {
    const smsService = require("./services/sms");
    const init = await smsService.initiateSmsCancellation(thread, tenant);
    return init.reply;
  }

  // ── Reschedule flow ──────────────────────────────────────────────
  if (ai.should_reschedule && ai.appointment_date && ai.appointment_time) {
    const dateValidation = validateProposedDate(ai.appointment_date);
    if (!dateValidation.ok) return dateValidation.message;
    ai.appointment_date = dateValidation.normalized;

    const booking = await bookingsService.findLatestBookingByPhone(
      tenant.id,
      thread.leadCapture?.phone || thread.phone
    );
    if (!booking) return "I couldn't find an existing appointment to reschedule. Would you like to schedule a new one instead?";

    await bookingsService.updateBooking(booking.id, {
      preferred_date: ai.appointment_date,
      appointment_time: ai.appointment_time,
      notes: ai.lead_capture?.project_details || booking.notes,
    });
    return `✅ Your appointment has been rescheduled for ${ai.appointment_date} at ${ai.appointment_time}.`;
  }

  if (!ai.should_book || !ai.appointment_date || !ai.appointment_time) return null;

  const fullName = ai.lead_capture?.full_name || thread.leadCapture?.full_name;
  const phone    = ai.lead_capture?.phone     || thread.leadCapture?.phone || thread.phone;
  const email    = ai.lead_capture?.email     || thread.leadCapture?.email;
  if (!fullName || !phone || !email) {
    const missing = [];
    if (!fullName) missing.push("full name");
    if (!phone)    missing.push("phone number");
    if (!email)    missing.push("email address");
    return `To finalize your booking, I just need your ${missing.join(" and ")}. Please share that and I'll get you scheduled!`;
  }

  // Date validation
  const dateValidation = validateProposedDate(ai.appointment_date);
  if (!dateValidation.ok) return dateValidation.message;
  ai.appointment_date = dateValidation.normalized;

  if (ai.appointment_time === "morning")   ai.appointment_time = "9:00 AM";
  if (ai.appointment_time === "afternoon") ai.appointment_time = "1:00 PM";
  if (ai.appointment_time === "evening")   ai.appointment_time = "6:00 PM";

  // Idempotency check — defends against orchestrator running twice
  try {
    const dup = await db.query(
      `SELECT id FROM bookings
        WHERE tenant_id = $1
          AND contact_phone = $2
          AND preferred_date = $3
          AND appointment_time = $4
          AND COALESCE(status, '') != 'Cancelled'
          AND created_at > now() - interval '60 seconds'
        LIMIT 1`,
      [tenant.id, phone, ai.appointment_date, ai.appointment_time]
    );
    if (dup.rows.length > 0) {
      console.log("[Booking] Idempotent skip — duplicate within 60s for tenant=%s phone=%s date=%s time=%s",
        tenant.id, phone, ai.appointment_date, ai.appointment_time);
      thread.bookedEventId = thread.bookedEventId || "LOCAL_ONLY";
      thread.needsFollowUpAt = null;
      return `✅ You are booked for ${ai.appointment_date} at ${ai.appointment_time}.`;
    }
  } catch (idempErr) {
    console.error("[Booking] Idempotency check failed (non-fatal):", idempErr.message);
  }

  const availability = await checkAvailability({
    appointment_date: ai.appointment_date,
    appointment_time: ai.appointment_time,
    duration_minutes: 60,
  }, tenant);

  const calendarNotConfigured = availability.reason === "calendar_not_configured";
  const isAvailable = (availability.ok && availability.available) || calendarNotConfigured;
  if (availability.reason === "calendar_error") {
    console.warn("[Booking] Calendar error — falling back to local booking:", availability.message || "unknown");
  }

  if (!isAvailable) {
    thread.needsFollowUpAt = Date.now() + 30 * 60 * 1000;
    return "That time is no longer available. Please share another preferred time.";
  }

  let booked = { ok: true, fallback: true };
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
        project_details: thread.leadCapture.project_details || "",
      }, tenant);

      if (syncResult && syncResult.ok) booked = syncResult;
      else console.warn("[Booking] Google Calendar sync failed:", syncResult?.reason || "unknown");
    } catch (err) {
      console.error("[Booking] Google Calendar exception:", err.message);
    }
  }

  if (!booked.ok) return "I couldn't complete booking yet. Can I offer another time?";

  thread.bookedEventId    = booked.eventId || (booked.fallback ? "LOCAL_ONLY" : "");
  thread.needsFollowUpAt  = null;
  thread.followUpCount    = 0;

  try {
    const t = tenantOverride || (thread.tenantId ? TENANTS[thread.tenantId] : null);
    if (t) {
      await bookingsService.createBooking(t.id, null, {
        contact_name: thread.leadCapture.full_name || "New Lead",
        contact_phone: thread.leadCapture?.phone || thread.phone,
        contact_email: thread.leadCapture.email || "",
        address:       thread.leadCapture.address || "",
        city:          "",
        scope:         thread.leadCapture.project_type || "",
        job_type:      (thread.leadCapture.project_type && String(thread.leadCapture.project_type).trim()) || "Residential",
        preferred_date:   ai.appointment_date,
        appointment_time: ai.appointment_time,
        notes:            thread.leadCapture.project_details || "",
        estimated_value:  thread.leadCapture.estimated_value,
      }, thread.leadId);

      if (thread.leadId) {
        leadsService.updateLeadStatus(thread.leadId, "Booked").catch(e => console.error("Lead status update error:", e));
      }
    }
  } catch (dbErr) {
    console.error("[Booking] Local DB persistence failed:", dbErr.message);
  }

  return `✅ You are booked for ${ai.appointment_date} at ${ai.appointment_time}.`;
}

function validateProposedDate(rawDate) {
  const m = String(rawDate || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) {
    return { ok: false, message: "I didn't quite catch that date. Could you share it as MM/DD or YYYY-MM-DD?" };
  }
  const [, yStr, mStr, dStr] = m;
  const proposed = new Date(Number(yStr), Number(mStr) - 1, Number(dStr));
  proposed.setHours(0, 0, 0, 0);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (proposed < today) {
    console.warn("[Booking] Past date rejected: %s", rawDate);
    return { ok: false, message: "Looks like that date has already passed — could you share a date coming up?" };
  }

  const ninetyDays = new Date(today);
  ninetyDays.setDate(ninetyDays.getDate() + 90);
  if (proposed > ninetyDays) {
    console.warn("[Booking] Date >90 days out rejected: %s", rawDate);
    return { ok: false, message: "Just to confirm — that date is more than 90 days out. Could you double-check the date and year you'd like?" };
  }

  const y = proposed.getFullYear();
  const mm = String(proposed.getMonth() + 1).padStart(2, "0");
  const dd = String(proposed.getDate()).padStart(2, "0");
  return { ok: true, normalized: `${y}-${mm}-${dd}` };
}

async function processSmsConversation(phone, incomingText, tenant = null) {
  const thread = getOrCreateSmsThread(phone);
  thread.lastInboundAt = Date.now();
  thread.history.push({ role: "user", text: incomingText, at: new Date().toISOString() });

  if (tenant) {
    // Map thread.channel → contact_method bucket. sms/website/facebook
    // are the only values thread.channel ever takes (set in
    // getOrCreateSmsThread + /website-chat + processFacebookConversation).
    const channelToContactMethod = {
      sms:      'sms',
      website:  'web_form',
      facebook: 'facebook',
    };
    const lead = await leadsService.getOrCreateLead(
      tenant.id,
      thread.phone,
      thread.leadCapture?.full_name,
      null,
      channelToContactMethod[thread.channel] || 'unknown'
    );
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

  // ─────────────────────────────────────────────────────────────────────
  // TCPA hard keyword opt-out (Migration 060, May 9 2026)
  //
  // Carrier-mandated STOP keywords MUST fire DNC immediately, with no AI
  // round-trip and no chance of paraphrasing or misclassification.
  // Soft phrases like "stop calling me" fall through to the AI orchestrator's
  // should_dnc field (handled lower in this function).
  //
  // Normalization: trim, uppercase, strip everything non-letter. So:
  //   "Stop."  → "STOP"    (match)
  //   "stop!"  → "STOP"    (match)
  //   "STOP "  → "STOP"    (match)
  //   "I need to cancel my appointment" → "INEEDTOCANCEL..." (NO match)
  // ─────────────────────────────────────────────────────────────────────
  const STOP_KEYWORDS = new Set([
    "STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "REMOVE", "OPTOUT"
  ]);
  const START_KEYWORDS = new Set(["START", "UNSTOP"]);
  const tcpaNormalized = (incomingText || "").trim().toUpperCase().replace(/[^A-Z]/g, "");

  if (tenant && thread.leadId && STOP_KEYWORDS.has(tcpaNormalized)) {
    console.log("[TCPA] STOP keyword from phone=%s leadId=%s tenant=%s keyword=%s",
      thread.phone, thread.leadId, tenant.id, tcpaNormalized);

    try {
      await leadsService.setDoNotContact(thread.leadId, true, {
        reason: `SMS keyword: ${tcpaNormalized}`,
        trigger_source: 'sms_keyword',
      });
    } catch (err) {
      console.error("[TCPA] setDoNotContact (keyword) failed:", err.message);
    }

    const replyText = "You've been unsubscribed and will no longer receive messages from us. Reply START to opt back in.";
    thread.history.push({ role: "assistant", text: replyText, at: new Date().toISOString() });
    thread.lastOutboundAt = Date.now();
    thread.needsFollowUpAt = null;
    thread.cancelState = null;

    messagesService.saveMessage(tenant.id, thread.leadId, thread.channel || "sms", "outbound", replyText, {
      tcpa_dnc_confirmation: true,
      trigger_source: 'sms_keyword',
      keyword: tcpaNormalized,
    });

    return { reply: replyText, lead_capture: {}, booking_confirmed: null, dnc_set: true };
  }

  if (tenant && thread.leadId && START_KEYWORDS.has(tcpaNormalized)) {
    console.log("[TCPA] START keyword from phone=%s leadId=%s tenant=%s",
      thread.phone, thread.leadId, tenant.id);

    try {
      await leadsService.setDoNotContact(thread.leadId, false, {
        reason: `SMS keyword: ${tcpaNormalized}`,
        trigger_source: 'sms_keyword',
      });
    } catch (err) {
      console.error("[TCPA] setDoNotContact (START re-enable) failed:", err.message);
    }

    const replyText = "You're opted back in. Reply STOP at any time to unsubscribe.";
    thread.history.push({ role: "assistant", text: replyText, at: new Date().toISOString() });
    thread.lastOutboundAt = Date.now();

    messagesService.saveMessage(tenant.id, thread.leadId, thread.channel || "sms", "outbound", replyText, {
      tcpa_optin_confirmation: true,
      trigger_source: 'sms_keyword',
      keyword: tcpaNormalized,
    });

    return { reply: replyText, lead_capture: {}, booking_confirmed: null, dnc_cleared: true };
  }

  // ─────────────────────────────────────────────────────────────────────
  // Phase 8 (May 12, 2026) — Human handoff check.
  //
  // If the owner has taken over this conversation via POST /api/leads/:id/send,
  // leads.human_handoff_at is set. We must NOT auto-respond on that lead until
  // the owner releases handoff via POST /api/leads/:id/resume-ai.
  //
  // We've already saved the customer's inbound message above, so it appears
  // in the owner's conversation viewer instantly. Now we skip everything that
  // would generate an outbound reply — the cancellation state machine AND the
  // AI orchestrator — because both could conflict with the owner's manual
  // replies.
  //
  // Critical ordering: TCPA STOP/START keywords (above) ALWAYS fire — legal
  // compliance never pauses. Only the AI auto-response is suppressed.
  //
  // Fails open on DB error: if the handoff lookup throws, we proceed to
  // normal AI handling. Better to over-reply than to silently drop messages
  // during a Postgres hiccup.
  // ─────────────────────────────────────────────────────────────────────
  if (thread.leadId) {
    try {
      const handoffCheck = await db.query(
        "SELECT human_handoff_at FROM leads WHERE id = $1 LIMIT 1",
        [thread.leadId]
      );
      if (handoffCheck.rows[0]?.human_handoff_at) {
        console.log(
          "[Handoff] AI paused leadId=%s tenant=%s handoff_since=%s — saving inbound, skipping reply",
          thread.leadId,
          tenant?.id || "(none)",
          handoffCheck.rows[0].human_handoff_at
        );
        return {
          reply: null,
          handoff: true,
          lead_capture: {},
          booking_confirmed: null,
        };
      }
    } catch (err) {
      console.error(
        "[Handoff] Lookup failed leadId=%s err=%s — failing open, AI will respond",
        thread.leadId,
        err.message
      );
      // Fall through to normal AI flow
    }
  }

// ─────────────────────────────────────────────────────────────────────
  // Touch-up routing (May 13, 2026) — bypass AI for touch-up requests.
  //
  // When a customer asks for a touch-up, the AI shouldn't try to
  // auto-book (touch-ups involve warranty / scope / crew decisions the
  // AI doesn't handle). Instead: send "team member will reach out" reply,
  // email the team with full context, fire an owner notification, skip
  // the AI orchestrator entirely.
  //
  // Discovered via Miranda Hopkins transcript May 13 — AI tried to book
  // a touch-up for the same day at 8:00 AM when she sent "0800" at 8:04
  // AM. Even with stronger date validation, touch-ups shouldn't be
  // auto-booked at all.
  //
  // Ordering: runs AFTER TCPA keywords (compliance always wins) and
  // AFTER handoff check (owner stays in charge), but BEFORE cancellation
  // state machine (don't interrupt mid-cancel) and BEFORE AI orchestrator
  // (skip AI entirely on match).
  // ─────────────────────────────────────────────────────────────────────
  if (tenant) {
    try {
      const touchUpService = require("./services/touchUp");
      const detection = await touchUpService.detectTouchUpRequest(thread, incomingText);
      if (detection) {
        const replyText = await touchUpService.handleTouchUpRequest(
          thread,
          incomingText,
          tenant,
          detection
        );

        thread.history.push({
          role: "assistant",
          text: replyText,
          at: new Date().toISOString(),
        });
        thread.lastOutboundAt = Date.now();
        thread.needsFollowUpAt = null;  // don't arm nurture for touch-ups
        thread.followUpCount = 0;

        if (thread.leadId) {
          messagesService.saveMessage(
            tenant.id,
            thread.leadId,
            thread.channel || "sms",
            "outbound",
            replyText,
            { touch_up_routed: true }
          );
        }

        return {
          reply: replyText,
          touch_up: true,
          lead_capture: {},
          booking_confirmed: null,
        };
      }
    } catch (err) {
      // Fail open — log and fall through to normal AI flow rather than
      // block customers entirely if touch-up service has a bug.
      console.error(
        "[TouchUp] Detection failed leadId=%s err=%s — falling through to AI",
        thread.leadId || "(none)",
        err.message
      );
    }
  }
  
 // ─────────────────────────────────────────────────────────────────────
  // Phase 4C (May 4, 2026) — SMS cancellation state machine.
  //
  // If we're mid-cancel-flow, bypass the AI orchestrator entirely and run
  // the structured state machine in services/sms.js. This guarantees the
  // customer's YES/NO/numbered choices are interpreted exactly as we
  // expect, without the AI paraphrasing or missing the intent. Only kicks
  // in when thread.cancelState !== null AND a tenant is resolved (no
  // tenant = no booking lookup possible).
  //
  // The state machine returns { reply } when it handled the message, or
  // null if the state was unknown/corrupt (which it resets, then we fall
  // through to the AI orchestrator path).
  // ─────────────────────────────────────────────────────────────────────
  if (thread.cancelState && tenant) {
    const smsService = require("./services/sms");
    const cancelResult = await smsService.handleSmsCancellationIncoming(thread, incomingText, tenant);
    if (cancelResult) {
      // Mirror the bookkeeping the normal flow does at the end —
      // we're returning EARLY so we have to do it here.
      thread.history.push({ role: "assistant", text: cancelResult.reply, at: new Date().toISOString() });
      thread.lastOutboundAt = Date.now();
      if (thread.leadId) {
        messagesService.saveMessage(tenant.id, thread.leadId, thread.channel || "sms", "outbound", cancelResult.reply);
      }
      // Reset followUpCount — customer just engaged
      thread.followUpCount = 0;
      return {
        reply: cancelResult.reply,
        lead_capture: {},
        booking_confirmed: null,
      };
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

  // ─────────────────────────────────────────────────────────────────────
  // TCPA soft-intent opt-out (Migration 060, May 9 2026)
  //
  // Hard keywords were caught BEFORE the AI ran. This handles soft phrases
  // like "stop calling me", "don't text me again" that the AI classified as
  // opt-out (should_dnc=true). We fire DNC + send the formal confirmation
  // reply, overwriting whatever conversational ack the AI generated.
  // ─────────────────────────────────────────────────────────────────────
  if (ai.should_dnc && tenant && thread.leadId) {
    console.log("[TCPA] AI intent DNC fired phone=%s leadId=%s tenant=%s msg=%s",
      thread.phone, thread.leadId, tenant.id, (incomingText || "").slice(0, 80));

    try {
      await leadsService.setDoNotContact(thread.leadId, true, {
        reason: `SMS intent: "${(incomingText || '').slice(0, 200)}"`,
        trigger_source: 'sms_intent',
      });
    } catch (err) {
      console.error("[TCPA] setDoNotContact (intent) failed:", err.message);
    }

    const replyText = "You've been unsubscribed and won't receive any further messages or calls from us. Reply START to opt back in.";
    thread.history.push({ role: "assistant", text: replyText, at: new Date().toISOString() });
    thread.lastOutboundAt = Date.now();
    thread.needsFollowUpAt = null;
    thread.cancelState = null;

    messagesService.saveMessage(tenant.id, thread.leadId, thread.channel || "sms", "outbound", replyText, {
      tcpa_dnc_confirmation: true,
      trigger_source: 'sms_intent',
      raw_message: (incomingText || "").slice(0, 200),
    });

    return { reply: replyText, lead_capture: {}, booking_confirmed: null, dnc_set: true };
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

  if (!thread.leadCapture.phone && !thread.phone.startsWith("fb-") && !thread.phone.startsWith("web-")) {
    thread.leadCapture.phone = thread.phone;
  }

  let replyText = ai.reply || "Thanks for reaching out!";

  const bookingResult = await handleLeadBooking(thread, ai, tenant);
 if (bookingResult) {
    replyText = bookingResult;
  } else if (!ai.should_book && !thread.bookedEventId) {
    // Only arm nurture if not booked. Without this guard, every post-booking
    // customer reply re-armed the nurture loop. Bug observed May 7 2026.
    const followUpMinutes = Number(ai.follow_up_minutes) || 120;
    thread.needsFollowUpAt = Date.now() + followUpMinutes * 60 * 1000;
  }

  if ((thread.leadCapture?.full_name || thread.phone) && !thread.crmLeadSent) {
    if (!isNewBookingConfirmation(bookingResult)) {
      const sent = await sendToCRM(buildThreadCrmLeadPayload(thread, ai, tenant, bookingResult), tenant?.id);
      if (sent) thread.crmLeadSent = true;
    }
  }

  // Reset follow-up count only when there's no booking in flight. After a
// confirmed booking, leaving counter intact prevents nurture from re-arming
// indefinitely if the customer keeps chatting post-confirmation.
if (!thread.bookedEventId) {
  thread.followUpCount = 0;
}

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
    booking_confirmed: (ai.should_book && isNewBookingConfirmation(bookingResult)) ? {
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

   const lead = await leadsService.getOrCreateLead(tenant.id, thread.phone, thread.leadCapture?.full_name, null, 'facebook');
    if (lead) {
      thread.leadId = lead.id;
      // If the lead was just created and we just got the name, it's already in there.
      // If it existed but had no name, getOrCreateLead updates it.
      messagesService.saveMessage(tenant.id, lead.id, "facebook", "inbound", messageText);
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // Phase 8.1 (May 12, 2026) — Human handoff check for Facebook Messenger.
  //
  // Mirrors the check in processSmsConversation. If the owner has taken
  // over this lead's conversation (via the dashboard SMS compose), AI
  // auto-responses are paused on this lead across ALL channels — including
  // Facebook. The inbound FB message is already saved above, so the owner
  // sees the customer's message in the dashboard timeline.
  //
  // Caller (/facebook-webhook handler) checks result.handoff and skips
  // sendFacebookMessage when true.
  //
  // Fails open on DB error: better to over-reply than to silently drop
  // FB messages during a Postgres hiccup.
  // ─────────────────────────────────────────────────────────────────────
  if (thread.leadId) {
    try {
      const handoffCheck = await db.query(
        "SELECT human_handoff_at FROM leads WHERE id = $1 LIMIT 1",
        [thread.leadId]
      );
      if (handoffCheck.rows[0]?.human_handoff_at) {
        console.log(
          "[Handoff] FB AI paused leadId=%s tenant=%s handoff_since=%s — skipping AI reply",
          thread.leadId,
          tenant?.id || "(none)",
          handoffCheck.rows[0].human_handoff_at
        );
        return {
          reply: null,
          handoff: true,
          lead_capture: {},
          booking_confirmed: null,
        };
      }
    } catch (err) {
      console.error(
        "[Handoff] FB lookup failed leadId=%s err=%s — failing open, AI will respond",
        thread.leadId,
        err.message
      );
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

  if ((thread.leadCapture?.full_name || hasPhoneToSend) && !thread.crmLeadSent) {
    if (!isNewBookingConfirmation(bookingResult)) {
      const sent = await sendToCRM(buildThreadCrmLeadPayload(thread, ai, tenant, bookingResult), tenant?.id);
      if (sent) thread.crmLeadSent = true;
    }
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
    booking_confirmed: (ai.should_book && isNewBookingConfirmation(bookingResult)) ? {
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

// ─────────────────────────────────────────────────────────
// DNC SUPPRESSION HELPER (Migration 059, May 8 2026)
// ─────────────────────────────────────────────────────────

/**
 * Check whether the lead behind an in-memory SMS thread is on the
 * do-not-contact list.
 *
 * Two paths:
 *   1. thread.leadId — direct check by lead id.
 *   2. Phone match — covers website/SMS threads where leadId wasn't
 *      attached yet, by looking up any DNC'd lead with the same phone
 *      under the same tenant.
 *
 * Skips the phone-match path for synthetic thread keys (fb-* / web-*)
 * since those aren't real phone numbers.
 *
 * Returns true if blocked, false if safe to proceed.
 */
async function isThreadDoNotContact(thread) {
  if (!thread) return false;

  // Path 1: linked lead is DNC
  if (thread.leadId) {
    const r = await db.query(
      "SELECT 1 FROM leads WHERE id = $1 AND do_not_contact = true LIMIT 1",
      [thread.leadId]
    );
    if (r.rows.length > 0) return true;
  }

  // Path 2: any same-phone lead in this tenant is DNC. Skip for
  // synthetic thread keys (fb-/web-) which aren't real phones — for
  // those, the leadId path is the only reliable check.
  const phone = thread.leadCapture?.phone || thread.phone;
  if (
    phone &&
    thread.tenantId &&
    !String(phone).startsWith("fb-") &&
    !String(phone).startsWith("web-")
  ) {
    const last10 = String(phone).replace(/\D/g, "").slice(-10);
    const r = await db.query(
      `SELECT 1 FROM leads
        WHERE tenant_id = $1
          AND do_not_contact = true
          AND (
            phone = $2
            OR right(regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g'), 10) = $3
          )
        LIMIT 1`,
      [thread.tenantId, phone, last10]
    );
    if (r.rows.length > 0) return true;
  }

  return false;
}

async function runSmsFollowUps() {
  const now = Date.now();
  for (const thread of smsThreads.values()) {
    if (!thread.needsFollowUpAt || thread.needsFollowUpAt > now) continue;

    // ── Suppress nurture entirely once a booking is on file ─────────
    // Booked customers get appointment-confirmation flows from elsewhere
    // (estimateRecovery, calendar invites). Sending "your appointment is
    // on our schedule" here just adds noise — bug observed May 7 2026.
    if (thread.bookedEventId) {
      thread.needsFollowUpAt = null;
      continue;
    }

    // 2-touch limit
    if (thread.followUpCount >= 2) {
      thread.needsFollowUpAt = null;
      continue;
    }

    // ── DNC suppression (Migration 059, May 8 2026) ─────────────────
    // If the lead behind this thread is do-not-contact, never fire a
    // follow-up. Clear the timer so we stop checking on every tick.
    // The send-time guards in services/sms.js sendNurturingSms and
    // sendBookingCancellationSms are the last line of defense if this
    // somehow leaks through.
    try {
      if (await isThreadDoNotContact(thread)) {
        console.log(
          "[FollowUp] DNC blocked phone=%s leadId=%s tenantId=%s — clearing timer",
          thread.phone,
          thread.leadId || "(none)",
          thread.tenantId || "(none)"
        );
        thread.needsFollowUpAt = null;
        continue;
      }
    } catch (err) {
      // Don't block on a DB error — service-layer DNC checks will catch
      // it at send time. Log and proceed.
      console.error(
        "[FollowUp] DNC check failed phone=%s err=%s — proceeding to send-time guards",
        thread.phone,
        err.message
      );
    }

    // ── Cooldown: 30 min after last inbound (was 10 — too aggressive) ─
    // Prevents the "checking in" message from firing in the middle of an
    // active conversation. Bug observed May 7: nurture fired 33 minutes
    // after customer's last reply during ongoing back-and-forth.
    const recentInboundMs = thread.lastInboundAt ? now - thread.lastInboundAt : Infinity;
    if (recentInboundMs < 30 * 60 * 1000) continue;

    // Same cooldown for recent outbound — don't pile on
    const recentOutboundMs = thread.lastOutboundAt ? now - thread.lastOutboundAt : Infinity;
    if (recentOutboundMs < 30 * 60 * 1000) continue;

    // Unbooked-only nurture text (booked branch removed since we early-exit above)
    const followUpText = "Just checking in — would you like me to help you lock in a time for your estimate?";

    let sent = { ok: false };

    // Channel routing
    if (thread.channel === "website") {
      if (thread.leadCapture.phone) {
        sent = await sendTwilioSms(thread.leadCapture.phone, followUpText, thread.tenantId);
      } else {
        // No phone captured during web chat — can't follow up, mark done
        thread.needsFollowUpAt = null;
        continue;
      }
    } else if (thread.channel === "facebook") {
      const fbId = thread.phone.replace("fb-", "");
      await sendFacebookMessage(fbId, followUpText);
      sent = { ok: true };
    } else {
      sent = await sendTwilioSms(thread.phone, followUpText, thread.tenantId);
    }

    if (sent.ok) {
      thread.history.push({ role: "assistant", text: followUpText, at: new Date().toISOString() });
      thread.lastOutboundAt = now;
      thread.followUpCount++;

      if (thread.leadId) {
        leadsService.getLeadById(thread.leadId).then(lead => {
          if (lead) {
            messagesService.saveMessage(lead.tenant_id, lead.id, thread.channel || "sms", "outbound", followUpText, { is_followup: true });
          }
        }).catch(err => console.error("[FollowUp] CRM log failed:", err.message));
      }

      // Touch 1 → schedule Touch 2 in 24h. Touch 2 → done.
      if (thread.followUpCount < 2) {
        thread.needsFollowUpAt = now + 24 * 60 * 60 * 1000;
      } else {
        thread.needsFollowUpAt = null;
      }
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
  let phoneNumberRow = null;

  // Tenant lookup by To (primary) or From (fallback) — existing behavior.
  const toNum   = req.body?.To   || req.query?.To;
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

  // Last-resort fallback to gladiators so a misconfigured number doesn't
  // hard-crash the webhook (existing behavior, preserved).
  if (!tenant) {
    tenant = TENANTS["gladiators"];
    resolvedTenantId = "gladiators";
  }

  // Build 1 — fetch the phone_numbers row for the dialed number so we can
  // apply per-phone AI toggle, ring-first, per-phone BH opt-in, and custom
  // voicemail URL. Null-safe: if the row is missing or the query fails
  // (e.g. migration 039 hasn't run yet), decideCallRouting defaults to
  // AI-on / no ring-first, matching pre-Build-1 behavior.
  if (toNum && tenant?.id) {
    try {
      const pnResult = await pool.query(
        `SELECT id, tenant_id, phone, is_primary, lead_source,
                ai_status, ring_first_enabled, ring_first_phone,
                ring_first_timeout_seconds, business_hours_enabled,
                voicemail_message_url
           FROM phone_numbers
          WHERE phone = $1 AND tenant_id = $2
          LIMIT 1`,
        [toNum, tenant.id]
      );
      phoneNumberRow = pnResult.rows[0] || null;
    } catch (err) {
      // Likely cause: migration 039 hasn't run on this environment. Log
      // and continue — decideCallRouting handles null gracefully.
      console.error("[AI-Desk] phone_numbers lookup failed:", err.message);
    }
  }

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

    // ── Build 1 routing decision ───────────────────────────────────────
    const routing = decideCallRouting({
      tenant,
      phoneNumber: phoneNumberRow,
      fromNumber:  fromNum,
    });

    console.log(
      "[AI-Desk] Routing tenant=%s to=%s from=%s → shouldRunAi=%s ringFirst=%s reason=%s",
      tenant.id,
      toNum,
      fromNum,
      routing.shouldRunAi,
      routing.ringFirst,
      routing.reason
    );

    // Case 1: voicemail-only (AI off, no ring-first).
    if (!routing.shouldRunAi && !routing.ringFirst) {
      res.type("text/xml").send(buildVoicemailTwiml(routing.voicemailMessageUrl));
      return;
    }

    // Need a WS URL whether we're streaming direct or as ring-first fallback.
    const wsUrl = buildTenantWsUrl(requestBaseUrl, resolvedTenantId, tenant.lead_source, {
      callSid:    req.body?.CallSid || req.query?.CallSid,
      fromNumber: fromNum,
      toNumber:   toNum,
      direction:  "inbound",
    });
    if (!/^wss:\/\//i.test(wsUrl)) {
      const fallbackTwiml = buildFallbackTwiml(
        "Please hold while we connect you to the team.",
        tenant.transferNumber
      );
      res.type("text/xml").send(fallbackTwiml);
      return;
    }

    // Case 2: ring a human first, fall through to AI or voicemail.
    if (routing.ringFirst) {
      const ringTwiml = buildRingFirstTwiml({
        ringFirstPhone:      routing.ringFirstPhone,
        ringFirstTimeout:    routing.ringFirstTimeoutSeconds,
        fallbackType:        routing.shouldRunAi ? "ai_stream" : "voicemail",
        streamUrl:           wsUrl,
        voicemailMessageUrl: routing.voicemailMessageUrl,
      });
      res.type("text/xml").send(ringTwiml);
      return;
    }

    // Case 3: AI direct — the legacy path, preserved unchanged.
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
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
    app.all(pathPattern, handler);
  }
}

registerTwilioVoiceRoutes(["/twilio-voice", "/twilio-voice/"], false);
registerTwilioVoiceRoutes(["/twilio-voice/:tenantId", "/twilio-voice/:tenantId/"], true);

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
  if (tenant) {
    notificationsService.createNotification(tenant.id, {
      type: 'missed_call',
      title: 'Missed Call Detected',
      body: `A call from ${from} was missed. AI sent an automated follow-up SMS.`,
      data: { from, callStatus }
    }).catch(e => console.error("Notification error:", e));
  }
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
  const from       = normalizePhone(req.body?.From || req.body?.from);
  const body       = String(req.body?.Body || req.body?.body || "").trim();
  const messageSid = String(req.body?.MessageSid || req.body?.messageSid || "");

  if (!from || !body) {
    res.status(400).send("Missing From or Body");
    return;
  }

  // ── Twilio retry dedup ─────────────────────────────────────────────
  if (messageSid) {
    const now = Date.now();
    // GC: drop entries older than dedup window
    for (const [sid, ts] of recentTwilioSmsSids.entries()) {
      if (now - ts > TWILIO_SMS_DEDUP_MS) recentTwilioSmsSids.delete(sid);
    }
    if (recentTwilioSmsSids.has(messageSid)) {
      console.log("[SMS] Dedup hit — Twilio retry for sid=%s, suppressing reply", messageSid);
      // Still return valid TwiML so Twilio stops retrying
      res.type("text/xml").send('<?xml version="1.0" encoding="UTF-8"?><Response/>');
      return;
    }
    recentTwilioSmsSids.set(messageSid, now);
  }

  try {
    const toNum  = req.body?.To || req.body?.to;
    const tenant = await getTenantByPhone(toNum);
    const result = await processSmsConversation(from, body, tenant);

    // Phase 8 (May 12, 2026) — when handoff is active or there's no reply
    // to send, return empty TwiML so Twilio doesn't relay anything to the
    // customer's phone. The owner sees the inbound in the dashboard and
    // replies manually via the Conversations compose box.
    if (result?.handoff || !result?.reply) {
      console.log("[SMS] No AI reply (handoff=%s) for from=%s", !!result?.handoff, from);
      res.type("text/xml").send('<?xml version="1.0" encoding="UTF-8"?><Response/>');
      return;
    }

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
  // Initialize from/to from URL query params populated by handleTwilioVoice
  // via buildTenantWsUrl. Twilio's Stream payload does NOT include From in
  // msg.start by default unless you add <Parameter> elements to the TwiML —
  // we don't, but we DO put From/To in the WebSocket URL query string.
  // Without reading from `q` here, the closure's `from` stays null forever
  // and any tool that uses it for caller identification (request_do_not_contact,
  // cancel_appointment) silently fails the lookup.
  let from = q.From || q.from || null;
  let to = q.To || q.to || null;
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
  // Silence hangup — Apr 21, 2026.
  // Protects against dead-air bills when a caller walks away mid-call.
  // 15s total silence → "Are you still there?"  30s → goodbye + hangup.
  // Resets on caller speech AND on response.done (AI finished talking).
  let silencePromptTimer = null;
  let silenceHangupTimer = null;
  let silencePrompted = false;        // flips true after the 15s nudge fires
  let silenceHangupTriggered = false; // prevents double-fire
  const SILENCE_PROMPT_MS = 15_000;
  const SILENCE_HANGUP_MS = 30_000;

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
        // ─────────────────────────────────────────────────────────────────
        // INBOUND: force verbatim greeting.  Apr 21, 2026.
        //
        // Tenants set voice_welcome_message in Settings and expect it said
        // EXACTLY.  Instructions-based pinning doesn't work — OpenAI Realtime
        // paraphrases freely ("Thanks for calling X, this is Alex" becomes
        // "Hello, thank you for calling X" with Alex dropped entirely).
        //
        // The fix is to pre-insert an assistant message containing the exact
        // greeting as if the AI already composed it, then emit response.create
        // to flush it to speech.  Realtime speaks the pre-composed message
        // verbatim because it's treated as the AI's own prior output.
        //
        // Fallback chain — each candidate is trimmed BEFORE the || check so
        // whitespace-only values fall through cleanly to the next option:
        //   voice_welcome_message (trimmed) →
        //   welcome_message (trimmed) →
        //   hardcoded default
        // ─────────────────────────────────────────────────────────────────
        const verbatimGreeting =
          (tenant?.voice_welcome_message || "").trim() ||
          (tenant?.welcome_message || "").trim() ||
          `Thanks for calling ${tenant?.company_name || "us"}. How can I help you today?`;

        console.log("[AI-Desk] Triggering initial INBOUND greeting (verbatim): \"%s\"", verbatimGreeting);

        sendToOpenAI({
          type: "response.create",
          response: {
            modalities: ["audio", "text"],
            instructions: `Your first utterance on this call must be EXACTLY this, word-for-word, spoken warmly:\n\n"${verbatimGreeting}"\n\nDo not paraphrase, do not add words before or after. After you say this greeting, stop and wait for the caller to respond.`,
          },
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

// ─────────────────────────────────────────────────────────────────────
  // Silence hangup helpers — Apr 21, 2026.
  //
  // resetSilenceTimers():  call whenever the caller OR AI just made sound.
  //                        Wipes both timers, re-arms them from zero.
  // clearSilenceTimers():  call on terminal events (socket close, hang_up
  //                        tool) — don't re-arm, just wipe.
  //
  // Timer 1 (15s) fires a gentle "are you still there?" prompt via a
  // response.create with inline instructions.  Paraphrasing is fine here —
  // we only need the caller to hear SOMETHING that invites a reply.
  //
  // Timer 2 (30s) fires a goodbye + hangup.  The goodbye is emitted the
  // same way: response.create with instructions.  After a 3s buffer to let
  // the goodbye audio reach the caller, we close the Twilio call via REST.
  // ─────────────────────────────────────────────────────────────────────
  function clearSilenceTimers() {
    if (silencePromptTimer) { clearTimeout(silencePromptTimer); silencePromptTimer = null; }
    if (silenceHangupTimer) { clearTimeout(silenceHangupTimer); silenceHangupTimer = null; }
  }

  function resetSilenceTimers() {
    clearSilenceTimers();

    // Don't arm timers if the call is already wrapping up.
    if (silenceHangupTriggered || hasScheduledHangup) return;
    if (twilioSocket.readyState !== WebSocket.OPEN) return;

    silencePrompted = false;

    silencePromptTimer = setTimeout(() => {
      if (silenceHangupTriggered || twilioSocket.readyState !== WebSocket.OPEN) return;
      if (responseInProgress) {
        // AI is still talking — reschedule check in 2s.
        silencePromptTimer = setTimeout(resetSilenceTimers, 2_000);
        return;
      }
      silencePrompted = true;
      console.log("[AI-Desk] Silence 15s — prompting 'are you still there?'");
      sendToOpenAI({
        type: "response.create",
        response: {
          modalities: ["audio", "text"],
          instructions: "The caller has gone quiet for about 15 seconds. Gently ask if they're still there, in a single short sentence. Do not recap the prior conversation.",
        },
      });
    }, SILENCE_PROMPT_MS);

    silenceHangupTimer = setTimeout(async () => {
      if (silenceHangupTriggered || twilioSocket.readyState !== WebSocket.OPEN) return;
      silenceHangupTriggered = true;
      const companyName = tenant?.company_name || "us";
      console.log("[AI-Desk] Silence 30s — saying goodbye and hanging up");

      sendToOpenAI({
        type: "response.create",
        response: {
          modalities: ["audio", "text"],
          instructions: `The caller has been silent for 30 seconds and appears to have walked away. In a warm, brief single sentence, thank them for calling ${companyName} and say goodbye. Do not ask any further questions.`,
        },
      });

      // Give the goodbye audio ~3 seconds to reach the caller, then hang up.
      setTimeout(async () => {
        try {
          const client = twilioLib.getClientForTenant(tenant);
          if (client && callSid) {
            await client.calls(callSid).update({ status: "completed" });
            console.log("[AI-Desk] Silence timeout: terminated callSid=%s", callSid);
          }
        } catch (e) {
          console.error("[AI-Desk] Silence timeout hangup failed:", e.message);
        }
        if (openaiSocket?.readyState === WebSocket.OPEN) openaiSocket.close();
        if (twilioSocket.readyState === WebSocket.OPEN) twilioSocket.close();
      }, 3_000);
    }, SILENCE_HANGUP_MS);
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

      const silenceMs = parseInt(process.env.REALTIME_SILENCE_MS, 10) || 1500;
      const vadThreshold = parseFloat(process.env.REALTIME_VAD_THRESHOLD) || 0.85;
      const sessionUpdate = {
  type: "session.update",
  session: {
    input_audio_format: "g711_ulaw",
    output_audio_format: "g711_ulaw",
    voice: aiConfig.voice,
   instructions: `${aiConfig.instructions}

Speak clearly at a moderate pace. Let the caller finish before you respond. Always speak in English. DO NOT USE ANY OTHER LANGUAGE AT THE START OF THE CALL.`,
    tools: aiConfig.tools,
    turn_detection: {
      type: "server_vad",
      threshold: vadThreshold,
      prefix_padding_ms: 500,
      silence_duration_ms: silenceMs,
    },
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
         resetSilenceTimers(); // caller spoke → reset silence clock
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

    // ─────────────────────────────────────────────────────────────
    // GOODBYE DETECTION — Apr 24, 2026
    // If Alex says a distinctive close phrase, schedule hangup 2.5s
    // later (enough time for the audio to actually play out). Prevents
    // Alex from rambling into voicemail menu prompts after the
    // conversational close.
    //
    // Only on outbound calls (including recovery + nurturing) —
    // inbound calls already have hang_up tool + silence timeout.
    //
    // Phrases chosen are things Alex says ONLY when closing:
    //   "have a great day" / "take care"
    // Deliberately NOT triggering on bare "goodbye" to reduce false
    // positives (caller might say "okay goodbye" early).
    // ─────────────────────────────────────────────────────────────
    const isOutboundContext = isOutbound || isRecovery || isNurturing;
    if (isOutboundContext && !hasScheduledHangup && callSid) {
      const lowerText = text.toLowerCase();
      const saidGoodbye =
        lowerText.includes("have a great day") ||
        lowerText.includes("have a wonderful day") ||
        lowerText.includes("take care");

      if (saidGoodbye) {
        hasScheduledHangup = true;
        console.log("[AI-Desk] Goodbye phrase detected in outbound call — hanging up in 2.5s. callSid=%s", callSid);

        setTimeout(async () => {
          try {
            const client = twilioLib.getClientForTenant(tenant);
            if (client && callSid) {
              await client.calls(callSid).update({ status: "completed" });
              console.log("[AI-Desk] Goodbye hangup completed callSid=%s", callSid);
            }
          } catch (e) {
            console.error("[AI-Desk] Goodbye hangup error:", e.message);
          }
          clearSilenceTimers();
          if (openaiSocket?.readyState === WebSocket.OPEN) openaiSocket.close();
          if (twilioSocket.readyState === WebSocket.OPEN) twilioSocket.close();

          await safeUpdateCallSummary(callId, {
            status: "completed",
            disposition: hasBooked ? "booked" : "goodbye_hangup",
            transcript,
            metadata: { leadCapture: currentLeadCapture, hangup_reason: "ai_goodbye_detected" },
            markEnded: true,
          });
        }, 2500);
      }
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
               } else if (name === "send_estimate_link" && tenant && callId) {
              // ─────────────────────────────────────────────────────────
              // Phase E1 (May 4, 2026) — outbound estimate link SMS.
              //
              // Replaces the bug where the AI verbally described "let me
              // send you a quick link" but no SMS actually fired (because
              // no tool existed). Now: tool exists, AI calls it, SMS goes
              // out, customer taps link, lands on /q/:tenantId, widget
              // auto-opens to estimator with call_id attribution.
              //
              // Unlike cancel_appointment, we DO use args.caller_phone
              // (not just `from`). Legitimate use case: caller wants the
              // link sent to their spouse's phone instead. AI passes the
              // alternate number, we send there.
              // ─────────────────────────────────────────────────────────
              const phone = args.caller_phone || from;
 
              if (!phone) {
                console.warn("[AI-Desk] send_estimate_link: no phone available (args=%s, from=%s)",
                  args.caller_phone || "missing", from || "missing");
                output = JSON.stringify({
                  success: false,
                  message: "I don't have a phone number to text the link to. Tell the caller: 'I'll need a number to text the link to — what's the best one?' Then ask them and call this tool again with caller_phone set to the number they give you.",
                });
              } else {
                // Build the link. PUBLIC_BACKEND_URL env var lets ops
                // override the host in case we move off Render or use a
                // CNAME. Falls back to the current Render hostname.
                const baseUrl = (process.env.PUBLIC_BACKEND_URL || "https://ai-front-desk-backend.onrender.com").replace(/\/+$/, "");
                const link = `${baseUrl}/q/${tenant.id}?call_id=${encodeURIComponent(callId)}`;
 
                try {
                  const smsService = require("./services/sms");
                  const result = await smsService.sendEstimateLinkSms(tenant, phone, link, callId);
 
                  if (result.ok) {
                    console.log("[AI-Desk] send_estimate_link success call_id=%s tenant=%s to=%s sid=%s",
                      callId, tenant.id, phone, result.sid);
 
                    // ─────────────────────────────────────────────────────
                    // Phase E1.2 (May 4, 2026) — Voice → Estimate funnel
                    // Stage 1 tracking. Mark this call as having sent an
                    // estimate link so the Dashboard funnel widget can
                    // count "links sent" alongside "estimates filled out"
                    // (leads.estimator_payload->>'source_call_id') and
                    // "bookings from voice" (bookings JOIN those leads).
                    //
                    // Fire-and-forget — funnel tracking is non-critical,
                    // never block the tool response on it. The IS NULL
                    // guard makes it idempotent: if the AI fires the tool
                    // twice in one call (rare — wrong number caller scenario),
                    // we keep the first timestamp and ignore subsequent.
                    // ─────────────────────────────────────────────────────
                    pool.query(
                      "UPDATE calls SET estimate_link_sent_at = now() WHERE id = $1 AND estimate_link_sent_at IS NULL",
                      [callId]
                    ).catch((err) =>
                      console.error("[AI-Desk] funnel tracking update failed call_id=%s err=%s", callId, err.message)
                    );
 
                    output = JSON.stringify({
                      success: true,
                      message: "Link sent successfully. Tell the caller: 'Just sent it — should be in your messages now. Fill it out and you'll get an instant ballpark range, then you can book a walkthrough right from there.' Briefly confirm they got it.",
                    });
                  } else {
 
                    console.error("[AI-Desk] send_estimate_link failed call_id=%s err=%s",
                      callId, result.error || result.skipped || "unknown");
                    output = JSON.stringify({
                      success: false,
                      message: "Couldn't send the link. Tell the caller: 'I'm having trouble sending the text right now — let me get someone to follow up with you instead.' Then call request_human_transfer with reason='caller_requested_human'.",
                    });
                  }
                } catch (err) {
                  console.error("[AI-Desk] send_estimate_link unexpected error:", err.message);
                  output = JSON.stringify({
                    success: false,
                    message: "Something went wrong. Tell the caller: 'I'm having a technical issue sending the link — let me transfer you.' Then call request_human_transfer with reason='caller_requested_human'.",
                  });
                }
              }
           } else if (name === "cancel_appointment" && tenant && callId) {
              // ─────────────────────────────────────────────────────────
              // Phase 4B (May 4, 2026) — voice cancellation flow.
              //
              // Two-phase protocol: AI calls Phase 1 with caller_phone to
              // look up upcoming bookings, then Phase 2 with confirmed=true
              // + target_booking_id after caller confirms.
              //
              // CRITICAL: we ignore args.caller_phone for the actual lookup
              // and use the WS-handshake `from` variable instead. This
              // prevents the AI from being talked into looking up someone
              // else's appointments by a caller who claims a different
              // number.
              // ─────────────────────────────────────────────────────────
              const { confirmed, target_booking_id, cancellation_reason } = args;
              const lookupPhone = from; // call's actual From: — never trust args
 
              if (!lookupPhone) {
                console.warn("[AI-Desk] cancel_appointment: no From: on call — falling back to transfer");
                output = JSON.stringify({
                  success: false,
                  action: "transfer_to_human",
                  message: "I can't identify your number on this call. Tell the caller: 'I'm having trouble looking up your appointment — let me transfer you to someone who can help.' Then call request_human_transfer with reason='caller_requested_human'.",
                });
              } else if (confirmed && target_booking_id) {
                // ── Phase 2: actually cancel ─────────────────────────
                try {
                  const booking = await bookingsService.cancelBooking(target_booking_id, {
                    cancelled_via: "voice",
                    cancellation_reason: cancellation_reason || null,
                  });
                  if (!booking) {
                    console.warn("[AI-Desk] cancel_appointment phase 2: booking not found id=%s", target_booking_id);
                    output = JSON.stringify({
                      success: false,
                      action: "transfer_to_human",
                      message: "I couldn't find that appointment to cancel. Tell the caller: 'I'm having trouble cancelling that one — let me transfer you to someone who can help.' Then call request_human_transfer with reason='caller_requested_human'.",
                    });
                  } else {
                    // Verify the booking actually belonged to this tenant.
                    // Defense-in-depth — target_booking_id from the AI
                    // could in theory be tampered with mid-conversation.
                    if (booking.tenant_id !== tenant.id) {
                      console.error("[AI-Desk] cancel_appointment phase 2: tenant mismatch! booking=%s tenant=%s expected=%s",
                        booking.id, booking.tenant_id, tenant.id);
                      output = JSON.stringify({
                        success: false,
                        action: "transfer_to_human",
                        message: "Something went wrong with that cancellation. Transfer the caller using request_human_transfer with reason='caller_requested_human'.",
                      });
                    } else {
                      console.log("[AI-Desk] cancel_appointment phase 2: cancelled booking=%s tenant=%s reason=%s",
                        booking.id, tenant.id, cancellation_reason ? "captured" : "none");
                      output = JSON.stringify({
                        success: true,
                        message: "Appointment cancelled. The customer will receive a text confirmation in a moment. Now ask the caller: 'Got it — you'll get a text confirmation in a moment. Would you like to set up a new time, or just leave things for now?' If they want to reschedule, start the booking flow. If not, say something warm and brief — do NOT call hang_up.",
                      });
                    }
                  }
                } catch (err) {
                  console.error("[AI-Desk] cancel_appointment phase 2 error:", err.message);
                  output = JSON.stringify({
                    success: false,
                    action: "transfer_to_human",
                    message: "Something went wrong with that cancellation. Tell the caller: 'I'm having a technical issue — let me transfer you.' Then call request_human_transfer with reason='caller_requested_human'.",
                  });
                }
              } else {
                // ── Phase 1: look up upcoming bookings ───────────────
                try {
                  const upcoming = await bookingsService.findUpcomingBookingsByPhone(tenant.id, lookupPhone);
 
                  if (upcoming.length === 0) {
                    console.log("[AI-Desk] cancel_appointment phase 1: no upcoming bookings for from=%s tenant=%s", lookupPhone, tenant.id);
                    output = JSON.stringify({
                      success: false,
                      action: "transfer_to_human",
                      message: "No upcoming appointments under this number. Tell the caller: 'I don't see any upcoming appointments under this number — let me transfer you to someone who can help.' Then call request_human_transfer with reason='caller_requested_human'.",
                    });
                  } else if (upcoming.length === 1) {
                    const b = upcoming[0];
                    const friendly = bookingsService.formatBookingForVoiceConfirm(b);
                    console.log("[AI-Desk] cancel_appointment phase 1: 1 booking found id=%s friendly=%s", b.id, friendly);
                    output = JSON.stringify({
                      success: true,
                      action: "confirm_with_caller",
                      booking_id: b.id,
                      friendly,
                      message: `Found one upcoming appointment: ${friendly}. Repeat back the date and time exactly: 'I see you have an appointment ${friendly} — should I go ahead and cancel that for you?' Wait for an EXPLICIT yes (yes / yeah / correct / please / go ahead). If they say no or hesitate, do NOT cancel — clarify what they want instead. After explicit yes, casually ask: 'No problem — was there anything specific that came up, just so we can let the team know?' (don't push if they decline). Then call cancel_appointment AGAIN with confirmed=true, target_booking_id="${b.id}", caller_phone="${lookupPhone}", and cancellation_reason set to whatever the caller shared (omit if they declined).`,
                    });
                  } else {
                    const items = upcoming.map((b) => ({
                      id: b.id,
                      friendly: bookingsService.formatBookingForVoiceConfirm(b),
                    }));
                    const listForAi = items
                      .map((it, i) => `${i + 1}) ${it.friendly} (id: ${it.id})`)
                      .join("; ");
                    console.log("[AI-Desk] cancel_appointment phase 1: %d bookings found for from=%s", upcoming.length, lookupPhone);
                    output = JSON.stringify({
                      success: true,
                      action: "ask_which_booking",
                      bookings: items,
                      message: `Found ${upcoming.length} upcoming appointments: ${listForAi}. Tell the caller naturally: 'I see a few appointments under this number — the first one is [friendly1], the second is [friendly2]. Which one would you like to cancel?' After they pick, CONFIRM by repeating back: 'Just to make sure, you want to cancel the [chosen friendly] one — is that right?' Wait for explicit yes. Then casually ask for a reason. Then call cancel_appointment AGAIN with confirmed=true, target_booking_id=<the chosen booking's id from above>, caller_phone="${lookupPhone}", and cancellation_reason if captured.`,
                    });
                  }
                } catch (err) {
                  console.error("[AI-Desk] cancel_appointment phase 1 lookup error:", err.message);
                  output = JSON.stringify({
                    success: false,
                    action: "transfer_to_human",
                    message: "Lookup failed. Tell the caller: 'I'm having trouble looking that up — let me transfer you to someone who can help.' Then call request_human_transfer with reason='caller_requested_human'.",
                  });
                }
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
              
              // Notification for lead capture
              notificationsService.createNotification(tenant.id, {
                type: 'lead_captured',
                title: 'New Lead Info Captured',
                body: `Captured details for ${args.contact_name || 'a new lead'} (${args.contact_phone || 'unknown phone'}).`,
                data: { leadId, ...args }
              }).catch(e => console.error("Notification error:", e));

              output = JSON.stringify({ success: true, message: "Lead info captured. Continue the conversation." });
            } else if (name === "book_appointment" && tenant && callId) {
              console.log("[AI-Desk] Realtime book_appointment callSid=%s tenantId=%s callId=%s recovery=%s", callSid, tenant.id, callId, isRecovery);
              currentLeadCapture = { ...currentLeadCapture, ...args };
              
              // 1. Create local booking
              const { booking, crmSynced } = await bookingsService.createBooking(tenant.id, callId, args, leadId, leadSource);
              console.log("[AI-Desk] Realtime booking done id=%s crmSynced=%s", booking.id, crmSynced);
              
              // Notification for new booking
              notificationsService.createNotification(tenant.id, {
                type: 'booking_created',
                title: 'New Booking Created',
                body: `${args.contact_name || 'A customer'} booked an appointment for ${args.preferred_date || 'a future date'}.`,
                data: { bookingId: booking.id, callId }
              }).catch(e => console.error("Notification error:", e));
              
              // 2. Sync to Google Calendar
              calendar.syncToGoogleCalendar(booking, tenant).catch(e => console.error("[Calendar] Auto-sync failed:", e.message));

              // 3. Update lead status to 'Booked'
              if (leadId) {
                leadsService.updateLeadStatus(leadId, 'Booked').catch(e => console.error("Lead status update error:", e));
              }

              // 5. Mark any active estimate recovery as CONVERTED (Sales Win)
              const bookingPhone = args.contact_phone || args.phone;
              if (bookingPhone) {
                try {
                  const activeRecovery = await db.query(
                    `SELECT id FROM estimate_recoveries
                     WHERE tenant_id = $1
                       AND status IN ('active', 'paused', 'dormant')
                       AND (
                         contact_phone = $2
                         OR right(regexp_replace(COALESCE(contact_phone, ''), '[^0-9]', '', 'g'), 10) = $3
                       )
                     LIMIT 1`,
                    [tenant.id, normalizePhone(bookingPhone), getLast10Digits(bookingPhone)]
                  );
                  if (activeRecovery.rows.length > 0) {
                    await estimateRecoveryService.markConverted(activeRecovery.rows[0].id);
                    console.log("[AI-Desk] Recovery CONVERTED (via booking) id=%s 🎉", activeRecovery.rows[0].id);
                  }
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

                // Notification for transfer request
                notificationsService.createNotification(tenant.id, {
                  type: 'transfer_requested',
                  title: 'Human Transfer Requested',
                  body: `Caller ${args.caller_name || ''} (${args.caller_phone || ''}) requested to speak with a human. Reason: ${args.reason || 'Not specified'}.`,
                  data: { ...args, callSid }
                }).catch(e => console.error("Notification error:", e));

                output = JSON.stringify(result);
              }
            } else if (name === "request_do_not_contact" && tenant && callId) {
              // ─────────────────────────────────────────────────────────
              // TCPA voice opt-out — Migration 060 (May 9, 2026)
              //
              // Caller explicitly asked to be removed from all contact.
              // We:
              //  1. Fire setDoNotContact + cascade-cancel recoveries/nurtures
              //  2. Audit-log via setDoNotContact (trigger_source=voice_intent)
              //  3. Notify the owner that a caller opted out
              //  4. Schedule a safety-net hangup 5s out in case Alex
              //     forgets to call hang_up after acknowledging
              //
              // CRITICAL: we use the resolved `leadId` (from `from` at WS
              // handshake) rather than trusting any arg. Falls back to a
              // phone-based lead lookup if leadId wasn't set yet (e.g.
              // very fast hangup before getOrCreateLead resolved).
              // ─────────────────────────────────────────────────────────
              console.log("[AI-Desk] request_do_not_contact callSid=%s tenant=%s leadId=%s from=%s reason=%s",
                callSid, tenant.id, leadId || "(none)", from || "(none)", args.reason || "(none)");

              let dncFired = false;
              let resolvedLeadId = leadId;

              if (!resolvedLeadId && from) {
                try {
                  const leadRow = await db.query(
                    `SELECT id FROM leads
                       WHERE tenant_id = $1
                         AND (
                           phone = $2
                           OR right(regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g'), 10) = $3
                         )
                       ORDER BY updated_at DESC LIMIT 1`,
                    [tenant.id, from, getLast10Digits(from)]
                  );
                  if (leadRow.rows.length > 0) {
                    resolvedLeadId = leadRow.rows[0].id;
                  }
                } catch (err) {
                  console.error("[AI-Desk] request_do_not_contact phone-lookup failed:", err.message);
                }
              }

              if (resolvedLeadId) {
                try {
                  await leadsService.setDoNotContact(resolvedLeadId, true, {
                    reason: args.reason || `Voice caller from ${from || 'unknown'} explicitly requested DNC`,
                    trigger_source: 'voice_intent',
                  });
                  dncFired = true;
                } catch (err) {
                  console.error("[AI-Desk] request_do_not_contact setDoNotContact failed:", err.message);
                }
              } else {
                console.warn("[AI-Desk] request_do_not_contact: no lead found for phone=%s tenant=%s — DNC not applied",
                  from || "(unknown)", tenant.id);
              }

              // Update the call record with the disposition for audit
              safeUpdateCallSummary(callId, {
                disposition: 'dnc_requested',
                metadata: {
                  ...currentLeadCapture,
                  dnc_fired: dncFired,
                  dnc_trigger_source: 'voice_intent',
                  dnc_reason: args.reason || null,
                }
              }).catch((err) => console.error("[AI-Desk] DNC call summary update failed:", err.message));

              // Owner-facing notification
              notificationsService.createNotification(tenant.id, {
                type: 'dnc_requested',
                title: 'Caller Requested Do-Not-Contact',
                body: `A caller from ${from || 'unknown number'} explicitly asked to be removed from contact during a voice call. ${dncFired ? 'DNC applied.' : 'DNC NOT applied (no matching lead found — manual review needed).'}`,
                data: { callSid, callId, from, leadId: resolvedLeadId, dnc_fired: dncFired, reason: args.reason }
              }).catch((e) => console.error("DNC notification error:", e));

              output = JSON.stringify({
                success: dncFired,
                message: dncFired
                  ? "DNC applied. Tell the caller in ONE short sentence, calm and warm: 'Got it. I'll make sure you're removed from our list right away. Take care.' Then immediately call hang_up. DO NOT argue, DO NOT ask why, DO NOT try to retain."
                  : "I couldn't find their record automatically, but they've asked to opt out and we'll handle it manually. Tell the caller in ONE short sentence: 'Got it — I'll make a note and have someone update our records. Take care.' Then immediately call hang_up.",
              });

              // Safety-net hangup: if Alex forgets to call hang_up after
              // the acknowledgment, close the call from our side at 5s.
              // hasScheduledHangup flag prevents double-fire with hang_up.
              if (!hasScheduledHangup && callSid) {
                hasScheduledHangup = true;
                setTimeout(async () => {
                  try {
                    const client = twilioLib.getClientForTenant(tenant);
                    if (client && callSid) {
                      await client.calls(callSid).update({ status: "completed" });
                      console.log("[AI-Desk] DNC safety-net hangup triggered callSid=%s", callSid);
                    }
                  } catch (e) {
                    console.error("[AI-Desk] DNC safety-net hangup failed:", e.message);
                  }
                  clearSilenceTimers();
                  if (openaiSocket?.readyState === WebSocket.OPEN) openaiSocket.close();
                  if (twilioSocket.readyState === WebSocket.OPEN) twilioSocket.close();
                  await safeUpdateCallSummary(callId, {
                    status: "completed",
                    disposition: dncFired ? "dnc_requested" : "dnc_attempted",
                    transcript,
                    metadata: { ...currentLeadCapture, hangup_reason: "dnc_safety_net" },
                    markEnded: true,
                  });
                }, 5000);
              }
            } else if (name === "hang_up" && callSid) {
              console.log("[AI-Desk] Realtime hang_up trigger callSid=%s", callSid);
              clearSilenceTimers();
              output = JSON.stringify({ success: true, message: "Call ending." });

             setTimeout(async () => {
                try {
                const client = twilioLib.getClientForTenant(tenant);
               if (client && callSid) {
                 await client.calls(callSid).update({ status: "completed" });
                 console.log("[AI-Desk] Call terminated via hang_up tool callSid=%s", callSid);
              } else {
                 console.warn("[AI-Desk] hang_up: no Twilio client for tenant=%s callSid=%s", tenant?.id, callSid);
              }
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
          resetSilenceTimers(); // AI finished speaking → restart silence clock
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
          console.log("[AI-Desk] Booking confirmed, closing call in 15s...");
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
          }, 15000);
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
        leadsService.getOrCreateLead(tenant.id, from, null, leadSource, 'voice').then(lead => {
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
    clearSilenceTimers();
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

// ═════════════════════════════════════════════════════════════════════════
// LOCATION DATA RETENTION CRON (Apr 19, 2026)
// Hard-deletes tenant rows + all related data once their 30-day data
// retention window has expired. Runs every hour and acts on any rows where
// location_data_retention_until < now().
//
// Per Apr 19 spec: removed locations are immediately deactivated, kept in a
// suspended state for 30 days, then permanently deleted. Restoration during
// the 30-day window is possible via support (just clear location_removed_at
// + location_data_retention_until + is_suspended).
//
// We run hourly (not daily) so that retention expiries are processed within
// 1 hour of their target time regardless of server timezone. Cheap query
// thanks to the partial index idx_tenants_data_retention.
// ═════════════════════════════════════════════════════════════════════════

const RETENTION_CRON_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

async function runLocationRetentionCron() {
  const startedAt = new Date();
  console.log("[RetentionCron] Starting scan at", startedAt.toISOString());

  try {
    // Find tenants whose retention window has expired
    const expired = await db.query(
      `SELECT id, name, company_name, parent_id, location_removed_at, location_data_retention_until
         FROM tenants
        WHERE location_data_retention_until IS NOT NULL
          AND location_data_retention_until < now()
        ORDER BY location_data_retention_until ASC
        LIMIT 100`
    );

    if (expired.rows.length === 0) {
      console.log("[RetentionCron] No expired retention windows found.");
      return { ok: true, deleted: 0 };
    }

    console.log("[RetentionCron] Found %d tenant(s) past retention. Hard-deleting now.", expired.rows.length);

    let deletedCount = 0;
    let errorCount = 0;

    for (const tenant of expired.rows) {
      const tenantId = tenant.id;
      const label = tenant.company_name || tenant.name || tenantId;

      try {
        // Cascade delete in dependency order. Wrapped in a transaction so a
        // partial failure rolls back cleanly and leaves the tenant row alone
        // for retry next hour.
        await db.query("BEGIN");

        // Delete child tables that reference tenant_id
        // (Order matters only if you have FKs without ON DELETE CASCADE;
        // safest to do explicitly even if cascading is set up)
        const tables = [
          "messages",
          "calls",
          "leads",
          "bookings",
          "recoveries",
          "notifications",
          "phone_numbers",
          "team_members",
          "technicians",
          "audit_logs",
          "outbound_campaigns",
          "outbound_call_results",
          "estimate_attempts",
          "nurturing_history",
          "dashboard_users",
        ];

        for (const table of tables) {
          try {
            await db.query(`DELETE FROM ${table} WHERE tenant_id = $1`, [tenantId]);
          } catch (tableErr) {
            // Some tables may not exist in all environments — log + continue
            if (tableErr.code === "42P01") {
              // undefined_table — ignore
              continue;
            }
            throw tableErr;
          }
        }

        // Finally delete the tenant row itself
        await db.query("DELETE FROM tenants WHERE id = $1", [tenantId]);

        await db.query("COMMIT");
        deletedCount++;

        console.log(
          "[RetentionCron] Hard-deleted tenant %s (%s). Removed at %s, retention expired %s.",
          tenantId,
          label,
          tenant.location_removed_at,
          tenant.location_data_retention_until
        );
      } catch (err) {
        await db.query("ROLLBACK").catch(() => {});
        errorCount++;
        console.error(
          "[RetentionCron] FAILED to delete tenant %s (%s): %s",
          tenantId,
          label,
          err.message
        );
        // Continue to next tenant — don't abort the whole batch
      }
    }

    const elapsed = Date.now() - startedAt.getTime();
    console.log(
      "[RetentionCron] Done. Deleted=%d Errors=%d Elapsed=%dms",
      deletedCount,
      errorCount,
      elapsed
    );

    return { ok: true, deleted: deletedCount, errors: errorCount, elapsedMs: elapsed };
  } catch (err) {
    console.error("[RetentionCron] FATAL error during scan:", err);
    return { ok: false, error: err.message };
  }
}

// Kick off the cron loop. First run happens 5 minutes after server start
// (gives the server time to settle), then every hour after that.
setTimeout(() => {
  runLocationRetentionCron().catch((e) =>
    console.error("[RetentionCron] Initial run failed:", e.message)
  );
  setInterval(() => {
    runLocationRetentionCron().catch((e) =>
      console.error("[RetentionCron] Scheduled run failed:", e.message)
    );
  }, RETENTION_CRON_INTERVAL_MS);
}, 5 * 60 * 1000); // 5 min after startup

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
      const leadRecord = await leadsService.getOrCreateLead(tenant.id, lead.phone || sessionId, lead.full_name || lead.name, null, 'web_form');
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

    // Phase 8 (May 12, 2026) — when handoff is active there's no AI reply
    // to summarize, so skip the notification email. The result returned to
    // the chat widget includes { reply: null, handoff: true } — the widget
    // should render nothing in handoff mode (owner replies via SMS).
    if (!result?.handoff && result?.reply) {
      const isFallback = (tenant && tenant.slug === "website-chat");
      const tenantName = tenant ? (tenant.company_name || tenant.name || "Website Chat") : "Website Chat";

      emailService
        .sendWebsiteChatNotificationEmail({ message, sessionId, reply: result.reply, tenantName: isFallback ? "Website Chat" : tenantName })
        .catch((err) => console.error("Website chat email to Drew:", err.message));
    }

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
    pageAccessToken,
    tenant?.id
  );
  return res.sendStatus(200);
}

if (payload === "TALK_HUMAN") {
  await sendFacebookMessage(
    senderId,
    "No problem 👍 A team member will reach out shortly.",
    [],
    pageAccessToken,
    tenant?.id
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

    // Phase 8.1 (May 12, 2026) — when handoff is active, customer's FB
    // message is saved to the dashboard but no AI auto-response is sent.
    // Owner sees the message in the conversation viewer and replies
    // manually (currently SMS-only via the compose box).
    if (result?.handoff || !result?.reply) {
      console.log("[Facebook] No AI reply (handoff=%s) for sender=%s", !!result?.handoff, senderId);
      return;
    }

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
  const status = req.body?.status || "converted";

  if (!phone) {
    return res.status(400).json({ ok: false, error: "Missing phone number" });
  }

  try {
    // Look up any active recovery for this phone and mark it converted/cancelled.
    // Replaces the deprecated salesEngine.stopEstimateFollowUp flow.
    const recoveryRes = await db.query(
      "SELECT id FROM estimate_recoveries WHERE contact_phone = $1 AND status IN ('active', 'paused', 'dormant') LIMIT 1",
      [phone]
    );

    if (recoveryRes.rows.length === 0) {
      return res.json({ ok: true, message: "No active recovery found to stop" });
    }

    const recoveryId = recoveryRes.rows[0].id;
    if (status === "converted") {
      await estimateRecoveryService.markConverted(recoveryId);
    } else if (status === "cancelled") {
      await estimateRecoveryService.markCancelled(recoveryId);
    } else {
      await estimateRecoveryService.markPaused(recoveryId);
    }

    res.json({ ok: true, recovery_id: recoveryId, status });
  } catch (error) {
    console.error("Stop follow-up error:", error.message);
    res.status(500).json({ ok: false, error: "Internal server error" });
  }
});
// -------------------- Webhook: CRM Job Completed (DripJobs → Zapier → here) --------------------
// -------------------- Webhook: CRM Job Completed (DripJobs → Zapier → here) --------------------
// Handles DripJobs-style "job completed" events. When revenue is present,
// writes revenue to both the lead and the booking, marks lead status=Won,
// schedules post-service nurturing (referral/maintenance/reengagement live
// in services/nurturing.js and also fire), and converts any active estimate
// recovery. When revenue is absent or zero, only touches last_service_date —
// no status flip, no nurturing, no recovery conversion. This keeps
// warranty/touch-up/refund "completions" from triggering review/referral asks.
// If no lead exists for the incoming phone, one is auto-created so no real job
// is dropped. If no booking exists, one is created so the dashboard can surface
// the revenue through the bookings table.
app.post("/webhooks/crm/job-completed", async (req, res) => {
  const rawPhone = req.body?.phone || req.body?.contact_phone;
  console.log("[CRM Webhook] Received job-completed for phone=%s", rawPhone);

  const phone = normalizePhone(rawPhone);
  const contactName = req.body?.contact_name || req.body?.full_name || null;
  const serviceDate = req.body?.service_date || new Date().toISOString().slice(0, 10);
  const jobType = req.body?.job_type || null;
  const jobIdRaw = req.body?.job_id || req.body?.crm_id || null;
  let tenantId = req.body?.tenant_id || null;

  // Accept revenue as: actual_revenue_cents (int), grand_total (dollars),
  // amount (dollars), total (dollars). Normalize to integer cents.
  let revenueCents = null;
  const rawCents = req.body?.actual_revenue_cents;
  const rawDollars = req.body?.grand_total ?? req.body?.amount ?? req.body?.total;

  if (rawCents !== undefined && rawCents !== null && rawCents !== "") {
    const s = String(rawCents).replace(/[^0-9.-]/g, "");
    if (s.includes(".")) {
      const f = parseFloat(s);
      if (!isNaN(f)) revenueCents = Math.round(f * 100);
    } else {
      const i = parseInt(s, 10);
      if (!isNaN(i)) revenueCents = i;
    }
  } else if (rawDollars !== undefined && rawDollars !== null && rawDollars !== "") {
    const s = String(rawDollars).replace(/[^0-9.-]/g, "");
    const f = parseFloat(s);
    if (!isNaN(f)) revenueCents = Math.round(f * 100);
  }

  const hasRevenue = revenueCents !== null && revenueCents > 0;

  if (!phone) {
    return res.status(400).json({ ok: false, error: "Missing phone or contact_phone" });
  }

  // Auth: Bearer <api_key> OR body.api_key OR x-api-key header → look up tenant
  let apiKey = (req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
  if (!apiKey) apiKey = req.headers["x-api-key"] || req.body?.api_key || "";
  apiKey = String(apiKey).trim();

  if (apiKey) {
    try {
      const tenantRow = await db.query(
        "SELECT id FROM tenants WHERE api_key = $1 LIMIT 1",
        [apiKey]
      );
      if (tenantRow.rows.length > 0) {
        tenantId = tenantRow.rows[0].id;
      }
    } catch (e) {
      console.error("[CRM Webhook] api_key lookup error:", e.message);
    }
  }

  if (!tenantId) {
    return res.status(401).json({ ok: false, error: "Could not identify tenant. Provide Authorization: Bearer <api_key>, x-api-key header, api_key in body, or tenant_id in body." });
  }

  try {
    // 1. Find the lead by phone + tenant. If missing, auto-create so no job is lost.
    let leadResult = await db.query(
      "SELECT id, name, status FROM leads WHERE tenant_id = $1 AND phone = $2 LIMIT 1",
      [tenantId, phone]
    );
    let lead = leadResult.rows[0] || null;

    if (!lead) {
      console.log("[CRM Webhook] No lead for phone=%s tenantId=%s — auto-creating from job-completed payload", phone, tenantId);
      const initialStatus = hasRevenue ? "Won" : "New";
      const insertRes = await db.query(
        `INSERT INTO leads (tenant_id, phone, name, status, lead_source, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'crm_job_completed', now(), now())
         RETURNING id, name, status`,
        [tenantId, phone, contactName || "CRM Lead", initialStatus]
      );
      lead = insertRes.rows[0];
    }

    // 2. Update the lead. Always touch last_service_date. Only flip status to
    //    Won and write revenue if the payload actually included revenue —
    //    warranty/touch-up/refund "completions" with $0 leave status untouched.
    const leadUpdates = ["last_service_date = $2::date", "updated_at = now()"];
    const leadParams = [lead.id, serviceDate];

    if (hasRevenue) {
      leadUpdates.push("status = 'Won'");
      leadParams.push(revenueCents);
      leadUpdates.push(`actual_revenue_cents = $${leadParams.length}`);
    }
    if (contactName && !lead.name) {
      leadParams.push(contactName);
      leadUpdates.push(`name = $${leadParams.length}`);
    }

    await db.query(
      `UPDATE leads SET ${leadUpdates.join(", ")} WHERE id = $1`,
      leadParams
    );
    console.log("[CRM Webhook] Lead updated leadId=%s status=%s revenue_cents=%s last_service_date=%s",
      lead.id, hasRevenue ? "Won" : lead.status, hasRevenue ? revenueCents : "n/a", serviceDate);

    // 3. Find the latest booking for this lead. If one exists, mark Completed
    //    and write revenue when present. If none exists AND we have revenue,
    //    create a minimal booking so the dashboard can see it through the
    //    bookings table. If no revenue, skip booking creation — we don't want
    //    empty rows piling up for warranty/touch-up pings.
    const bookingResult = await db.query(
      "SELECT id, status, lead_id, tenant_id, preferred_date FROM bookings WHERE tenant_id = $1 AND lead_id = $2 ORDER BY created_at DESC LIMIT 1",
      [tenantId, lead.id]
    );
    let booking = bookingResult.rows[0] || null;

    if (booking) {
      const bookingUpdates = ["status = 'Completed'", "updated_at = now()"];
      const bookingParams = [booking.id];
      if (hasRevenue) {
        bookingParams.push(revenueCents);
        bookingUpdates.push(`actual_revenue_cents = $${bookingParams.length}`);
      }
      if (jobIdRaw) {
        bookingParams.push(String(jobIdRaw).slice(0, 255));
        bookingUpdates.push(`crm_id = COALESCE(crm_id, $${bookingParams.length})`);
      }
      await db.query(
        `UPDATE bookings SET ${bookingUpdates.join(", ")} WHERE id = $1`,
        bookingParams
      );
      console.log("[CRM Webhook] Booking updated bookingId=%s status=Completed revenue_cents=%s",
        booking.id, hasRevenue ? revenueCents : "n/a");
    } else if (hasRevenue) {
      const insertBooking = await db.query(
        `INSERT INTO bookings (tenant_id, lead_id, contact_name, contact_phone,
                               status, state, preferred_date,
                               actual_revenue_cents, lead_source, crm_id,
                               created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'Completed', 'Confirmed', $5::date,
                 $6, 'crm_job_completed', $7,
                 now(), now())
         RETURNING id, lead_id, status, preferred_date`,
        [
          tenantId,
          lead.id,
          contactName || lead.name || "CRM Lead",
          phone,
          serviceDate,
          revenueCents,
          jobIdRaw ? String(jobIdRaw).slice(0, 255) : null,
        ]
      );
      booking = insertBooking.rows[0];
      console.log("[CRM Webhook] Booking CREATED bookingId=%s revenue_cents=%s",
        booking.id, revenueCents);
    } else {
      console.log("[CRM Webhook] No booking and no revenue — skipping booking creation for leadId=%s", lead.id);
    }

    // 4. Schedule post-service nurturing campaigns — ONLY if revenue was
    //    recorded. Zero-dollar "completions" (warranty, refund, touch-up)
    //    don't trigger nurturing to avoid awkward referral/review asks on
    //    unpaid work.
    if (hasRevenue && booking) {
      nurturingService.schedulePostServiceCampaigns(tenantId, booking).catch((e) =>
        console.error("[CRM Webhook] Schedule nurturing campaigns:", e.message)
      );
    } else if (!hasRevenue) {
      console.log("[CRM Webhook] Skipped nurturing schedule (no revenue recorded) leadId=%s", lead.id);
    }

    // 5. Mark any active estimate recovery as CONVERTED — only when revenue
    //    actually came in. Otherwise we'd inflate conversion metrics on
    //    zero-dollar completions.
    if (hasRevenue) {
      try {
        const activeRecovery = await db.query(
          `SELECT id FROM estimate_recoveries
           WHERE tenant_id = $1
             AND status IN ('active', 'paused', 'dormant')
             AND (
               contact_phone = $2
               OR right(regexp_replace(COALESCE(contact_phone, ''), '[^0-9]', '', 'g'), 10) = $3
             )
           LIMIT 1`,
          [tenantId, phone, getLast10Digits(phone)]
        );
        if (activeRecovery.rows.length > 0) {
          await estimateRecoveryService.markConverted(activeRecovery.rows[0].id);
          console.log("[CRM Webhook] Converted estimate_recovery id=%s", activeRecovery.rows[0].id);
        }
      } catch (e) {
        console.error("[CRM Webhook] Recovery conversion error:", e.message);
      }
    }

// 💰 Revenue recovered notification
    if (hasRevenue) {
      notificationsService.notifyRevenueRecovered(tenantId, {
        amount_cents:  revenueCents,
        customer_name: lead.name || contactName,
        lead_id:       lead.id,
        booking_id:    booking?.id || null,
      }).catch((e) => console.error("[CRM Webhook] notifyRevenueRecovered failed:", e.message));
    }

    // 📅 New booking notification — only when we auto-created a booking here
    if (hasRevenue && booking && bookingResult.rows.length === 0) {
      notificationsService.notifyNewBooking(tenantId, {
        customer_name: lead.name || contactName,
        service_date:  serviceDate,
        booking_id:    booking.id,
        lead_id:       lead.id,
        source:        'crm_job_completed',
      }).catch((e) => console.error("[CRM Webhook] notifyNewBooking failed:", e.message));
    }

    res.json({
      ok: true,
      lead_id: lead.id,
      booking_id: booking?.id || null,
      revenue_cents_written: hasRevenue ? revenueCents : null,
      last_service_date: serviceDate,
      status: hasRevenue ? 'Won' : lead.status,
      nurturing_scheduled: hasRevenue && !!booking,
    });
} catch (err) {
    console.error("[CRM Webhook] /webhooks/crm/job-completed error:", err);
    res.status(500).json({ ok: false, error: "Server error handling job-completed" });
  }
});

// -------------------- Cron: estimate recovery every 5 min --------------------
cron.schedule("*/5 * * * *", () => {
  estimateRecoveryService.processDueRecoveries().catch((e) => console.error("Recovery cron:", e));
});

// Removed 2026-04-17: duplicated estimateRecoveryService.processDueRecoveries.
// See services/salesEngine.js deprecation notes.

cron.schedule("*/10 * * * *", () => {
  nurturingService.processDueNurturing().catch((e) => console.error("Nurturing cron:", e));
});

cron.schedule("0 9 * * *", () => {
  nurturingService.processMaintenanceReminders().catch((e) => console.error("Nurturing maintenance:", e));
  nurturingService.processReengagement().catch((e) => console.error("Nurturing reengagement:", e));
  nurturingService.processSeasonalCampaigns().catch((e) => console.error("Nurturing seasonal:", e));
  notificationsService.sendDailySummary().catch((e) => console.error("Daily summary notification failed:", e));
});

// Check hung-up rate every hour
cron.schedule("0 * * * *", () => {
  notificationsService.checkHungUpRates().catch((e) => console.error("Hung-up rate notification failed:", e));
});

// Check usage alerts every 4 hours
cron.schedule("0 */4 * * *", () => {
  notificationsService.checkUsageAlerts().catch((e) => console.error("Usage alert notification failed:", e));
});

// ═══════════════════════════════════════════════════════════════
// METRIC ALERTS — Added April 17, 2026
// Runs 10 different anomaly checks on staggered cron schedules.
// 4 critical alerts also email drew@aifrontdeskhelper.com.
// ═══════════════════════════════════════════════════════════════

// Every 30 minutes — fast-moving platform alerts (negative reviews, OpenAI errors)
cron.schedule("*/30 * * * *", () => {
  metricAlerts.runHalfHourlyChecks().catch((e) => console.error("[Cron] MetricAlerts 30-min failed:", e.message));
});

// Every hour — Twilio failures + spam surges
cron.schedule("0 * * * *", () => {
  metricAlerts.runHourlyChecks().catch((e) => console.error("[Cron] MetricAlerts hourly failed:", e.message));
});

// Every 6 hours — conversion drop + call pattern anomalies
cron.schedule("0 */6 * * *", () => {
  metricAlerts.runSixHourlyChecks().catch((e) => console.error("[Cron] MetricAlerts 6-hourly failed:", e.message));
});

// Daily at 6 AM UTC (1 AM Central) — slow-moving business health metrics
cron.schedule("0 6 * * *", () => {
  metricAlerts.runDailyChecks().catch((e) => console.error("[Cron] MetricAlerts daily failed:", e.message));
});

// ═══════════════════════════════════════════════════════════════
// CHURN GRACE EXPIRATION CRON — Added Apr 21, 2026 (Step 9)
// Daily at 3 AM Central. Suspends tenants whose 30-day direct-billing
// grace window has passed without completion. Matches the retention
// cron's "3 AM nightly" pattern.
//
// Suspension rationale (not soft-delete): transferred customers did
// nothing wrong — their reseller churned. Suspension gates product
// access until they call support or complete direct billing. The
// authMiddleware still allows /api/billing + /api/auth/me while
// suspended, so they can finish setup AFTER the grace expires.
// ═══════════════════════════════════════════════════════════════
cron.schedule("0 3 * * *", async () => {
  console.log("[ChurnGraceCron] Starting grace-expiration scan");
  try {
    const { rows } = await db.query(
      `SELECT id, name, primary_email, churn_grace_expires_at,
              churn_grace_originated_reseller_id
         FROM tenants
        WHERE churn_grace_token IS NOT NULL
          AND churn_grace_expires_at IS NOT NULL
          AND churn_grace_expires_at < now()
          AND (is_suspended IS NULL OR is_suspended = false)
          AND deleted_at IS NULL
        LIMIT 100`
    );

    if (rows.length === 0) {
      console.log("[ChurnGraceCron] No expired grace windows found.");
      return;
    }

    console.log("[ChurnGraceCron] Found %d tenant(s) to suspend", rows.length);
    let successCount = 0;
    let errorCount = 0;

    for (const tenant of rows) {
      try {
        await db.query(
          `UPDATE tenants
              SET is_suspended = true,
                  suspended_reason = 'churn_grace_expired',
                  churn_grace_token = NULL,
                  updated_at = now()
            WHERE id = $1`,
          [tenant.id]
        );
        successCount++;
        console.log(
          "[ChurnGraceCron] Suspended tenant=%s (%s) — grace expired %s",
          tenant.id,
          tenant.primary_email || "(no email)",
          tenant.churn_grace_expires_at
        );
      } catch (err) {
        errorCount++;
        console.error(
          "[ChurnGraceCron] Failed to suspend tenant=%s: %s",
          tenant.id,
          err.message
        );
      }
    }

    console.log(
      "[ChurnGraceCron] Done. Suspended=%d Errors=%d",
      successCount,
      errorCount
    );
  } catch (err) {
    console.error("[ChurnGraceCron] Fatal scan error:", err.message);
  }
});
console.log("[Cron] ChurnGraceCron registered: daily 3 AM");

console.log("[Cron] MetricAlerts registered: 30min, hourly, 6-hourly, daily");
// Auto-fetch Google reviews nightly + notify on new reviews needing approval
const { startReviewScheduler } = require("./services/reviewScheduler");
startReviewScheduler();

// -------------------- Listen --------------------
loadTenants().then(() => {
  server.listen(PORT, () => {
    console.log(`AI front desk backend listening on port ${PORT}`);
    startOutboundEngine().catch(e => console.error("Outbound Engine start failed:", e));
    startResellerUsageReporter();
  });
});
