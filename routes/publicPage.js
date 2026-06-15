"use strict";

/**
 * routes/publicPage.js
 *
 * Phase 13.5 (Jun 12, 2026) — Public per-tenant booking + discoverability page.
 *
 * A server-rendered (SSR) public page per tenant:
 *     GET  /book/:slugOrId          → the HTML page (JSON-LD baked in)
 *     POST /book/:slugOrId/submit   → server-side booking handler (no exposed key)
 *
 * WHY SSR (the whole point):
 *   The page bakes schema.org JSON-LD (LocalBusiness + Service) into the INITIAL
 *   HTML, server-side. That's what makes a tenant machine-readable and ELIGIBLE
 *   to be surfaced by AI assistants / search that do web retrieval. A client-
 *   rendered SPA that injects markup after JS runs is far weaker — many crawlers
 *   don't execute JS. So this is a plain Express route returning real HTML.
 *
 *   IMPORTANT HONESTY: this makes a tenant bookable and ELIGIBLE to be found.
 *   It does NOT guarantee placement in any assistant's answers — that's the
 *   platform's retrieval/editorial call, same as a Google rank. We build the
 *   eligibility; we don't (can't) manufacture the placement.
 *
 * ESTIMATOR GATE (Drew's decision, Jun 12 — strict):
 *   The "instant online quote" capability — in BOTH the human copy AND the
 *   JSON-LD — only renders when:
 *       estimator_enabled AND (estimator_addon_active OR estimator_grandfathered)
 *   A tenant who's toggled off, or whose add-on lapsed, must not advertise a
 *   quote capability (no false advertising to crawlers, no dead links). Booking
 *   is unconditional; only the quote half is gated.
 *
 * KEY SAFETY (Drew's decision, Jun 12):
 *   The booking WRITE goes through POST /book/:slugOrId/submit, which runs
 *   SERVER-SIDE and calls bookingEngine.book() directly. The tenant api_key is
 *   NEVER sent to the browser. The public page can't carry the key (view-source
 *   would leak it), so instead of key-gating we use light anti-spam (honeypot +
 *   validation) — same shape as a normal public contact/booking form, and the
 *   same pattern the website widget already uses to book without exposing a key.
 *
 * AGENT/PUBLIC BOOKING = REAL BOOKING:
 *   submit calls bookingEngine.book() with source "public_page" — logged,
 *   briefing runs, nurture skipped (already converted), outcome chain preserved.
 */

const express = require("express");
const router = express.Router();

const bookingEngine = require("../lib/bookingEngine");
const db = require("../lib/db");

const DEFAULT_DURATION_MIN = 60;
const DAY_SCAN_HORIZON = 14;
const MAX_DAYS_SHOWN = 7;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function isValidEmail(text) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(text || "").trim());
}

// HTML-escape everything tenant-supplied before it goes into the page, so a
// tenant name/address with < > & " can't break the markup or inject anything.
function esc(text) {
  return String(text == null ? "" : text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// JSON for a <script type="application/ld+json"> block. We escape "<" to its
// unicode form to prevent any "</script>" in data from closing the tag early.
function ldJson(obj) {
  return JSON.stringify(obj, null, 2).replace(/</g, "\\u003c");
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

// Resolve a tenant by slug first, then by id. SELECT * so we tolerate whatever
// business-profile columns exist (address/phone/services vary); we read them
// defensively below and degrade gracefully when a field is absent.
async function loadTenantBySlugOrId(slugOrId) {
  if (!slugOrId) return null;
  try {
    let res = await db.query(`SELECT * FROM tenants WHERE slug = $1 LIMIT 1`, [slugOrId]);
    if (res.rows[0]) return res.rows[0];
    // Fallback to id (only attempt if it looks like a uuid, to avoid odd casts).
    if (/^[0-9a-f-]{36}$/i.test(slugOrId)) {
      res = await db.query(`SELECT * FROM tenants WHERE id = $1 LIMIT 1`, [slugOrId]);
      if (res.rows[0]) return res.rows[0];
    }
    return null;
  } catch (e) {
    console.error("[publicPage] loadTenant failed key=%s: %s", slugOrId, e.message);
    return null;
  }
}

// The strict estimator gate. Reads only booleans that exist on the row; any
// missing column reads as undefined → falsy, which fails safe (no quote shown).
function estimatorActive(tenant) {
  const enabled = tenant.estimator_enabled === true;
  const addonOk = tenant.estimator_addon_active === true || tenant.estimator_grandfathered === true;
  return enabled && addonOk;
}

// Pull a best-effort business profile from whatever columns exist on the row.
// Everything is optional; the page and JSON-LD omit absent fields rather than
// rendering empty/placeholder values.
function readProfile(tenant) {
  const pick = (...keys) => {
    for (const k of keys) {
      const v = tenant[k];
      // Only accept primitive string/number values; skip objects/arrays
      // (e.g. service_area stored as JSON) so we never render "[object Object]".
      if (v == null) continue;
      if (typeof v === "object") continue;
      if (String(v).trim() !== "") return String(v).trim();
    }
    return "";
  };
  return {
    name: pick("company_name", "name", "business_name") || "This Business",
    phone: pick("business_phone", "company_phone", "phone", "twilio_number", "phone_number"),
    email: pick("support_email", "business_email", "contact_email"),
    website: pick("website", "website_url", "company_website"),
    addressLine: pick("address", "business_address", "street_address"),
    city: pick("city", "business_city"),
    state: pick("state", "business_state"),
    postal: pick("zip", "postal_code", "business_zip"),
    serviceArea: pick("service_area", "service_area_text"),
    description: pick("business_description", "description", "tagline"),
    brandColor: pick("brand_color") || "#1f6feb",
    timezone: tenant.timezone || "America/Chicago",
  };
}

// Build the LocalBusiness (+ optional quote action / Service) JSON-LD.
function buildJsonLd(tenant, profile, pageUrl, quoteEnabled) {
  const ld = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    "name": profile.name,
    "url": pageUrl,
  };
  if (profile.description) ld.description = profile.description;
  if (profile.phone) ld.telephone = profile.phone;
  if (profile.email) ld.email = profile.email;

  if (profile.addressLine || profile.city || profile.state || profile.postal) {
    ld.address = {
      "@type": "PostalAddress",
      ...(profile.addressLine ? { streetAddress: profile.addressLine } : {}),
      ...(profile.city ? { addressLocality: profile.city } : {}),
      ...(profile.state ? { addressRegion: profile.state } : {}),
      ...(profile.postal ? { postalCode: profile.postal } : {}),
      addressCountry: "US",
    };
  }
  if (profile.serviceArea) ld.areaServed = profile.serviceArea;

  // Booking action — always present (every tenant is bookable).
  ld.potentialAction = [
    {
      "@type": "ReserveAction",
      "name": "Book an appointment",
      "target": {
        "@type": "EntryPoint",
        "urlTemplate": pageUrl,
        "actionPlatform": [
          "http://schema.org/DesktopWebPlatform",
          "http://schema.org/MobileWebPlatform",
        ],
      },
      "result": { "@type": "Reservation", "name": "Appointment" },
    },
  ];

  // Quote capability — ONLY when the estimator gate passes.
  if (quoteEnabled) {
    ld.makesOffer = {
      "@type": "Offer",
      "name": "Instant online quote",
      "description": "Get an instant estimate online in about a minute.",
    };
    ld.potentialAction.push({
      "@type": "Action",
      "name": "Get an instant online quote",
      "target": { "@type": "EntryPoint", "urlTemplate": pageUrl },
    });
  }

  return ld;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /book/:slugOrId  — the SSR page
// ─────────────────────────────────────────────────────────────────────────────

router.get("/:slugOrId", async (req, res) => {
  const tenant = await loadTenantBySlugOrId(req.params.slugOrId);
  if (!tenant) {
    return res.status(404).type("html").send(
      `<!doctype html><meta charset="utf-8"><title>Not found</title>
       <body style="font-family:system-ui;padding:40px"><h1>Page not found</h1>
       <p>We couldn't find that business.</p></body>`
    );
  }

  const profile = readProfile(tenant);
  const quoteEnabled = estimatorActive(tenant);
  const proto = req.get("x-forwarded-proto") || req.protocol || "https";
  const host = req.get("host");
  const slugOrId = tenant.slug || tenant.id;
  const pageUrl = `${proto}://${host}/book/${esc(slugOrId)}`;
  const submitUrl = `/book/${encodeURIComponent(slugOrId)}/submit`;
  const availUrl = `/api/v1/availability/${encodeURIComponent(tenant.id)}`;

  const jsonLd = ldJson(buildJsonLd(tenant, profile, pageUrl, quoteEnabled));

  const addrParts = [profile.addressLine, [profile.city, profile.state].filter(Boolean).join(", "), profile.postal]
    .filter(Boolean).join(" · ");

  // The quote block — rendered only when the estimator gate passes. Links to
  // the tenant's existing estimator widget rather than re-implementing it.
  const quoteSection = quoteEnabled ? `
      <section class="card">
        <h2>Get an instant quote</h2>
        <p>Want a ballpark price first? Get an instant estimate online — takes about a minute.</p>
        <a class="btn btn-secondary" href="/q/${encodeURIComponent(tenant.id)}">Get an instant quote</a>
      </section>` : "";

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(profile.name)} — Book an appointment${quoteEnabled ? " or get an instant quote" : ""}</title>
<meta name="description" content="${esc(profile.description || `Book an appointment with ${profile.name}${quoteEnabled ? ", or get an instant online quote" : ""}.`)}">
<link rel="canonical" href="${pageUrl}">
<meta property="og:title" content="${esc(profile.name)} — Book an appointment">
<meta property="og:type" content="business.business">
<meta property="og:url" content="${pageUrl}">
<script type="application/ld+json">
${jsonLd}
</script>
<style>
  :root { --ink:#14202b; --muted:#5b6b78; --line:#e4e9ee; --brand:${esc(profile.brandColor)}; --bg:#f6f8fa; }
  * { box-sizing: border-box; }
  body { margin:0; font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; color:var(--ink); background:var(--bg); }
  .wrap { max-width: 760px; margin: 0 auto; padding: 28px 18px 60px; }
  header.biz { padding: 8px 0 20px; }
  header.biz h1 { margin: 0 0 6px; font-size: 1.7rem; }
  header.biz .meta { color: var(--muted); font-size: .95rem; line-height:1.5; }
  .card { background:#fff; border:1px solid var(--line); border-radius:14px; padding:20px; margin:16px 0; }
  .card h2 { margin:0 0 10px; font-size:1.15rem; }
  label { display:block; font-size:.85rem; color:var(--muted); margin:12px 0 4px; }
  input, select { width:100%; padding:10px 12px; border:1px solid var(--line); border-radius:9px; font-size:1rem; }
  .row { display:flex; gap:12px; flex-wrap:wrap; }
  .row > div { flex:1 1 220px; }
  .btn { display:inline-block; border:0; border-radius:10px; padding:12px 18px; font-size:1rem; font-weight:600; cursor:pointer; text-decoration:none; }
  .btn-primary { background:var(--brand); color:#fff; }
  .btn-secondary { background:#eef3fb; color:var(--brand); }
  .slots { display:flex; flex-wrap:wrap; gap:8px; margin-top:8px; }
  .slot { padding:8px 12px; border:1px solid var(--line); border-radius:9px; background:#fff; cursor:pointer; font-size:.95rem; }
  .slot.sel { background:var(--brand); color:#fff; border-color:var(--brand); }
  .muted { color:var(--muted); font-size:.9rem; }
  .hide { display:none; }
  .ok { background:#e9f7ef; border:1px solid #b6e2c6; color:#1d6f42; padding:14px; border-radius:10px; }
  .err { background:#fdecec; border:1px solid #f3c0c0; color:#b3261e; padding:10px 12px; border-radius:9px; margin-top:10px; }
  footer { text-align:center; color:var(--muted); font-size:.8rem; margin-top:28px; }
  /* honeypot — hidden from humans, bots fill it */
  .hp { position:absolute; left:-9999px; width:1px; height:1px; overflow:hidden; }
</style>
</head>
<body>
<div class="wrap">
  <header class="biz">
    <h1>${esc(profile.name)}</h1>
    <div class="meta">
      ${profile.description ? esc(profile.description) + "<br>" : ""}
      ${addrParts ? esc(addrParts) + "<br>" : ""}
      ${profile.phone ? "📞 " + esc(profile.phone) : ""}
      ${profile.serviceArea ? " · Serving " + esc(profile.serviceArea) : ""}
    </div>
  </header>

  ${quoteSection}

  <section class="card" id="bookCard">
    <h2>Book an appointment</h2>
    <p class="muted">Pick a day, choose a time, and tell us where to come.</p>

    <label for="day">Day</label>
    <select id="day"><option value="">Loading available days…</option></select>

    <div id="slotWrap" class="hide">
      <label>Time</label>
      <div class="slots" id="slots"></div>
    </div>

    <div id="contactWrap" class="hide">
      <div class="row">
        <div><label for="name">Full name</label><input id="name" autocomplete="name"></div>
        <div><label for="phone">Phone</label><input id="phone" autocomplete="tel"></div>
      </div>
      <div class="row">
        <div><label for="email">Email</label><input id="email" autocomplete="email"></div>
        <div><label for="address">Service address</label><input id="address" autocomplete="street-address"></div>
      </div>
      <label for="details">Project details (optional)</label>
      <input id="details" placeholder="e.g. exterior repaint, ~2000 sq ft">
      <!-- honeypot -->
      <div class="hp"><label>Leave this blank</label><input id="company" tabindex="-1" autocomplete="off"></div>
      <div style="margin-top:16px"><button class="btn btn-primary" id="submitBtn">Confirm booking</button></div>
      <div id="formMsg"></div>
    </div>
  </section>

  <div id="successCard" class="card hide">
    <div class="ok"><strong>You're booked!</strong> <span id="okText"></span> We'll be in touch to confirm.</div>
  </div>

  <footer>Powered by AI Front Desk</footer>
</div>

<script>
(function(){
  var availUrl = ${JSON.stringify(availUrl)};
  var submitUrl = ${JSON.stringify(submitUrl)};
  var state = { date:null, time:null, days:[] };

  var daySel = document.getElementById("day");
  var slotWrap = document.getElementById("slotWrap");
  var slotsEl = document.getElementById("slots");
  var contactWrap = document.getElementById("contactWrap");
  var formMsg = document.getElementById("formMsg");

  function showErr(t){ formMsg.innerHTML = '<div class="err">'+t+'</div>'; }
  function clearErr(){ formMsg.innerHTML = ""; }

  // Load available days from the PUBLIC availability endpoint (no key needed).
  fetch(availUrl).then(function(r){ return r.json(); }).then(function(data){
    daySel.innerHTML = "";
    var days = (data && data.days) ? data.days : [];
    if (!days.length) {
      daySel.innerHTML = '<option value="">No openings in the next two weeks — call us</option>';
      return;
    }
    state.days = days;
    var ph = document.createElement("option");
    ph.value = ""; ph.textContent = "Select a day…";
    daySel.appendChild(ph);
    days.forEach(function(d){
      var o = document.createElement("option");
      o.value = d.date; o.textContent = formatDay(d.date);
      daySel.appendChild(o);
    });
  }).catch(function(){
    daySel.innerHTML = '<option value="">Could not load availability</option>';
  });

  function formatDay(iso){
    var p = iso.split("-");
    var dt = new Date(Date.UTC(+p[0], +p[1]-1, +p[2], 12));
    return dt.toLocaleDateString(undefined, { weekday:"short", month:"short", day:"numeric" });
  }

  daySel.addEventListener("change", function(){
    state.date = daySel.value; state.time = null;
    slotsEl.innerHTML = "";
    if (!state.date) { slotWrap.classList.add("hide"); contactWrap.classList.add("hide"); return; }
    var day = state.days.filter(function(d){ return d.date === state.date; })[0];
    var slots = day ? day.slots : [];
    slots.forEach(function(s){
      var b = document.createElement("button");
      b.type = "button"; b.className = "slot"; b.textContent = s.time;
      b.onclick = function(){
        state.time = s.value;
        Array.prototype.forEach.call(slotsEl.children, function(c){ c.classList.remove("sel"); });
        b.classList.add("sel");
        contactWrap.classList.remove("hide");
      };
      slotsEl.appendChild(b);
    });
    slotWrap.classList.remove("hide");
  });

  document.getElementById("submitBtn").addEventListener("click", function(){
    clearErr();
    var payload = {
      date: state.date, time: state.time,
      name: document.getElementById("name").value.trim(),
      phone: document.getElementById("phone").value.trim(),
      email: document.getElementById("email").value.trim(),
      address: document.getElementById("address").value.trim(),
      project_details: document.getElementById("details").value.trim(),
      company: document.getElementById("company").value  // honeypot
    };
    if (!payload.date || !payload.time) { showErr("Please pick a day and a time."); return; }
    if (!payload.name || !payload.phone) { showErr("Please enter your name and phone."); return; }
    if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(payload.email)) { showErr("Please enter a valid email."); return; }
    if (payload.address.length < 5) { showErr("Please enter your service address."); return; }

    var btn = this; btn.disabled = true; btn.textContent = "Booking…";
    fetch(submitUrl, {
      method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(payload)
    }).then(function(r){ return r.json().then(function(j){ return { status:r.status, body:j }; }); })
      .then(function(res){
        if (res.status === 200 && res.body && res.body.ok) {
          document.getElementById("bookCard").classList.add("hide");
          document.getElementById("okText").textContent =
            "Your appointment is set for " + formatDay(state.date) + ".";
          document.getElementById("successCard").classList.remove("hide");
        } else {
          var e = (res.body && res.body.error) || "booking_failed";
          if (e === "slot_taken") showErr("Sorry, that time was just taken. Please pick another.");
          else if (e === "validation_failed") showErr("Please check your details and try again.");
          else showErr("Something went wrong booking that time. Please try again or call us.");
          btn.disabled = false; btn.textContent = "Confirm booking";
        }
      }).catch(function(){
        showErr("Network error — please try again.");
        btn.disabled = false; btn.textContent = "Confirm booking";
      });
  });
})();
</script>
</body>
</html>`;

  res.status(200).type("html").send(html);
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /book/:slugOrId/submit  — server-side booking (no exposed key)
// ─────────────────────────────────────────────────────────────────────────────

router.post("/:slugOrId/submit", async (req, res) => {
  const tenant = await loadTenantBySlugOrId(req.params.slugOrId);
  if (!tenant) return res.status(404).json({ ok: false, error: "tenant_not_found" });

  const b = req.body || {};

  // Honeypot: a real human leaves "company" blank; a bot fills every field.
  if (b.company && String(b.company).trim() !== "") {
    console.warn("[publicPage] honeypot tripped tenant=%s", tenant.id);
    // Pretend success so bots don't learn the trap; nothing is booked.
    return res.json({ ok: true, booking_id: null, lead_id: null });
  }

  const date = (b.date || "").trim();
  const time = (b.time || "").toString().trim();
  const errors = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) errors.push("date");
  if (!time) errors.push("time");
  if (!b.name || !String(b.name).trim()) errors.push("name");
  if (!b.phone || !String(b.phone).trim()) errors.push("phone");
  if (!isValidEmail(b.email)) errors.push("email");
  if (!b.address || String(b.address).trim().length < 5) errors.push("address");
  if (errors.length) {
    return res.status(422).json({ ok: false, error: "validation_failed", fields: errors });
  }

  let result;
  try {
    result = await bookingEngine.book({
      tenantId: tenant.id,
      date,
      time,
      durationMinutes: DEFAULT_DURATION_MIN,
      contact: {
        name: String(b.name).slice(0, 120),
        phone: String(b.phone).trim(),
        email: String(b.email).trim(),
        address: String(b.address).slice(0, 240),
      },
      projectType: b.project_type || "",
      projectDetails: b.project_details || "",
      leadId: null,
      source: "public_page",
    });
  } catch (e) {
    console.error("[publicPage] engine.book threw tenant=%s: %s", tenant.id, e.message);
    return res.status(502).json({ ok: false, error: "booking_failed" });
  }

  if (!result || !result.ok) {
    const reason = result?.reason || "booking_failed";
    const code = reason === "slot_taken" ? 409
               : (reason === "day_closed" || reason === "outside_business_hours" || reason === "invalid_datetime") ? 422
               : 502;
    console.warn("[publicPage] booking rejected tenant=%s reason=%s", tenant.id, reason);
    return res.status(code).json({ ok: false, error: reason });
  }

  console.log("[publicPage] BOOKED via public page tenant=%s bookingId=%s date=%s time=%s",
    tenant.id, result.bookingId, date, time);
  return res.json({ ok: true, booking_id: result.bookingId, lead_id: result.leadId });
});

module.exports = router;
