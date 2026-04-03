(function () {
  "use strict";

  // ── Duplicate load guard ──
  if (window.__aiBookByTextLoaded) return;
  window.__aiBookByTextLoaded = true;

  // ─────────────────────────────────────────────────────────
  // 1. SCRIPT TAG CONFIG
  // ─────────────────────────────────────────────────────────
  var scriptTag = document.currentScript;
  if (!scriptTag) {
    var scripts = document.getElementsByTagName("script");
    for (var i = 0; i < scripts.length; i++) {
      if (scripts[i].src && scripts[i].src.includes("book-by-text.js")) {
        scriptTag = scripts[i];
        break;
      }
    }
  }

  var tenantId  = scriptTag ? scriptTag.getAttribute("data-tenant-id") : null;
  var scriptUrl = scriptTag ? (function() { try { return new URL(scriptTag.src); } catch(e) { return null; } })() : null;
  var apiBase   = (scriptTag && scriptTag.getAttribute("data-api-url")) ||
                  (scriptUrl ? scriptUrl.origin : "https://ai-front-desk-backend.onrender.com");

  if (!tenantId) {
    console.error("[AI-BookByText] Missing data-tenant-id on script tag.");
  }

  // ─────────────────────────────────────────────────────────
  // 2. SESSION ID — FIX 1: safe localStorage with fallback
  // ─────────────────────────────────────────────────────────
  var sessionId;
  try {
    sessionId = localStorage.getItem("ai_session_id");
    if (!sessionId) {
      sessionId = "web-" + Math.random().toString(36).substring(2, 11);
      localStorage.setItem("ai_session_id", sessionId);
    }
  } catch (e) {
    sessionId = "web-" + Math.random().toString(36).substring(2, 11) + Date.now().toString(36);
  }

  // ─────────────────────────────────────────────────────────
  // 3. FETCH TENANT CONFIG — FIX 7: dynamic brand color + name
  // ─────────────────────────────────────────────────────────
  var cfg = {
    brandName:  "Us",
    brandColor: "#000000",
    privacyUrl: "https://www.aifrontdeskhelper.com/privacy-policy"
  };

  function fetchConfig(cb) {
    if (!tenantId) { cb(cfg); return; }
    fetch(apiBase + "/widget/config?tenantId=" + encodeURIComponent(tenantId))
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (data) {
          cfg.brandName  = data.brandName  || cfg.brandName;
          cfg.brandColor = data.brandColor || cfg.brandColor;
          cfg.privacyUrl = data.privacyUrl || cfg.privacyUrl;
        }
        cb(cfg);
      })
      .catch(function () { cb(cfg); });
  }

  // ─────────────────────────────────────────────────────────
  // 4. PHONE VALIDATION — FIX 5
  // ─────────────────────────────────────────────────────────
  function isValidPhone(phone) {
    var digits = phone.replace(/\D/g, "");
    return digits.length >= 10 && digits.length <= 15;
  }

  function formatPhone(phone) {
    var digits = phone.replace(/\D/g, "");
    if (digits.length === 10) {
      return "(" + digits.substr(0,3) + ") " + digits.substr(3,3) + "-" + digits.substr(6);
    }
    return phone;
  }

  // ─────────────────────────────────────────────────────────
  // 5. LOG CONSENT SEPARATELY — FIX 6
  // ─────────────────────────────────────────────────────────
  function logConsent(phone, consentText) {
    try {
      fetch(apiBase + "/widget/sms-consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantId:    tenantId,
          sessionId:   sessionId,
          phone:       phone,
          consentText: consentText,
          source:      "book_by_text_widget",
          url:         window.location.href,
          timestamp:   new Date().toISOString()
        })
      });
    } catch (e) { /* silent — never block UX */ }
  }

  // ─────────────────────────────────────────────────────────
  // 6. BUILD WIDGET — called after config is fetched
  // ─────────────────────────────────────────────────────────
  function buildWidget(config) {
    var color    = config.brandColor;
    var name     = config.brandName;
    var privUrl  = config.privacyUrl;

    // FIX 2 + 3: consent text includes business name and Privacy Policy link
    var consentHtml =
      "By submitting, you agree to receive text messages from <strong>" + name + "</strong> " +
      "about your quote, scheduling, and service updates. Msg/data rates may apply. " +
      "Reply STOP to opt out, HELP for help. " +
      "<a href='" + privUrl + "' target='_blank' rel='noopener' " +
      "style='color:#666;text-decoration:underline'>Privacy Policy</a>. " +
      "<em style='display:block;margin-top:3px;color:#aaa'>Consent not required to purchase.</em>";

    var consentPlain =
      "By submitting, you agree to receive text messages from " + name +
      " about your quote, scheduling, and service updates. " +
      "Msg/data rates may apply. Reply STOP to opt out, HELP for help. Consent not required to purchase.";

    // ── Styles ──
    var style = document.createElement("style");
    style.innerHTML = [
      ".ai-bbt-overlay{position:fixed;top:0;left:0;width:100%;height:100%;",
      "background:rgba(0,0,0,0.45);backdrop-filter:blur(8px);z-index:2147483647;",
      "display:none;align-items:center;justify-content:center;",
      "opacity:0;transition:opacity 0.3s ease;font-family:Arial,-apple-system,sans-serif}",

      ".ai-bbt-modal{background:#fff;width:90%;max-width:440px;border-radius:24px;",
      "padding:40px;box-shadow:0 20px 60px rgba(0,0,0,0.15);",
      "position:relative;transform:scale(0.95);transition:transform 0.3s ease;",
      "text-align:center;box-sizing:border-box}",

      ".ai-bbt-overlay.active{display:flex;opacity:1}",
      ".ai-bbt-overlay.active .ai-bbt-modal{transform:scale(1)}",

      ".ai-bbt-title{font-size:24px;font-weight:800;color:#111;margin:0 0 10px}",
      ".ai-bbt-desc{font-size:14px;color:#666;margin-bottom:25px;line-height:1.6}",

      ".ai-bbt-label{display:block;font-size:11px;font-weight:700;text-transform:uppercase;",
      "letter-spacing:0.1em;color:#999;margin-bottom:8px;text-align:left}",

      ".ai-bbt-input{width:100%;padding:15px;border-radius:12px;border:1.5px solid #eee;",
      "font-size:16px;transition:border-color 0.2s;box-sizing:border-box;outline:none;",
      "text-align:center;font-weight:500;margin-bottom:20px}",
      ".ai-bbt-input:focus{border-color:" + color + "}",
      ".ai-bbt-input.error{border-color:#ef4444}",

      ".ai-bbt-consent-wrap{display:flex;gap:12px;align-items:flex-start;",
      "text-align:left;margin-bottom:24px}",

      ".ai-bbt-checkbox{width:18px;height:18px;margin-top:2px;cursor:pointer;",
      "accent-color:" + color + ";flex-shrink:0}",

      ".ai-bbt-consent-text{font-size:12px;color:#888;line-height:1.5;cursor:pointer}",

      ".ai-bbt-error-msg{font-size:12px;color:#ef4444;margin:-14px 0 14px;text-align:left}",

      ".ai-bbt-submit{width:100%;padding:16px;border-radius:14px;background:" + color + ";",
      "color:#fff;font-size:16px;font-weight:700;border:none;cursor:pointer;",
      "transition:transform 0.2s,opacity 0.2s}",
      ".ai-bbt-submit:hover{opacity:0.88;transform:translateY(-2px)}",
      ".ai-bbt-submit:disabled{opacity:0.45;cursor:not-allowed;transform:none}",

      ".ai-bbt-close{position:absolute;top:18px;right:20px;font-size:28px;",
      "color:#ccc;cursor:pointer;transition:color 0.2s;line-height:1;background:none;",
      "border:none;padding:0}",
      ".ai-bbt-close:hover{color:#111}",

      /* Mobile: full width */
      "@media(max-width:480px){",
      ".ai-bbt-modal{padding:28px 20px;border-radius:16px}",
      ".ai-bbt-title{font-size:20px}",
      "}"
    ].join("");
    document.head.appendChild(style);

    // ── Overlay ──
    var overlay = document.createElement("div");
    overlay.className = "ai-bbt-overlay";
    overlay.id        = "ai-bbt-overlay";

    overlay.innerHTML =
      '<div class="ai-bbt-modal">' +
        '<button class="ai-bbt-close" id="ai-bbt-close" aria-label="Close">&times;</button>' +

        // Form step
        '<div id="ai-bbt-form">' +
          '<h2 class="ai-bbt-title">Book via Text</h2>' +
          '<p class="ai-bbt-desc">Enter your number and <strong>' + name + '</strong> will text you to coordinate your appointment and quote details.</p>' +
          '<label class="ai-bbt-label" for="ai-bbt-phone">Phone Number</label>' +
          '<input type="tel" id="ai-bbt-phone" class="ai-bbt-input" placeholder="(555) 000-0000" autocomplete="tel" />' +
          '<div id="ai-bbt-phone-error" class="ai-bbt-error-msg" style="display:none">Please enter a valid 10-digit phone number.</div>' +
          '<div class="ai-bbt-consent-wrap">' +
            '<input type="checkbox" id="ai-bbt-consent" class="ai-bbt-checkbox" />' +
            '<label for="ai-bbt-consent" class="ai-bbt-consent-text" id="ai-bbt-consent-text">' +
              consentHtml +
            '</label>' +
          '</div>' +
          '<div id="ai-bbt-consent-error" class="ai-bbt-error-msg" style="display:none">Please check the box to continue.</div>' +
          '<button class="ai-bbt-submit" id="ai-bbt-submit">Start Texting</button>' +
        '</div>' +

        // Success step
        '<div id="ai-bbt-success" style="display:none;padding:20px 0">' +
          '<div style="font-size:52px;margin-bottom:16px">✅</div>' +
          '<h2 class="ai-bbt-title">Check Your Phone!</h2>' +
          '<p class="ai-bbt-desc">We just sent you a text message.<br>Our AI Assistant is ready to help you finish your booking.</p>' +
          '<button class="ai-bbt-submit" id="ai-bbt-got-it">Got it</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(overlay);

    // ── References ──
    var phoneInput    = document.getElementById("ai-bbt-phone");
    var consentCheck  = document.getElementById("ai-bbt-consent");
    var submitBtn     = document.getElementById("ai-bbt-submit");
    var formStep      = document.getElementById("ai-bbt-form");
    var successStep   = document.getElementById("ai-bbt-success");
    var closeBtn      = document.getElementById("ai-bbt-close");
    var gotItBtn      = document.getElementById("ai-bbt-got-it");
    var phoneError    = document.getElementById("ai-bbt-phone-error");
    var consentError  = document.getElementById("ai-bbt-consent-error");

    function resetModal() {
      setTimeout(function () {
        formStep.style.display   = "block";
        successStep.style.display = "none";
        phoneInput.value         = "";
        phoneInput.classList.remove("error");
        consentCheck.checked     = false;
        submitBtn.disabled       = false;
        submitBtn.innerText      = "Start Texting";
        phoneError.style.display   = "none";
        consentError.style.display = "none";
      }, 350);
    }

    // FIX 4: scoped open/close — no global namespace pollution
    var ns = "_aiBookByText_" + (tenantId || "default");
    window[ns + "_open"] = function () {
      overlay.classList.add("active");
      setTimeout(function () { phoneInput.focus(); }, 300);
    };
    window[ns + "_close"] = function () {
      overlay.classList.remove("active");
      resetModal();
    };

    // Keep legacy globals for backward compatibility
    window.__aiBookOpen  = window[ns + "_open"];
    window.__aiBookClose = window[ns + "_close"];

    closeBtn.onclick = window.__aiBookClose;
    gotItBtn.onclick = window.__aiBookClose;
    overlay.onclick = function (e) {
      if (e.target === overlay) window.__aiBookClose();
    };

    // Live phone formatting
    phoneInput.addEventListener("input", function () {
      phoneInput.classList.remove("error");
      phoneError.style.display = "none";
    });

    // ── Submit ──
    submitBtn.onclick = async function () {
      var phone = phoneInput.value.trim();
      var valid = true;

      // FIX 5: validate phone
      if (!isValidPhone(phone)) {
        phoneInput.classList.add("error");
        phoneError.style.display = "block";
        valid = false;
      }

      if (!consentCheck.checked) {
        consentError.style.display = "block";
        valid = false;
      }

      if (!valid) return;

      submitBtn.disabled   = true;
      submitBtn.innerText  = "Sending...";
      phoneError.style.display   = "none";
      consentError.style.display = "none";

      // FIX 6: log consent to sms_consents table FIRST — decoupled from SMS send
      logConsent(phone, consentPlain);

      try {
        var res = await fetch(apiBase + "/api/widget/start-sms", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tenantId:    tenantId,
            phone:       phone,
            consent:     true,
            consentText: consentPlain,
            source:      "book_by_text_widget",
            pageUrl:     window.location.href,
            sessionId:   sessionId
          })
        });

        if (res.ok) {
          formStep.style.display    = "none";
          successStep.style.display = "block";
        } else {
          var errData = await res.json().catch(function () { return {}; });
          var msg = errData.error || "Failed to send. Please try again.";
          phoneError.innerText       = msg;
          phoneError.style.display   = "block";
          submitBtn.disabled         = false;
          submitBtn.innerText        = "Start Texting";
        }
      } catch (err) {
        phoneError.innerText       = "Connection error. Please try again.";
        phoneError.style.display   = "block";
        submitBtn.disabled         = false;
        submitBtn.innerText        = "Start Texting";
      }
    };

    // ── Hook .ai-book-link elements ──
    function attachListeners() {
      var links = document.querySelectorAll(".ai-book-link");
      for (var j = 0; j < links.length; j++) {
        if (!links[j].hasAttribute("data-ai-attached")) {
          links[j].setAttribute("data-ai-attached", "true");
          links[j].addEventListener("click", function (e) {
            e.preventDefault();
            window.__aiBookOpen();
          });
        }
      }
    }

    var observer = new MutationObserver(attachListeners);
    observer.observe(document.body, { childList: true, subtree: true });
    attachListeners();

    console.log("[AI-BookByText] Ready. Tenant: " + tenantId + " | API: " + apiBase);
  }

  // ── INIT ──
  fetchConfig(buildWidget);

})();
