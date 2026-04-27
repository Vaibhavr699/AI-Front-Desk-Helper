import { useState, useEffect, useCallback } from "react";

const API_BASE = import.meta.env.VITE_API_URL || "";
const token = () => localStorage.getItem("token");
const hdrs = () => ({
  Authorization: `Bearer ${token()}`,
  "Content-Type": "application/json",
});

// Always-fresh fetch options for status endpoints. Browsers were serving
// stale 304s from a previous "connected" state even after the DB had been
// wiped, which made the page show "Connected" UI on tenants that hadn't
// completed OAuth. cache:"no-store" + a timestamp param breaks all caches.
const NO_CACHE = { headers: hdrs(), cache: "no-store" };
const cacheBust = () => `&_t=${Date.now()}`;

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

  // Check for OAuth/Stripe redirect query params on mount. After OAuth or
  // Stripe finishes, the URL will look like /reviews?connected=true or
  // /reviews?subscribed=true — both of which need a fresh status fetch
  // (not a cached response).
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

  const loadStatus = useCallback(async () => {
    if (!tenantId) return;
    try {
      const [statusRes, tenantRes] = await Promise.all([
        fetch(`${API_BASE}/api/reviews/status?tenant_id=${tenantId}${cacheBust()}`, NO_CACHE),
        fetch(`${API_BASE}/api/dashboard/tenant?tenant_id=${tenantId}${cacheBust()}`, NO_CACHE),
      ]);
      const statusData = await statusRes.json();
      const tenantData = await tenantRes.json().catch(() => ({}));
      setStatus(statusData);
      setTenantPlan(tenantData?.plan || "basic");
    } catch {
      setStatus({ connected: false, addon_active: false });
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

  // Always load status first
  useEffect(() => { loadStatus(); }, [loadStatus]);

  // Only load reviews if BOTH access AND a real Google connection exist.
  // Previously this only checked addon_active/elite, which made Elite
  // tenants try to load reviews even before OAuth — masking real
  // connection issues with empty state.
  useEffect(() => {
    if (status === null) return; // still loading status
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
        showToast("Failed to get OAuth URL", "error");
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
      // Force fresh status fetch from server, don't trust local state
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
  // Don't render anything decisive until we know the real status. Prevents
  // the brief flash of wrong UI on page load.
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
