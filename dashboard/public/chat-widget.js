(function () {
  // Guard against double initialization
  if (window.__aiChatWidgetLoaded) return;
  window.__aiChatWidgetLoaded = true;

  console.log("[AI-Widget] Script initializing...");

  // ── Script tag detection ──────────────────────────────────────────────────
  let scriptTag = document.currentScript;
  if (!scriptTag) {
    const scripts = document.getElementsByTagName("script");
    for (let i = 0; i < scripts.length; i++) {
      if (scripts[i].src && scripts[i].src.includes("chat-widget.js")) {
        scriptTag = scripts[i];
        break;
      }
    }
  }

  const tenantId  = scriptTag ? scriptTag.getAttribute("data-tenant-id") : null;
  const scriptUrl = scriptTag ? new URL(scriptTag.src) : null;
  const apiBase   = scriptUrl ? scriptUrl.origin : "https://ai-front-desk-backend.onrender.com";

  console.log("[AI-Widget] Context:", { tenantId, apiBase });

  let sessionId = localStorage.getItem("ai_session_id");
  if (!sessionId) {
    sessionId = "web-" + (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2));
    localStorage.setItem("ai_session_id", sessionId);
  }

  // ── Voice → estimator attribution (Phase 7 V2 — May 4, 2026) ──────────────
  // When the customer arrives via an SMS link from a phone call (sent by the
  // AI's send_estimate_link tool), the wrapper page at /q/:tenantId injects
  // window.__aiWidgetAutoStart with a callId. We capture it here at module
  // scope so it survives estimator state resets, and pass it through to
  // /api/estimator/lead in estimator_payload.source_call_id when the lead
  // is captured. Drew can later report on the "voice → estimate → booking"
  // funnel by joining on this id.
  //
  // We accept the callId from two sources, in priority order:
  //   1. window.__aiWidgetAutoStart.callId (set by the wrapper page)
  //   2. ?call_id=... query param (fallback for direct deep links)
  let sourceCallId = null;
  try {
    if (window.__aiWidgetAutoStart && typeof window.__aiWidgetAutoStart.callId === "string") {
      sourceCallId = window.__aiWidgetAutoStart.callId;
    } else {
      const urlParams = new URLSearchParams(window.location.search);
      const cid = urlParams.get("call_id");
      // Defensive: cap length to avoid pathological values in the URL
      if (cid && cid.length > 0 && cid.length < 100) sourceCallId = cid;
    }
  } catch (e) {
    // URLSearchParams not supported in very old browsers — silently skip
  }
  if (sourceCallId) {
    console.log("[AI-Widget] Source call ID detected:", sourceCallId);
  }

  // ── Branding defaults (overridden by tenant config) ───────────────────────
  let companyName        = "Front Desk";
  let welcomeMessage     = "Hi there 👋 Need a quick estimate or have a question? I can help you schedule in seconds.";
  let brandColor         = "#E8600A";   // Default orange — overridden per tenant
  let twilioPhoneNumber  = null;
  let logoUrl            = null;
  let hasWelcomed        = false;
  let isOpen             = false;
   let hasShownHandoffNotice = false;  // Phase 8.2a — show "team member will follow up" only once per session

  // ── Phase 8.3 (May 12, 2026) — polling state for owner-sent website messages
  // pollInterval is set when chat opens and cleared when it closes.
  // pollSinceIso advances after each successful poll so we don't re-render
  // the same owner message twice. Initialized to chat-open time, so the
  // customer only sees owner messages sent AFTER they opened the widget.
  // Known V1 limitation: if owner sent a message while the widget was
  // closed, customer won't see it on reopen until owner sends another.
  let pollInterval       = null;
  let pollSinceIso       = null;

   // ── What's included by service (Phase 7 V1.5 — May 5, 2026) ──────────────
  // Migration 051 moved this to vertical_services.includes_text. Helper now
  // reads from estimatorConfig (loaded via /tenant-config) so painters with
  // custom includes text see it, and V2 verticals (roof, fence) can ship
  // their own without code changes.
  function getIncludesText(serviceSlug) {
    if (!serviceSlug || serviceSlug === "specialized") return null;
    if (!estimatorConfig || !Array.isArray(estimatorConfig.services)) return null;
    const svc = estimatorConfig.services.find(s => s.service_slug === serviceSlug);
    return svc?.includes_text || null;
  }

  // ── Phase 7 V2 (May 12, 2026) — Trade-aware helpers for mega-verticals ────
  //
  // The home_exterior mega-vertical (Paragon, vertical_id=6) groups 20
  // services across 4 trades. We need two pieces of trade logic:
  //
  //   1. Service → Trade mapping for the QUESTION filter — questions in the
  //      DB are tagged at the TRADE level (service_slug='roofing' applies
  //      to all 5 roofing service variants), not per-specific-service.
  //
  //   2. Trade-first picker UX — instead of showing all 20 services in one
  //      flat list, show 4 trade buttons first, then drill into specific
  //      service options for that trade.
  //
  // Service slug conventions (Phase 7):
  //   - Roofing services use bare slugs:  asphalt, metal, tile, slate, flat_epdm
  //   - Siding services prefixed:         siding_*
  //   - Fence services prefixed:          fence_*
  //   - Gutter services prefixed:         gutter_*
  //   - Painting (single-vertical):       interior, exterior, cabinets, deck_fence
  //
  // For single-trade verticals (Gladiators painting, standalone roofing),
  // getTradeForService returns null on painting slugs, and isMegaVertical()
  // returns false — so the original flat picker + exact-match question
  // filter take over with zero regression.
  const ROOFING_BARE_SLUGS = new Set(["asphalt_shingle", "metal_standing_seam", "tile", "slate", "flat_epdm"]);
  const TRADE_DISPLAY = {
    roofing: { name: "Roofing", icon: "🏠",  subPrompt: "Which roofing material?" },
    siding:  { name: "Siding",  icon: "🏘️",  subPrompt: "Which siding type?"      },
    fence:   { name: "Fence",   icon: "🚧",  subPrompt: "Which fence type?"       },
    gutters: { name: "Gutters", icon: "💧",  subPrompt: "Which gutter type?"      },
  };
  const TRADE_ORDER = ["roofing", "siding", "fence", "gutters"];

  function getTradeForService(serviceSlug) {
    if (!serviceSlug || typeof serviceSlug !== "string") return null;
    if (serviceSlug.startsWith("siding_")) return "siding";
    if (serviceSlug.startsWith("fence_"))  return "fence";
    if (serviceSlug.startsWith("gutter_")) return "gutters";
    if (ROOFING_BARE_SLUGS.has(serviceSlug)) return "roofing";
    return null;  // painting + unknowns
  }

  // Returns the list of distinct trades present in the current tenant's
  // estimatorConfig.services (ordered by TRADE_ORDER for stable UI). Used
  // by isMegaVertical() and renderTradePicker() to decide what to show.
  function getTradesInVertical() {
    if (!estimatorConfig || !Array.isArray(estimatorConfig.services)) return [];
    const tradeSet = new Set();
    estimatorConfig.services.forEach(s => {
      if (s.is_specialized) return;
      const trade = getTradeForService(s.service_slug);
      if (trade) tradeSet.add(trade);
    });
    return TRADE_ORDER.filter(t => tradeSet.has(t));
  }

  function isMegaVertical() {
    return getTradesInVertical().length >= 2;
  }

  // ── Estimator state (Phase 7 V1 — May 2, 2026) ────────────────────────────
  // Inline estimator flow rendered as chat messages. Triggered by the
  // "💰 Quick Quote" button pinned above the input area. Coexists with
  // normal Alex chat — if user types mid-flow, Alex responds normally and
  // estimator state pauses (can be resumed by tapping a previous card).
  let estimatorEnabled   = false;        // From /api/estimator/tenant-config
  let estimatorConfig    = null;         // services + questions + options
  let estimatorActive    = false;        // True when in mid-flow
  const estimatorState = {
    service_slug: null,
    inputs: {},
    rooms: [],
    _roomSize: "medium",
    quote_result: null,
    contact: { name: "", phone: "", email: "", address: "" },
    _step: null,   // Tracks which question we're currently rendering
    eventLog: []   // Phase 7 V1.5: buffered events for /log-events POST
  };

  // Helper: push an event into the log buffer with timestamp.
  // Buffered until lead is captured, then POSTed in batch.
  function logEstimatorEvent(eventType, content) {
    estimatorState.eventLog.push({
      event_type: eventType,
      content: content,
      timestamp: new Date().toISOString()
    });
  }

  // ── Mobile detection ──────────────────────────────────────────────────────
  const MOBILE_BP = 640;
  function isMobile() {
    return window.innerWidth <= MOBILE_BP;
  }

  // ── Helper: lighten a hex color for hover states ──────────────────────────
  function lightenColor(hex, amount) {
    try {
      const num = parseInt(hex.replace("#", ""), 16);
      const r   = Math.min(255, (num >> 16) + amount);
      const g   = Math.min(255, ((num >> 8) & 0xff) + amount);
      const b   = Math.min(255, (num & 0xff) + amount);
      return "#" + ((r << 16) | (g << 8) | b).toString(16).padStart(6, "0");
    } catch { return hex; }
  }

  function formatCents(cents) {
    return "$" + Math.round(cents / 100).toLocaleString();
  }

  // ── Visitor tracking ───────────────────────────────────────────────────────
  async function trackVisitor(eventType, extra = {}) {
    try {
      await fetch(`${apiBase}/visitor-event`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId, sessionId, event: eventType, url: window.location.href, timestamp: new Date().toISOString(), ...extra })
      });
    } catch (err) { console.warn("[AI Widget] Tracking failed:", err); }
  }

  // ── CRM lead capture ──────────────────────────────────────────────────────
  async function sendLeadToCRM(lead) {
    try {
      await fetch(`${apiBase}/lead-capture`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId, sessionId, lead })
      });
    } catch (err) { console.warn("[AI Widget] Lead capture failed:", err); }
  }

  // ── Phase 8.3 (May 12, 2026) — poll for owner-sent messages ──────────────
  //
  // pollOwnerMessages and startPolling/stopPolling are module-scope so the
  // openChat/closeChat handlers below can drive them. Renders new messages
  // by directly invoking the addMsg function exposed onto window by createUI
  // (set in createUI right after addMsg is defined).
  //
  // Failures are silent — polling continues until chat closes. We don't
  // want a transient network blip to surface a UI error.
  async function pollOwnerMessages() {
    if (!tenantId || !sessionId) return;
    try {
      const url = `${apiBase}/api/widget/poll-messages?tenantId=${encodeURIComponent(tenantId)}&sessionId=${encodeURIComponent(sessionId)}&since=${encodeURIComponent(pollSinceIso)}`;
      const res = await fetch(url);
      if (!res.ok) return;
      const data = await res.json();
      const messages = Array.isArray(data?.messages) ? data.messages : [];
      if (messages.length === 0) return;

      // Render each new message as an assistant-style bubble. The customer
      // doesn't need to know which messages came from the AI vs. an actual
      // human — both come from "the company."
      const addMsg = window.__aiWidgetAddMsg;
      if (typeof addMsg === "function") {
        messages.forEach((m) => {
          addMsg(m.body, false);
          if (m.created_at && m.created_at > pollSinceIso) {
            pollSinceIso = m.created_at;
          }
        });
      }
    } catch (err) {
      console.warn("[AI-Widget] Poll failed:", err.message);
    }
  }

  function startPolling() {
    if (pollInterval) return;
    pollSinceIso = new Date().toISOString();
    pollInterval = setInterval(pollOwnerMessages, 5000);
    console.log("[AI-Widget] Owner-message polling started (5s)");
  }

  function stopPolling() {
    if (!pollInterval) return;
    clearInterval(pollInterval);
    pollInterval = null;
    console.log("[AI-Widget] Owner-message polling stopped");
  }

  // ── Init: fetch tenant branding + estimator config in parallel ────────────
  async function initWidget() {
    if (!tenantId) {
      console.error("[AI-Widget] No tenantId found. Script tag must have data-tenant-id attribute.");
      return;
    }
    trackVisitor("widget_loaded", sourceCallId ? { source_call_id: sourceCallId } : {});

    try {
      console.log("[AI-Widget] Fetching configuration...");
      const [brandingRes, estimatorRes] = await Promise.all([
        fetch(`${apiBase}/api/public-tenant/${tenantId}`).then(r => r.ok ? r.json() : null),
        fetch(`${apiBase}/api/estimator/tenant-config/${tenantId}`).then(r => r.ok ? r.json() : null)
      ]);

      if (brandingRes) {
        if (brandingRes.company_name || brandingRes.name) companyName = brandingRes.company_name || brandingRes.name;
        if (brandingRes.chat_welcome_message)              welcomeMessage = brandingRes.chat_welcome_message;
        else if (brandingRes.welcome_message)              welcomeMessage = brandingRes.welcome_message;
        if (brandingRes.brand_color)                        brandColor = brandingRes.brand_color;
        if (brandingRes.logo_url)                           logoUrl    = brandingRes.logo_url;
        if (brandingRes.twilio_phone_number)                twilioPhoneNumber = brandingRes.twilio_phone_number;
        console.log("[AI-Widget] Loaded config for:", companyName, "| color:", brandColor);
      } else {
        console.warn("[AI-Widget] Failed to load config, using defaults.");
      }

      if (estimatorRes) {
        estimatorConfig = estimatorRes;
        estimatorEnabled = true;
        console.log("[AI-Widget] Estimator enabled. Services:", estimatorConfig.services?.length || 0);
      } else {
        console.log("[AI-Widget] Estimator not enabled for this tenant.");
      }
    } catch (err) {
      console.error("[AI-Widget] Init error:", err);
    }
  }

  // ── Build the UI ──────────────────────────────────────────────────────────
  function createUI() {
    if (!document.body) {
      setTimeout(createUI, 50);
      return;
    }
    console.log("[AI-Widget] Creating UI...");

    // ── Defensive: ensure a viewport meta tag exists ───────────────────────
    // If a host page embedding the widget didn't include one, mobile
    // browsers render at a "desktop" width (~980px) and our mobile CSS
    // media queries (@media max-width:640px) never fire. Defense-in-depth
    // for third-party contractor sites — our own /q/:tenantId wrapper
    // already includes the meta tag. Added May 15, 2026.
    if (!document.querySelector('meta[name="viewport"]')) {
      const vp = document.createElement("meta");
      vp.name = "viewport";
      vp.content = "width=device-width, initial-scale=1, maximum-scale=1";
      document.head.appendChild(vp);
      console.log("[AI-Widget] Injected missing viewport meta tag");
    }

    const hoverColor = lightenColor(brandColor, 20);

    const style = document.createElement("style");
    style.innerHTML = `
      @keyframes ai-fadeIn   { from { opacity:0; transform:translateY(5px); } to { opacity:1; transform:translateY(0); } }
      @keyframes ai-slideIn  { from { transform:translateX(100px); opacity:0; } to { transform:translateX(0); opacity:1; } }
      @keyframes ai-pulse    { 0%,100%{transform:scale(1);box-shadow:0 4px 15px rgba(0,0,0,.2)} 50%{transform:scale(1.05);box-shadow:0 6px 20px rgba(0,0,0,.3)} }
      @keyframes ai-bounce   { 0%,20%,50%,80%,100%{transform:translateY(0)} 40%{transform:translateY(-5px)} 60%{transform:translateY(-3px)} }
      @keyframes ai-dotPulse { 0%,80%,100%{transform:scale(0)} 40%{transform:scale(1)} }
      .ai-chat-bubble { animation: ai-fadeIn 0.3s ease; }
      .ai-pulse-anim  { animation: ai-pulse 2s infinite ease-in-out; }
      .ai-slide-in    { animation: ai-slideIn 0.8s cubic-bezier(0.16,1,0.3,1); }
      .ai-typing-dot  { display:inline-block; width:7px; height:7px; border-radius:50%; background:#aaa; margin:0 2px; animation:ai-dotPulse 1.4s infinite ease-in-out; }
      .ai-typing-dot:nth-child(2) { animation-delay:0.2s; }
      .ai-typing-dot:nth-child(3) { animation-delay:0.4s; }
      #ai-chat-toggle:hover { opacity:0.9; transform:scale(1.05) !important; }

      /* Estimator inline UI elements */
      .ai-est-card-btn {
        display: block; width: 100%; padding: 10px 12px;
        margin: 4px 0; background: #fff; border: 1.5px solid #e0e0e0;
        border-radius: 10px; cursor: pointer; text-align: left;
        font-family: inherit; font-size: 13px; color: #222;
        transition: all 0.15s; font-weight: 500;
      }
      .ai-est-card-btn:hover { border-color: ${brandColor}; background: ${brandColor}08; }
      .ai-est-card-btn.selected { border-color: ${brandColor}; background: ${brandColor}15; }
      .ai-est-card-btn:disabled { opacity: 0.5; cursor: not-allowed; }

      .ai-est-input {
        width: 100%; padding: 9px 12px; border: 1.5px solid #e0e0e0;
        border-radius: 8px; font-size: 14px; outline: none;
        font-family: inherit; box-sizing: border-box; background: #fff;
        transition: border-color 0.15s;
      }
      .ai-est-input:focus { border-color: ${brandColor}; }

      .ai-est-counter-row {
        display: flex; align-items: center; gap: 8px;
        padding: 6px 8px; border-radius: 6px; background: #fafafa;
        border: 1px solid #eee; margin: 3px 0;
      }
      .ai-est-counter-btn {
        width: 26px; height: 26px; border: 1px solid #ddd;
        background: #fff; border-radius: 5px; cursor: pointer;
        font-size: 14px; font-family: inherit;
        display: flex; align-items: center; justify-content: center;
      }

      /* Mobile-specific rules (≤640px) */
      @media (max-width: 640px) {
        #ai-chat-container {
          width: calc(100vw - 16px) !important;
          max-width: calc(100vw - 16px) !important;
          height: calc(100vh - 16px) !important;
          height: calc(100dvh - 16px) !important;
          right: 8px !important;
          left: 8px !important;
          bottom: 8px !important;
          border-radius: 14px !important;
        }
        #ai-chat-toggle {
          width: 56px !important;
          height: 56px !important;
          padding: 0 !important;
          border-radius: 50% !important;
          font-size: 24px !important;
          bottom: 20px !important;
          right: 20px !important;
          display: flex !important;
          align-items: center !important;
          justify-content: center !important;
        }
        #ai-chat-callout {
          display: none !important;
        }
        #ai-sms-modal {
          position: fixed !important;
          top: 0 !important; left: 0 !important;
          width: 100vw !important; height: 100vh !important;
          height: 100dvh !important;
        }
      }
    `;
    document.head.appendChild(style);

    // ── Toggle Button ────────────────────────────────────────────────────────
    const toggle = document.createElement("div");
    toggle.id = "ai-chat-toggle";
    toggle.className = "ai-slide-in";
    Object.assign(toggle.style, {
      position: "fixed", bottom: "30px", right: "30px",
      background: brandColor,
      color: "#fff", padding: "13px 24px",
      borderRadius: "30px", cursor: "pointer", zIndex: "2147483647",
      fontFamily: "'Inter', Arial, sans-serif",
      boxShadow: `0 4px 20px ${brandColor}55`,
      transition: "all 0.3s cubic-bezier(0.4,0,0.2,1)",
      fontWeight: "bold", fontSize: "15px", letterSpacing: "0.3px"
    });
    document.body.appendChild(toggle);

    // ── Callout bubble ───────────────────────────────────────────────────────
    // Phase 7: switched copy from "Need a quick quote?" to estimator-aware
    // language when estimator is enabled. Otherwise keeps original copy.
    const callout = document.createElement("div");
    callout.id = "ai-chat-callout";
    callout.innerHTML = estimatorEnabled
      ? `💰 Get a quick quote!`
      : `👋 Need a quick quote?`;
    Object.assign(callout.style, {
      position: "fixed", bottom: "95px", right: "30px",
      background: "#fff", color: "#111", padding: "10px 32px 10px 16px",
      borderRadius: "12px", boxShadow: "0 5px 25px rgba(0,0,0,0.15)",
      zIndex: "2147483646", fontFamily: "'Inter', Arial, sans-serif",
      fontSize: "14px", fontWeight: "500", display: "none",
      opacity: "0", transform: "translateY(10px)",
      transition: "all 0.4s cubic-bezier(0.4,0,0.2,1)",
      border: "1px solid #eee",
      cursor: "pointer"
    });
    callout.onclick = () => { if (!isOpen) openChat(); };
    document.body.appendChild(callout);

    const calloutArrow = document.createElement("div");
    Object.assign(calloutArrow.style, {
      position: "absolute", bottom: "-8px", right: "20px",
      width: "0", height: "0", borderLeft: "8px solid transparent",
      borderRight: "8px solid transparent", borderTop: "8px solid #fff"
    });
    callout.appendChild(calloutArrow);

    const calloutClose = document.createElement("button");
    calloutClose.innerHTML = "&#10005;";
    calloutClose.type = "button";
    Object.assign(calloutClose.style, {
      position: "absolute", top: "4px", right: "6px",
      background: "none", border: "none", cursor: "pointer",
      fontSize: "11px", color: "#aaa", padding: "2px 4px", lineHeight: "1"
    });
    calloutClose.onclick = (e) => { e.stopPropagation(); hideCallout(); };
    callout.appendChild(calloutClose);

    function showCallout() {
      if (isOpen || isMobile()) return;
      callout.style.display = "block";
      setTimeout(() => { callout.style.opacity = "1"; callout.style.transform = "translateY(0)"; }, 100);
    }
    function hideCallout() {
      callout.style.opacity = "0";
      callout.style.transform = "translateY(10px)";
      setTimeout(() => { callout.style.display = "none"; }, 400);
    }

    setTimeout(showCallout, 5000);
    setTimeout(() => { if (!isOpen) toggle.classList.add("ai-pulse-anim"); }, 10000);

    // ── Chat container ───────────────────────────────────────────────────────
    const container = document.createElement("div");
    container.id = "ai-chat-container";
    Object.assign(container.style, {
      position: "fixed", bottom: "100px", right: "30px",
      width: "380px", height: "540px", background: "#fff",
      border: "1px solid #eee", borderRadius: "18px",
      boxShadow: "0 15px 50px rgba(0,0,0,0.15)", display: "none",
      flexDirection: "column", zIndex: "2147483647", overflow: "hidden",
      fontFamily: "'Inter', Arial, sans-serif", opacity: "0",
      transform: "translateY(10px)",
      transition: "all 0.4s cubic-bezier(0.4,0,0.2,1)"
    });
    document.body.appendChild(container);

    // ── Header ───────────────────────────────────────────────────────────────
    const header = document.createElement("div");
    Object.assign(header.style, {
      background: brandColor,
      color: "#fff", padding: "14px 16px",
      display: "flex", alignItems: "center", justifyContent: "space-between",
      gap: "10px", flexShrink: "0"
    });

    const avatar = document.createElement("div");
    if (logoUrl) {
      const img = document.createElement("img");
      img.src = logoUrl;
      img.alt = companyName;
      Object.assign(img.style, {
        width: "32px", height: "32px", borderRadius: "50%",
        objectFit: "cover", border: "2px solid rgba(255,255,255,0.6)", flexShrink: "0"
      });
      avatar.appendChild(img);
    } else {
      avatar.innerText = companyName.charAt(0).toUpperCase();
      Object.assign(avatar.style, {
        width: "32px", height: "32px", borderRadius: "50%",
        background: "rgba(255,255,255,0.25)", color: "#fff",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontWeight: "bold", fontSize: "14px", flexShrink: "0"
      });
    }
    header.appendChild(avatar);

    const headerInfo = document.createElement("div");
    headerInfo.style.flex = "1";
    headerInfo.style.minWidth = "0";
    const headerTitle = document.createElement("div");
    headerTitle.innerText = companyName;
    Object.assign(headerTitle.style, {
      fontWeight: "700", fontSize: "15px",
      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"
    });
    const headerStatus = document.createElement("div");
    headerStatus.innerText = "● Online now";
    Object.assign(headerStatus.style, { fontSize: "11px", opacity: "0.8", marginTop: "1px" });
    headerInfo.appendChild(headerTitle);
    headerInfo.appendChild(headerStatus);
    header.appendChild(headerInfo);

    const closeBtn = document.createElement("button");
    closeBtn.innerHTML = "&times;";
    closeBtn.type = "button";
    closeBtn.title = "Close chat";
    Object.assign(closeBtn.style, {
      width: "32px", height: "32px", borderRadius: "50%",
      border: "none", background: "rgba(255,255,255,0.2)", color: "#fff",
      cursor: "pointer", fontSize: "22px", fontWeight: "bold", lineHeight: "1",
      display: "flex", alignItems: "center", justifyContent: "center",
      flexShrink: "0", padding: "0"
    });

    const smsBtn = document.createElement("button");
    smsBtn.innerText = "SMS";
    smsBtn.title = "Text us instead";
    smsBtn.style.display = "none";
    Object.assign(smsBtn.style, {
      padding: "4px 10px", borderRadius: "6px",
      border: "1px solid rgba(255,255,255,0.5)",
      background: "rgba(255,255,255,0.2)",
      color: "#fff", cursor: "pointer", fontSize: "11px", fontWeight: "bold",
      flexShrink: "0"
    });
    smsBtn.onclick = () => { smsModal.style.display = "flex"; smsPhoneInput.focus(); };
    header.appendChild(smsBtn);

    const helpBtn = document.createElement("button");
    helpBtn.innerText = "?";
    helpBtn.type = "button";
    Object.assign(helpBtn.style, {
      width: "26px", height: "26px", borderRadius: "50%",
      border: "1px solid rgba(255,255,255,0.5)",
      background: "rgba(255,255,255,0.2)",
      color: "#fff", cursor: "pointer", fontSize: "13px", fontWeight: "bold",
      display: "flex", alignItems: "center", justifyContent: "center", flexShrink: "0"
    });
    const scriptSrc   = apiBase + "/chat-widget.js";
    const embedSnippet = `<script src="${scriptSrc}" data-tenant-id="${tenantId}"></script>`;
    const tooltip = document.createElement("div");
    Object.assign(tooltip.style, {
      display: "none", position: "fixed", width: "300px", padding: "14px",
      background: "#1a1a1a", color: "#fff", fontSize: "12px",
      borderRadius: "10px", boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
      zIndex: "2147483647", lineHeight: "1.5"
    });
    tooltip.innerHTML = `<strong style="display:block;margin-bottom:8px">Add this widget to your site</strong>
      Paste before <code style="background:#333;padding:2px 6px;border-radius:4px">&lt;/body&gt;</code>:<br><br>
      <code style="display:block;background:#333;padding:10px;border-radius:6px;font-size:11px;word-break:break-all;white-space:pre-wrap">${embedSnippet.replace(/</g,"&lt;").replace(/>/g,"&gt;")}</code>`;
    helpBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (tooltip.style.display === "block") {
        tooltip.style.display = "none";
      } else {
        if (!tooltip.parentNode) document.body.appendChild(tooltip);
        const r = helpBtn.getBoundingClientRect();
        const tooltipWidth = Math.min(300, window.innerWidth - 16);
        tooltip.style.width = tooltipWidth + "px";
        tooltip.style.left = Math.max(8, Math.min(window.innerWidth - tooltipWidth - 8, r.right - tooltipWidth)) + "px";
        tooltip.style.top  = Math.max(8, r.top - 220)  + "px";
        tooltip.style.display = "block";
      }
    });
    document.addEventListener("click", (e) => {
      if (tooltip.style.display === "block" && e.target !== helpBtn && !tooltip.contains(e.target)) {
        tooltip.style.display = "none";
      }
    });
    header.appendChild(helpBtn);
    header.appendChild(closeBtn);
    container.appendChild(header);

    // ── Messages area ────────────────────────────────────────────────────────
    const messagesBody = document.createElement("div");
    Object.assign(messagesBody.style, {
      flex: "1", padding: "16px", overflowY: "auto",
      display: "flex", flexDirection: "column", gap: "10px",
      background: "#fafafa",
      WebkitOverflowScrolling: "touch"
    });
    container.appendChild(messagesBody);

    // ── Quick Quote button (Phase 7 — pinned above input area) ──────────────
    // Only rendered when estimatorEnabled = true. Always visible while chat
    // is open. Tappable any time, even mid-conversation.
    const quickQuoteRow = document.createElement("div");
    quickQuoteRow.style.display = "none"; // Default hidden, shown if estimator enabled
    Object.assign(quickQuoteRow.style, {
      padding: "8px 14px 0 14px", background: "#fff",
      borderTop: "1px solid #f0f0f0", flexShrink: "0"
    });
    const quickQuoteBtn = document.createElement("button");
    quickQuoteBtn.type = "button";
    quickQuoteBtn.innerText = "💰 Quick Quote";
    Object.assign(quickQuoteBtn.style, {
      width: "100%", padding: "10px 14px",
      background: brandColor,
      color: "#fff", border: "none", borderRadius: "10px",
      cursor: "pointer", fontSize: "13px", fontWeight: "700",
      letterSpacing: "0.3px",
      boxShadow: `0 2px 8px ${brandColor}33`,
      fontFamily: "inherit",
      transition: "transform 0.15s, box-shadow 0.15s"
    });
    quickQuoteBtn.onmouseenter = () => {
      quickQuoteBtn.style.transform = "translateY(-1px)";
      quickQuoteBtn.style.boxShadow = `0 4px 12px ${brandColor}55`;
    };
    quickQuoteBtn.onmouseleave = () => {
      quickQuoteBtn.style.transform = "translateY(0)";
      quickQuoteBtn.style.boxShadow = `0 2px 8px ${brandColor}33`;
    };
    quickQuoteBtn.onclick = () => startEstimatorFlow();
    quickQuoteRow.appendChild(quickQuoteBtn);
    container.appendChild(quickQuoteRow);

    // ── Input area ───────────────────────────────────────────────────────────
    const inputArea = document.createElement("div");
    Object.assign(inputArea.style, {
      display: "flex", padding: "12px 14px", borderTop: "1px solid #eee",
      background: "#fff", alignItems: "center", gap: "8px",
      flexShrink: "0"
    });
    container.appendChild(inputArea);

    const input = document.createElement("input");
    input.placeholder = "Type a message...";
    Object.assign(input.style, {
      flex: "1", border: "1.5px solid #eee", outline: "none", fontSize: "16px",
      padding: "9px 12px", background: "#f7f7f7", borderRadius: "20px",
      color: "#111", transition: "border-color 0.2s",
      minWidth: "0"
    });
    input.addEventListener("focus",  () => { input.style.borderColor = brandColor; });
    input.addEventListener("blur",   () => { input.style.borderColor = "#eee"; });
    inputArea.appendChild(input);

    const sendBtn = document.createElement("button");
    sendBtn.innerText = "Send";
    Object.assign(sendBtn.style, {
      background: brandColor, border: "none", color: "#fff",
      fontWeight: "bold", cursor: "pointer", padding: "9px 16px",
      fontSize: "13px", borderRadius: "20px", flexShrink: "0",
      transition: "opacity 0.2s"
    });
    sendBtn.onmouseenter = () => { sendBtn.style.opacity = "0.85"; };
    sendBtn.onmouseleave = () => { sendBtn.style.opacity = "1"; };
    inputArea.appendChild(sendBtn);

    // ── Message bubble helpers ───────────────────────────────────────────────
    function addMsg(text, isUser) {
      const bubble = document.createElement("div");
      bubble.className = "ai-chat-bubble";
      bubble.innerText = text;
      Object.assign(bubble.style, {
        padding: "10px 14px", borderRadius: "16px", fontSize: "14px",
        maxWidth: "82%", alignSelf: isUser ? "flex-end" : "flex-start",
        background: isUser ? brandColor : "#fff",
        color: isUser ? "#fff" : "#222",
        boxShadow: isUser ? `0 2px 8px ${brandColor}44` : "0 1px 4px rgba(0,0,0,0.06)",
        border: isUser ? "none" : "1px solid #efefef",
        lineHeight: "1.5", wordBreak: "break-word"
      });
      if (isUser) bubble.style.borderBottomRightRadius = "4px";
      else        bubble.style.borderBottomLeftRadius  = "4px";
      messagesBody.appendChild(bubble);
      messagesBody.scrollTop = messagesBody.scrollHeight;
      return bubble;
    }

    // Phase 8.3 (May 12, 2026) — expose addMsg so the module-scope poller
    // can render owner messages into the same conversation flow. Set once,
    // immediately after createUI defines messagesBody + addMsg above.
    window.__aiWidgetAddMsg = addMsg;

    // Special bubble that holds an interactive component (form, buttons, etc.)
    function addInteractiveBubble(buildContent) {
      const bubble = document.createElement("div");
      bubble.className = "ai-chat-bubble";
      Object.assign(bubble.style, {
        padding: "12px 14px", borderRadius: "16px", borderBottomLeftRadius: "4px",
        fontSize: "14px", maxWidth: "92%", alignSelf: "flex-start",
        background: "#fff", color: "#222",
        boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
        border: "1px solid #efefef", lineHeight: "1.5",
        wordBreak: "break-word"
      });
      buildContent(bubble);
      messagesBody.appendChild(bubble);
      messagesBody.scrollTop = messagesBody.scrollHeight;
      return bubble;
    }

    function showTyping() {
      const typing = document.createElement("div");
      typing.id = "ai-typing-indicator";
      typing.style.alignSelf = "flex-start";
      typing.innerHTML = `<span class="ai-typing-dot"></span><span class="ai-typing-dot"></span><span class="ai-typing-dot"></span>`;
      Object.assign(typing.style, {
        padding: "10px 14px", borderRadius: "16px", borderBottomLeftRadius: "4px",
        background: "#fff", border: "1px solid #efefef",
        display: "flex", gap: "2px", alignItems: "center"
      });
      messagesBody.appendChild(typing);
      messagesBody.scrollTop = messagesBody.scrollHeight;
    }
    function hideTyping() {
      const t = document.getElementById("ai-typing-indicator");
      if (t) t.remove();
    }

    // ════════════════════════════════════════════════════════════════════════
    // ESTIMATOR FLOW (Phase 7 V1 — May 2, 2026)
    // ════════════════════════════════════════════════════════════════════════

    function startEstimatorFlow() {
      if (!estimatorEnabled || !estimatorConfig) return;
      // Reset state. NOTE: sourceCallId is module-scoped (NOT in estimatorState),
      // so it survives this reset and gets attached to the lead at capture time.
      estimatorActive = true;
      estimatorState.service_slug = null;
      estimatorState.inputs = {};
      estimatorState.rooms = [];
      estimatorState._roomSize = "medium";
      estimatorState.quote_result = null;
      estimatorState.contact = { name: "", phone: "", email: "", address: "" };
      estimatorState._step = "service_picker";
      estimatorState.eventLog = [];   // Reset event buffer

      const startedVia = sourceCallId ? `voice link (call_id=${sourceCallId})` : "Quick Quote button";
      trackVisitor("estimator_started", sourceCallId ? { source_call_id: sourceCallId } : {});
      logEstimatorEvent("estimator_started", `[Quick Quote] Customer started estimator flow via ${startedVia}`);

      // Intro message
      addMsg("Great! I'll ask you a few quick questions to give you a ballpark range. This is just an estimate — final pricing requires an in-person walkthrough.", false);

      // Phase 7 V2 (May 12, 2026) — for mega-verticals (home_exterior, etc.)
      // show trade picker first; for single-trade verticals (painting only,
      // standalone roofing) keep the original flat service picker.
      if (isMegaVertical()) {
        setTimeout(() => renderTradePicker(), 600);
      } else {
        setTimeout(() => renderServicePicker(), 600);
      }
    }

    // ── Phase 7 V2 (May 12, 2026) — Trade picker for mega-verticals ─────────
    //
    // Step 1 of a two-step picker. Shows trade buttons (Roofing / Siding /
    // Fence / Gutters) plus a "Something else" specialized escape hatch.
    // On selection, calls renderServicePicker(trade) to drill into the
    // services for that trade.
    //
    // For single-trade verticals this function is never called — the old
    // renderServicePicker() runs directly from startEstimatorFlow.
    function renderTradePicker() {
      const trades = getTradesInVertical();

      addInteractiveBubble((bubble) => {
        const label = document.createElement("div");
        label.innerText = "What kind of project?";
        label.style.fontWeight = "600";
        label.style.marginBottom = "8px";
        label.style.fontSize = "13px";
        bubble.appendChild(label);

        trades.forEach(trade => {
          const config = TRADE_DISPLAY[trade];
          if (!config) return;
          const btn = document.createElement("button");
          btn.className = "ai-est-card-btn";
          btn.type = "button";
          btn.innerHTML = `<span style="font-size:18px;margin-right:8px;vertical-align:middle">${config.icon}</span><span style="vertical-align:middle">${config.name}</span>`;
          btn.onclick = () => {
            bubble.querySelectorAll("button").forEach(b => b.disabled = true);
            btn.classList.add("selected");
            addMsg(config.name, true);
            logEstimatorEvent("trade_selected", `[Quick Quote] Selected trade: ${config.name}`);
            setTimeout(() => renderServicePicker(trade), 400);
          };
          bubble.appendChild(btn);
        });

        // Specialized / multi-trade escape hatch on the trade picker
        const spec = document.createElement("button");
        spec.className = "ai-est-card-btn";
        spec.type = "button";
        spec.innerHTML = `<span style="font-size:18px;margin-right:8px;vertical-align:middle">🛠️</span><span style="vertical-align:middle">Something else / multiple trades</span>`;
        spec.onclick = () => {
          estimatorState.service_slug = "specialized";
          bubble.querySelectorAll("button").forEach(b => b.disabled = true);
          spec.classList.add("selected");
          addMsg("Something else / multiple trades", true);
          logEstimatorEvent("service_selected", "[Quick Quote] Selected: Specialized / multi-trade project");
          estimatorState.quote_result = {
            specialized: true,
            reason: "For multi-trade or specialized projects, we'll set up an in-person walkthrough to put together a complete estimate.",
            quote: null
          };
          setTimeout(() => renderSpecializedResult(), 400);
        };
        bubble.appendChild(spec);
      });
    }

    // ── Service picker — flat (single-trade) or filtered (mega-vertical) ────
    //
    // Phase 7 V2: now accepts an optional `tradeFilter` parameter. When
    // passed (called from renderTradePicker), shows only services in that
    // trade plus a "← Back to project types" link. When omitted (called
    // from startEstimatorFlow for single-trade verticals like painting),
    // shows all non-specialized services in a flat list with the original
    // Specialized button — exactly like Phase 7 V1 behavior.
    function renderServicePicker(tradeFilter) {
      let services = (estimatorConfig.services || []).filter(s => !s.is_specialized);

      // If we came from the trade picker, filter to that trade's services only
      if (tradeFilter) {
        services = services.filter(s => getTradeForService(s.service_slug) === tradeFilter);
      }

      // Painting service icons (used when no tradeFilter — i.e., legacy
      // Gladiators-style single-vertical flow). Mega-vertical service
      // buttons inherit the trade icon from TRADE_DISPLAY below.
      const serviceIcons = {
        interior:   "🏠",
        exterior:   "🎨",
        cabinets:   "🚪",
        deck_fence: "🪵"
      };

      addInteractiveBubble((bubble) => {
        // Back button only when drilling in from a trade picker
        if (tradeFilter) {
          const backWrap = document.createElement("div");
          backWrap.style.marginBottom = "8px";
          const backBtn = document.createElement("button");
          backBtn.type = "button";
          backBtn.innerText = "← Back to project types";
          Object.assign(backBtn.style, {
            background: "transparent",
            border: "none",
            color: brandColor,
            cursor: "pointer",
            fontSize: "11px",
            fontWeight: "600",
            padding: "0",
            fontFamily: "inherit"
          });
          backBtn.onclick = () => {
            bubble.querySelectorAll("button").forEach(b => b.disabled = true);
            logEstimatorEvent("trade_picker_back", "[Quick Quote] Customer tapped back to trade picker");
            setTimeout(() => renderTradePicker(), 200);
          };
          backWrap.appendChild(backBtn);
          bubble.appendChild(backWrap);
        }

        const label = document.createElement("div");
        label.innerText = tradeFilter
          ? (TRADE_DISPLAY[tradeFilter]?.subPrompt || "Which option?")
          : "What kind of project?";
        label.style.fontWeight = "600";
        label.style.marginBottom = "8px";
        label.style.fontSize = "13px";
        bubble.appendChild(label);

        services.forEach(svc => {
          const btn = document.createElement("button");
          btn.className = "ai-est-card-btn";
          btn.type = "button";
          // Icon priority: legacy painting hardcoded icon → trade icon → fallback sparkle
          const icon = serviceIcons[svc.service_slug]
            || (tradeFilter ? TRADE_DISPLAY[tradeFilter]?.icon : null)
            || "✨";
          btn.innerHTML = `<span style="font-size:18px;margin-right:8px;vertical-align:middle">${icon}</span><span style="vertical-align:middle">${svc.display_name}</span>`;
          btn.onclick = () => {
            estimatorState.service_slug = svc.service_slug;
            // Disable all buttons in this bubble (lock the answer)
            bubble.querySelectorAll("button").forEach(b => b.disabled = true);
            btn.classList.add("selected");
            // Echo selection as user message
            addMsg(svc.display_name, true);
            logEstimatorEvent("service_selected", `[Quick Quote] Selected service: ${svc.display_name}`);
            setTimeout(() => renderQuestionsForService(svc.service_slug), 400);
          };
          bubble.appendChild(btn);
        });

        // Specialized button only on the FLAT picker (no tradeFilter).
        // The trade picker has its own specialized option, and inside
        // a trade we don't want a second "specialized" exit.
        if (!tradeFilter) {
          const spec = document.createElement("button");
          spec.className = "ai-est-card-btn";
          spec.type = "button";
          spec.innerHTML = `<span style="font-size:18px;margin-right:8px;vertical-align:middle">🛠️</span><span style="vertical-align:middle">Specialized project</span>`;
          spec.onclick = () => {
            estimatorState.service_slug = "specialized";
            bubble.querySelectorAll("button").forEach(b => b.disabled = true);
            spec.classList.add("selected");
            addMsg("Specialized project", true);
            logEstimatorEvent("service_selected", "[Quick Quote] Selected service: Specialized project (needs walkthrough)");
            estimatorState.quote_result = {
              specialized: true,
              reason: "Specialized projects need an in-person walkthrough so we can see the details that affect pricing.",
              quote: null
            };
            setTimeout(() => renderSpecializedResult(), 400);
          };
          bubble.appendChild(spec);
        }
      });
    }

    // ── Phase 7 V2 (May 12, 2026) — Trade-aware question filter ─────────────
    //
    // For mega-verticals, questions are tagged at the trade level
    // (service_slug='roofing' applies to all 5 roofing service variants).
    // For single-trade verticals (Gladiators painting), questions are
    // tagged at the specific service level. This filter handles both.
    //
    //   - Exact service match  → show (e.g., painting 'interior' questions)
    //   - Trade-level match    → show (e.g., 'asphalt' service → 'roofing' qs)
    //   - service_slug=null    → show (universal questions like access)
    //   - System questions     → always hide (service_type, special_notes)
    function getQuestionsForService(serviceSlug) {
      const trade = getTradeForService(serviceSlug);
      return (estimatorConfig.questions || []).filter(q => {
        if (q.question_slug === "service_type" || q.question_slug === "special_notes") return false;
        if (q.service_slug === serviceSlug) return true;
        if (trade && q.service_slug === trade) return true;
        if (q.service_slug === null) return true;
        return false;
      });
    }

    // Render all questions for a service as a single interactive bubble.
    // Multi-question forms in one bubble = less scroll churn than one-per-message.
    function renderQuestionsForService(serviceSlug) {
      const questions = getQuestionsForService(serviceSlug);
      if (questions.length === 0) {
        // Shouldn't happen for valid services, but defensive
        submitEstimatorQuote();
        return;
      }

      addInteractiveBubble((bubble) => {
        const intro = document.createElement("div");
        intro.innerText = "Tell me a bit more:";
        intro.style.fontWeight = "600";
        intro.style.marginBottom = "10px";
        intro.style.fontSize = "13px";
        bubble.appendChild(intro);

        questions.forEach((q, idx) => {
          const block = renderQuestionBlock(q);
          if (block) {
            if (idx > 0) block.style.marginTop = "12px";
            bubble.appendChild(block);
          }
        });

        // Submit button at bottom of the form bubble
        const submitWrap = document.createElement("div");
        submitWrap.style.marginTop = "14px";
        const submitBtn = document.createElement("button");
        submitBtn.type = "button";
        submitBtn.innerText = "Get my ballpark range →";
        Object.assign(submitBtn.style, {
          width: "100%", padding: "10px",
          background: brandColor, color: "#fff", border: "none",
          borderRadius: "8px", cursor: "pointer", fontSize: "13px",
          fontWeight: "700", fontFamily: "inherit"
        });
        submitBtn.onclick = () => {
          // Lock all inputs in the bubble
          bubble.querySelectorAll("input, select, button").forEach(el => el.disabled = true);
          submitBtn.innerText = "Calculating...";
          // Pass bubble ref so submitEstimatorQuote can update button text on completion
          submitEstimatorQuote(submitBtn);
        };
        submitWrap.appendChild(submitBtn);
        bubble.appendChild(submitWrap);
      });
    }

    function renderQuestionBlock(q) {
      const wrap = document.createElement("div");

      const label = document.createElement("div");
      label.innerText = q.label + (q.required ? " *" : "");
      Object.assign(label.style, {
        fontWeight: "600", fontSize: "12px", color: "#444",
        marginBottom: "4px"
      });
      wrap.appendChild(label);

      if (q.helper_text) {
        const helper = document.createElement("div");
        helper.innerText = q.helper_text;
        Object.assign(helper.style, { fontSize: "11px", color: "#888", marginBottom: "5px", lineHeight: "1.4" });
        wrap.appendChild(helper);
      }

      if (q.question_type === "select") {
        const sel = document.createElement("select");
        sel.className = "ai-est-input";
        const placeholder = document.createElement("option");
        placeholder.value = "";
        placeholder.innerText = "— select —";
        sel.appendChild(placeholder);
        (q.options || []).forEach(opt => {
          const o = document.createElement("option");
          o.value = opt.value;
          o.innerText = opt.label;
          sel.appendChild(o);
        });
        sel.onchange = () => { estimatorState.inputs[q.question_slug] = sel.value; };
        wrap.appendChild(sel);

      } else if (q.question_type === "yes_no") {
        const row = document.createElement("div");
        row.style.display = "flex";
        row.style.gap = "6px";
        (q.options || []).forEach(opt => {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "ai-est-card-btn";
          btn.innerText = opt.label;
          btn.style.flex = "1";
          btn.style.textAlign = "center";
          btn.style.margin = "0";
          btn.style.padding = "8px";
          btn.onclick = () => {
            estimatorState.inputs[q.question_slug] = opt.value;
            row.querySelectorAll(".ai-est-card-btn").forEach(b => b.classList.remove("selected"));
            btn.classList.add("selected");
          };
          row.appendChild(btn);
        });
        wrap.appendChild(row);

      } else if (q.question_type === "multi_select") {
        const grid = document.createElement("div");
        grid.style.display = "flex";
        grid.style.flexDirection = "column";
        grid.style.gap = "3px";
        const selected = estimatorState.inputs[q.question_slug] || [];
        (q.options || []).forEach(opt => {
          const row = document.createElement("label");
          Object.assign(row.style, {
            display: "flex", alignItems: "center", gap: "8px",
            padding: "6px 8px", borderRadius: "6px", cursor: "pointer",
            fontSize: "13px", color: "#222"
          });
          const cb = document.createElement("input");
          cb.type = "checkbox";
          cb.value = opt.value;
          cb.checked = selected.includes(opt.value);
          cb.style.accentColor = brandColor;
          cb.style.width = "16px";
          cb.style.height = "16px";
          cb.onchange = () => {
            const cur = estimatorState.inputs[q.question_slug] || [];
            if (cb.checked) {
              if (!cur.includes(opt.value)) cur.push(opt.value);
            } else {
              const i = cur.indexOf(opt.value);
              if (i >= 0) cur.splice(i, 1);
            }
            estimatorState.inputs[q.question_slug] = cur;
          };
          row.appendChild(cb);
          row.appendChild(document.createTextNode(opt.label));
          grid.appendChild(row);
        });
        wrap.appendChild(grid);

      } else if (q.question_type === "multi_select_with_count") {
        const grid = document.createElement("div");
        grid.style.display = "flex";
        grid.style.flexDirection = "column";
        grid.style.gap = "4px";
        (q.options || []).forEach(opt => {
          const row = document.createElement("div");
          row.className = "ai-est-counter-row";
          const lbl = document.createElement("div");
          lbl.innerText = opt.label;
          lbl.style.flex = "1";
          lbl.style.fontSize = "13px";
          const minus = document.createElement("button");
          minus.className = "ai-est-counter-btn";
          minus.type = "button";
          minus.innerText = "−";
          const count = document.createElement("span");
          count.innerText = "0";
          Object.assign(count.style, { minWidth: "18px", textAlign: "center", fontWeight: "600", fontSize: "13px" });
          const plus = document.createElement("button");
          plus.className = "ai-est-counter-btn";
          plus.type = "button";
          plus.innerText = "+";
          minus.onclick = () => {
            const r = estimatorState.rooms.find(r => r.type === opt.value);
            if (r && r.count > 0) {
              r.count--;
              if (r.count === 0) estimatorState.rooms = estimatorState.rooms.filter(rr => rr.type !== opt.value);
            }
            const r2 = estimatorState.rooms.find(r => r.type === opt.value);
            count.innerText = r2 ? r2.count : 0;
          };
          plus.onclick = () => {
            let r = estimatorState.rooms.find(r => r.type === opt.value);
            if (!r) {
              r = { type: opt.value, count: 0, size: estimatorState._roomSize };
              estimatorState.rooms.push(r);
            }
            r.count++;
            count.innerText = r.count;
          };
          row.appendChild(lbl);
          row.appendChild(minus);
          row.appendChild(count);
          row.appendChild(plus);
          grid.appendChild(row);
        });
        wrap.appendChild(grid);

        // Average size selector
        const sizeWrap = document.createElement("div");
        sizeWrap.style.marginTop = "8px";
        const sizeLbl = document.createElement("div");
        sizeLbl.innerText = "Average room size:";
        Object.assign(sizeLbl.style, { fontSize: "11px", color: "#888", marginBottom: "4px" });
        sizeWrap.appendChild(sizeLbl);
        const sizeRow = document.createElement("div");
        sizeRow.style.display = "flex";
        sizeRow.style.gap = "4px";
        ["small", "medium", "large", "xl"].forEach(size => {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "ai-est-card-btn";
          btn.innerText = size === "xl" ? "XL" : size.charAt(0).toUpperCase() + size.slice(1);
          btn.style.flex = "1";
          btn.style.padding = "6px";
          btn.style.fontSize = "11px";
          btn.style.textAlign = "center";
          btn.style.margin = "0";
          if (estimatorState._roomSize === size) btn.classList.add("selected");
          btn.onclick = () => {
            estimatorState._roomSize = size;
            estimatorState.rooms.forEach(r => r.size = size);
            sizeRow.querySelectorAll(".ai-est-card-btn").forEach(b => b.classList.remove("selected"));
            btn.classList.add("selected");
          };
          sizeRow.appendChild(btn);
        });
        sizeWrap.appendChild(sizeRow);
        wrap.appendChild(sizeWrap);

      } else if (q.question_type === "number") {
        const inp = document.createElement("input");
        inp.type = "number";
        inp.className = "ai-est-input";
        const opts = q.options || {};
        if (opts.min !== undefined)  inp.min  = opts.min;
        if (opts.max !== undefined)  inp.max  = opts.max;
        if (opts.step !== undefined) inp.step = opts.step;
        if (opts.unit) inp.placeholder = opts.unit;
        inp.oninput = () => { estimatorState.inputs[q.question_slug] = parseFloat(inp.value) || 0; };
        wrap.appendChild(inp);

      } else if (q.question_type === "year_input") {
        const inp = document.createElement("input");
        inp.type = "number";
        inp.className = "ai-est-input";
        inp.placeholder = "YYYY";
        const opts = q.options || {};
        inp.min = opts.min || 1850;
        inp.max = opts.max || new Date().getFullYear();
        inp.oninput = () => {
          const y = parseInt(inp.value, 10);
          if (!y) return;
          let bucket = "1978_2000";
          if (y < 1978) bucket = "pre_1978";
          else if (y >= 2000) bucket = "2000_plus";
          estimatorState.inputs[q.question_slug] = bucket;
        };
        wrap.appendChild(inp);

      } else if (q.question_type === "size_bucket") {
        const row = document.createElement("div");
        row.style.display = "flex";
        row.style.gap = "4px";
        row.style.flexWrap = "wrap";
        (q.options || []).forEach(opt => {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "ai-est-card-btn";
          btn.innerText = opt.label;
          btn.style.flex = "1";
          btn.style.minWidth = "80px";
          btn.style.padding = "8px";
          btn.style.fontSize = "11px";
          btn.style.textAlign = "center";
          btn.style.margin = "0";
          btn.onclick = () => {
            estimatorState.inputs[q.question_slug] = opt.value;
            row.querySelectorAll(".ai-est-card-btn").forEach(b => b.classList.remove("selected"));
            btn.classList.add("selected");
          };
          row.appendChild(btn);
        });
        wrap.appendChild(row);

      } else if (q.question_type === "text") {
        const ta = document.createElement("textarea");
        ta.className = "ai-est-input";
        ta.rows = 2;
        ta.style.resize = "vertical";
        ta.oninput = () => { estimatorState.inputs[q.question_slug] = ta.value; };
        wrap.appendChild(ta);

      } else {
        return null;
      }

      return wrap;
    }

    async function submitEstimatorQuote(submitBtn) {
      showTyping();
      const inputs = { ...estimatorState.inputs };
      if (estimatorState.service_slug === "interior") {
        inputs.rooms = estimatorState.rooms
          .filter(r => r.count > 0)
          .map(r => ({ size: r.size || estimatorState._roomSize, count: r.count }));
      }

      try {
        const res = await fetch(`${apiBase}/api/estimator/quote`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tenant_id: tenantId,
            service_slug: estimatorState.service_slug,
            inputs
          })
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || `Server returned ${res.status}`);
        }
        const data = await res.json();
        estimatorState.quote_result = data;
        hideTyping();

        if (submitBtn) submitBtn.innerText = "✓ Submitted";
        if (data.specialized) {
          renderSpecializedResult();
        } else {
          renderQuoteResult();
        }
      } catch (err) {
        hideTyping();
        console.error("[AI-Widget] Estimator quote error:", err);
        // Re-enable the form bubble so user can retry instead of being stuck
        if (submitBtn) {
          submitBtn.innerText = "Try again";
          submitBtn.disabled = false;
          // Re-enable inputs in the same bubble as the button
          const bubble = submitBtn.closest(".ai-chat-bubble");
          if (bubble) {
            bubble.querySelectorAll("input, select").forEach(el => el.disabled = false);
            bubble.querySelectorAll("button").forEach(b => { if (b !== submitBtn) b.disabled = false; });
          }
        }
        addMsg("Hmm, something went wrong calculating your range. Mind trying again? Or just give us a call.", false);
        estimatorActive = false;
      }
    }

   function renderQuoteResult() {
      const r = estimatorState.quote_result;
      // Log the quote shown event before rendering
      const minDollars = Math.round(r.range_min_cents / 100);
      const maxDollars = Math.round(r.range_max_cents / 100);
      const rangeText = (r.range_min_cents === r.range_max_cents)
        ? `$${minDollars.toLocaleString()}`
        : `$${minDollars.toLocaleString()} - $${maxDollars.toLocaleString()}`;
      const inputSummary = JSON.stringify({
        service: estimatorState.service_slug,
        inputs: estimatorState.inputs,
        rooms: estimatorState.rooms.filter(rm => rm.count > 0)
      });
      logEstimatorEvent("quote_shown", `[Quick Quote] Showed quote range: ${rangeText} — Inputs: ${inputSummary}`);
      addInteractiveBubble((bubble) => {
        const title = document.createElement("div");
        title.innerText = "Your Ballpark Range";
        Object.assign(title.style, { fontSize: "12px", color: "#888", fontWeight: "600", textAlign: "center", marginBottom: "4px" });
        bubble.appendChild(title);

        const range = document.createElement("div");
        const minStr = formatCents(r.range_min_cents);
        const maxStr = formatCents(r.range_max_cents);
        range.innerText = (r.range_min_cents === r.range_max_cents) ? minStr : `${minStr} – ${maxStr}`;
        Object.assign(range.style, {
          fontSize: "26px", fontWeight: "800", color: "#1a1a1a",
          textAlign: "center", margin: "4px 0 8px 0", letterSpacing: "-0.5px"
        });
        bubble.appendChild(range);

        // What's included — sourced from scope_options overlay (structured object)
// or legacy vertical_services.includes_text (plain string) via /tenant-config
const includes = getIncludesText(estimatorState.service_slug);
if (includes) {
  if (typeof includes === "string") {
    // Legacy fallback: services without scope_options rows still come back as prose
    const includesBox = document.createElement("div");
    Object.assign(includesBox.style, {
      background: "#f0f7ff", border: "1px solid #cfe3ff", borderRadius: "8px",
      padding: "10px 12px", marginTop: "4px", marginBottom: "6px",
      fontSize: "12px", color: "#1e3a5f", lineHeight: "1.5"
    });
    includesBox.innerHTML = `📋 <strong>Includes:</strong> ${includes}`;
    bubble.appendChild(includesBox);
  } else if (typeof includes === "object") {
    // Structured format — green "Included" + amber "Not included" boxes
    if (includes.included) {
      const includedBox = document.createElement("div");
      Object.assign(includedBox.style, {
        background: "#e8f5e9", border: "1.5px solid #66bb6a", borderRadius: "10px",
        padding: "11px 13px", marginTop: "6px", marginBottom: "4px",
        fontSize: "12px", color: "#1b5e20", lineHeight: "1.5"
      });
      includedBox.innerHTML = `✅ <strong style="font-size:13px">Included in this estimate:</strong><br><span style="font-weight:600;font-size:13px">${includes.included}</span>`;
      bubble.appendChild(includedBox);
    }
    if (includes.excluded) {
      const excludedBox = document.createElement("div");
      Object.assign(excludedBox.style, {
        background: "#fff3e0", border: "1.5px solid #ffa726", borderRadius: "10px",
        padding: "11px 13px", marginTop: "4px", marginBottom: "6px",
        fontSize: "12px", color: "#e65100", lineHeight: "1.5"
      });
      excludedBox.innerHTML = `❌ <strong style="font-size:13px">Does NOT include:</strong><br><span style="font-weight:600;font-size:13px">${includes.excluded}</span><br><span style="font-weight:400;font-size:11px;opacity:0.85;font-style:italic">These can be added during your in-person walkthrough if needed.</span>`;
      bubble.appendChild(excludedBox);
    }
  }
}

        const disclaimer = document.createElement("div");
        Object.assign(disclaimer.style, {
          background: "#fff8e1", border: "1px solid #ffe082", borderRadius: "8px",
          padding: "8px 10px", marginTop: "4px", fontSize: "11px", color: "#7a5b00", lineHeight: "1.5"
        });
        disclaimer.innerHTML = `⚠️ <strong>This is a ballpark, not a final quote.</strong> Final pricing requires an in-person walkthrough.`;
        bubble.appendChild(disclaimer);
      });

      // Follow-up CTA message
      setTimeout(() => {
        addMsg("Want me to schedule a free in-person walkthrough? Usually within 24 hours.", false);
        setTimeout(() => renderContactForm(false), 500);
      }, 800);
    }

    function renderSpecializedResult() {
      const r = estimatorState.quote_result;
      logEstimatorEvent("quote_shown", `[Quick Quote] Specialized project — ${r.reason || "needs in-person walkthrough"}`);
      addMsg(r.reason || "This kind of project needs an in-person walkthrough so we can give you accurate pricing.", false);
      setTimeout(() => {
        addMsg("Want me to schedule a free walkthrough? Usually within 24 hours.", false);
        setTimeout(() => renderContactForm(true), 500);
      }, 800);
    }

    function renderContactForm(isSpecialized) {
      addInteractiveBubble((bubble) => {
        const intro = document.createElement("div");
        intro.innerText = "Quick contact info:";
        Object.assign(intro.style, { fontWeight: "600", marginBottom: "8px", fontSize: "13px" });
        bubble.appendChild(intro);

        const fields = [
          { key: "name",    label: "Name *",    type: "text",  placeholder: "First and last" },
          { key: "phone",   label: "Phone *",   type: "tel",   placeholder: "(555) 555-5555" },
          { key: "email",   label: "Email *",   type: "email", placeholder: "you@example.com" },
          { key: "address", label: "Address (optional)", type: "text", placeholder: "Street, city, ZIP" }
        ];

        const inputs = {};
        fields.forEach(f => {
          const w = document.createElement("div");
          w.style.marginBottom = "8px";
          const lbl = document.createElement("div");
          lbl.innerText = f.label;
          Object.assign(lbl.style, { fontSize: "11px", fontWeight: "600", color: "#444", marginBottom: "3px" });
          w.appendChild(lbl);
          const inp = document.createElement("input");
          inp.type = f.type;
          inp.className = "ai-est-input";
          inp.placeholder = f.placeholder;
          inp.oninput = () => { estimatorState.contact[f.key] = inp.value; };
          w.appendChild(inp);
          inputs[f.key] = inp;
          bubble.appendChild(w);
        });

        const errBox = document.createElement("div");
        Object.assign(errBox.style, { display: "none", color: "#c00", fontSize: "11px", marginBottom: "6px" });
        bubble.appendChild(errBox);

        const submit = document.createElement("button");
        submit.type = "button";
        submit.innerText = isSpecialized ? "Schedule walkthrough" : "Yes, schedule it";
        Object.assign(submit.style, {
          width: "100%", padding: "10px",
          background: brandColor, color: "#fff", border: "none",
          borderRadius: "8px", cursor: "pointer", fontSize: "13px",
          fontWeight: "700", fontFamily: "inherit", marginTop: "4px"
        });
        submit.onclick = async () => {
          const c = estimatorState.contact;
          const errs = [];
          if (!c.name || c.name.trim().length < 2) errs.push("Please enter your name.");
          if (!c.phone || c.phone.replace(/\D/g, "").length < 10) errs.push("Please enter a valid phone.");
          if (!c.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email)) errs.push("Please enter a valid email.");
          if (errs.length) {
            errBox.innerText = errs.join(" ");
            errBox.style.display = "block";
            return;
          }
          errBox.style.display = "none";
          submit.disabled = true;
          submit.innerText = "Sending...";

          try {
            const res = await fetch(`${apiBase}/api/estimator/lead`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                tenant_id: tenantId,
                phone: c.phone,
                name: c.name,
                email: c.email,
                address: c.address || null,
                project_type: estimatorState.service_slug,
                estimator_payload: {
                  service_slug: estimatorState.service_slug,
                  inputs: estimatorState.inputs,
                  rooms: estimatorState.rooms,
                  session_id: sessionId,
                  // Phase 7 V2 (May 4, 2026) — voice attribution. Set when
                  // the customer arrived via an SMS link from a phone call.
                  // Will be null for organic widget traffic.
                  source_call_id: sourceCallId
                },
                quote_result: estimatorState.quote_result
              })
            });
            if (!res.ok) throw new Error(`Server returned ${res.status}`);
            const leadResp = await res.json();
            const newLeadId = leadResp.lead_id;

            // Lock all inputs
            bubble.querySelectorAll("input, button").forEach(el => el.disabled = true);
            // Echo as a user-side confirmation
            addMsg(`${c.name} • ${c.phone}`, true);

            // Log final event + flush all buffered events to /log-events
            logEstimatorEvent("lead_captured",
              `[Quick Quote] Lead captured — Name: ${c.name} | Phone: ${c.phone} | Email: ${c.email}${c.address ? ' | Address: ' + c.address : ''}${sourceCallId ? ' | Voice attribution: call_id=' + sourceCallId : ''}`
            );

            // Fire-and-forget: synthetic conversation messages for dashboard visibility.
            // Wrapped in its own try/catch so failure doesn't break the user flow.
            if (newLeadId && estimatorState.eventLog.length > 0) {
              fetch(`${apiBase}/api/estimator/log-events`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  tenant_id: tenantId,
                  lead_id: newLeadId,
                  events: estimatorState.eventLog
                })
              }).then(r => {
                if (r.ok) {
                  console.log("[AI-Widget] Logged %d estimator events to backend", estimatorState.eventLog.length);
                } else {
                  console.warn("[AI-Widget] Event log POST returned %d", r.status);
                }
              }).catch(err => {
                console.warn("[AI-Widget] Event log POST failed:", err.message);
              });
            }

            setTimeout(() => {
              addMsg(`✅ You're all set! Someone from ${companyName} will reach out within 24 hours to schedule your walkthrough.`, false);
              estimatorActive = false;
              trackVisitor("estimator_lead_captured", sourceCallId ? { source_call_id: sourceCallId } : {});
            }, 400);
          } catch (err) {
            console.error("[AI-Widget] Lead capture error:", err);
            errBox.innerText = "Something went wrong. Please try again or just text us.";
            errBox.style.display = "block";
            submit.disabled = false;
            submit.innerText = isSpecialized ? "Schedule walkthrough" : "Yes, schedule it";
          }
        };
        bubble.appendChild(submit);
      });
    }

    // ════════════════════════════════════════════════════════════════════════
    // END ESTIMATOR FLOW
    // ════════════════════════════════════════════════════════════════════════

    // ── Responsive layout — called on mount, resize, orientationchange ──────
    function applyResponsiveLayout() {
      const mobile = isMobile();
      if (!isOpen) {
        if (mobile) {
          toggle.innerText = "💬";
        } else {
          toggle.innerText = `Chat with ${companyName}`;
        }
      } else {
        if (mobile) {
          toggle.innerText = "×";
          toggle.style.fontSize = "28px";
        } else {
          toggle.innerText = "Close";
          toggle.style.fontSize = "15px";
        }
      }
    }
    applyResponsiveLayout();
    window.addEventListener("resize", applyResponsiveLayout);
    window.addEventListener("orientationchange", applyResponsiveLayout);

    // ── Open/close logic ─────────────────────────────────────────────────────
    function openChat() {
      isOpen = true;
      trackVisitor("chat_opened", sourceCallId ? { source_call_id: sourceCallId } : {});
      hideCallout();
      toggle.classList.remove("ai-pulse-anim");
      container.style.display = "flex";
      setTimeout(() => { container.style.opacity = "1"; container.style.transform = "translateY(0)"; }, 10);
      toggle.style.background = "#444";
      applyResponsiveLayout();
      // Show Quick Quote button if estimator enabled
      if (estimatorEnabled) {
        quickQuoteRow.style.display = "block";
      }
      if (!hasWelcomed) { addMsg(welcomeMessage, false); hasWelcomed = true; }
      setTimeout(() => input.focus(), 400);

      // Phase 8.3 (May 12, 2026) — start polling for owner-sent messages
      startPolling();
    }
    function closeChat() {
      isOpen = false;
      container.style.opacity = "0";
      container.style.transform = "translateY(10px)";
      setTimeout(() => { container.style.display = "none"; }, 400);
      toggle.style.background = brandColor;
      applyResponsiveLayout();

      // Phase 8.3 (May 12, 2026) — stop polling when chat closes
      stopPolling();
    }
    toggle.onclick  = () => { isOpen ? closeChat() : openChat(); };
    closeBtn.onclick = () => { closeChat(); };

    // ── SMS consent modal ─────────────────────────────────────────────────────
    const smsModal = document.createElement("div");
    smsModal.id = "ai-sms-modal";
    Object.assign(smsModal.style, {
      position: "absolute", top: "0", left: "0", width: "100%", height: "100%",
      background: "rgba(255,255,255,0.98)", zIndex: "2147483648",
      display: "none", flexDirection: "column", padding: "28px 20px",
      boxSizing: "border-box", textAlign: "center", fontFamily: "'Inter', sans-serif",
      overflowY: "auto"
    });
    container.appendChild(smsModal);

    const smsClose = document.createElement("div");
    smsClose.innerHTML = "&times;";
    Object.assign(smsClose.style, {
      position: "absolute", top: "14px", right: "18px", fontSize: "28px",
      cursor: "pointer", color: "#999", lineHeight: "1",
      width: "32px", height: "32px", display: "flex",
      alignItems: "center", justifyContent: "center"
    });
    smsClose.onclick = () => { smsModal.style.display = "none"; };
    smsModal.appendChild(smsClose);

    const smsTitle = document.createElement("h3");
    smsTitle.innerText = "Text with us";
    smsTitle.style.margin = "0 0 10px 0";
    smsTitle.style.color = "#111";
    smsModal.appendChild(smsTitle);

    const smsDesc = document.createElement("p");
    smsDesc.innerText = `Enter your phone number and ${companyName} will text you to arrange your appointment.`;
    Object.assign(smsDesc.style, { fontSize: "13px", color: "#666", margin: "0 0 18px 0", lineHeight: "1.5" });
    smsModal.appendChild(smsDesc);

    const smsPhoneInput = document.createElement("input");
    smsPhoneInput.type = "tel";
    smsPhoneInput.placeholder = "(555) 000-0000";
    Object.assign(smsPhoneInput.style, {
      width: "100%", padding: "12px", borderRadius: "10px",
      border: `1.5px solid ${brandColor}`, fontSize: "16px",
      marginBottom: "14px", boxSizing: "border-box", textAlign: "center", outline: "none"
    });
    smsModal.appendChild(smsPhoneInput);

    const consentWrap = document.createElement("div");
    Object.assign(consentWrap.style, {
      display: "flex", alignItems: "flex-start", gap: "10px",
      textAlign: "left", marginBottom: "18px"
    });
    const consentCheck = document.createElement("input");
    consentCheck.type = "checkbox";
    consentCheck.style.marginTop = "3px";
    consentCheck.style.accentColor = brandColor;
    consentCheck.style.width = "18px";
    consentCheck.style.height = "18px";
    consentCheck.style.flexShrink = "0";
    const disclosureText = `By submitting, you agree to receive text messages from ${companyName} about your quote, scheduling, and service updates. Msg/data rates may apply. Reply STOP to opt out.`;
    const consentLabel = document.createElement("label");
    consentLabel.innerText = disclosureText;
    Object.assign(consentLabel.style, { fontSize: "11px", color: "#888", lineHeight: "1.5" });
    consentWrap.appendChild(consentCheck);
    consentWrap.appendChild(consentLabel);
    smsModal.appendChild(consentWrap);

    const smsSubmit = document.createElement("button");
    smsSubmit.innerText = "Start Texting";
    Object.assign(smsSubmit.style, {
      width: "100%", background: brandColor, color: "#fff",
      padding: "13px", borderRadius: "10px", border: "none",
      fontSize: "15px", fontWeight: "bold", cursor: "pointer"
    });
    smsModal.appendChild(smsSubmit);

    smsSubmit.onclick = async () => {
      const phone   = smsPhoneInput.value.trim();
      const consent = consentCheck.checked;
      if (!phone)   { alert("Please enter your phone number."); return; }
      if (!consent) { alert("Please agree to receive text messages."); return; }
      smsSubmit.disabled  = true;
      smsSubmit.innerText = "Sending...";
      try {
        const res = await fetch(`${apiBase}/api/widget/start-sms`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tenantId, phone, consent: true, consentText: disclosureText, source: "widget_sms_popup", pageUrl: window.location.href, sessionId })
        });
        if (res.ok) {
          smsModal.innerHTML = `<div style="margin-top:50px"><div style="font-size:40px;margin-bottom:16px">✅</div><h3 style="margin-bottom:10px;color:${brandColor}">Message Sent!</h3><p style="color:#666;font-size:14px">Check your phone — we've started the conversation.</p><button onclick="this.closest('#ai-sms-modal').style.display='none'" style="margin-top:24px;background:${brandColor};color:#fff;padding:10px 30px;border-radius:8px;border:none;cursor:pointer;font-weight:bold">Done</button></div>`;
          trackVisitor("sms_optin_success", { phone });
        } else {
          const err = await res.json();
          alert(err.error || "Failed to send. Please try again.");
          smsSubmit.disabled = false; smsSubmit.innerText = "Start Texting";
        }
      } catch {
        alert("Connection error. Please try again.");
        smsSubmit.disabled = false; smsSubmit.innerText = "Start Texting";
      }
    };

    const checkPhone = setInterval(() => {
      if (twilioPhoneNumber) {
        clearInterval(checkPhone);
        smsBtn.style.display = "flex";
      }
    }, 500);
    setTimeout(() => clearInterval(checkPhone), 10000);

    // ── Send message ──────────────────────────────────────────────────────────
    async function handleSend() {
      const val = input.value.trim();
      if (!val) return;
      addMsg(val, true);
      input.value = "";
      showTyping();
      try {
        const response = await fetch(`${apiBase}/website-chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: val, tenantId, sessionId })
        });
        const data = await response.json();
        hideTyping();
        trackVisitor("message_sent", { message: val });

        // Phase 8.1 (May 12, 2026) — when the owner has taken over this lead
        // via the dashboard, /website-chat returns { reply: null, handoff: true }.
        // Don't render anything on the customer side — the owner is replying
        // out-of-band (currently via SMS). The customer's own message is still
        // visible in their chat window (rendered above via addMsg(val, true)),
        // and the inbound is recorded in the dashboard timeline for the owner.
        //
        // Lead capture and quote capture still flow through if present —
        // those are independent of the AI reply and useful regardless of
        // handoff state.
        if (data.handoff) {
          console.log("[AI-Widget] Handoff active — AI reply suppressed");
          // Phase 8.2a (May 12, 2026) — show a one-time "team member will reach out"
          // notice so the customer doesn't think the chat broke. Uses the existing
          // hasWelcomed-style pattern: a module-scoped flag persists for the session.
          // Resets on page reload (new sessionId, new hasShownHandoffNotice).
          if (!hasShownHandoffNotice) {
            addMsg("Thanks! A team member will follow up with you shortly.", false);
            hasShownHandoffNotice = true;
          }
        } else if (data.reply) {
          addMsg(data.reply, false);
        } else {
          // No reply and no handoff — unexpected empty response, show fallback
          addMsg("I'm sorry, I encountered an issue.", false);
        }

        if (data.lead_capture && Object.keys(data.lead_capture).length > 0) sendLeadToCRM(data.lead_capture);
        if (data.quote_capture) addMsg("📋 Quote request received. We'll be in touch shortly!", false);
      } catch (err) {
        hideTyping();
        addMsg("Connection error. Please check your internet.", false);
        console.error("[AI-Widget] Send error:", err);
      }
    }

    sendBtn.onclick  = handleSend;
    input.onkeypress = (e) => { if (e.key === "Enter") handleSend(); };
    console.log("[AI-Widget] UI ready.");

    // ── Auto-start (Phase 7 V2 — May 4, 2026) ────────────────────────────────
    // When the customer arrives via the /q/:tenantId hosted landing page
    // (sent by AI's send_estimate_link voice tool), the wrapper page has
    // injected window.__aiWidgetAutoStart BEFORE this script loaded. Read
    // it now and auto-open + auto-trigger the estimator flow.
    //
    // Defensive: requires both flags. Auto-start without auto-open would
    // start the estimator behind a closed chat window — bad UX. Auto-open
    // without auto-start just opens the chat, which is fine for other flows.
    if (window.__aiWidgetAutoStart) {
      const auto = window.__aiWidgetAutoStart;
      console.log("[AI-Widget] Auto-start hint received:", auto);
      if (auto.openChat) {
        // Small delay so the animations + container layout settle before
        // we trigger the open transition. Without this, the chat window
        // can render in a weird half-state on slow devices.
        setTimeout(() => {
          openChat();
          if (auto.startEstimator) {
            if (estimatorEnabled) {
              // Wait for the welcome message bubble to render before kicking
              // off the estimator flow — avoids a janky "two bubbles appear
              // at once" effect. 700ms matches the welcome's natural cadence.
              setTimeout(() => startEstimatorFlow(), 700);
            } else {
              console.warn("[AI-Widget] Auto-start requested estimator but estimatorEnabled=false (tenant config missing or 404)");
            }
          }
        }, 250);
      }
    }
  }

  // ── Boot ───────────────────────────────────────────────────────────────────
  if (document.readyState === "complete" || document.readyState === "interactive") {
    initWidget().then(createUI);
  } else {
    window.addEventListener("DOMContentLoaded", () => initWidget().then(createUI));
  }
})();
