(function () {
  // ============================================================================
  // estimator-widget.js — Phase 7 V1 Standalone Estimator Popup
  // ============================================================================
  // Coexists with chat-widget.js. Chat = bottom-RIGHT, Estimator = bottom-LEFT.
  //
  // Embed:
  //   <script src="https://ai-front-desk-backend.onrender.com/estimator-widget.js"
  //           data-tenant-id="<uuid>" async></script>
  //
  // Manual trigger:
  //   <button onclick="window.AIEstimator.open()">Get Ballpark Pricing</button>
  //
  // Language note: "ballpark" not "estimate" everywhere user-facing. Estimates
  // are quasi-binding in some states; ballpark sets correct expectations.
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

  // ── Session tracking ──────────────────────────────────────────────────────
  let sessionId = localStorage.getItem("ai_estimator_session_id");
  if (!sessionId) {
    sessionId = "est-" + (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2));
    localStorage.setItem("ai_estimator_session_id", sessionId);
  }

  // ── State ─────────────────────────────────────────────────────────────────
  let companyName = "our team";
  let brandColor  = "#E8600A";
  let logoUrl     = null;
  let isOpen      = false;
  let estimatorConfig = null;
  let widgetEnabled   = false;

  // Form state — preserved across screen transitions
  const formState = {
    service_slug: null,           // Selected service
    inputs: {},                   // Question answers keyed by question_slug
    rooms: [],                    // Interior service rooms
    quote_result: null,           // Result from /api/estimator/quote
    contact: { name: "", phone: "", email: "", address: "" }
  };

  // ── Mobile detection ──────────────────────────────────────────────────────
  const MOBILE_BP = 640;
  function isMobile() { return window.innerWidth <= MOBILE_BP; }

  function lightenColor(hex, amount) {
    try {
      const num = parseInt(hex.replace("#", ""), 16);
      const r = Math.min(255, (num >> 16) + amount);
      const g = Math.min(255, ((num >> 8) & 0xff) + amount);
      const b = Math.min(255, (num & 0xff) + amount);
      return "#" + ((r << 16) | (g << 8) | b).toString(16).padStart(6, "0");
    } catch { return hex; }
  }

  function formatCents(cents) {
    return "$" + Math.round(cents / 100).toLocaleString();
  }

  // ── Init ──────────────────────────────────────────────────────────────────
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
        if (brandingRes.company_name || brandingRes.name) companyName = brandingRes.company_name || brandingRes.name;
        if (brandingRes.brand_color) brandColor = brandingRes.brand_color;
        if (brandingRes.logo_url)    logoUrl    = brandingRes.logo_url;
      }
      if (configRes) {
        estimatorConfig = configRes;
        widgetEnabled = true;
        console.log("[AI-Estimator] Loaded for:", companyName, "| services:", configRes.services?.length || 0);
      } else {
        console.warn("[AI-Estimator] Widget not enabled for this tenant.");
        return false;
      }
      return true;
    } catch (err) {
      console.error("[AI-Estimator] Init error:", err);
      return false;
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // UI BUILDER
  // ──────────────────────────────────────────────────────────────────────────
  function createUI() {
    if (!document.body) { setTimeout(createUI, 50); return; }
    if (!widgetEnabled) { console.log("[AI-Estimator] Skipping render — disabled."); return; }

    // ── Styles ─────────────────────────────────────────────────────────────
    const style = document.createElement("style");
    style.innerHTML = `
      @keyframes ai-est-fadeIn  { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
      @keyframes ai-est-slideIn { from { transform:translateX(-100px); opacity:0; } to { transform:translateX(0); opacity:1; } }
      @keyframes ai-est-spin    { to { transform: rotate(360deg); } }

      .ai-est-screen { animation: ai-est-fadeIn 0.25s ease; }
      .ai-est-slide-in { animation: ai-est-slideIn 0.7s cubic-bezier(0.16,1,0.3,1); }
      .ai-est-spinner {
        width: 28px; height: 28px;
        border: 3px solid rgba(0,0,0,0.1);
        border-top-color: ${brandColor};
        border-radius: 50%;
        animation: ai-est-spin 0.8s linear infinite;
      }
      .ai-est-btn {
        display: inline-flex; align-items: center; justify-content: center; gap: 6px;
        padding: 12px 20px; border-radius: 12px; font-weight: 700; font-size: 14px;
        cursor: pointer; border: none; transition: all 0.2s; font-family: inherit;
      }
      .ai-est-btn-primary { background: ${brandColor}; color: #fff; }
      .ai-est-btn-primary:hover { background: ${lightenColor(brandColor, -15)}; }
      .ai-est-btn-secondary { background: #f0f0f0; color: #333; }
      .ai-est-btn-secondary:hover { background: #e5e5e5; }
      .ai-est-input {
        width: 100%; padding: 11px 14px; border: 1.5px solid #e0e0e0; border-radius: 10px;
        font-size: 15px; outline: none; font-family: inherit; box-sizing: border-box;
        background: #fff; color: #222; transition: border-color 0.2s;
      }
      .ai-est-input:focus { border-color: ${brandColor}; }
      .ai-est-label {
        display: block; font-weight: 600; font-size: 13px; color: #444;
        margin-bottom: 6px; letter-spacing: 0.2px;
      }
      .ai-est-helper { font-size: 11px; color: #888; margin-top: 4px; line-height: 1.4; }
      .ai-est-card {
        padding: 14px 16px; border: 2px solid #e8e8e8; border-radius: 12px; cursor: pointer;
        transition: all 0.2s; background: #fff; text-align: left; width: 100%;
        font-family: inherit; font-size: 14px; color: #222; font-weight: 500;
      }
      .ai-est-card:hover { border-color: ${brandColor}; background: ${brandColor}08; }
      .ai-est-card.selected { border-color: ${brandColor}; background: ${brandColor}12; }
      .ai-est-checkbox-row {
        display: flex; align-items: center; gap: 10px; padding: 10px 12px;
        border-radius: 8px; cursor: pointer; transition: background 0.15s;
      }
      .ai-est-checkbox-row:hover { background: #f5f5f5; }

      #ai-est-toggle:hover { opacity:0.9; transform:scale(1.05) !important; }

      @media (max-width: 640px) {
        #ai-est-modal {
          width: 100vw !important;
          height: 100vh !important;
          height: 100dvh !important;
          max-width: 100vw !important;
          max-height: 100vh !important;
          right: 0 !important; left: 0 !important;
          top: 0 !important; bottom: 0 !important;
          border-radius: 0 !important;
        }
        #ai-est-toggle {
          width: 56px !important; height: 56px !important;
          padding: 0 !important; border-radius: 50% !important;
          font-size: 22px !important;
          bottom: 20px !important; left: 20px !important;
          display: flex !important; align-items: center !important; justify-content: center !important;
        }
      }
    `;
    document.head.appendChild(style);

    // ── Floating CTA ───────────────────────────────────────────────────────
    const toggle = document.createElement("div");
    toggle.id = "ai-est-toggle";
    toggle.className = "ai-est-slide-in";
    toggle.innerText = "💰 Get Ballpark Pricing";
    Object.assign(toggle.style, {
      position: "fixed", bottom: "30px", left: "30px",
      background: brandColor, color: "#fff", padding: "13px 24px",
      borderRadius: "30px", cursor: "pointer", zIndex: "2147483647",
      fontFamily: "'Inter', Arial, sans-serif",
      boxShadow: `0 4px 20px ${brandColor}55`,
      transition: "all 0.3s cubic-bezier(0.4,0,0.2,1)",
      fontWeight: "bold", fontSize: "15px", letterSpacing: "0.3px"
    });
    document.body.appendChild(toggle);

    // ── Modal ──────────────────────────────────────────────────────────────
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

    // ── Header ─────────────────────────────────────────────────────────────
    const header = document.createElement("div");
    Object.assign(header.style, {
      background: brandColor, color: "#fff", padding: "16px 18px",
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
    Object.assign(headerTitle.style, { fontWeight: "700", fontSize: "15px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" });
    const headerSubtitle = document.createElement("div");
    headerSubtitle.innerText = `from ${companyName}`;
    Object.assign(headerSubtitle.style, { fontSize: "11px", opacity: "0.85", marginTop: "1px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" });
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

    // ── Body ───────────────────────────────────────────────────────────────
    const body = document.createElement("div");
    body.id = "ai-est-body";
    Object.assign(body.style, {
      flex: "1", overflowY: "auto", padding: "0",
      WebkitOverflowScrolling: "touch", background: "#fafafa"
    });
    modal.appendChild(body);

    // ──────────────────────────────────────────────────────────────────────
    // SCREEN RENDERERS
    // ──────────────────────────────────────────────────────────────────────

    function renderScreen(contentEl) {
      body.innerHTML = "";
      const wrapper = document.createElement("div");
      wrapper.className = "ai-est-screen";
      wrapper.style.padding = "20px";
      wrapper.appendChild(contentEl);
      body.appendChild(wrapper);
      body.scrollTop = 0;
    }

    function renderLoading(label = "Loading...") {
      const el = document.createElement("div");
      Object.assign(el.style, {
        display: "flex", flexDirection: "column", alignItems: "center",
        justifyContent: "center", padding: "60px 20px", gap: "16px"
      });
      const spinner = document.createElement("div");
      spinner.className = "ai-est-spinner";
      const lbl = document.createElement("div");
      lbl.innerText = label;
      Object.assign(lbl.style, { fontSize: "13px", color: "#888", fontWeight: "500" });
      el.appendChild(spinner);
      el.appendChild(lbl);
      renderScreen(el);
    }

    function renderError(message, onRetry) {
      const el = document.createElement("div");
      el.style.textAlign = "center";
      el.style.padding = "20px 0";
      const icon = document.createElement("div");
      icon.innerText = "⚠️";
      icon.style.fontSize = "32px";
      icon.style.marginBottom = "12px";
      const msg = document.createElement("div");
      msg.innerText = message;
      Object.assign(msg.style, { fontSize: "14px", color: "#444", marginBottom: "16px", lineHeight: "1.5" });
      el.appendChild(icon);
      el.appendChild(msg);
      if (onRetry) {
        const btn = document.createElement("button");
        btn.className = "ai-est-btn ai-est-btn-primary";
        btn.innerText = "Try again";
        btn.onclick = onRetry;
        el.appendChild(btn);
      }
      renderScreen(el);
    }

    // ── Screen 1: Service picker ──────────────────────────────────────────
    function renderServicePicker() {
      const el = document.createElement("div");
      const title = document.createElement("h3");
      title.innerText = "What kind of project?";
      Object.assign(title.style, { margin: "0 0 6px 0", fontSize: "18px", fontWeight: "700", color: "#1a1a1a" });
      const subtitle = document.createElement("p");
      subtitle.innerText = "Pick the closest match. Specialized projects route to an in-person walkthrough.";
      Object.assign(subtitle.style, { margin: "0 0 18px 0", fontSize: "13px", color: "#666", lineHeight: "1.5" });
      el.appendChild(title);
      el.appendChild(subtitle);

      const grid = document.createElement("div");
      Object.assign(grid.style, { display: "flex", flexDirection: "column", gap: "10px" });

      const services = (estimatorConfig.services || []).filter(s => !s.is_specialized);
      const serviceIcons = {
        interior:   "🏠",
        exterior:   "🎨",
        cabinets:   "🚪",
        deck_fence: "🪵"
      };

      services.forEach(svc => {
        const card = document.createElement("button");
        card.className = "ai-est-card";
        card.type = "button";
        const icon = serviceIcons[svc.service_slug] || "✨";
        card.innerHTML = `<span style="font-size:22px;margin-right:10px;vertical-align:middle">${icon}</span><span style="vertical-align:middle">${svc.display_name}</span>`;
        card.onclick = () => {
          formState.service_slug = svc.service_slug;
          formState.inputs = {};
          formState.rooms = [];
          renderQuestions();
        };
        grid.appendChild(card);
      });

      // Specialized option
      const specialized = document.createElement("button");
      specialized.className = "ai-est-card";
      specialized.type = "button";
      specialized.innerHTML = `<span style="font-size:22px;margin-right:10px;vertical-align:middle">🛠️</span><span style="vertical-align:middle">Specialized project (in-person estimate)</span>`;
      specialized.onclick = () => {
        formState.service_slug = "specialized";
        formState.quote_result = {
          specialized: true,
          reason: "Specialized projects need an in-person walkthrough so we can see the details that affect pricing.",
          trigger: { question: "service_type", value: "specialized" },
          quote: null
        };
        renderSpecializedResult();
      };
      grid.appendChild(specialized);

      el.appendChild(grid);
      renderScreen(el);
    }

    // ── Screen 2: Service-specific questions ──────────────────────────────
    function renderQuestions() {
      const el = document.createElement("div");

      // Back button
      const backRow = document.createElement("div");
      backRow.style.marginBottom = "12px";
      const backBtn = document.createElement("button");
      backBtn.type = "button";
      backBtn.innerText = "← Back";
      Object.assign(backBtn.style, {
        background: "none", border: "none", color: "#666", fontSize: "13px",
        fontWeight: "600", cursor: "pointer", padding: "0", fontFamily: "inherit"
      });
      backBtn.onclick = () => renderServicePicker();
      backRow.appendChild(backBtn);
      el.appendChild(backRow);

      const service = (estimatorConfig.services || []).find(s => s.service_slug === formState.service_slug);
      const title = document.createElement("h3");
      title.innerText = service?.display_name || "Project details";
      Object.assign(title.style, { margin: "0 0 6px 0", fontSize: "18px", fontWeight: "700", color: "#1a1a1a" });
      el.appendChild(title);

      const subtitle = document.createElement("p");
      subtitle.innerText = "Answer a few quick questions for your ballpark range.";
      Object.assign(subtitle.style, { margin: "0 0 18px 0", fontSize: "13px", color: "#666", lineHeight: "1.5" });
      el.appendChild(subtitle);

      // Filter questions for this service (or universal where service_slug=null)
      const questions = (estimatorConfig.questions || []).filter(q =>
        q.service_slug === formState.service_slug ||
        (q.service_slug === null && q.question_slug !== "service_type" && q.question_slug !== "special_notes")
      );

      const form = document.createElement("div");
      Object.assign(form.style, { display: "flex", flexDirection: "column", gap: "16px" });

      questions.forEach(q => {
        const block = renderQuestion(q);
        if (block) form.appendChild(block);
      });

      el.appendChild(form);

      // Submit button
      const submitRow = document.createElement("div");
      submitRow.style.marginTop = "20px";
      const submitBtn = document.createElement("button");
      submitBtn.className = "ai-est-btn ai-est-btn-primary";
      submitBtn.type = "button";
      submitBtn.innerText = "Get my ballpark range →";
      submitBtn.style.width = "100%";
      submitBtn.style.padding = "14px";
      submitBtn.style.fontSize = "15px";
      submitBtn.onclick = () => submitQuote();
      submitRow.appendChild(submitBtn);
      el.appendChild(submitRow);

      // Disclaimer
      const disclaimer = document.createElement("p");
      disclaimer.innerText = "Final pricing requires an in-person walkthrough. This is just a ballpark.";
      Object.assign(disclaimer.style, { fontSize: "11px", color: "#999", marginTop: "12px", textAlign: "center", lineHeight: "1.4" });
      el.appendChild(disclaimer);

      renderScreen(el);
    }

    // ── Question renderer (handles all 7 question types) ──────────────────
    function renderQuestion(q) {
      const wrapper = document.createElement("div");

      const label = document.createElement("label");
      label.className = "ai-est-label";
      label.innerText = q.label + (q.required ? " *" : "");
      wrapper.appendChild(label);

      if (q.helper_text) {
        const helper = document.createElement("div");
        helper.className = "ai-est-helper";
        helper.innerText = q.helper_text;
        helper.style.marginBottom = "8px";
        helper.style.marginTop = "0";
        wrapper.appendChild(helper);
      }

      // Type-specific input
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
        sel.onchange = () => { formState.inputs[q.question_slug] = sel.value; };
        if (formState.inputs[q.question_slug]) sel.value = formState.inputs[q.question_slug];
        wrapper.appendChild(sel);

      } else if (q.question_type === "yes_no") {
        const row = document.createElement("div");
        row.style.display = "flex";
        row.style.gap = "8px";
        (q.options || []).forEach(opt => {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "ai-est-card";
          btn.innerText = opt.label;
          btn.style.flex = "1";
          btn.style.textAlign = "center";
          btn.style.padding = "10px";
          if (formState.inputs[q.question_slug] === opt.value) btn.classList.add("selected");
          btn.onclick = () => {
            formState.inputs[q.question_slug] = opt.value;
            row.querySelectorAll(".ai-est-card").forEach(b => b.classList.remove("selected"));
            btn.classList.add("selected");
          };
          row.appendChild(btn);
        });
        wrapper.appendChild(row);

      } else if (q.question_type === "multi_select") {
        const grid = document.createElement("div");
        grid.style.display = "flex";
        grid.style.flexDirection = "column";
        grid.style.gap = "4px";
        const selected = formState.inputs[q.question_slug] || [];
        (q.options || []).forEach(opt => {
          const row = document.createElement("label");
          row.className = "ai-est-checkbox-row";
          const cb = document.createElement("input");
          cb.type = "checkbox";
          cb.value = opt.value;
          cb.checked = selected.includes(opt.value);
          cb.style.accentColor = brandColor;
          cb.style.width = "18px";
          cb.style.height = "18px";
          cb.onchange = () => {
            const cur = formState.inputs[q.question_slug] || [];
            if (cb.checked) {
              if (!cur.includes(opt.value)) cur.push(opt.value);
            } else {
              const i = cur.indexOf(opt.value);
              if (i >= 0) cur.splice(i, 1);
            }
            formState.inputs[q.question_slug] = cur;
          };
          const txt = document.createElement("span");
          txt.innerText = opt.label;
          txt.style.fontSize = "14px";
          txt.style.color = "#222";
          row.appendChild(cb);
          row.appendChild(txt);
          grid.appendChild(row);
        });
        wrapper.appendChild(grid);

      } else if (q.question_type === "multi_select_with_count") {
        // Interior rooms_to_paint — render as list with +/- count per room
        const grid = document.createElement("div");
        grid.style.display = "flex";
        grid.style.flexDirection = "column";
        grid.style.gap = "6px";
        (q.options || []).forEach(opt => {
          const existingRoom = formState.rooms.find(r => r.type === opt.value);
          const row = document.createElement("div");
          Object.assign(row.style, {
            display: "flex", alignItems: "center", gap: "10px",
            padding: "8px 10px", borderRadius: "8px", background: "#fff",
            border: "1px solid #eee"
          });
          const lbl = document.createElement("div");
          lbl.innerText = opt.label;
          lbl.style.flex = "1";
          lbl.style.fontSize = "14px";
          lbl.style.color = "#222";
          const minus = document.createElement("button");
          minus.type = "button";
          minus.innerText = "−";
          Object.assign(minus.style, {
            width: "28px", height: "28px", border: "1px solid #ddd",
            background: "#fff", borderRadius: "6px", cursor: "pointer",
            fontSize: "16px", fontFamily: "inherit"
          });
          const count = document.createElement("span");
          count.innerText = existingRoom ? existingRoom.count : 0;
          Object.assign(count.style, { minWidth: "20px", textAlign: "center", fontWeight: "600", fontSize: "14px" });
          const plus = document.createElement("button");
          plus.type = "button";
          plus.innerText = "+";
          Object.assign(plus.style, {
            width: "28px", height: "28px", border: "1px solid #ddd",
            background: "#fff", borderRadius: "6px", cursor: "pointer",
            fontSize: "16px", fontFamily: "inherit"
          });
          minus.onclick = () => {
            const r = formState.rooms.find(r => r.type === opt.value);
            if (r && r.count > 0) {
              r.count--;
              if (r.count === 0) formState.rooms = formState.rooms.filter(rr => rr.type !== opt.value);
            }
            count.innerText = (formState.rooms.find(r => r.type === opt.value) || { count: 0 }).count;
          };
          plus.onclick = () => {
            let r = formState.rooms.find(r => r.type === opt.value);
            if (!r) {
              r = { type: opt.value, count: 0, size: "medium" };
              formState.rooms.push(r);
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
        wrapper.appendChild(grid);

        // Default room size selector for all selected rooms
        const sizeWrap = document.createElement("div");
        sizeWrap.style.marginTop = "12px";
        const sizeLabel = document.createElement("div");
        sizeLabel.className = "ai-est-helper";
        sizeLabel.innerText = "Average room size:";
        sizeLabel.style.marginBottom = "6px";
        sizeWrap.appendChild(sizeLabel);
        const sizeRow = document.createElement("div");
        sizeRow.style.display = "flex";
        sizeRow.style.gap = "6px";
        ["small", "medium", "large", "xl"].forEach(size => {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "ai-est-card";
          btn.innerText = size === "xl" ? "XL" : size.charAt(0).toUpperCase() + size.slice(1);
          btn.style.flex = "1";
          btn.style.padding = "8px";
          btn.style.fontSize = "12px";
          btn.style.textAlign = "center";
          if (!formState._roomSize) formState._roomSize = "medium";
          if (formState._roomSize === size) btn.classList.add("selected");
          btn.onclick = () => {
            formState._roomSize = size;
            formState.rooms.forEach(r => r.size = size);
            sizeRow.querySelectorAll(".ai-est-card").forEach(b => b.classList.remove("selected"));
            btn.classList.add("selected");
          };
          sizeRow.appendChild(btn);
        });
        sizeWrap.appendChild(sizeRow);
        wrapper.appendChild(sizeWrap);

      } else if (q.question_type === "number") {
        const inp = document.createElement("input");
        inp.type = "number";
        inp.className = "ai-est-input";
        const opts = q.options || {};
        if (opts.min !== undefined)  inp.min  = opts.min;
        if (opts.max !== undefined)  inp.max  = opts.max;
        if (opts.step !== undefined) inp.step = opts.step;
        if (opts.unit) inp.placeholder = opts.unit;
        if (formState.inputs[q.question_slug]) inp.value = formState.inputs[q.question_slug];
        inp.oninput = () => { formState.inputs[q.question_slug] = parseFloat(inp.value) || 0; };
        wrapper.appendChild(inp);

      } else if (q.question_type === "year_input") {
        const inp = document.createElement("input");
        inp.type = "number";
        inp.className = "ai-est-input";
        inp.placeholder = "YYYY";
        const opts = q.options || {};
        inp.min = opts.min || 1850;
        inp.max = opts.max || new Date().getFullYear();
        if (formState.inputs[q.question_slug]) inp.value = formState.inputs[q.question_slug];
        inp.oninput = () => {
          const y = parseInt(inp.value, 10);
          if (!y) return;
          // Map year → bucket per the migration's year_built modifier options
          let bucket = "1978_2000";
          if (y < 1978) bucket = "pre_1978";
          else if (y >= 2000) bucket = "2000_plus";
          formState.inputs[q.question_slug] = bucket;
        };
        wrapper.appendChild(inp);

      } else if (q.question_type === "size_bucket") {
        // Used for room_size on interior — but rooms handle their own sizing inline above.
        // For other contexts, render as button row.
        const row = document.createElement("div");
        row.style.display = "flex";
        row.style.gap = "6px";
        row.style.flexWrap = "wrap";
        (q.options || []).forEach(opt => {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "ai-est-card";
          btn.innerText = opt.label;
          btn.style.flex = "1";
          btn.style.minWidth = "100px";
          btn.style.padding = "10px";
          btn.style.fontSize = "12px";
          btn.style.textAlign = "center";
          if (formState.inputs[q.question_slug] === opt.value) btn.classList.add("selected");
          btn.onclick = () => {
            formState.inputs[q.question_slug] = opt.value;
            row.querySelectorAll(".ai-est-card").forEach(b => b.classList.remove("selected"));
            btn.classList.add("selected");
          };
          row.appendChild(btn);
        });
        wrapper.appendChild(row);

      } else if (q.question_type === "text") {
        const ta = document.createElement("textarea");
        ta.className = "ai-est-input";
        ta.rows = 3;
        ta.style.resize = "vertical";
        if (formState.inputs[q.question_slug]) ta.value = formState.inputs[q.question_slug];
        ta.oninput = () => { formState.inputs[q.question_slug] = ta.value; };
        wrapper.appendChild(ta);

      } else {
        // Unknown type — skip
        return null;
      }

      return wrapper;
    }

    // ── Submit quote ──────────────────────────────────────────────────────
    async function submitQuote() {
      renderLoading("Calculating your ballpark range...");

      // Build inputs payload — interior needs special handling for rooms array
      const inputs = { ...formState.inputs };
      if (formState.service_slug === "interior") {
        // Build rooms array with size from _roomSize
        inputs.rooms = formState.rooms
          .filter(r => r.count > 0)
          .map(r => ({ size: r.size || formState._roomSize || "medium", count: r.count }));
      }

      try {
        const res = await fetch(`${apiBase}/api/estimator/quote`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tenant_id: tenantId,
            service_slug: formState.service_slug,
            inputs
          })
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || `Server returned ${res.status}`);
        }
        const data = await res.json();
        formState.quote_result = data;

        if (data.specialized) {
          renderSpecializedResult();
        } else {
          renderQuoteResult();
        }
      } catch (err) {
        console.error("[AI-Estimator] Quote error:", err);
        renderError(
          "We hit a snag calculating your range. Mind trying again? If it keeps happening, just give us a call.",
          () => submitQuote()
        );
      }
    }

    // ── Screen 3a: Quote result (ballpark range) ──────────────────────────
    function renderQuoteResult() {
      const el = document.createElement("div");
      const r = formState.quote_result;

      const title = document.createElement("h3");
      title.innerText = "Your Ballpark Range";
      Object.assign(title.style, { margin: "0 0 8px 0", fontSize: "16px", fontWeight: "600", color: "#666", textAlign: "center" });
      el.appendChild(title);

      // Big number
      const range = document.createElement("div");
      const minStr = formatCents(r.range_min_cents);
      const maxStr = formatCents(r.range_max_cents);
      range.innerText = (r.range_min_cents === r.range_max_cents) ? minStr : `${minStr} – ${maxStr}`;
      Object.assign(range.style, {
        fontSize: "32px", fontWeight: "800", color: "#1a1a1a",
        textAlign: "center", margin: "8px 0 6px 0", letterSpacing: "-0.5px"
      });
      el.appendChild(range);

      const sub = document.createElement("p");
      sub.innerText = "Based on the details you shared.";
      Object.assign(sub.style, { margin: "0 0 20px 0", fontSize: "13px", color: "#888", textAlign: "center" });
      el.appendChild(sub);

      // Disclaimer box
      const disclaimer = document.createElement("div");
      Object.assign(disclaimer.style, {
        background: "#fff8e1", border: "1px solid #ffe082", borderRadius: "10px",
        padding: "12px 14px", marginBottom: "20px"
      });
      disclaimer.innerHTML = `<strong style="display:block;font-size:12px;margin-bottom:4px;color:#7a5b00">⚠️ This is a ballpark, not a final quote.</strong><span style="font-size:12px;color:#7a5b00;line-height:1.5">Final pricing requires an in-person walkthrough where we can see the actual condition, prep needs, and details that affect the quote.</span>`;
      el.appendChild(disclaimer);

      // CTA: Get exact pricing
      const ctaTitle = document.createElement("h4");
      ctaTitle.innerText = "Get exact pricing";
      Object.assign(ctaTitle.style, { margin: "0 0 4px 0", fontSize: "15px", fontWeight: "700", color: "#1a1a1a" });
      el.appendChild(ctaTitle);

      const ctaSub = document.createElement("p");
      ctaSub.innerText = "Schedule a free in-person walkthrough — usually within 24 hours.";
      Object.assign(ctaSub.style, { margin: "0 0 14px 0", fontSize: "12px", color: "#666", lineHeight: "1.5" });
      el.appendChild(ctaSub);

      const form = renderContactForm(false);
      el.appendChild(form);

      renderScreen(el);
    }

    // ── Screen 3b: Specialized routing ────────────────────────────────────
    function renderSpecializedResult() {
      const el = document.createElement("div");
      const r = formState.quote_result;

      const icon = document.createElement("div");
      icon.innerText = "👋";
      Object.assign(icon.style, { fontSize: "40px", textAlign: "center", marginBottom: "10px" });
      el.appendChild(icon);

      const title = document.createElement("h3");
      title.innerText = "Let's see this in person";
      Object.assign(title.style, { margin: "0 0 8px 0", fontSize: "18px", fontWeight: "700", color: "#1a1a1a", textAlign: "center" });
      el.appendChild(title);

      const sub = document.createElement("p");
      sub.innerText = r.reason || "This kind of project needs an in-person look so we can give you accurate pricing.";
      Object.assign(sub.style, { margin: "0 0 20px 0", fontSize: "13px", color: "#666", textAlign: "center", lineHeight: "1.5" });
      el.appendChild(sub);

      const ctaTitle = document.createElement("h4");
      ctaTitle.innerText = "Schedule a free walkthrough";
      Object.assign(ctaTitle.style, { margin: "0 0 4px 0", fontSize: "15px", fontWeight: "700", color: "#1a1a1a" });
      el.appendChild(ctaTitle);

      const ctaSub = document.createElement("p");
      ctaSub.innerText = "We'll come out, look at your project, and give you a real quote — usually within 24 hours.";
      Object.assign(ctaSub.style, { margin: "0 0 14px 0", fontSize: "12px", color: "#666", lineHeight: "1.5" });
      el.appendChild(ctaSub);

      const form = renderContactForm(true);
      el.appendChild(form);

      renderScreen(el);
    }

    // ── Contact form (used by both quote result + specialized) ────────────
    function renderContactForm(isSpecialized) {
      const wrapper = document.createElement("div");
      Object.assign(wrapper.style, { display: "flex", flexDirection: "column", gap: "10px" });

      const fields = [
        { key: "name",    label: "Your name *",   type: "text",  placeholder: "First and last name" },
        { key: "phone",   label: "Phone *",        type: "tel",   placeholder: "(555) 555-5555" },
        { key: "email",   label: "Email *",        type: "email", placeholder: "you@example.com" },
        { key: "address", label: "Project address (optional)", type: "text", placeholder: "Street, city, ZIP" }
      ];

      fields.forEach(f => {
        const w = document.createElement("div");
        const lbl = document.createElement("label");
        lbl.className = "ai-est-label";
        lbl.innerText = f.label;
        w.appendChild(lbl);
        const inp = document.createElement("input");
        inp.type = f.type;
        inp.className = "ai-est-input";
        inp.placeholder = f.placeholder;
        if (formState.contact[f.key]) inp.value = formState.contact[f.key];
        inp.oninput = () => { formState.contact[f.key] = inp.value; };
        w.appendChild(inp);
        wrapper.appendChild(w);
      });

      const errorBox = document.createElement("div");
      Object.assign(errorBox.style, { display: "none", color: "#c00", fontSize: "12px", marginTop: "4px" });
      wrapper.appendChild(errorBox);

      const submit = document.createElement("button");
      submit.type = "button";
      submit.className = "ai-est-btn ai-est-btn-primary";
      submit.innerText = isSpecialized ? "Schedule my walkthrough" : "Get my walkthrough scheduled";
      Object.assign(submit.style, { width: "100%", padding: "14px", fontSize: "15px", marginTop: "8px" });
      submit.onclick = async () => {
        const c = formState.contact;
        const errs = [];
        if (!c.name || c.name.trim().length < 2) errs.push("Please enter your name.");
        if (!c.phone || c.phone.replace(/\D/g, "").length < 10) errs.push("Please enter a valid phone number.");
        if (!c.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email)) errs.push("Please enter a valid email.");
        if (errs.length) {
          errorBox.innerText = errs.join(" ");
          errorBox.style.display = "block";
          return;
        }
        errorBox.style.display = "none";
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
              project_type: formState.service_slug,
              estimator_payload: {
                service_slug: formState.service_slug,
                inputs: formState.inputs,
                rooms: formState.rooms,
                session_id: sessionId
              },
              quote_result: formState.quote_result
            })
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || `Server returned ${res.status}`);
          }
          renderConfirmation(isSpecialized);
        } catch (err) {
          console.error("[AI-Estimator] Lead error:", err);
          errorBox.innerText = "Something went wrong. Please try again or give us a call.";
          errorBox.style.display = "block";
          submit.disabled = false;
          submit.innerText = isSpecialized ? "Schedule my walkthrough" : "Get my walkthrough scheduled";
        }
      };
      wrapper.appendChild(submit);

      return wrapper;
    }

    // ── Screen 4: Confirmation ────────────────────────────────────────────
    function renderConfirmation(isSpecialized) {
      const el = document.createElement("div");
      el.style.textAlign = "center";
      el.style.padding = "20px 0";

      const icon = document.createElement("div");
      icon.innerText = "✅";
      Object.assign(icon.style, { fontSize: "48px", marginBottom: "12px" });
      el.appendChild(icon);

      const title = document.createElement("h3");
      title.innerText = "You're all set!";
      Object.assign(title.style, { margin: "0 0 10px 0", fontSize: "20px", fontWeight: "700", color: "#1a1a1a" });
      el.appendChild(title);

      const msg = document.createElement("p");
      msg.innerText = `Thanks for reaching out. Someone from ${companyName} will be in touch within 24 hours to schedule your walkthrough.`;
      Object.assign(msg.style, { margin: "0 0 20px 0", fontSize: "14px", color: "#555", lineHeight: "1.6" });
      el.appendChild(msg);

      const close = document.createElement("button");
      close.className = "ai-est-btn ai-est-btn-secondary";
      close.type = "button";
      close.innerText = "Close";
      close.onclick = () => closeModal();
      el.appendChild(close);

      renderScreen(el);
    }

    // ── Open/close ─────────────────────────────────────────────────────────
    function openModal() {
      isOpen = true;
      modal.style.display = "flex";
      setTimeout(() => {
        modal.style.opacity = "1";
        modal.style.transform = "translateY(0)";
      }, 10);
      toggle.style.background = "#444";
      toggle.innerText = isMobile() ? "×" : "Close";
      // Reset to service picker on each open (unless mid-flow)
      if (!formState.service_slug) renderServicePicker();
      else if (formState.quote_result?.specialized) renderSpecializedResult();
      else if (formState.quote_result) renderQuoteResult();
      else renderQuestions();
    }
    function closeModal() {
      isOpen = false;
      modal.style.opacity = "0";
      modal.style.transform = "translateY(10px)";
      setTimeout(() => { modal.style.display = "none"; }, 400);
      toggle.style.background = brandColor;
      toggle.innerText = isMobile() ? "💰" : "💰 Get Ballpark Pricing";
    }

    toggle.onclick  = () => { isOpen ? closeModal() : openModal(); };
    closeBtn.onclick = () => closeModal();

    // Click-outside to close
    document.addEventListener("click", (e) => {
      if (!isOpen) return;
      if (modal.contains(e.target) || toggle.contains(e.target)) return;
      closeModal();
    });
    // ESC to close
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && isOpen) closeModal();
    });

    // Responsive
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

    // ── Public API ─────────────────────────────────────────────────────────
    window.AIEstimator = {
      open: openModal,
      close: closeModal,
      isOpen: () => isOpen,
      reset: () => {
        formState.service_slug = null;
        formState.inputs = {};
        formState.rooms = [];
        formState.quote_result = null;
        formState.contact = { name: "", phone: "", email: "", address: "" };
        renderServicePicker();
      }
    };

    // Initial render
    renderServicePicker();

    console.log("[AI-Estimator] UI ready. Manual trigger: window.AIEstimator.open()");
  }

  // ── Boot ─────────────────────────────────────────────────────────────────
  function boot() {
    initWidget().then((ok) => { if (ok) createUI(); });
  }
  if (document.readyState === "complete" || document.readyState === "interactive") {
    boot();
  } else {
    window.addEventListener("DOMContentLoaded", boot);
  }
})();
