
(function () {
  const apiBase = "https://ai-front-desk-backend.onrender.com";

  let sessionId = localStorage.getItem("ai_session_id");
  if (!sessionId) {
    sessionId = "web-" + crypto.randomUUID();
    localStorage.setItem("ai_session_id", sessionId);
  }

  let hasWelcomed = false;
  let isOpen = false;

  // ===== Toggle Button =====
  const toggleButton = document.createElement("div");
  toggleButton.innerText = "Chat";
  toggleButton.style.position = "fixed";
  toggleButton.style.bottom = "20px";
  toggleButton.style.right = "20px";
  toggleButton.style.background = "#000";
  toggleButton.style.color = "#fff";
  toggleButton.style.padding = "12px 18px";
  toggleButton.style.borderRadius = "30px";
  toggleButton.style.cursor = "pointer";
  toggleButton.style.zIndex = "999999";
  toggleButton.style.fontFamily = "Arial, sans-serif";
  toggleButton.style.boxShadow = "0 6px 18px rgba(0,0,0,0.25)";
  toggleButton.style.transition = "all 0.3s ease";
  document.body.appendChild(toggleButton);

  // ===== Chat Container =====
  const container = document.createElement("div");
  container.style.position = "fixed";
  container.style.bottom = "80px";
  container.style.right = "20px";
  container.style.width = "340px";
  container.style.height = "440px";
  container.style.background = "#ffffff";
  container.style.border = "1px solid #ddd";
  container.style.borderRadius = "14px";
  container.style.boxShadow = "0 12px 40px rgba(0,0,0,0.25)";
  container.style.display = "none";
  container.style.flexDirection = "column";
  container.style.fontFamily = "Arial, sans-serif";
  container.style.zIndex = "999999";
  container.style.overflow = "hidden";
  container.style.opacity = "0";
  container.style.transition = "opacity 0.25s ease, transform 0.25s ease";
  container.style.transform = "translateY(10px)";
  document.body.appendChild(container);

  // ===== Chat header with (?) tooltip =====
  var scriptUrl = apiBase + "/dashboard/chat-widget.js";
  var embedSnippet = "<script src=\"" + scriptUrl + "\"><\/script>";
  var headerBar = document.createElement("div");
  headerBar.style.display = "flex";
  headerBar.style.alignItems = "center";
  headerBar.style.justifyContent = "space-between";
  headerBar.style.padding = "10px 12px";
  headerBar.style.borderBottom = "1px solid #eee";
  headerBar.style.background = "#fafafa";
  headerBar.style.flexShrink = "0";
  var headerTitle = document.createElement("span");
  headerTitle.innerText = "Chat";
  headerTitle.style.fontWeight = "bold";
  headerTitle.style.fontSize = "14px";
  headerTitle.style.color = "#333";
  headerBar.appendChild(headerTitle);
  var helpBtn = document.createElement("button");
  helpBtn.innerText = "?";
  helpBtn.type = "button";
  helpBtn.setAttribute("aria-label", "How it works");
  helpBtn.style.width = "22px";
  helpBtn.style.height = "22px";
  helpBtn.style.borderRadius = "50%";
  helpBtn.style.border = "1px solid #ccc";
  helpBtn.style.background = "#fff";
  helpBtn.style.color = "#666";
  helpBtn.style.cursor = "pointer";
  helpBtn.style.fontSize = "12px";
  helpBtn.style.fontWeight = "bold";
  helpBtn.style.display = "flex";
  helpBtn.style.alignItems = "center";
  helpBtn.style.justifyContent = "center";
  helpBtn.style.flexShrink = "0";
  var tooltip = document.createElement("div");
  tooltip.id = "ai-widget-tooltip";
  tooltip.style.display = "none";
  tooltip.style.position = "fixed";
  tooltip.style.width = "280px";
  tooltip.style.padding = "12px";
  tooltip.style.background = "#1a1a1a";
  tooltip.style.color = "#fff";
  tooltip.style.fontSize = "12px";
  tooltip.style.borderRadius = "8px";
  tooltip.style.boxShadow = "0 4px 12px rgba(0,0,0,0.3)";
  tooltip.style.zIndex = "1000001";
  tooltip.style.lineHeight = "1.5";
  tooltip.innerHTML = "<strong style=\"display:block;margin-bottom:6px\">How it works</strong>" +
    "Add this script to your website before <code style=\"background:#333;padding:1px 4px;border-radius:4px\">&lt;/body&gt;</code> to show the chat widget:<br><br>" +
    "<code style=\"display:block;background:#333;padding:8px;border-radius:4px;font-size:11px;word-break:break-all;white-space:pre-wrap\">" + embedSnippet.replace(/</g, "&lt;").replace(/>/g, "&gt;") + "</code>" +
    "<br>Script URL: <code style=\"background:#333;padding:2px 6px;border-radius:4px;font-size:11px;word-break:break-all\">" + scriptUrl + "</code>";
  function showTooltip() {
    if (!tooltip.parentNode || tooltip.parentNode !== document.body) document.body.appendChild(tooltip);
    var rect = helpBtn.getBoundingClientRect();
    tooltip.style.left = Math.max(8, rect.right - 280) + "px";
    tooltip.style.top = Math.max(8, rect.top - 220) + "px";
    tooltip.style.display = "block";
  }
  function hideTooltip() {
    tooltip.style.display = "none";
  }
  function toggleTooltip(e) {
    e.stopPropagation();
    if (tooltip.style.display === "block") hideTooltip(); else showTooltip();
  }
  helpBtn.addEventListener("click", toggleTooltip);
  document.addEventListener("click", function closeTooltipOnOutside(e) {
    if (tooltip.style.display === "block" && e.target !== helpBtn && !tooltip.contains(e.target)) hideTooltip();
  });
  var helpWrap = document.createElement("div");
  helpWrap.style.position = "relative";
  helpWrap.appendChild(helpBtn);
  headerBar.appendChild(helpWrap);
  container.appendChild(headerBar);

  // ===== Messages Area =====
  const messages = document.createElement("div");
  messages.style.flex = "1";
  messages.style.padding = "12px";
  messages.style.overflowY = "auto";
  messages.style.display = "flex";
  messages.style.flexDirection = "column";
  container.appendChild(messages);

  // ===== Input Area =====
  const inputContainer = document.createElement("div");
  inputContainer.style.display = "flex";
  inputContainer.style.borderTop = "1px solid #eee";

  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "Type your message...";
  input.style.flex = "1";
  input.style.border = "none";
  input.style.padding = "12px";
  input.style.outline = "none";
  input.style.fontSize = "14px";
  input.style.color = "#000";
  input.style.background = "#fff";

  const button = document.createElement("button");
  button.innerText = "Send";
  button.style.background = "#000";
  button.style.color = "#fff";
  button.style.border = "none";
  button.style.padding = "0 18px";
  button.style.cursor = "pointer";

  inputContainer.appendChild(input);
  inputContainer.appendChild(button);
  container.appendChild(inputContainer);

  // ===== Message Bubble =====
  function addMessage(text, isUser) {
    const msg = document.createElement("div");
    msg.innerText = text;
    msg.style.marginBottom = "10px";
    msg.style.fontSize = "14px";
    msg.style.padding = "10px";
    msg.style.borderRadius = "10px";
    msg.style.maxWidth = "80%";
    msg.style.background = isUser ? "#000" : "#f2f2f2";
    msg.style.color = isUser ? "#fff" : "#000";
    msg.style.alignSelf = isUser ? "flex-end" : "flex-start";
    msg.style.animation = "fadeIn 0.2s ease";
    messages.appendChild(msg);
    messages.scrollTop = messages.scrollHeight;
  }

  // ===== Typing Indicator =====
  function showTypingIndicator() {
    const typing = document.createElement("div");
    typing.id = "ai-typing";
    typing.style.marginBottom = "10px";
    typing.style.padding = "10px";
    typing.style.borderRadius = "10px";
    typing.style.background = "#f2f2f2";
    typing.style.alignSelf = "flex-start";
    typing.style.display = "flex";
    typing.style.gap = "4px";

    for (let i = 0; i < 3; i++) {
      const dot = document.createElement("div");
      dot.style.width = "6px";
      dot.style.height = "6px";
      dot.style.background = "#888";
      dot.style.borderRadius = "50%";
      dot.style.animation = "bounce 1.2s infinite ease-in-out";
      dot.style.animationDelay = `${i * 0.2}s`;
      typing.appendChild(dot);
    }

    messages.appendChild(typing);
    messages.scrollTop = messages.scrollHeight;
  }

  function removeTypingIndicator() {
    const typing = document.getElementById("ai-typing");
    if (typing) typing.remove();
  }

  // ===== Toggle Logic =====
  toggleButton.addEventListener("click", () => {
    isOpen = !isOpen;

    if (isOpen) {
      container.style.display = "flex";
      setTimeout(() => {
        container.style.opacity = "1";
        container.style.transform = "translateY(0)";
      }, 10);

      toggleButton.innerText = "Close";

      if (!hasWelcomed) {
        addMessage("Welcome! What's your query?", false);
        hasWelcomed = true;
      }
    } else {
      container.style.opacity = "0";
      container.style.transform = "translateY(10px)";
      setTimeout(() => {
        container.style.display = "none";
      }, 250);
      toggleButton.innerText = "Chat";
    }
  });

  // ===== Send Message =====
  async function sendMessage() {
    const text = input.value.trim();
    if (!text) return;

    addMessage(text, true);
    input.value = "";

    showTypingIndicator();

    try {
      const response = await fetch(apiBase + "/website-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, sessionId: sessionId }),
      });
      removeTypingIndicator();
      if (!response.ok) {
        addMessage("Sorry, something went wrong. Please try again.", false);
        return;
      }
      const data = await response.json();
      setTimeout(function () {
        addMessage(data.reply || "No response from server.", false);
      }, 400);
    } catch (err) {
      removeTypingIndicator();
      addMessage("Connection error. Please try again.", false);
    } finally {
      /* ensure try block is closed for embedded scripts */
    }
  }

  button.addEventListener("click", sendMessage);
  input.addEventListener("keypress", function (e) {
    if (e.key === "Enter") sendMessage();
  });

  // ===== Animations =====
  const style = document.createElement("style");
  style.innerHTML = `
    @keyframes bounce {
      0%, 80%, 100% { transform: scale(0); }
      40% { transform: scale(1); }
    }
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(5px); }
      to { opacity: 1; transform: translateY(0); }
    }
  `;
  document.head.appendChild(style);
})();
