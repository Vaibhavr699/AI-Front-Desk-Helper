
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
  toggleButton.style.padding = "12px 16px";
  toggleButton.style.borderRadius = "30px";
  toggleButton.style.cursor = "pointer";
  toggleButton.style.zIndex = "999999";
  toggleButton.style.fontFamily = "Arial, sans-serif";
  toggleButton.style.boxShadow = "0 4px 12px rgba(0,0,0,0.2)";
  document.body.appendChild(toggleButton);

  // ===== Chat Container =====
  const container = document.createElement("div");
  container.style.position = "fixed";
  container.style.bottom = "80px";
  container.style.right = "20px";
  container.style.width = "320px";
  container.style.height = "420px";
  container.style.background = "#ffffff";
  container.style.border = "1px solid #ddd";
  container.style.borderRadius = "12px";
  container.style.boxShadow = "0 8px 30px rgba(0,0,0,0.15)";
  container.style.display = "none"; // 🔥 hidden by default
  container.style.flexDirection = "column";
  container.style.fontFamily = "Arial, sans-serif";
  container.style.zIndex = "999999";
  container.style.overflow = "hidden";
  container.style.display = "flex";
  container.style.visibility = "hidden";
  document.body.appendChild(container);

  // ===== Messages Area =====
  const messages = document.createElement("div");
  messages.style.flex = "1";
  messages.style.padding = "10px";
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
  input.style.padding = "10px";
  input.style.outline = "none";

  const button = document.createElement("button");
  button.innerText = "Send";
  button.style.background = "#000";
  button.style.color = "#fff";
  button.style.border = "none";
  button.style.padding = "10px 15px";
  button.style.cursor = "pointer";

  inputContainer.appendChild(input);
  inputContainer.appendChild(button);
  container.appendChild(inputContainer);

  function addMessage(text, isUser) {
    const msg = document.createElement("div");
    msg.innerText = text;
    msg.style.marginBottom = "8px";
    msg.style.fontSize = "14px";
    msg.style.padding = "8px";
    msg.style.borderRadius = "8px";
    msg.style.maxWidth = "80%";
    msg.style.background = isUser ? "#000" : "#f2f2f2";
    msg.style.color = isUser ? "#fff" : "#000";
    msg.style.alignSelf = isUser ? "flex-end" : "flex-start";
    messages.appendChild(msg);
    messages.scrollTop = messages.scrollHeight;
  }

  // ===== Toggle Logic =====
  toggleButton.addEventListener("click", () => {
    isOpen = !isOpen;

    if (isOpen) {
      container.style.visibility = "visible";
      container.style.display = "flex";
      toggleButton.innerText = "Close";

      if (!hasWelcomed) {
        addMessage(
          "Hi there 👋 Welcome to Gladiators Painting! Are you looking for interior or exterior painting today?",
          false
        );
        hasWelcomed = true;
      }
    } else {
      container.style.display = "none";
      toggleButton.innerText = "Chat";
    }
  });

  // ===== Send Message =====
  async function sendMessage() {
    const text = input.value.trim();
    if (!text) return;

    addMessage(text, true);
    input.value = "";

    try {
      const response = await fetch(`${apiBase}/website-chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: text,
          sessionId: sessionId,
        }),
      });

      if (!response.ok) {
        addMessage("Sorry, something went wrong. Please try again.", false);
        return;
      }

      const data = await response.json();
      addMessage(data.reply || "No response from server.", false);
    } catch (err) {
      addMessage("Connection error. Please try again.", false);
    }
  }

  button.addEventListener("click", sendMessage);
  input.addEventListener("keypress", function (e) {
    if (e.key === "Enter") sendMessage();
  });
})();
