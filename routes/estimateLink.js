"use strict";

/**
 * routes/estimateLink.js
 *
 * Hosted landing page for the SMS estimate link sent by the voice AI's
 * send_estimate_link tool. Phase E1 (May 4, 2026).
 *
 * Flow:
 *   1. Caller asks for a price quote on a phone call.
 *   2. AI (after confirming the cell number) calls send_estimate_link.
 *   3. Backend builds URL: https://<host>/q/<tenantId>?call_id=<callId>
 *   4. SMS goes out: "Tap to get your free instant estimate: <link>"
 *   5. Customer taps link → lands here.
 *   6. We render a minimal page that loads chat-widget.js with auto-open
 *      + auto-start-estimator flags via window.__aiWidgetAutoStart. The
 *      widget reads that object (and ?call_id=) for attribution back to
 *      the originating phone call, then forwards source_call_id on lead
 *      capture.
 *
 * Why a backend-hosted page (Option A) instead of redirecting to the
 * tenant's website (Option B): works universally regardless of whether
 * the tenant has the widget embedded on their site, and doesn't depend
 * on a website_url column being populated. Drew picked A as the MVP
 * (May 4, 2026).
 *
 * The page is intentionally minimal — branding comes from the widget
 * itself once it loads (company_name, brand_color, logo_url all pulled
 * from /api/public-tenant/<id>). We only need the company name in the
 * <title> and as a static header for SEO/sharing previews.
 *
 * The widget's contract (chat-widget.js, May 4, 2026):
 *
 *   window.__aiWidgetAutoStart = {
 *     openChat: true,        // open the chat panel automatically
 *     startEstimator: true,  // trigger startEstimatorFlow() after open
 *     callId: "<uuid>"       // optional — for source_call_id attribution
 *   };
 *
 * This must be set BEFORE the chat-widget.js script tag so the module
 * picks it up at IIFE time. We render it inline above the script tag.
 */

const express = require("express");
const router  = express.Router();
const db      = require("../lib/db");

/**
 * GET /q/:tenantId?call_id=<uuid>
 *
 * Returns a self-contained HTML page that loads chat-widget.js with
 * auto-open + auto-start-estimator flags. Validates that the tenant
 * exists and has estimator_enabled=true.
 *
 * Status codes:
 *   200 — valid tenant, estimator enabled, page rendered
 *   404 — tenant not found OR estimator not enabled
 *   500 — DB error
 */
router.get("/q/:tenantId", async (req, res) => {
  const { tenantId } = req.params;
  const callId = req.query.call_id || null;

  // Reject obviously malformed tenant IDs early. Real tenant IDs are
  // UUIDs — the loose regex catches typos and prevents a DB hit on junk.
  if (!/^[0-9a-f-]{32,36}$/i.test(tenantId)) {
    return res.status(404).type("html").send(renderErrorPage("Estimator not found"));
  }

  let tenant;
  try {
    const result = await db.query(
      `SELECT id, company_name, name, brand_color, estimator_enabled
         FROM tenants
        WHERE id = $1
        LIMIT 1`,
      [tenantId]
    );
    tenant = result.rows[0];
  } catch (e) {
    console.error("[Estimate Link Page] DB error tenantId=%s err=%s", tenantId, e.message);
    return res.status(500).type("html").send(renderErrorPage("Something went wrong on our end"));
  }

  if (!tenant) {
    console.log("[Estimate Link Page] Tenant not found id=%s", tenantId);
    return res.status(404).type("html").send(renderErrorPage("Estimator not found"));
  }

  if (!tenant.estimator_enabled) {
    console.log("[Estimate Link Page] Estimator not enabled for tenant=%s", tenantId);
    return res.status(404).type("html").send(renderErrorPage("This estimator isn't set up yet"));
  }

  const companyName = tenant.company_name || tenant.name || "Your Contractor";
  const brandColor  = tenant.brand_color  || "#E8702A";

  // Build the widget script URL from the current request. req.protocol
  // respects X-Forwarded-Proto when app.set("trust proxy", true) is set
  // in server.js (Render needs this; default is true in our app).
  const widgetScriptUrl = `${req.protocol}://${req.get("host")}/chat-widget.js`;

  console.log("[Estimate Link Page] Served tenant=%s call_id=%s", tenantId, callId || "(none)");

  res.set("Content-Type", "text/html; charset=utf-8");
  // Don't cache — the widget script may change tenant config dynamically
  // and we want the freshest data each visit.
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");

  res.send(renderEstimatePage({
    tenantId,
    companyName,
    brandColor,
    widgetScriptUrl,
    callId,
  }));
});

// ─────────────────────────────────────────────────────────────────────
// HTML renderers
// ─────────────────────────────────────────────────────────────────────

function renderEstimatePage({ tenantId, companyName, brandColor, widgetScriptUrl, callId }) {
  // Keep the page lean — heavy lifting is in chat-widget.js. We:
  //   - set the <title> for SEO + sharing previews
  //   - render a centered loading state while the widget initializes
  //   - hide the widget's toggle button + callout (we auto-open)
  //   - reposition + resize the widget container to feel like a full app
  //   - on mobile, hide the static header and let the widget go fullscreen
  //   - set window.__aiWidgetAutoStart BEFORE the script loads
  //
  // We embed the autostart hint as a JSON literal — JSON.stringify
  // produces safe JS for any string inputs and avoids template-string
  // escaping issues with single quotes / newlines / Unicode in callId.
  const autoStartJson = JSON.stringify({
    openChat: true,
    startEstimator: true,
    ...(callId ? { callId } : {}),
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <meta name="robots" content="noindex, nofollow">
  <meta name="theme-color" content="${escapeAttr(brandColor)}">
  <title>Free Estimate · ${escapeHtml(companyName)}</title>
  <link rel="icon" href="data:," />
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      background: linear-gradient(135deg, #f5f7fa 0%, #e6ebf2 100%);
      min-height: 100vh;
      min-height: 100dvh;
      color: #1a1a1a;
      -webkit-font-smoothing: antialiased;
    }
    .wrapper {
      min-height: 100vh;
      min-height: 100dvh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 24px 16px;
    }
    .header {
      text-align: center;
      max-width: 480px;
      margin-bottom: 24px;
      animation: fadeIn 0.5s ease-out;
    }
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .header h1 {
      font-size: 26px;
      margin: 0 0 10px 0;
      font-weight: 800;
      letter-spacing: -0.5px;
      line-height: 1.2;
    }
    .brand-name {
      color: ${escapeAttr(brandColor)};
    }
    .header p {
      font-size: 15px;
      color: #555;
      margin: 0 0 12px 0;
      line-height: 1.5;
    }
    .loader {
      display: inline-block;
      width: 32px;
      height: 32px;
      border: 3px solid rgba(0,0,0,0.08);
      border-top-color: ${escapeAttr(brandColor)};
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      margin-top: 8px;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    /* Widget overrides — make it the centerpiece on desktop, hide toggle */
    #ai-chat-toggle, #ai-chat-callout {
      display: none !important;
    }
    #ai-chat-container {
      bottom: auto !important;
      right: auto !important;
      top: 50% !important;
      left: 50% !important;
      transform: translate(-50%, -50%) !important;
      width: min(440px, calc(100vw - 32px)) !important;
      height: min(680px, calc(100vh - 32px)) !important;
      height: min(680px, calc(100dvh - 32px)) !important;
      box-shadow: 0 25px 80px rgba(0,0,0,0.25) !important;
    }

    /* On mobile, hide the static header and let the widget go fullscreen
       using its existing CSS. The widget's mobile media query uses
       !important so it'll override our desktop overrides above. */
    @media (max-width: 640px) {
      .header { display: none; }
      .wrapper { padding: 0; }
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <h1>Free Estimate · <span class="brand-name">${escapeHtml(companyName)}</span></h1>
      <p>Answer a few quick questions to get an instant ballpark range.<br>Takes about 60 seconds.</p>
      <div class="loader" aria-hidden="true"></div>
    </div>
  </div>

  <script>
    // Phase E1 (May 4, 2026): tell chat-widget.js to auto-open + auto-start
    // the estimator on this hosted landing page. The widget reads this
    // object at IIFE time, so it MUST be set before the script tag below.
    // The widget also reads ?call_id=... from the URL as a fallback, but
    // we set callId here too so the URL stays clean.
    window.__aiWidgetAutoStart = ${autoStartJson};
  </script>
  <script src="${escapeAttr(widgetScriptUrl)}" data-tenant-id="${escapeAttr(tenantId)}"></script>
</body>
</html>`;
}

function renderErrorPage(message) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="noindex">
  <title>Not Found</title>
  <style>
    body {
      margin: 0;
      padding: 60px 24px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      text-align: center;
      color: #444;
      background: #f9f9fb;
      min-height: 100vh;
      box-sizing: border-box;
    }
    h1 { color: #1a1a1a; margin: 0 0 12px 0; font-size: 26px; }
    p  { font-size: 15px; line-height: 1.5; max-width: 380px; margin: 0 auto 12px auto; }
  </style>
</head>
<body>
  <h1>Hmm</h1>
  <p>${escapeHtml(message)}.</p>
  <p>Please give us a call directly to get your estimate.</p>
</body>
</html>`;
}

// HTML-escape a string for use as text content. Used on company_name
// and any other tenant-supplied data to prevent stored XSS in the
// hosted page.
function escapeHtml(s) {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// HTML-escape a string for use inside a quoted attribute. Slightly more
// permissive than escapeHtml — only need to escape what would break out
// of a "..." attribute. We use the same helper for safety.
function escapeAttr(s) {
  return escapeHtml(s);
}

module.exports = router;
