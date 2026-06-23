import { useState, useEffect, useCallback } from "react";

const API_BASE = import.meta.env.VITE_API_URL || "";
const token = () => localStorage.getItem("token");
const hdrs = () => ({
  Authorization: `Bearer ${token()}`,
  "Content-Type": "application/json",
});

// Cache-busting helpers — the browser was serving 304 stale responses for
// /api/reviews/status from a previous "connected" state, which made the page
// show "Connected" UI on tenants whose tokens had been wiped. cache:"no-store"
// + a timestamp param breaks all caches.
const NO_CACHE = { headers: hdrs(), cache: "no-store" };
const cacheBust = () => `&_t=${Date.now()}`;

// Fetch with a hard timeout so a slow/hanging endpoint can't lock up the UI.
// Used for /api/dashboard/tenant which has been observed taking 70+ seconds
// in production and triggering 499 client-aborted responses.
async function fetchWithTimeout(url, opts = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

const STARS = ["", "★", "★★", "★★★", "★★★★", "★★★★★"];
const STAR_COLORS = ["", "#dc2626", "#f97316", "#eab308", "#84cc16", "#16a34a"];

function StarRating({ rating }) {
  return (
    <span style={{ color: STAR_COLORS[rating] || "#16a34a", fontSize: 14, letterSpacing: 1 }}>
      {STARS[rating] || "★★★★★"}
    </span>
  );
}

// ── Paywall card ───────────────────────────────────────────────────────────────
function PaywallCard({ tenantId, plan }) {
  const [loading, setLoading] = useState(false);

  async function handleSubscribe() {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/reviews/subscribe?tenant_id=${tenantId}`, {
        method: "POST", headers: hdrs(),
      });
      const data = await res.json();
      if (data.url) window.location.href = data.url;
    } catch { alert("Failed to start checkout. Please try again."); }
    finally { setLoading(false); }
  }

  return (
    <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #e8e6e0", padding: 40, textAlign: "center", maxWidth: 580, margin: "0 auto" }}>
      <div style={{ width: 56, height: 56, background: "rgba(232,96,10,0.1)", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, margin: "0 auto 16px" }}>⭐</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: "#1a1a1a", marginBottom: 8 }}>AI Review Responses</div>
      <div style={{ fontSize: 13, color: "#888", maxWidth: 400, margin: "0 auto 24px", lineHeight: 1.7 }}>
        Auto-detect new Google reviews, generate SEO-optimized AI responses, and post them with one click. Available as a $29/mo add-on.
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, maxWidth: 460, margin: "0 auto 28px" }}>
        {[
          { icon: "🔍", title: "Auto-detect", desc: "New reviews found every 4 hours" },
          { icon: "✍️", title: "AI drafts", desc: "SEO-optimized, personalized" },
          { icon: "📤", title: "One-click post", desc: "Post directly to Google" },
        ].map((f, i) => (
          <div key={i} style={{ background: "#fafaf9", border: "1px solid #e8e6e0", borderRadius: 10, padding: "14px 10px" }}>
            <div style={{ fontSize: 20, marginBottom: 6 }}>{f.icon}</div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#1a1a1a", marginBottom: 3 }}>{f.title}</div>
            <div style={{ fontSize: 11, color: "#888", lineHeight: 1.5 }}>{f.desc}</div>
          </div>
        ))}
      </div>

      <div style={{ background: "#fafaf9", border: "1px solid #e8e6e0", borderRadius: 12, padding: "16px 20px", marginBottom: 24, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ textAlign: "left" }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#1a1a1a" }}>AI Review Responses</div>
          <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>Add-on · {plan === "basic" ? "Basic" : "Pro"} plan · cancel anytime</div>
        </div>
        <div style={{ fontSize: 22, fontWeight: 800, color: "#E8600A" }}>$29<span style={{ fontSize: 12, fontWeight: 400, color: "#888" }}>/mo</span></div>
      </div>

      <button onClick={handleSubscribe} disabled={loading} style={{ width: "100%", padding: "14px 0", background: "#E8600A", border: "none", borderRadius: 10, fontSize: 14, fontWeight: 600, color: "#fff", cursor: loading ? "not-allowed" : "pointer", fontFamily: "'DM Sans', sans-serif", transition: "all 0.15s", opacity: loading ? 0.7 : 1 }}>
        {loading ? "Opening checkout..." : "Unlock for $29/mo →"}
      </button>
      <div style={{ fontSize: 10, color: "#bbb", marginTop: 10 }}>
        Secure checkout via Stripe · Included free on Elite plan
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Review Requests section (Jun 23, 2026)
//
// Tenant-facing controls for the automated review-request drip. Lives in the
// CONNECTED view of the Reviews tab. Review-link field + on/off toggle + the
// live list of active campaigns each with a Stop button. Backed by
// /api/review-campaigns (config, list, :id/stop). Matches the page's inline
// style conventions (#E8600A, s.card pattern, toast). showToast + sBtn are
// passed in as props; API_BASE + hdrs are module-level.
// ════════════════════════════════════════════════════════════════════════════
function ReviewRequestsSection({ tenantId, showToast, sBtn }) {
  const [open, setOpen] = useState(false);
  const [config, setConfig] = useState(null); // { enabled, review_link, steps }
  const [campaigns, setCampaigns] = useState([]);
  const [saving, setSaving] = useState(false);
  const [linkDraft, setLinkDraft] = useState("");

  const loadConfig = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/review-campaigns/config?tenant_id=${tenantId}`, { headers: hdrs() });
      const data = await res.json();
      if (res.ok) {
        setConfig(data);
        setLinkDraft(data.review_link || "");
      }
    } catch { /* non-fatal */ }
  }, [tenantId]);

  const loadCampaigns = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/review-campaigns?tenant_id=${tenantId}&status=active`, { headers: hdrs() });
      const data = await res.json();
      if (res.ok) setCampaigns(data.campaigns || []);
    } catch { /* non-fatal */ }
  }, [tenantId]);

  useEffect(() => { loadConfig(); loadCampaigns(); }, [loadConfig, loadCampaigns]);

  async function patchConfig(patch) {
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/api/review-campaigns/config?tenant_id=${tenantId}`, {
        method: "PATCH", headers: hdrs(), body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Save failed");
      }
      await loadConfig();
      showToast("Saved");
    } catch (e) { showToast(e.message || "Save failed", "error"); }
    finally { setSaving(false); }
  }

  async function toggleEnabled() {
    if (!config) return;
    if (!config.enabled && !config.review_link) {
      showToast("Add your Google review link first", "error");
      return;
    }
    await patchConfig({ enabled: !config.enabled });
  }

  async function saveLink() {
    await patchConfig({ review_link: linkDraft });
  }

  async function stopCampaign(id) {
    try {
      const res = await fetch(`${API_BASE}/api/review-campaigns/${id}/stop?tenant_id=${tenantId}`, {
        method: "POST", headers: hdrs(),
      });
      if (!res.ok) throw new Error("Stop failed");
      showToast("Request stopped");
      loadCampaigns();
    } catch (e) { showToast(e.message || "Stop failed", "error"); }
  }

  const card = {
    background: "#fff", borderRadius: 14, border: "1px solid #e8e6e0",
    overflow: "hidden", marginBottom: 16,
  };

  if (!config) return null;

  return (
    <div style={card}>
      {/* Header row */}
      <div
        onClick={() => setOpen((o) => !o)}
        style={{ padding: "14px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", borderBottom: open ? "1px solid #f5f5f5" : "none" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 16 }}>📣</span>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#1a1a1a" }}>Review Requests</div>
            <div style={{ fontSize: 11, color: "#888" }}>
              Automatically ask happy customers for a Google review after a completed job
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 10, fontWeight: 700, padding: "3px 10px", borderRadius: 20, textTransform: "uppercase", letterSpacing: "0.06em",
            background: config.enabled ? "#dcfce7" : "#f5f4f0",
            color: config.enabled ? "#16a34a" : "#888",
            border: `1px solid ${config.enabled ? "#bbf7d0" : "#e8e6e0"}` }}>
            {config.enabled ? "On" : "Off"}
          </span>
          <span style={{ fontSize: 12, color: "#bbb" }}>{open ? "▲" : "▼"}</span>
        </div>
      </div>

      {open && (
        <div style={{ padding: "16px 18px" }}>
          {/* Review link */}
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#888", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
              Google review link
            </div>
            <div style={{ fontSize: 11, color: "#aaa", marginBottom: 8, lineHeight: 1.5 }}>
              From your Google Business Profile → "Ask for reviews" → copy link. This is sent to customers.
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                value={linkDraft}
                onChange={(e) => setLinkDraft(e.target.value)}
                placeholder="https://g.page/r/..."
                style={{ flex: 1, padding: "9px 12px", border: "1px solid #e8e6e0", borderRadius: 8, fontSize: 12, fontFamily: "'DM Sans', sans-serif", outline: "none" }}
              />
              <button onClick={saveLink} disabled={saving} style={sBtn("#2563eb", "rgba(37,99,235,0.08)")}>
                {saving ? "Saving..." : "Save link"}
              </button>
            </div>
          </div>

          {/* Enable toggle */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", background: "#fafaf9", border: "1px solid #e8e6e0", borderRadius: 10, marginBottom: 18 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#1a1a1a" }}>Automatic review requests</div>
              <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>
                Default: text on day 1, day 3, then email on day 7 (3rd text if no email). Stops when they leave a review.
              </div>
            </div>
            <button
              onClick={toggleEnabled}
              disabled={saving}
              style={{ ...sBtn(config.enabled ? "#888" : "#16a34a", config.enabled ? "transparent" : "rgba(22,163,74,0.1)"), minWidth: 80 }}
            >
              {config.enabled ? "Turn off" : "Turn on"}
            </button>
          </div>

          {/* Active campaigns + Stop buttons */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#888", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
              In progress ({campaigns.length})
            </div>
            <div style={{ fontSize: 11, color: "#92722a", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "8px 12px", marginBottom: 10, lineHeight: 1.5 }}>
              Don't want to ask a particular customer for a review? You have about 24 hours after the job completes to click <strong>Stop</strong> before the first text is sent.
            </div>
            {campaigns.length === 0 ? (
              <div style={{ fontSize: 12, color: "#aaa", padding: "12px 0" }}>
                No active review requests. They start automatically when a job is marked complete.
              </div>
            ) : (
              campaigns.map((c) => (
                <div key={c.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", border: "1px solid #f0eeea", borderRadius: 8, marginBottom: 6 }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#1a1a1a" }}>{c.contact_name || c.contact_phone || "Customer"}</div>
                    <div style={{ fontSize: 11, color: "#aaa" }}>
                      Step {(c.current_step ?? 0) + 1} · next {c.next_send_at ? new Date(c.next_send_at).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—"}
                    </div>
                  </div>
                  <button onClick={() => stopCampaign(c.id)} style={sBtn("#dc2626", "rgba(220,38,38,0.06)")}>
                    Stop
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function Reviews({ tenantId }) {
  const [status, setStatus] = useState(null);
  const [reviews, setReviews] = useState([]);
  const [filter, setFilter] = useState("pending");
  const [loading, setLoading] = useState(true);
  const [polling, setPolling] = useState(false);
  const [activeId, setActiveId] = useState(null);
  const [editText, setEditText] = useState("");
  const [posting, setPosting] = useState(false);
  const [regenerating, setRegenerating] = useState(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [toast, setToast] = useState(null);
  const [tenantPlan, setTenantPlan] = useState("basic");

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  // Handle redirect query params on mount (Stripe + OAuth callbacks).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("subscribed") === "true") {
      showToast("Reviews add-on activated! Connect your Google account to get started.");
      window.history.replaceState({}, "", "/reviews");
    }
    if (params.get("cancelled") === "true") {
      showToast("Checkout cancelled.", "error");
      window.history.replaceState({}, "", "/reviews");
    }
    if (params.get("connected") === "true") {
      showToast("Google Business Profile connected ✓");
      window.history.replaceState({}, "", "/reviews");
    }
    if (params.get("error") === "oauth_failed") {
      showToast("Google connection failed. Please try again.", "error");
      window.history.replaceState({}, "", "/reviews");
    }
  }, []);

  // Load /api/reviews/status. This MUST complete (or fail-fast) before the
  // page renders the connected/connect/paywall UI. Tenant plan is loaded
  // separately so a slow tenant endpoint can't block the page.
  const loadStatus = useCallback(async () => {
    if (!tenantId) {
      console.warn("[Reviews UI] loadStatus called with no tenantId — page will be stuck");
      return;
    }
    console.log("[Reviews UI] loadStatus starting tenant=" + tenantId);

    let statusData = null;
    try {
      const statusRes = await fetchWithTimeout(
        `${API_BASE}/api/reviews/status?tenant_id=${tenantId}${cacheBust()}`,
        NO_CACHE,
        10000
      );
      console.log("[Reviews UI] /status responded", statusRes.status);
      statusData = await statusRes.json();
      console.log("[Reviews UI] /status data:", statusData);
    } catch (e) {
      console.error("[Reviews UI] /status failed:", e);
      statusData = { connected: false, addon_active: false };
    }

    // Always set status so the page renders SOMETHING. Failure case falls
    // through to paywall, which is the correct conservative default.
    setStatus(statusData);
  }, [tenantId]);

  // Best-effort tenant fetch. Failure here MUST NOT block the page.
  // /api/dashboard/tenant has been observed timing out (499 / 71s) in
  // production. Hard 8s timeout, fallback to "basic". The status
  // endpoint already tells us addon_active so the only thing missing
  // tenant.plan affects is the "elite" detection — but if status.addon_active
  // is true, the user has access either way.
  const loadTenantPlan = useCallback(async () => {
    if (!tenantId) return;
    try {
      const res = await fetchWithTimeout(
        `${API_BASE}/api/dashboard/tenant?tenant_id=${tenantId}${cacheBust()}`,
        NO_CACHE,
        8000
      );
      const data = await res.json();
      setTenantPlan(data?.plan || "basic");
      console.log("[Reviews UI] tenant plan:", data?.plan);
    } catch (e) {
      console.warn("[Reviews UI] tenant plan fetch failed (non-fatal):", e?.message || e);
      setTenantPlan("basic");
    }
  }, [tenantId]);

  const loadReviews = useCallback(async () => {
    if (!tenantId) return;
    try {
      const res = await fetch(
        `${API_BASE}/api/reviews?tenant_id=${tenantId}&status=${filter}${cacheBust()}`,
        NO_CACHE
      );
      const data = await res.json();
      setReviews(data.reviews || []);
      setPendingCount(data.pending_count || 0);
    } catch { setReviews([]); }
    finally { setLoading(false); }
  }, [tenantId, filter]);

  // Run status + plan in parallel but don't await Promise.all.
  // Each updates its own piece of state independently so a hang in one
  // can't block the other.
  useEffect(() => {
    loadStatus();
    loadTenantPlan();
  }, [loadStatus, loadTenantPlan]);

  // Only load reviews when the user has access AND a real OAuth connection.
  useEffect(() => {
    if (status === null) return;
    const hasAccess = status?.addon_active || tenantPlan === "elite";
    if (hasAccess && status?.connected) {
      loadReviews();
    } else {
      setLoading(false);
    }
  }, [loadReviews, status, tenantPlan, filter]);

  async function handleConnect() {
    try {
      const res = await fetch(
        `${API_BASE}/api/reviews/oauth/url?tenant_id=${tenantId}${cacheBust()}`,
        NO_CACHE
      );
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        showToast(data.error || "Failed to get OAuth URL", "error");
      }
    } catch { showToast("Failed to connect Google", "error"); }
  }

  async function handleDisconnect() {
    if (!confirm("Disconnect Google Business Profile?")) return;
    try {
      await fetch(
        `${API_BASE}/api/reviews/disconnect?tenant_id=${tenantId}`,
        { method: "DELETE", headers: hdrs() }
      );
      showToast("Google disconnected");
      // Re-fetch status from server, don't trust local state
      await loadStatus();
    } catch { showToast("Disconnect failed", "error"); }
  }

  async function handlePoll() {
    setPolling(true);
    try {
      const res = await fetch(
        `${API_BASE}/api/reviews/poll?tenant_id=${tenantId}`,
        { method: "POST", headers: hdrs() }
      );
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || "Poll failed", "error");
      } else {
        showToast(
          data.new_reviews > 0
            ? `${data.new_reviews} new review${data.new_reviews > 1 ? "s" : ""} found`
            : "No new reviews"
        );
      }
      loadReviews();
    } catch { showToast("Poll failed", "error"); }
    finally { setPolling(false); }
  }

  async function handleApprove(review) {
    setPosting(true);
    try {
      const body = activeId === review.id && editText ? { custom_response: editText } : {};
      const res = await fetch(`${API_BASE}/api/reviews/${review.id}/approve?tenant_id=${tenantId}`, {
        method: "POST", headers: hdrs(), body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to post");
      }
      showToast("Response posted to Google ✓");
      setActiveId(null); setEditText("");
      loadReviews();
    } catch (e) { showToast(e.message || "Failed to post", "error"); }
    finally { setPosting(false); }
  }

  async function handleSkip(id) {
    await fetch(`${API_BASE}/api/reviews/${id}/skip?tenant_id=${tenantId}`, { method: "POST", headers: hdrs() });
    showToast("Review skipped");
    loadReviews();
  }

  async function handleRegenerate(id) {
    setRegenerating(id);
    try {
      const res = await fetch(`${API_BASE}/api/reviews/${id}/regenerate?tenant_id=${tenantId}`, { method: "POST", headers: hdrs() });
      const data = await res.json();
      setReviews(prev => prev.map(r => r.id === id ? { ...r, ai_draft: data.ai_draft } : r));
      if (activeId === id) setEditText(data.ai_draft);
      showToast("New draft generated");
    } catch { showToast("Regeneration failed", "error"); }
    finally { setRegenerating(null); }
  }

  const s = {
    page: { background: "#F5F4F0", minHeight: "100vh", fontFamily: "'DM Sans', sans-serif", padding: "0 0 60px" },
    topbar: { background: "#fff", borderBottom: "1px solid #e5e5e5", padding: "14px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 },
    wrap: { maxWidth: 900, margin: "0 auto", padding: "0 20px" },
    card: { background: "#fff", borderRadius: 14, border: "1px solid #e8e6e0", overflow: "hidden", marginBottom: 12 },
    btn: (color = "#E8600A", bg = "rgba(232,96,10,0.1)") => ({ padding: "8px 16px", borderRadius: 8, border: `1px solid ${color}`, background: bg, color, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }),
    filterBtn: (active) => ({ padding: "7px 16px", borderRadius: 8, border: active ? "1.5px solid #E8600A" : "1px solid #e8e6e0", background: active ? "rgba(232,96,10,0.08)" : "#fff", color: active ? "#E8600A" : "#888", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }),
  };

  const isElite = tenantPlan === "elite";
  const hasAccess = isElite || status?.addon_active;

  // ── Initial loading state ─────────────────────────────────────────────────
  if (status === null) {
    return (
      <div style={s.page}>
        <div style={s.topbar}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#1a1a1a" }}>Google Reviews</div>
            <div style={{ fontSize: 11, color: "#888" }}>Loading...</div>
          </div>
        </div>
        <div style={{ ...s.wrap, textAlign: "center", padding: 40, color: "#bbb", fontSize: 13 }}>
          Loading Reviews...
        </div>
      </div>
    );
  }

  // ── Paywall (no access at all) ────────────────────────────────────────────
  if (!hasAccess) {
    return (
      <div style={s.page}>
        <div style={s.topbar}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#1a1a1a" }}>Google Reviews</div>
            <div style={{ fontSize: 11, color: "#888" }}>AI-powered review responses · Add-on</div>
          </div>
          <div style={{ fontSize: 10, fontWeight: 700, padding: "3px 10px", borderRadius: 20, background: "#fff7ed", color: "#c2410c", border: "1px solid #fed7aa", textTransform: "uppercase" }}>
            $29/mo Add-on
          </div>
        </div>
        <div style={s.wrap}>
          <PaywallCard tenantId={tenantId} plan={tenantPlan} />
        </div>
      </div>
    );
  }

  // ── Has access but no Google linked → show Connect button ─────────────────
  if (!status.connected) {
    return (
      <div style={s.page}>
        {toast && (
          <div style={{ position: "fixed", top: 20, right: 20, zIndex: 100, background: toast.type === "error" ? "#fef2f2" : "#f0fdf4", border: `1px solid ${toast.type === "error" ? "#fecaca" : "#bbf7d0"}`, borderRadius: 10, padding: "10px 18px", fontSize: 12, fontWeight: 600, color: toast.type === "error" ? "#dc2626" : "#16a34a", boxShadow: "0 4px 12px rgba(0,0,0,0.08)" }}>
            {toast.msg}
          </div>
        )}
        <div style={s.topbar}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#1a1a1a" }}>Google Reviews</div>
            <div style={{ fontSize: 11, color: "#888" }}>AI-powered review responses</div>
          </div>
          {!isElite && (
            <div style={{ fontSize: 10, fontWeight: 700, padding: "3px 10px", borderRadius: 20, background: "#dcfce7", color: "#16a34a", border: "1px solid #bbf7d0", textTransform: "uppercase" }}>
              Active · $29/mo
            </div>
          )}
          {isElite && (
            <div style={{ fontSize: 10, fontWeight: 700, padding: "3px 10px", borderRadius: 20, background: "#eff6ff", color: "#1d4ed8", border: "1px solid #bfdbfe", textTransform: "uppercase" }}>
              Included in Elite
            </div>
          )}
        </div>
        <div style={s.wrap}>
          <div style={{ ...s.card, padding: 40, textAlign: "center" }}>
            <div style={{ fontSize: 40, marginBottom: 16 }}>⭐</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#1a1a1a", marginBottom: 8 }}>Connect Google Business Profile</div>
            <div style={{ fontSize: 13, color: "#888", maxWidth: 420, margin: "0 auto 28px", lineHeight: 1.7 }}>
              Connect your Google Business account to automatically detect new reviews and generate AI-powered responses.
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, maxWidth: 500, margin: "0 auto 32px" }}>
              {[
                { icon: "🔍", title: "Auto-detect", desc: "New reviews found every 4 hours" },
                { icon: "✍️", title: "AI drafts", desc: "SEO-optimized personalized responses" },
                { icon: "📤", title: "One-click post", desc: "Approve and post directly to Google" },
              ].map((f, i) => (
                <div key={i} style={{ background: "#fafaf9", border: "1px solid #e8e6e0", borderRadius: 10, padding: "14px 12px" }}>
                  <div style={{ fontSize: 22, marginBottom: 6 }}>{f.icon}</div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#1a1a1a", marginBottom: 3 }}>{f.title}</div>
                  <div style={{ fontSize: 11, color: "#888", lineHeight: 1.5 }}>{f.desc}</div>
                </div>
              ))}
            </div>
            <button onClick={handleConnect} style={{ ...s.btn(), padding: "12px 32px", fontSize: 14 }}>
              Connect Google Account →
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Full connected UI ─────────────────────────────────────────────────────
  return (
    <div style={s.page}>
      {toast && (
        <div style={{ position: "fixed", top: 20, right: 20, zIndex: 100, background: toast.type === "error" ? "#fef2f2" : "#f0fdf4", border: `1px solid ${toast.type === "error" ? "#fecaca" : "#bbf7d0"}`, borderRadius: 10, padding: "10px 18px", fontSize: 12, fontWeight: 600, color: toast.type === "error" ? "#dc2626" : "#16a34a", boxShadow: "0 4px 12px rgba(0,0,0,0.08)" }}>
          {toast.msg}
        </div>
      )}

      <div style={s.topbar}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#1a1a1a", display: "flex", alignItems: "center", gap: 8 }}>
              Google Reviews
              {pendingCount > 0 && (
                <span style={{ background: "#E8600A", color: "#fff", fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 20 }}>{pendingCount}</span>
              )}
            </div>
            <div style={{ fontSize: 11, color: "#16a34a", display: "flex", alignItems: "center", gap: 4 }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#16a34a" }} />
              Connected to Google Business
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={handlePoll} disabled={polling} style={s.btn("#2563eb", "rgba(37,99,235,0.08)")}>
            {polling ? "Checking..." : "Check for new reviews"}
          </button>
          <button onClick={handleDisconnect} style={s.btn("#888", "transparent")}>Disconnect</button>
        </div>
      </div>

      <div style={s.wrap}>
        <ReviewRequestsSection tenantId={tenantId} showToast={showToast} sBtn={s.btn} />

        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          {[
            { key: "pending", label: `Pending${pendingCount > 0 ? ` (${pendingCount})` : ""}` },
            { key: "posted", label: "Posted" },
            { key: "skipped", label: "Skipped" },
          ].map(f => (
            <button key={f.key} style={s.filterBtn(filter === f.key)} onClick={() => setFilter(f.key)}>{f.label}</button>
          ))}
        </div>

        {loading ? (
          <div style={{ textAlign: "center", padding: 40, color: "#bbb", fontSize: 13 }}>Loading reviews...</div>
        ) : reviews.length === 0 ? (
          <div style={{ ...s.card, padding: 40, textAlign: "center" }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>{filter === "pending" ? "🎉" : filter === "posted" ? "📤" : "⏭"}</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#1a1a1a", marginBottom: 6 }}>
              {filter === "pending" ? "No reviews waiting" : filter === "posted" ? "No posted responses yet" : "No skipped reviews"}
            </div>
            <div style={{ fontSize: 12, color: "#888" }}>
              {filter === "pending" ? "Reviews are checked automatically every 6 hours. Click above to check now." : ""}
            </div>
          </div>
        ) : (
          reviews.map(review => (
            <div key={review.id} style={s.card}>
              <div style={{ padding: "14px 18px", borderBottom: "1px solid #f5f5f5", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                  <div style={{ width: 38, height: 38, borderRadius: "50%", background: `${STAR_COLORS[review.rating] || "#E8600A"}22`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700, color: STAR_COLORS[review.rating] || "#E8600A", flexShrink: 0 }}>
                    {(review.reviewer_name || "?")[0].toUpperCase()}
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#1a1a1a" }}>{review.reviewer_name || "Anonymous"}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2 }}>
                      <StarRating rating={review.rating} />
                      <span style={{ fontSize: 10, color: "#bbb" }}>
                        {review.review_date ? new Date(review.review_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : ""}
                      </span>
                    </div>
                  </div>
                </div>
                <div style={{ fontSize: 9, fontWeight: 700, padding: "3px 10px", borderRadius: 20, background: review.status === "posted" ? "#dcfce7" : review.status === "skipped" ? "#f5f4f0" : "#fff7ed", color: review.status === "posted" ? "#16a34a" : review.status === "skipped" ? "#888" : "#c2410c", border: `1px solid ${review.status === "posted" ? "#bbf7d0" : review.status === "skipped" ? "#e8e6e0" : "#fed7aa"}`, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  {review.status}
                </div>
              </div>

              {review.review_text && (
                <div style={{ padding: "12px 18px", background: "#fafaf9", borderBottom: "1px solid #f5f5f5", fontSize: 13, color: "#444", lineHeight: 1.7, fontStyle: "italic" }}>
                  "{review.review_text}"
                </div>
              )}

              {review.ai_draft && review.status === "pending" && (
                <div style={{ padding: "14px 18px", borderBottom: activeId === review.id ? "1px solid #f5f5f5" : "none" }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "#E8600A", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
                    <span>AI Draft Response</span>
                    <button onClick={() => handleRegenerate(review.id)} disabled={regenerating === review.id} style={{ fontSize: 10, color: "#2563eb", background: "none", border: "none", cursor: "pointer", fontWeight: 600, padding: 0 }}>
                      {regenerating === review.id ? "Regenerating..." : "↻ Regenerate"}
                    </button>
                  </div>
                  {activeId === review.id ? (
                    <textarea value={editText} onChange={e => setEditText(e.target.value)} style={{ width: "100%", minHeight: 100, background: "#fafaf9", border: "1.5px solid #E8600A", borderRadius: 8, padding: "10px 12px", fontSize: 12, color: "#1a1a1a", fontFamily: "'DM Sans', sans-serif", lineHeight: 1.7, outline: "none", resize: "vertical", boxSizing: "border-box" }} />
                  ) : (
                    <div style={{ fontSize: 12, color: "#444", lineHeight: 1.7, background: "#fafaf9", border: "1px solid #e8e6e0", borderRadius: 8, padding: "10px 12px" }}>
                      {review.ai_draft}
                    </div>
                  )}
                </div>
              )}

              {review.status === "posted" && review.ai_draft && (
                <div style={{ padding: "14px 18px" }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "#16a34a", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
                    Posted · {review.posted_at ? new Date(review.posted_at).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : ""}
                  </div>
                  <div style={{ fontSize: 12, color: "#444", lineHeight: 1.7, background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8, padding: "10px 12px" }}>
                    {review.ai_draft}
                  </div>
                </div>
              )}

              {review.status === "pending" && (
                <div style={{ padding: "12px 18px", display: "flex", gap: 8, borderTop: "1px solid #f5f5f5", background: "#fafaf9" }}>
                  <button onClick={() => handleApprove(review)} disabled={posting} style={{ ...s.btn("#16a34a", "rgba(22,163,74,0.1)"), flex: 1 }}>
                    {posting ? "Posting..." : "✓ Approve & Post to Google"}
                  </button>
                  <button onClick={() => { setActiveId(activeId === review.id ? null : review.id); setEditText(review.ai_draft || ""); }} style={s.btn(activeId === review.id ? "#E8600A" : "#888", "transparent")}>
                    {activeId === review.id ? "Done editing" : "✏ Edit"}
                  </button>
                  <button onClick={() => handleSkip(review.id)} style={s.btn("#888", "transparent")}>Skip</button>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
