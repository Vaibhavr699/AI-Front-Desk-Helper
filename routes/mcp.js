"use strict";

/**
 * routes/mcp.js
 *
 * Phase 13B (Jun 12, 2026) — Agent-Bookable MCP Server.
 *
 * The MCP (Model Context Protocol) layer that lets MCP-aware AI platforms
 * discover and invoke booking for a tenant. It exposes two tools —
 * check_availability and create_booking — that wrap the SAME lib/bookingEngine
 * the REST API (13A), website, SMS, and voice already use. An agent booking is
 * a REAL booking, identical underneath. 13B does NOT reimplement anything; it's
 * a thin MCP-protocol shell over the verified engine.
 *
 * TRANSPORT (hand-rolled, no SDK dependency):
 *   This implements MCP over JSON-RPC 2.0 on a single HTTP POST endpoint
 *   (the "Streamable HTTP" shape, responses returned as JSON). We hand-roll
 *   rather than pull @modelcontextprotocol/sdk because that SDK is ESM-only
 *   and this backend is CommonJS — a require/import clash that builds green
 *   then fails to load. Hand-rolling loads with require like everything else
 *   and carries zero dependency/interop risk. The protocol surface an agent
 *   actually needs to connect and call tools is small: initialize,
 *   notifications/initialized, tools/list, tools/call, ping.
 *
 * PER-TENANT (Drew's decision, Jun 12):
 *   Each tenant gets their own MCP connection URL:
 *       POST /api/mcp/:tenantId
 *   This mirrors the per-tenant webhook URL pattern. The tenant is resolved
 *   from the path, so an agent connected to one tenant's URL can only ever
 *   see/book that tenant.
 *
 * AUTH (mirrors 13A):
 *   - check_availability  → PUBLIC (reads open slots, nothing sensitive)
 *   - create_booking      → KEYED (writes data + fires real SMS/email).
 *     The tenant api_key is required, accepted as Authorization: Bearer <key>
 *     or x-api-key header on the HTTP request (so the key is supplied at the
 *     connection/transport layer, not leaked into tool arguments / chat).
 *
 * AGENT BOOKING = REAL BOOKING:
 *   create_booking routes through bookingEngine.book() with source "mcp", so
 *   the booking is logged, pre-visit briefing runs, recovery/nurture is skipped
 *   (already converted), and the outcome-chain is preserved — same as 13A.
 */

const express = require("express");
const router = express.Router();

const bookingEngine = require("../lib/bookingEngine");
const db = require("../lib/db");

const DEFAULT_DURATION_MIN = 60;
const DAY_SCAN_HORIZON = 14;
const MAX_DAYS_SHOWN = 7;

// The MCP protocol version we implement. Clients send their own in initialize;
// we echo a supported one back. This is the current stable revision.
const PROTOCOL_VERSION = "2025-06-18";

const SERVER_INFO = { name: "aifrontdesk-booking", version: "1.0.0" };

// ─────────────────────────────────────────────────────────────────────────────
// Tool definitions (advertised via tools/list)
// ─────────────────────────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: "check_availability",
    description:
      "Check open appointment slots for this business. Optionally pass a specific date (YYYY-MM-DD); " +
      "if omitted, returns the next several days that have openings. Each slot has a 'value' " +
      "(e.g. \"09:00:00\") to pass to create_booking, and a human-friendly 'time' (e.g. \"9:00 AM\").",
    inputSchema: {
      type: "object",
      properties: {
        date: {
          type: "string",
          description: "Optional. A specific day to check, formatted YYYY-MM-DD. Omit to scan upcoming days.",
        },
        duration_minutes: {
          type: "number",
          description: "Optional. Appointment length in minutes. Defaults to 60.",
        },
      },
    },
  },
  {
    name: "create_booking",
    description:
      "Book an appointment. Requires a date and a slot 'value' from check_availability, plus the " +
      "customer's name, phone, email, and service address (all required). Creates a real booking and " +
      "sends the customer a confirmation. Requires the tenant API key on the connection.",
    inputSchema: {
      type: "object",
      properties: {
        date: { type: "string", description: "Appointment date, YYYY-MM-DD." },
        time: { type: "string", description: "Slot 'value' from check_availability, e.g. \"09:00:00\"." },
        duration_minutes: { type: "number", description: "Optional. Defaults to 60." },
        name: { type: "string", description: "Customer full name." },
        phone: { type: "string", description: "Customer phone number." },
        email: { type: "string", description: "Customer email address." },
        address: { type: "string", description: "Service address (street, city, ZIP)." },
        project_type: { type: "string", description: "Optional. Type of project/service." },
        project_details: { type: "string", description: "Optional. Extra detail about the job." },
        estimated_value: { type: "number", description: "Optional. Estimated job value in dollars." },
      },
      required: ["date", "time", "name", "phone", "email", "address"],
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function isValidEmail(text) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(text || "").trim());
}

function todayIsoInTz(timezone) {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric", month: "2-digit", day: "2-digit",
    timeZone: timezone || "America/Chicago",
  }).format(new Date());
}

function addDaysIso(isoDate, days) {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

async function loadTenant(tenantId) {
  if (!tenantId) return null;
  try {
    const { rows } = await db.query(
      `SELECT id, name, timezone, api_key FROM tenants WHERE id = $1 LIMIT 1`,
      [tenantId]
    );
    return rows[0] || null;
  } catch (e) {
    console.error("[mcp] loadTenant failed id=%s: %s", tenantId, e.message);
    return null;
  }
}

function extractApiKey(req) {
  const auth = req.get("authorization") || "";
  const bearer = auth.match(/^Bearer\s+(.+)$/i);
  if (bearer) return bearer[1].trim();
  const x = req.get("x-api-key");
  if (x) return String(x).trim();
  return null;
}

// JSON-RPC 2.0 envelope helpers.
function rpcResult(id, result) {
  return { jsonrpc: "2.0", id, result };
}
function rpcError(id, code, message, data) {
  const err = { code, message };
  if (data !== undefined) err.data = data;
  return { jsonrpc: "2.0", id, error: err };
}

// A tool result in MCP form: content blocks. We return JSON text the agent can
// parse, and set isError on tool-level failures (distinct from protocol errors).
function toolText(obj, isError = false) {
  return {
    content: [{ type: "text", text: JSON.stringify(obj) }],
    isError: Boolean(isError),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool implementations — call the engine directly (in-process, no HTTP hop)
// ─────────────────────────────────────────────────────────────────────────────

async function runCheckAvailability(tenant, args) {
  const duration = parseInt(args.duration_minutes, 10) || DEFAULT_DURATION_MIN;
  const dateParam = (args.date || "").trim();

  if (dateParam) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      return toolText({ ok: false, error: "invalid_date", detail: "date must be YYYY-MM-DD" }, true);
    }
    let avail;
    try {
      avail = await bookingEngine.getAvailability({ tenantId: tenant.id, date: dateParam, durationMinutes: duration });
    } catch (e) {
      console.error("[mcp] availability failed tenant=%s date=%s: %s", tenant.id, dateParam, e.message);
      return toolText({ ok: false, error: "availability_lookup_failed" }, true);
    }
    const slots = (avail && avail.ok && Array.isArray(avail.slots)) ? avail.slots : [];
    return toolText({ ok: true, date: dateParam, duration_minutes: duration, slots });
  }

  // Multi-day scan.
  const tz = tenant.timezone || "America/Chicago";
  const days = [];
  try {
    const start = todayIsoInTz(tz);
    for (let i = 0; i < DAY_SCAN_HORIZON && days.length < MAX_DAYS_SHOWN; i++) {
      const dateIso = addDaysIso(start, i);
      let avail;
      try {
        avail = await bookingEngine.getAvailability({ tenantId: tenant.id, date: dateIso, durationMinutes: duration });
      } catch (e) {
        console.error("[mcp] scan day failed tenant=%s date=%s: %s", tenant.id, dateIso, e.message);
        continue;
      }
      if (avail && avail.ok && Array.isArray(avail.slots) && avail.slots.length > 0) {
        days.push({ date: dateIso, slots: avail.slots });
      }
    }
  } catch (e) {
    console.error("[mcp] availability scan failed tenant=%s: %s", tenant.id, e.message);
    return toolText({ ok: false, error: "availability_lookup_failed" }, true);
  }
  return toolText({ ok: true, duration_minutes: duration, days });
}

async function runCreateBooking(tenant, args, req) {
  // Auth gate — same key model as 13A's POST.
  const key = extractApiKey(req);
  if (!key) {
    return toolText({ ok: false, error: "missing_api_key", detail: "Provide the tenant API key on the connection (Authorization: Bearer <key>)." }, true);
  }
  if (!tenant.api_key || key !== tenant.api_key) {
    console.warn("[mcp] create_booking auth failed tenant=%s", tenant.id);
    return toolText({ ok: false, error: "invalid_api_key" }, true);
  }

  const date = (args.date || "").trim();
  const time = (args.time || "").toString().trim();
  const duration = parseInt(args.duration_minutes, 10) || DEFAULT_DURATION_MIN;

  const errors = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) errors.push("date (YYYY-MM-DD) is required");
  if (!time) errors.push("time is required (use a slot value from check_availability)");
  if (!args.name || !String(args.name).trim()) errors.push("name is required");
  if (!args.phone || !String(args.phone).trim()) errors.push("phone is required");
  if (!isValidEmail(args.email)) errors.push("email must be a valid email");
  if (!args.address || String(args.address).trim().length < 5) errors.push("address is required");
  if (errors.length) {
    return toolText({ ok: false, error: "validation_failed", details: errors }, true);
  }

  const numericEstimate = Number(args.estimated_value);
  const estimatedValue = (Number.isFinite(numericEstimate) && numericEstimate > 0) ? numericEstimate : null;

  let result;
  try {
    result = await bookingEngine.book({
      tenantId: tenant.id,
      date,
      time,
      durationMinutes: duration,
      contact: {
        name: String(args.name).slice(0, 120),
        phone: String(args.phone).trim(),
        email: String(args.email).trim(),
        address: String(args.address).slice(0, 240),
      },
      projectType: args.project_type || "",
      projectDetails: args.project_details || "",
      leadId: null,          // engine find-or-creates lead from contact.phone
      source: "mcp",         // tag MCP-layer bookings distinctly
      estimatedValue,        // optional; null → engine $250 default
    });
  } catch (e) {
    console.error("[mcp] engine.book threw tenant=%s: %s", tenant.id, e.message);
    return toolText({ ok: false, error: "booking_failed" }, true);
  }

  if (!result || !result.ok) {
    const reason = result?.reason || "booking_failed";
    console.warn("[mcp] booking rejected tenant=%s reason=%s", tenant.id, reason);
    return toolText({ ok: false, error: reason, message: result?.message }, true);
  }

  console.log("[mcp] BOOKED via MCP tenant=%s bookingId=%s date=%s time=%s", tenant.id, result.bookingId, date, time);
  return toolText({ ok: true, booking_id: result.bookingId, lead_id: result.leadId, date, time });
}

// ─────────────────────────────────────────────────────────────────────────────
// JSON-RPC method dispatch
// ─────────────────────────────────────────────────────────────────────────────

async function handleRpc(message, tenant, req) {
  const { id, method, params } = message;

  switch (method) {
    case "initialize":
      return rpcResult(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      });

    // Client tells us it's ready. Notification (no id) — no response body.
    case "notifications/initialized":
    case "initialized":
      return null;

    case "ping":
      return rpcResult(id, {});

    case "tools/list":
      return rpcResult(id, { tools: TOOLS });

    case "tools/call": {
      const toolName = params?.name;
      const args = params?.arguments || {};
      if (toolName === "check_availability") {
        return rpcResult(id, await runCheckAvailability(tenant, args));
      }
      if (toolName === "create_booking") {
        return rpcResult(id, await runCreateBooking(tenant, args, req));
      }
      return rpcError(id, -32602, `Unknown tool: ${toolName}`);
    }

    default:
      // Unknown method. Notifications (no id) are ignored; requests get an error.
      if (id === undefined || id === null) return null;
      return rpcError(id, -32601, `Method not found: ${method}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP endpoint — POST /api/mcp/:tenantId
//
// Accepts a single JSON-RPC message or a batch (array). Returns the matching
// response(s); notifications produce no response (204 if the whole payload was
// notifications).
// ─────────────────────────────────────────────────────────────────────────────

router.post("/:tenantId", async (req, res) => {
  const tenant = await loadTenant(req.params.tenantId);
  if (!tenant) {
    return res.status(404).json(rpcError(null, -32001, "tenant_not_found"));
  }

  const payload = req.body;

  try {
    if (Array.isArray(payload)) {
      const responses = [];
      for (const msg of payload) {
        const r = await handleRpc(msg, tenant, req);
        if (r !== null) responses.push(r);
      }
      if (responses.length === 0) return res.status(204).end();
      return res.json(responses);
    }

    if (payload && typeof payload === "object" && payload.jsonrpc) {
      const r = await handleRpc(payload, tenant, req);
      if (r === null) return res.status(204).end();
      return res.json(r);
    }

    return res.status(400).json(rpcError(null, -32600, "Invalid Request"));
  } catch (e) {
    console.error("[mcp] dispatch error tenant=%s: %s", tenant.id, e.message);
    const id = (payload && !Array.isArray(payload)) ? payload.id : null;
    return res.status(500).json(rpcError(id ?? null, -32603, "Internal error"));
  }
});

// A GET on the same path is handy for a quick "is it alive / what tools" probe
// and for clients that check the endpoint. Returns server info + tool names.
router.get("/:tenantId", async (req, res) => {
  const tenant = await loadTenant(req.params.tenantId);
  if (!tenant) return res.status(404).json({ ok: false, error: "tenant_not_found" });
  return res.json({
    ok: true,
    server: SERVER_INFO,
    protocolVersion: PROTOCOL_VERSION,
    tenant: { id: tenant.id, name: tenant.name },
    tools: TOOLS.map((t) => ({ name: t.name, description: t.description })),
  });
});

module.exports = router;
