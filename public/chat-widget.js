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

  async function initWidget() {
    if (!tenantId) {
      console.error("[AI-Widget] No tenantId found. Script tag must have data-tenant-id attribute.");
      return;
    }
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
      .ai-chat-bubble { animation: ai-fadeIn 0.3s ease; }
    `;
    document.head.appendChild(style);

    // Toggle Button
    const toggle = document.createElement("div");
    toggle.id = "ai-chat-toggle";
    toggle.innerText = "Chat";
    Object.assign(toggle.style, {
      position: "fixed", bottom: "20px", right: "20px",
      background: "#000", color: "#fff", padding: "12px 24px",
      borderRadius: "30px", cursor: "pointer", zIndex: "2147483647",
      fontFamily: "Arial, sans-serif", boxShadow: "0 4px 15px rgba(0,0,0,0.2)",
      transition: "all 0.3s ease", fontWeight: "bold",
      textAlign: "center"
    });
    document.body.appendChild(toggle);

    // Container
    const container = document.createElement("div");
    container.id = "ai-chat-container";
    Object.assign(container.style, {
      position: "fixed", bottom: "85px", right: "20px",
      width: "350px", height: "500px", background: "#fff",
      border: "1px solid #ddd", borderRadius: "12px",
      boxShadow: "0 10px 40px rgba(0,0,0,0.2)", display: "none",
      flexDirection: "column", zIndex: "2147483647", overflow: "hidden",
      fontFamily: "Arial, sans-serif", opacity: "0", transform: "translateY(10px)",
      transition: "opacity 0.3s ease, transform 0.3s ease"
    });
    document.body.appendChild(container);

    // Header
    const header = document.createElement("div");
    header.innerText = companyName;
    Object.assign(header.style, {
      background: "#000", color: "#fff", padding: "16px",
      fontWeight: "bold", textAlign: "center", fontSize: "16px"
    });
    container.appendChild(header);

    // Messages area
    const messagesBody = document.createElement("div");
    Object.assign(messagesBody.style, {
      flex: "1", padding: "15px", overflowY: "auto",
      display: "flex", flexDirection: "column", gap: "10px",
      background: "#f9f9f9"
    });
    container.appendChild(messagesBody);

    // Input area
    const inputArea = document.createElement("div");
    Object.assign(inputArea.style, {
      display: "flex", padding: "12px", borderTop: "1px solid #eee",
      background: "#fff"
    });
    container.appendChild(inputArea);

    const input = document.createElement("input");
    input.placeholder = "Type a message...";
    Object.assign(input.style, {
      flex: "1", border: "none", outline: "none", fontSize: "14px",
      padding: "5px"
    });
    inputArea.appendChild(input);

    const sendBtn = document.createElement("button");
    sendBtn.innerText = "Send";
    Object.assign(sendBtn.style, {
      background: "none", border: "none", color: "#000",
      fontWeight: "bold", cursor: "pointer", padding: "0 10px",
      fontSize: "14px"
    });
    inputArea.appendChild(sendBtn);

    function addMsg(text, isUser) {
      const bubble = document.createElement("div");
      bubble.className = "ai-chat-bubble";
      bubble.innerText = text;
      Object.assign(bubble.style, {
        padding: "10px 14px", borderRadius: "18px", fontSize: "14px",
        maxWidth: "80%", alignSelf: isUser ? "flex-end" : "flex-start",
        background: isUser ? "#000" : "#fff",
        color: isUser ? "#fff" : "#333",
        boxShadow: isUser ? "none" : "0 2px 5px rgba(0,0,0,0.05)",
        border: isUser ? "none" : "1px solid #eee",
        lineHeight: "1.4"
      });
      messagesBody.appendChild(bubble);
      messagesBody.scrollTop = messagesBody.scrollHeight;
    }

    toggle.onclick = () => {
      isOpen = !isOpen;
      if (isOpen) {
        container.style.display = "flex";
        setTimeout(() => {
          container.style.opacity = "1";
          container.style.transform = "translateY(0)";
        }, 10);
        toggle.innerText = "Close";
        if (!hasWelcomed) {
          addMsg(welcomeMessage, false);
          hasWelcomed = true;
        }
      } else {
        container.style.opacity = "0";
        container.style.transform = "translateY(10px)";
        setTimeout(() => {
          container.style.display = "none";
        }, 300);
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
      typing.style.fontSize = "12px";
      typing.style.color = "#888";
      typing.style.alignSelf = "flex-start";
      typing.style.marginLeft = "10px";
      messagesBody.appendChild(typing);
      messagesBody.scrollTop = messagesBody.scrollHeight;

      try {
        const response = await fetch(`${apiBase}/website-chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: val, tenantId, sessionId })
        });
        const data = await response.json();
        typing.remove();
        addMsg(data.reply || "I'm sorry, I encountered an issue.", false);
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
