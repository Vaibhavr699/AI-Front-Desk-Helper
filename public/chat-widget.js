(function () {
  console.log("[AI-Widget] Script initializing...");

  // Robust script detection to handle defer/async loading
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

  const tenantId = scriptTag ? scriptTag.getAttribute("data-tenant-id") : null;
  const scriptUrl = scriptTag ? new URL(scriptTag.src) : null;
  const apiBase = scriptUrl ? scriptUrl.origin : "https://ai-front-desk-backend.onrender.com";

  console.log("[AI-Widget] Context:", { tenantId, apiBase });

  let sessionId = localStorage.getItem("ai_session_id");
  if (!sessionId) {
    sessionId = "web-" + (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2));
    localStorage.setItem("ai_session_id", sessionId);
  }

  let companyName = "Front Desk";
  let welcomeMessage = "Hi there 👋 How can we help you today?";
  let hasWelcomed = false;
  let isOpen = false;

  /* =========================
   VISITOR TRACKING
========================= */

async function trackVisitor(eventType, extra = {}) {
  try {
    await fetch(`${apiBase}/visitor-event`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenantId,
        sessionId,
        event: eventType,
        url: window.location.href,
        timestamp: new Date().toISOString(),
        ...extra
      })
    });
  } catch (err) {
    console.warn("[AI Widget] Tracking failed:", err);
  }
}


/* =========================
   CRM LEAD CAPTURE
========================= */

async function sendLeadToCRM(lead) {
  try {
    await fetch(`${apiBase}/lead-capture`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenantId,
        sessionId,
        lead
      })
    });
  } catch (err) {
    console.warn("[AI Widget] Lead capture failed:", err);
  }
}


/* =========================
   FOLLOW UP ENGINE
========================= */

async function triggerFollowUp(lead) {
  try {
    await fetch(`${apiBase}/estimate_follow_up_engine`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenantId,
        sessionId,
        lead
      })
    });
  } catch (err) {
    console.warn("[AI Widget] Follow up failed:", err);
  }
}
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
        if (data.company_name || data.name) companyName = data.company_name || data.name;
        if (data.welcome_message) welcomeMessage = data.welcome_message;
        console.log("[AI-Widget] Loaded config for:", companyName);
      } else {
        console.warn("[AI-Widget] Failed to load config, using defaults.");
      }
    } catch (err) {
      console.error("[AI-Widget] Init error:", err);
    }
  }

  function createUI() {
    if (!document.body) {
      console.warn("[AI-Widget] document.body not ready, retrying...");
      setTimeout(createUI, 50);
      return;
    }
    console.log("[AI-Widget] Creating UI elements...");

    // Styles for animations
    const style = document.createElement("style");
    style.innerHTML = `
      @keyframes ai-fadeIn { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }
      @keyframes ai-slideIn { from { transform: translateX(100px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
      @keyframes ai-pulse { 0% { transform: scale(1); box-shadow: 0 4px 15px rgba(0,0,0,0.2); } 50% { transform: scale(1.05); box-shadow: 0 6px 20px rgba(0,0,0,0.3); } 100% { transform: scale(1); box-shadow: 0 4px 15px rgba(0,0,0,0.2); } }
      @keyframes ai-bounce { 0%, 20%, 50%, 80%, 100% {transform: translateY(0);} 40% {transform: translateY(-5px);} 60% {transform: translateY(-3px);} }
      
      .ai-chat-bubble { animation: ai-fadeIn 0.3s ease; }
      .ai-pulse-anim { animation: ai-pulse 2s infinite ease-in-out; }
      .ai-slide-in { animation: ai-slideIn 0.8s cubic-bezier(0.16, 1, 0.3, 1); }
      .ai-bounce-anim { animation: ai-bounce 2s infinite; }
    `;
    document.head.appendChild(style);

    // Toggle Button
    const toggle = document.createElement("div");
    toggle.id = "ai-chat-toggle";
    toggle.className = "ai-slide-in";
    toggle.innerText = "Chat";
    Object.assign(toggle.style, {
      position: "fixed", bottom: "30px", right: "30px",
      background: "linear-gradient(135deg, #000 0%, #333 100%)",
      color: "#fff", padding: "14px 28px",
      borderRadius: "30px", cursor: "pointer", zIndex: "2147483647",
      fontFamily: "'Inter', Arial, sans-serif", boxShadow: "0 4px 20px rgba(0,0,0,0.25)",
      transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)", fontWeight: "bold",
      textAlign: "center", fontSize: "16px", letterSpacing: "0.5px"
    });
    document.body.appendChild(toggle);

    const callout = document.createElement("div");
    callout.id = "ai-chat-callout";
    callout.innerHTML = `Need help?`;
    Object.assign(callout.style, {
      position: "fixed", bottom: "95px", right: "30px",
      background: "#fff", color: "#000", padding: "10px 18px",
      borderRadius: "12px", boxShadow: "0 5px 25px rgba(0,0,0,0.15)",
      zIndex: "2147483646", fontFamily: "'Inter', Arial, sans-serif",
      fontSize: "14px", fontWeight: "500", display: "none",
      opacity: "0", transform: "translateY(10px)",
      transition: "all 0.4s cubic-bezier(0.4, 0, 0.2, 1)",
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

    const closeBtn = document.getElementById("ai-callout-close");
    if (closeBtn) {
      closeBtn.onclick = (e) => {
        e.stopPropagation();
        hideCallout();
      };
    }

    function showCallout() {
      if (isOpen) return;
      callout.style.display = "block";
      setTimeout(() => {
        callout.style.opacity = "1";
        callout.style.transform = "translateY(0)";
        callout.classList.add("ai-bounce-anim");
      }, 100);
    }

    function hideCallout() {
      callout.style.opacity = "0";
      callout.style.transform = "translateY(10px)";
      setTimeout(() => {
        callout.style.display = "none";
      }, 400);
    }

    // Trigger callout and pulse after delays
    setTimeout(showCallout, 5000);
    setTimeout(() => {
      if (!isOpen) toggle.classList.add("ai-pulse-anim");
    }, 10000);

    // Container
    const container = document.createElement("div");
    container.id = "ai-chat-container";
    Object.assign(container.style, {
      position: "fixed", bottom: "100px", right: "30px",
      width: "380px", height: "540px", background: "#fff",
      border: "1px solid #eee", borderRadius: "16px",
      boxShadow: "0 15px 50px rgba(0,0,0,0.15)", display: "none",
      flexDirection: "column", zIndex: "2147483647", overflow: "hidden",
      fontFamily: "'Inter', Arial, sans-serif", opacity: "0", transform: "translateY(10px)",
      transition: "all 0.4s cubic-bezier(0.4, 0, 0.2, 1)"
    });
    document.body.appendChild(container);

    // Header with (?) how-it-works tooltip
    const header = document.createElement("div");
    Object.assign(header.style, {
      background: "linear-gradient(135deg, #000 0%, #333 100%)",
      color: "#fff", padding: "16px 20px",
      fontWeight: "bold", fontSize: "18px",
      letterSpacing: "0.5px",
      display: "flex", alignItems: "center", justifyContent: "space-between"
    });
    const headerSpacer = document.createElement("span");
    headerSpacer.style.width = "26px";
    header.appendChild(headerSpacer);
    const headerTitle = document.createElement("span");
    headerTitle.innerText = companyName;
    headerTitle.style.flex = "1";
    headerTitle.style.textAlign = "center";
    header.appendChild(headerTitle);
    const scriptUrl = apiBase + "/chat-widget.js";
    const embedSnippet = "<script src=\"" + scriptUrl + "\"><\/script>";
    const helpBtn = document.createElement("button");
    helpBtn.innerText = "?";
    helpBtn.type = "button";
    helpBtn.setAttribute("aria-label", "How it works");
    Object.assign(helpBtn.style, {
      width: "26px", height: "26px", borderRadius: "50%",
      border: "1px solid rgba(255,255,255,0.5)", background: "rgba(255,255,255,0.15)",
      color: "#fff", cursor: "pointer", fontSize: "14px", fontWeight: "bold",
      display: "flex", alignItems: "center", justifyContent: "center", flexShrink: "0"
    });
    const tooltip = document.createElement("div");
    tooltip.id = "ai-widget-how-it-works";
    tooltip.style.display = "none";
    tooltip.style.position = "fixed";
    tooltip.style.width = "300px";
    tooltip.style.padding = "14px";
    tooltip.style.background = "#1a1a1a";
    tooltip.style.color = "#fff";
    tooltip.style.fontSize = "12px";
    tooltip.style.borderRadius = "10px";
    tooltip.style.boxShadow = "0 8px 24px rgba(0,0,0,0.4)";
    tooltip.style.zIndex = "2147483647";
    tooltip.style.lineHeight = "1.5";
    tooltip.innerHTML = "<strong style=\"display:block;margin-bottom:8px\">How it works</strong>" +
      "Add this script to your website before <code style=\"background:#333;padding:2px 6px;border-radius:4px\">&lt;/body&gt;</code> to show the chat widget:<br><br>" +
      "<code style=\"display:block;background:#333;padding:10px;border-radius:6px;font-size:11px;word-break:break-all;white-space:pre-wrap\">" + embedSnippet.replace(/</g, "&lt;").replace(/>/g, "&gt;") + "</code>" +
      "<br>Script URL: <code style=\"background:#333;padding:2px 6px;border-radius:4px;font-size:11px;word-break:break-all\">" + scriptUrl + "</code>";
    function showTooltip() {
      if (!tooltip.parentNode || tooltip.parentNode !== document.body) document.body.appendChild(tooltip);
      var rect = helpBtn.getBoundingClientRect();
      tooltip.style.left = Math.max(8, rect.right - 300) + "px";
      tooltip.style.top = Math.max(8, rect.top - 240) + "px";
      tooltip.style.display = "block";
    }
    function hideTooltip() { tooltip.style.display = "none"; }
    function toggleTooltip(e) {
      e.stopPropagation();
      if (tooltip.style.display === "block") hideTooltip(); else showTooltip();
    }
    helpBtn.addEventListener("click", toggleTooltip);
    document.addEventListener("click", function (e) {
      if (tooltip.style.display === "block" && e.target !== helpBtn && !tooltip.contains(e.target)) hideTooltip();
    });
    const helpWrap = document.createElement("div");
    helpWrap.style.position = "relative";
    helpWrap.appendChild(helpBtn);
    header.appendChild(helpWrap);
    container.appendChild(header);

    // Messages area
    const messagesBody = document.createElement("div");
    Object.assign(messagesBody.style, {
      flex: "1", padding: "20px", overflowY: "auto",
      display: "flex", flexDirection: "column", gap: "12px",
      background: "#fcfcfc"
    });
    container.appendChild(messagesBody);

    // Input area
    const inputArea = document.createElement("div");
    Object.assign(inputArea.style, {
      display: "flex", padding: "15px", borderTop: "1px solid #eee",
      background: "#fff", alignItems: "center"
    });
    container.appendChild(inputArea);

    const input = document.createElement("input");
    input.placeholder = "Type a message...";
    Object.assign(input.style, {
      flex: "1", border: "none", outline: "none", fontSize: "15px",
      padding: "10px", background: "#f5f5f5", borderRadius: "8px"
    });
    inputArea.appendChild(input);

    const sendBtn = document.createElement("button");
    sendBtn.innerText = "Send";
    Object.assign(sendBtn.style, {
      background: "none", border: "none", color: "#000",
      fontWeight: "bold", cursor: "pointer", padding: "0 15px",
      fontSize: "15px"
    });
    inputArea.appendChild(sendBtn);

    function addMsg(text, isUser) {
      const bubble = document.createElement("div");
      bubble.className = "ai-chat-bubble";
      bubble.innerText = text;
      Object.assign(bubble.style, {
        padding: "12px 16px", borderRadius: "18px", fontSize: "15px",
        maxWidth: "85%", alignSelf: isUser ? "flex-end" : "flex-start",
        background: isUser ? "#000" : "#fff",
        color: isUser ? "#fff" : "#333",
        boxShadow: isUser ? "0 4px 10px rgba(0,0,0,0.1)" : "0 2px 8px rgba(0,0,0,0.05)",
        border: isUser ? "none" : "1px solid #f0f0f0",
        lineHeight: "1.5"
      });
      if (isUser) {
        bubble.style.borderBottomRightRadius = "4px";
      } else {
        bubble.style.borderBottomLeftRadius = "4px";
      }
      messagesBody.appendChild(bubble);
      messagesBody.scrollTop = messagesBody.scrollHeight;
    }
function showBookingForm() {

  const booking = document.createElement("div");

  booking.innerHTML = `
  <div style="padding:10px;background:#f5f5f5;border-radius:10px;">
  <b>Schedule Estimate</b>
  <input id="ai-name" placeholder="Name" style="width:100%;margin-top:5px">
  <input id="ai-phone" placeholder="Phone" style="width:100%;margin-top:5px">
  <input id="ai-date" type="date" style="width:100%;margin-top:5px">
  <button id="ai-book-btn" style="width:100%;margin-top:8px">Book</button>
  </div>
  `;

  messagesBody.appendChild(booking);

  document.getElementById("ai-book-btn").onclick = async () => {

    const lead = {
      name: document.getElementById("ai-name").value,
      phone: document.getElementById("ai-phone").value,
      date: document.getElementById("ai-date").value
    };

    await sendLeadToCRM(lead);
    await triggerFollowUp(lead);

    addMsg("✅ Appointment request sent!", false);
  };
}
    toggle.onmouseover = () => {
      toggle.style.transform = "scale(1.05)";
    };
    toggle.onmouseout = () => {
      toggle.style.transform = "scale(1)";
    };

    toggle.onclick = () => {
      isOpen = !isOpen;
      if (isOpen) {
        trackVisitor("chat_opened");
        hideCallout();
        toggle.classList.remove("ai-pulse-anim");
        container.style.display = "flex";
        setTimeout(() => {
          container.style.opacity = "1";
          container.style.transform = "translateY(0)";
          container.classList.add("ai-bounce-anim");
        }, 10);
        toggle.innerText = "Close";
        if (!hasWelcomed) {
          addMsg(welcomeMessage, false);
          hasWelcomed = true;
        }
      } else {
        container.style.opacity = "0";
        container.style.transform = "translateY(10px)";
        container.classList.remove("ai-bounce-anim");
        setTimeout(() => {
          container.style.display = "none";
        }, 400);
        toggle.innerText = "Chat";
      }
    };

    async function handleSend() {
      const val = input.value.trim();
      if (!val) return;
      addMsg(val, true);
      input.value = "";

      const typing = document.createElement("div");
      typing.innerText = "AI is thinking...";
      typing.style.fontSize = "13px";
      typing.style.color = "#000";
      typing.style.alignSelf = "flex-start";
      typing.style.marginLeft = "10px";
      typing.style.fontStyle = "italic";
      messagesBody.appendChild(typing);
      messagesBody.scrollTop = messagesBody.scrollHeight;

      try {
        const response = await fetch(apiBase + "/website-chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: val, tenantId, sessionId })
        });
        const data = await response.json();

        typing.remove();
        trackVisitor("message_sent", { message: val });
        addMsg(data.reply || "I'm sorry, I encountered an issue.", false);

        if (data.lead_capture) {
          console.log("Lead Captured:", data.lead_capture);
          await sendLeadToCRM(data.lead_capture);
          await triggerFollowUp(data.lead_capture);
        }
        if (data.show_booking) {
          showBookingForm();
        }
        if (data.booking_confirmed) {
          addMsg(
            "✅ Your appointment is booked for " + data.booking_confirmed.date + " at " + data.booking_confirmed.time + ".",
            false
          );
        }
        if (data.quote_capture) {
          addMsg("📋 Quick quote request received. We'll contact you shortly!", false);
        }
      } catch (err) {
        typing.remove();
        addMsg("Connection error. Please check your internet.", false);
        console.error("[AI-Widget] Send error:", err);
      }
    }

    sendBtn.onclick = handleSend;
    input.onkeypress = (e) => { if (e.key === "Enter") handleSend(); };
    console.log("[AI-Widget] UI Ready.");
  }

  // Initialization sequence
  if (document.readyState === "complete" || document.readyState === "interactive") {
    initWidget().then(createUI);
  } else {
    window.addEventListener("DOMContentLoaded", () => {
      initWidget().then(createUI);
    });
  }
})();
