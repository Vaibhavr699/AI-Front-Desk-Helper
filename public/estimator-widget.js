(function () {
  // ============================================================================
  // estimator-widget.js
  // ============================================================================
  // Phase 7 V1 — Standalone proactive estimator popup widget.
  //
  // Coexists with chat-widget.js — chat lives bottom-RIGHT, estimator bottom-LEFT.
  // Both can be loaded on the same page without collision.
  //
  // Embed:
  //   <script src="https://ai-front-desk-backend.onrender.com/estimator-widget.js"
  //           data-tenant-id="<uuid>" async></script>
  //
  // Manual trigger from painter's own button:
  //   <button onclick="window.AIEstimator.open()">Get Ballpark Pricing</button>
  //
  // Architecture mirrors chat-widget.js:
  //   - IIFE namespace isolation
  //   - data-tenant-id from script tag
  //   - branding load via /api/public-tenant/:tenantId
  //   - estimator config load via /api/estimator/tenant-config/:tenantId
  //   - mobile media queries match chat-widget.js (≤640px = full-screen modal)
  //
  // Language note: this widget uses "ballpark" not "estimate" everywhere user-
  // facing. Estimates are quasi-binding in some states; ballpark sets correct
  // expectations and protects the painter legally.
  // ============================================================================

  if (window.__aiEstimatorWidgetLoaded) return;
  window.__aiEstimatorWidgetLoaded = true;

  console.log("[AI-Estimator] Script initializing...");

  // ── Script tag detection ──────────────────────────────────────────────────
  let scriptTag = document.currentScript;
  if (!scriptTag) {
    const scripts = document.getElementsByTagName("script");
    for (let i = 0; i < scripts.length; i++) {
      if (scripts[i].src && scripts[i].src.includes("estimator-widget.js")) {
        scriptTag = scripts[i];
        break;
      }
    }
  }

  const tenantId  = scriptTag ? scriptTag.getAttribute("data-tenant-id") : null;
  const scriptUrl = scriptTag ? new URL(scriptTag.src) : null;
  const apiBase   = scriptUrl ? scriptUrl.origin : "https://ai-front-desk-backend.onrender.com";

  console.log("[AI-Estimator] Context:", { tenantId, apiBase });

  // ── Session tracking (parallel to chat-widget.js but separate key) ────────
  let sessionId = localStorage.getItem("ai_estimator_session_id");
  if (!sessionId) {
    sessionId = "est-" + (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2));
    localStorage.setItem("ai_estimator_session_id", sessionId);
  }

  // ── Branding defaults (overridden by tenant config) ───────────────────────
  let companyName = "our team";
  let brandColor  = "#E8600A"; // Default Gladiators orange — overridden per tenant
  let logoUrl     = null;
  let isOpen      = false;

  // ── Estimator-specific state ──────────────────────────────────────────────
  let estimatorConfig = null;  // Loaded from /api/estimator/tenant-config/
  let widgetEnabled   = false; // Gated by tenant.estimator_widget_enabled

  // ── Mobile detection (matches chat-widget.js breakpoint exactly) ──────────
  const MOBILE_BP = 640;
  function isMobile() { return window.innerWidth <= MOBILE_BP; }

  // ── Helper: lighten hex color for hover (mirrors chat-widget.js) ──────────
  function lightenColor(hex, amount) {
    try {
      const num = parseInt(hex.replace("#", ""), 16);
      const r   = Math.min(255, (num >> 16) + amount);
      const g   = Math.min(255, ((num >> 8) & 0xff) + amount);
      const b   = Math.min(255, (num & 0xff) + amount);
      return "#" + ((r << 16) | (g << 8) | b).toString(16).padStart(6, "0");
    } catch { return hex; }
  }

  // ── Init: fetch branding + estimator config in parallel ───────────────────
  async function initWidget() {
    if (!tenantId) {
      console.error("[AI-Estimator] No tenantId. Script tag must have data-tenant-id.");
      return false;
    }

    try {
      const [brandingRes, configRes] = await Promise.all([
        fetch(`${apiBase}/api/public-tenant/${tenantId}`).then(r => r.ok ? r.json() : null),
        fetch(`${apiBase}/api/estimator/tenant-config/${tenantId}`).then(r => r.ok ? r.json() : null)
      ]);

      if (brandingRes) {
        if (brandingRes.company_name || brandingRes.name) {
          companyName = brandingRes.company_name || brandingRes.name;
        }
        if (brandingRes.brand_color) brandColor = brandingRes.brand_color;
        if (brandingRes.logo_url)    logoUrl    = brandingRes.logo_url;
      }

      if (configRes) {
        estimatorConfig = configRes;
        widgetEnabled = true;
        console.log("[AI-Estimator] Loaded config for:", companyName, "| services:", configRes.services?.length || 0);
      } else {
        console.warn("[AI-Estimator] Config fetch failed — widget likely not enabled for this tenant.");
        return false;
      }

      return true;
    } catch (err) {
      console.error("[AI-Estimator] Init error:", err);
      return false;
    }
  }

  // ── Build the UI ──────────────────────────────────────────────────────────
  function createUI() {
    if (!document.body) {
      setTimeout(createUI, 50);
      return;
    }
    if (!widgetEnabled) {
      console.log("[AI-Estimator] Widget not enabled — skipping UI render.");
      return;
    }

    console.log("[AI-Estimator] Creating UI...");
    const hoverColor = lightenColor(brandColor, 20);

    // ── Animations + mobile CSS (matches chat-widget.js patterns) ──────────
    const style = document.createElement("style");
    style.innerHTML = `
      @keyframes ai-est-fadeIn  { from { opacity:0; transform:translateY(5px); } to { opacity:1; transform:translateY(0); } }
      @keyframes ai-est-slideIn { from { transform:translateX(-100px); opacity:0; } to { transform:translateX(0); opacity:1; } }
      @keyframes ai-est-pulse   { 0%,100%{transform:scale(1);box-shadow:0 4px 15px rgba(0,0,0,.2)} 50%{transform:scale(1.05);box-shadow:0 6px 20px rgba(0,0,0,.3)} }
      @keyframes ai-est-spin    { to { transform: rotate(360deg); } }

      .ai-est-fade-in   { animation: ai-est-fadeIn 0.3s ease; }
      .ai-est-slide-in  { animation: ai-est-slideIn 0.8s cubic-bezier(0.16,1,0.3,1); }
      .ai-est-pulse     { animation: ai-est-pulse 2s infinite ease-in-out; }
      .ai-est-spinner {
        width: 32px; height: 32px;
        border: 3px solid rgba(0,0,0,0.1);
        border-top-color: ${brandColor};
        border-radius: 50%;
        animation: ai-est-spin 0.8s linear infinite;
      }
      #ai-est-toggle:hover { opacity:0.9; transform:scale(1.05) !important; }

      /* Mobile rules (≤640px) — matches chat-widget.js patterns */
      @media (max-width: 640px) {
        #ai-est-modal {
          width: 100vw !important;
          height: 100vh !important;
          height: 100dvh !important;
          max-width: 100vw !important;
          right: 0 !important;
          left: 0 !important;
          top: 0 !important;
          bottom: 0 !important;
          border-radius: 0 !important;
        }
        #ai-est-toggle {
          width: 56px !important;
          height: 56px !important;
          padding: 0 !important;
          border-radius: 50% !important;
          font-size: 22px !important;
          bottom: 20px !important;
          left: 20px !important;
          display: flex !important;
          align-items: center !important;
          justify-content: center !important;
        }
      }
    `;
    document.head.appendChild(style);

    // ── Floating CTA button (bottom-LEFT to coexist with chat-widget.js) ──
    const toggle = document.createElement("div");
    toggle.id = "ai-est-toggle";
    toggle.className = "ai-est-slide-in";
    toggle.innerText = "💰 Get Ballpark Pricing";
    Object.assign(toggle.style, {
      position: "fixed", bottom: "30px", left: "30px",
      background: brandColor,
      color: "#fff", padding: "13px 24px",
      borderRadius: "30px", cursor: "pointer", zIndex: "2147483647",
      fontFamily: "'Inter', Arial, sans-serif",
      boxShadow: `0 4px 20px ${brandColor}55`,
      transition: "all 0.3s cubic-bezier(0.4,0,0.2,1)",
      fontWeight: "bold", fontSize: "15px", letterSpacing: "0.3px"
    });
    document.body.appendChild(toggle);

    // ── Modal container (will hold all screens) ──────────────────────────
    const modal = document.createElement("div");
    modal.id = "ai-est-modal";
    Object.assign(modal.style, {
      position: "fixed", bottom: "100px", left: "30px",
      width: "440px", maxHeight: "calc(100vh - 130px)", background: "#fff",
      border: "1px solid #eee", borderRadius: "18px",
      boxShadow: "0 15px 50px rgba(0,0,0,0.18)", display: "none",
      flexDirection: "column", zIndex: "2147483647", overflow: "hidden",
      fontFamily: "'Inter', Arial, sans-serif", opacity: "0",
      transform: "translateY(10px)",
      transition: "all 0.4s cubic-bezier(0.4,0,0.2,1)"
    });
    document.body.appendChild(modal);

    // ── Modal header (logo + close) ──────────────────────────────────────
    const header = document.createElement("div");
    Object.assign(header.style, {
      background: brandColor,
      color: "#fff", padding: "16px 18px",
      display: "flex", alignItems: "center", justifyContent: "space-between",
      gap: "10px", flexShrink: "0"
    });

    const headerLeft = document.createElement("div");
    headerLeft.style.display = "flex";
    headerLeft.style.alignItems = "center";
    headerLeft.style.gap = "10px";
    headerLeft.style.minWidth = "0";

    if (logoUrl) {
      const img = document.createElement("img");
      img.src = logoUrl;
      img.alt = companyName;
      Object.assign(img.style, {
        width: "32px", height: "32px", borderRadius: "50%",
        objectFit: "cover", border: "2px solid rgba(255,255,255,0.6)", flexShrink: "0"
      });
      headerLeft.appendChild(img);
    } else {
      const avatar = document.createElement("div");
      avatar.innerText = companyName.charAt(0).toUpperCase();
      Object.assign(avatar.style, {
        width: "32px", height: "32px", borderRadius: "50%",
        background: "rgba(255,255,255,0.25)", color: "#fff",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontWeight: "bold", fontSize: "14px", flexShrink: "0"
      });
      headerLeft.appendChild(avatar);
    }

    const headerInfo = document.createElement("div");
    headerInfo.style.minWidth = "0";
    const headerTitle = document.createElement("div");
    headerTitle.innerText = "Ballpark Pricing";
    Object.assign(headerTitle.style, {
      fontWeight: "700", fontSize: "15px",
      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"
    });
    const headerSubtitle = document.createElement("div");
    headerSubtitle.innerText = `from ${companyName}`;
    Object.assign(headerSubtitle.style, {
      fontSize: "11px", opacity: "0.85", marginTop: "1px",
      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"
    });
    headerInfo.appendChild(headerTitle);
    headerInfo.appendChild(headerSubtitle);
    headerLeft.appendChild(headerInfo);
    header.appendChild(headerLeft);

    const closeBtn = document.createElement("button");
    closeBtn.innerHTML = "&times;";
    closeBtn.type = "button";
    closeBtn.title = "Close";
    Object.assign(closeBtn.style, {
      width: "32px", height: "32px", borderRadius: "50%",
      border: "none", background: "rgba(255,255,255,0.2)", color: "#fff",
      cursor: "pointer", fontSize: "22px", fontWeight: "bold", lineHeight: "1",
      display: "flex", alignItems: "center", justifyContent: "center",
      flexShrink: "0", padding: "0"
    });
    header.appendChild(closeBtn);
    modal.appendChild(header);

    // ── Body container (screens render here) ─────────────────────────────
    const body = document.createElement("div");
    body.id = "ai-est-body";
    Object.assign(body.style, {
      flex: "1", overflowY: "auto", padding: "0",
      WebkitOverflowScrolling: "touch", background: "#fafafa"
    });
    modal.appendChild(body);

    // ── Loading state (default screen — replaced by service picker) ──────
    function renderLoading() {
      body.innerHTML = "";
      const wrapper = document.createElement("div");
      Object.assign(wrapper.style, {
        display: "flex", flexDirection: "column", alignItems: "center",
        justifyContent: "center", padding: "60px 20px", gap: "16px"
      });
      const spinner = document.createElement("div");
      spinner.className = "ai-est-spinner";
      const label = document.createElement("div");
      label.innerText = "Loading...";
      Object.assign(label.style, {
        fontSize: "13px", color: "#888", fontWeight: "500"
      });
      wrapper.appendChild(spinner);
      wrapper.appendChild(label);
      body.appendChild(wrapper);
    }
    renderLoading();

    // ── Open/close logic ─────────────────────────────────────────────────
    function openModal() {
      isOpen = true;
      modal.style.display = "flex";
      setTimeout(() => {
        modal.style.opacity = "1";
        modal.style.transform = "translateY(0)";
      }, 10);
      toggle.style.background = "#444";
      toggle.innerText = isMobile() ? "×" : "Close";
    }
    function closeModal() {
      isOpen = false;
      modal.style.opacity = "0";
      modal.style.transform = "translateY(10px)";
      setTimeout(() => { modal.style.display = "none"; }, 400);
      toggle.style.background = brandColor;
      toggle.innerText = isMobile() ? "💰" : "💰 Get Ballpark Pricing";
    }

    toggle.onclick = () => { isOpen ? closeModal() : openModal(); };
    closeBtn.onclick = () => { closeModal(); };

    // ── Click-outside to close ───────────────────────────────────────────
    document.addEventListener("click", (e) => {
      if (!isOpen) return;
      if (modal.contains(e.target) || toggle.contains(e.target)) return;
      closeModal();
    });

    // ── ESC to close ─────────────────────────────────────────────────────
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && isOpen) closeModal();
    });

    // ── Responsive layout sync ───────────────────────────────────────────
    function applyResponsive() {
      if (!isOpen) {
        toggle.innerText = isMobile() ? "💰" : "💰 Get Ballpark Pricing";
      } else {
        toggle.innerText = isMobile() ? "×" : "Close";
      }
    }
    window.addEventListener("resize", applyResponsive);
    window.addEventListener("orientationchange", applyResponsive);
    applyResponsive();

    // ── Public API for manual button triggers ────────────────────────────
    window.AIEstimator = {
      open: openModal,
      close: closeModal,
      isOpen: () => isOpen
    };

    console.log("[AI-Estimator] UI ready. Manual trigger: window.AIEstimator.open()");
  }

  // ── Boot ─────────────────────────────────────────────────────────────────
  function boot() {
    initWidget().then((ok) => {
      if (ok) createUI();
    });
  }
  if (document.readyState === "complete" || document.readyState === "interactive") {
    boot();
  } else {
    window.addEventListener("DOMContentLoaded", boot);
  }
})();
