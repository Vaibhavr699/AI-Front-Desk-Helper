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

  // ── Branding defaults (overridden by tenant config) ───────────────────────
  let companyName        = "Front Desk";
  let welcomeMessage     = "Hi there 👋 Need a quick estimate or have a question? I can help you schedule in seconds.";
  let brandColor         = "#E8600A";   // Default orange — overridden per tenant
  let twilioPhoneNumber  = null;
  let logoUrl            = null;
  let hasWelcomed        = false;
  let isOpen             = false;

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

  // ── Init: fetch tenant branding config ────────────────────────────────────
  async function initWidget() {
    if (!tenantId) {
      console.error("[AI-Widget] No tenantId found. Script tag must have data-tenant-id attribute.");
      return;
    }
    trackVisitor("widget_loaded");

    try {
      console.log("[AI-Widget] Fetching configuration...");
      const res = await fetch(`${apiBase}/api/public-tenant/${tenantId}`);
      if (res.ok) {
        const data = await res.json();
        if (data.company_name || data.name) companyName       = data.company_name || data.name;
        if (data.welcome_message)           welcomeMessage    = data.welcome_message;
        if (data.brand_color)               brandColor        = data.brand_color;
        if (data.logo_url)                  logoUrl           = data.logo_url;
        if (data.twilio_phone_number)       twilioPhoneNumber = data.twilio_phone_number;
        console.log("[AI-Widget] Loaded config for:", companyName, "| color:", brandColor);
      } else {
        console.warn("[AI-Widget] Failed to load config, using defaults.");
      }
    } catch (err) {
      console.error("[AI-Widget] Init error:", err);
    }
  }

  // ── Build the UI (called after config loaded) ─────────────────────────────
  function createUI() {
    if (!document.body) {
      setTimeout(createUI, 50);
      return;
    }
    console.log("[AI-Widget] Creating UI...");

    const hoverColor = lightenColor(brandColor, 20);

    // Animations
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
    `;
    document.head.appendChild(style);

    // ── Toggle Button ────────────────────────────────────────────────────────
    const toggle = document.createElement("div");
    toggle.id = "ai-chat-toggle";
    toggle.className = "ai-slide-in";
    toggle.innerText = `Chat with ${companyName}`;
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
    const callout = document.createElement("div");
    callout.id = "ai-chat-callout";
    callout.innerHTML = `👋 Need a quick quote?`;
    Object.assign(callout.style, {
      position: "fixed", bottom: "95px", right: "30px",
      background: "#fff", color: "#111", padding: "10px 32px 10px 16px",
      borderRadius: "12px", boxShadow: "0 5px 25px rgba(0,0,0,0.15)",
      zIndex: "2147483646", fontFamily: "'Inter', Arial, sans-serif",
      fontSize: "14px", fontWeight: "500", display: "none",
      opacity: "0", transform: "translateY(10px)",
      transition: "all 0.4s cubic-bezier(0.4,0,0.2,1)",
      border: "1px solid #eee"
    });
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
      if (isOpen) return;
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

    // Logo or initial avatar
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

    // Title + status
    const headerInfo = document.createElement("div");
    headerInfo.style.flex = "1";
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

    // SMS button
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

    // Help (?) button
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
        tooltip.style.left = Math.max(8, r.right - 300) + "px";
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
    container.appendChild(header);

    // ── Messages area ────────────────────────────────────────────────────────
    const messagesBody = document.createElement("div");
    Object.assign(messagesBody.style, {
      flex: "1", padding: "16px", overflowY: "auto",
      display: "flex", flexDirection: "column", gap: "10px",
      background: "#fafafa"
    });
    container.appendChild(messagesBody);

    // ── Input area ───────────────────────────────────────────────────────────
    const inputArea = document.createElement("div");
    Object.assign(inputArea.style, {
      display: "flex", padding: "12px 14px", borderTop: "1px solid #eee",
      background: "#fff", alignItems: "center", gap: "8px"
    });
    container.appendChild(inputArea);

    const input = document.createElement("input");
    input.placeholder = "Type a message...";
    Object.assign(input.style, {
      flex: "1", border: "1.5px solid #eee", outline: "none", fontSize: "14px",
      padding: "9px 12px", background: "#f7f7f7", borderRadius: "20px",
      color: "#111", transition: "border-color 0.2s"
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

    // ── Message bubble helper ─────────────────────────────────────────────────
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
    }

    // ── Typing indicator ──────────────────────────────────────────────────────
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

    // ── Toggle open/close ─────────────────────────────────────────────────────
    toggle.onclick = () => {
      isOpen = !isOpen;
      if (isOpen) {
        trackVisitor("chat_opened");
        hideCallout();
        toggle.classList.remove("ai-pulse-anim");
        container.style.display = "flex";
        setTimeout(() => { container.style.opacity = "1"; container.style.transform = "translateY(0)"; }, 10);
        toggle.innerText = "Close";
        toggle.style.background = "#444";
        if (!hasWelcomed) { addMsg(welcomeMessage, false); hasWelcomed = true; }
        setTimeout(() => input.focus(), 400);
      } else {
        container.style.opacity = "0";
        container.style.transform = "translateY(10px)";
        setTimeout(() => { container.style.display = "none"; }, 400);
        toggle.innerText = `Chat with ${companyName}`;
        toggle.style.background = brandColor;
      }
    };

    // ── SMS consent modal ─────────────────────────────────────────────────────
    const smsModal = document.createElement("div");
    smsModal.id = "ai-sms-modal";
    Object.assign(smsModal.style, {
      position: "absolute", top: "0", left: "0", width: "100%", height: "100%",
      background: "rgba(255,255,255,0.98)", zIndex: "2147483648",
      display: "none", flexDirection: "column", padding: "28px 20px",
      boxSizing: "border-box", textAlign: "center", fontFamily: "'Inter', sans-serif"
    });
    container.appendChild(smsModal);

    const smsClose = document.createElement("div");
    smsClose.innerHTML = "&times;";
    Object.assign(smsClose.style, {
      position: "absolute", top: "14px", right: "18px", fontSize: "22px",
      cursor: "pointer", color: "#999"
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

    // Show SMS button once phone number loaded
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
  }

  // ── Boot ───────────────────────────────────────────────────────────────────
  if (document.readyState === "complete" || document.readyState === "interactive") {
    initWidget().then(createUI);
  } else {
    window.addEventListener("DOMContentLoaded", () => initWidget().then(createUI));
  }
})();
