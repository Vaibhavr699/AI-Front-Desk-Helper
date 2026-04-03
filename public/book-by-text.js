(function () {
  if (window.__aiBookByTextLoaded) return;
  window.__aiBookByTextLoaded = true;

  let scriptTag = document.currentScript;
  if (!scriptTag) {
    const scripts = document.getElementsByTagName("script");
    for (let i = 0; i < scripts.length; i++) {
      if (scripts[i].src && scripts[i].src.includes("book-by-text.js")) {
        scriptTag = scripts[i];
        break;
      }
    }
  }

  const tenantId = scriptTag ? scriptTag.getAttribute("data-tenant-id") : null;
  const scriptUrl = scriptTag ? new URL(scriptTag.src) : null;
  const apiBase = scriptTag?.getAttribute("data-api-url") || (scriptUrl ? scriptUrl.origin : "https://ai-front-desk-backend.onrender.com");

  if (!tenantId) {
    console.error("[AI-BookByText] Missing data-tenant-id on script tag.");
  }

  // 2. State & Data
  let sessionId = localStorage.getItem("ai_session_id") || ("web-" + Math.random().toString(36).substring(2, 11));
  localStorage.setItem("ai_session_id", sessionId);

  // 3. UI Styles
  const style = document.createElement("style");
  style.innerHTML = `
    .ai-book-modal-overlay {
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      background: rgba(0, 0, 0, 0.4); backdrop-filter: blur(8px);
      z-index: 2147483647; display: none; align-items: center; justify-content: center;
      transition: opacity 0.3s ease; opacity: 0; font-family: 'Inter', -apple-system, sans-serif;
    }
    .ai-book-modal-content {
      background: #fff; width: 90%; max-width: 440px; border-radius: 24px;
      padding: 40px; box-shadow: 0 20px 40px rgba(0,0,0,0.1);
      position: relative; transform: scale(0.95); transition: transform 0.3s ease;
      text-align: center; box-sizing: border-box;
    }
    .ai-book-modal-overlay.active { display: flex; opacity: 1; }
    .ai-book-modal-overlay.active .ai-book-modal-content { transform: scale(1); }
    
    .ai-book-modal-title { font-size: 24px; font-weight: 800; color: #111; margin: 0 0 10px 0; }
    .ai-book-modal-desc { font-size: 14px; color: #666; margin-bottom: 25px; line-height: 1.6; }
    
    .ai-book-input-group { margin-bottom: 20px; text-align: left; }
    .ai-book-label { display: block; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: #999; margin-bottom: 8px; }
    .ai-book-input { 
      width: 100%; padding: 15px; border-radius: 12px; border: 1.5px solid #eee;
      font-size: 16px; transition: border-color 0.2s; box-sizing: border-box; outline: none;
      text-align: center; font-weight: 500;
    }
    .ai-book-input:focus { border-color: #000; }
    
    .ai-book-consent-wrap { display: flex; gap: 12px; align-items: flex-start; text-align: left; margin-bottom: 30px; }
    .ai-book-checkbox { width: 18px; height: 18px; margin-top: 2px; cursor: pointer; accent-color: #000; flex-shrink: 0; }
    .ai-book-consent-label { font-size: 12px; color: #888; line-height: 1.5; cursor: pointer; }
    
    .ai-book-submit {
      width: 100%; padding: 16px; border-radius: 14px; background: #000; color: #fff;
      font-size: 16px; font-weight: 700; border: none; cursor: pointer; transition: transform 0.2s, background 0.2s;
    }
    .ai-book-submit:hover { background: #222; transform: translateY(-2px); }
    .ai-book-submit:disabled { background: #ccc; cursor: not-allowed; transform: none; }
    
    .ai-book-close { position: absolute; top: 20px; right: 20px; font-size: 28px; color: #ccc; cursor: pointer; transition: color 0.2s; }
    .ai-book-close:hover { color: #000; }
  `;
  document.head.appendChild(style);

  // 4.UI Elements
  const overlay = document.createElement("div");
  overlay.className = "ai-book-modal-overlay";
  document.body.appendChild(overlay);

  overlay.innerHTML = `
    <div class="ai-book-modal-content">
      <div class="ai-book-close" id="ai-book-close">&times;</div>
      <div id="ai-book-step-form">
        <h2 class="ai-book-modal-title">Book via Text</h2>
        <p class="ai-book-modal-desc">Enter your number and we'll text you to coordinate your appointment & quote details.</p>
        
        <div class="ai-book-input-group">
          <label class="ai-book-label">Phone Number</label>
          <input type="tel" id="ai-book-phone" class="ai-book-input" placeholder="(555) 000-0000">
        </div>
        
        <div class="ai-book-consent-wrap">
          <input type="checkbox" id="ai-book-consent" class="ai-book-checkbox">
          <label for="ai-book-consent" class="ai-book-consent-label" id="ai-book-consent-text">
            By submitting, you agree to receive text messages about your quote, scheduling, and service updates. Msg/data rates may apply. Reply STOP to opt out, HELP for help.
          </label>
        </div>
        
        <button class="ai-book-submit" id="ai-book-submit">Send Text Invite</button>
      </div>
      <div id="ai-book-step-success" style="display:none; padding: 20px 0;">
        <div style="font-size: 48px; margin-bottom: 20px;">✅</div>
        <h2 class="ai-book-modal-title">Check Your Phone!</h2>
        <p class="ai-book-modal-desc">We've sent you a text message. Our AI Assistant is ready to help you finish your booking.</p>
        <button class="ai-book-submit" style="background: #000;" onclick="window.__aiBookClose()">Got it</button>
      </div>
    </div>
  `;

  // 5. Logic
  const phoneInput = document.getElementById("ai-book-phone");
  const consentCheck = document.getElementById("ai-book-consent");
  const submitBtn = document.getElementById("ai-book-submit");
  const formStep = document.getElementById("ai-book-step-form");
  const successStep = document.getElementById("ai-book-step-success");
  const closeBtn = document.getElementById("ai-book-close");

  window.__aiBookOpen = () => {
    overlay.classList.add("active");
    phoneInput.focus();
  };

  window.__aiBookClose = () => {
    overlay.classList.remove("active");
    // reset
    setTimeout(() => {
      formStep.style.display = "block";
      successStep.style.display = "none";
      phoneInput.value = "";
      consentCheck.checked = false;
      submitBtn.disabled = false;
      submitBtn.innerText = "Send Text Invite";
    }, 400);
  };

  closeBtn.onclick = window.__aiBookClose;
  overlay.onclick = (e) => { if (e.target === overlay) window.__aiBookClose(); };

  submitBtn.onclick = async () => {
    const phone = phoneInput.value.trim();
    if (!phone) return alert("Please enter your phone number.");
    if (!consentCheck.checked) return alert("Please check the consent box to receive messages.");

    submitBtn.disabled = true;
    submitBtn.innerText = "Wait a moment...";

    try {
      const disclosureText = document.getElementById("ai-book-consent-text").innerText.trim();
      const res = await fetch(`${apiBase}/api/widget/start-sms`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantId,
          phone,
          consent: true,
          consentText: disclosureText,
          source: "book_by_text_script",
          pageUrl: window.location.href,
          sessionId: sessionId
        })
      });

      if (res.ok) {
        formStep.style.display = "none";
        successStep.style.display = "block";
      } else {
        const err = await res.json();
        alert(err.error || "Failed to start text sequence.");
        submitBtn.disabled = false;
        submitBtn.innerText = "Send Text Invite";
      }
    } catch (err) {
      alert("Connection error. Please try again.");
      submitBtn.disabled = false;
      submitBtn.innerText = "Send Text Invite";
    }
  };

  // 6. Hook into Page Elements
  function attachListeners() {
    const links = document.querySelectorAll(".ai-book-link");
    links.forEach(link => {
      if (!link.hasAttribute("data-ai-attached")) {
        link.setAttribute("data-ai-attached", "true");
        link.addEventListener("click", (e) => {
          e.preventDefault();
          window.__aiBookOpen();
        });
      }
    });
  }

  // Monitor DOM
  const observer = new MutationObserver(attachListeners);
  observer.observe(document.body, { childList: true, subtree: true });
  attachListeners();

  console.log(`[AI-BookByText] Initialized. Linked to ${apiBase} for tenant ${tenantId}`);
})();
