"use strict";

/**
 * routes/estimateLink.js
 *
 * Hosted landing page for the SMS estimate link sent by the voice AI's
 * send_estimate_link tool. Phase E1 (May 4, 2026).
 *
 * Mobile fix May 15, 2026: added top:auto + transform:none resets to the
 * mobile media query. The desktop centering rules use `transform:
 * translate(-50%, -50%)` which the widget's own mobile CSS doesn't reset,
 * leaving the widget shifted half its width off the left side of the
 * viewport on phones. The two-property reset lets the widget's bottom-
 * anchored mobile layout take effect cleanly.
 */

const express = require("express");
const router  = express.Router();
const db      = require("../lib/db");

router.get("/q/:tenantId", async (req, res) => {
  const { tenantId } = req.params;
  const callId = req.query.call_id || null;

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

  const widgetScriptUrl = `${req.protocol}://${req.get("host")}/chat-widget.js`;

  console.log("[Estimate Link Page] Served tenant=%s call_id=%s", tenantId, callId || "(none)");

  res.set("Content-Type", "text/html; charset=utf-8");
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");

  res.send(renderEstimatePage({
    tenantId,
    companyName,
    brandColor,
    widgetScriptUrl,
    callId,
  }));
});

function renderEstimatePage({ tenantId, companyName, brandColor, widgetScriptUrl, callId }) {
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
       using its existing CSS. We MUST reset top + transform here because
       the widget's mobile CSS doesn't touch those properties — without
       these resets, the leftover translate(-50%, -50%) transform from
       our desktop override pulls the widget half-its-width off the left
       side of the viewport. Fix shipped May 15, 2026. */
    @media (max-width: 640px) {
      .header { display: none; }
      .wrapper { padding: 0; }
      #ai-chat-container {
        top: auto !important;
        transform: none !important;
      }
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

function escapeHtml(s) {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(s) {
  return escapeHtml(s);
}

module.exports = router;
