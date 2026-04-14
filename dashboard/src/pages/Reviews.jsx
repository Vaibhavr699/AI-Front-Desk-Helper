// Reviews.jsx
// Place in: dashboard/src/pages/Reviews.jsx
// Add to App.jsx:
//   import Reviews from "./pages/Reviews";
//   function ReviewsWithContext() {
//     const { tenantId } = useOutletContext();
//     return <Reviews tenantId={tenantId} />;
//   }
//   <Route path="/reviews" element={<ReviewsWithContext />} />

import { useState, useEffect, useCallback } from "react";

const API_BASE = import.meta.env.VITE_API_URL || "";
const token = () => localStorage.getItem("token");
const hdrs = () => ({
  Authorization: `Bearer ${token()}`,
  "Content-Type": "application/json",
});

const STARS = ["", "★", "★★", "★★★", "★★★★", "★★★★★"];
const STAR_COLORS = ["", "#dc2626", "#f97316", "#eab308", "#84cc16", "#16a34a"];

function StarRating({ rating }) {
  return (
    <span style={{ color: STAR_COLORS[rating] || "#16a34a", fontSize: 14, letterSpacing: 1 }}>
      {STARS[rating] || "★★★★★"}
    </span>
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

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const loadStatus = useCallback(async () => {
    if (!tenantId) return;
    try {
      const res = await fetch(`${API_BASE}/api/reviews/status?tenant_id=${tenantId}`, { headers: hdrs() });
      const data = await res.json();
      setStatus(data);
    } catch { setStatus({ connected: false }); }
  }, [tenantId]);

  const loadReviews = useCallback(async () => {
    if (!tenantId) return;
    try {
      const res = await fetch(`${API_BASE}/api/reviews?tenant_id=${tenantId}&status=${filter}`, { headers: hdrs() });
      const data = await res.json();
      setReviews(data.reviews || []);
      setPendingCount(data.pending_count || 0);
    } catch { setReviews([]); }
    finally { setLoading(false); }
  }, [tenantId, filter]);

  useEffect(() => { loadStatus(); }, [loadStatus]);
  useEffect(() => { loadReviews(); }, [loadReviews]);

  async function handleConnect() {
    try {
      const res = await fetch(`${API_BASE}/api/reviews/oauth/url?tenant_id=${tenantId}`, { headers: hdrs() });
      const data = await res.json();
      window.location.href = data.url;
    } catch { showToast("Failed to connect Google", "error"); }
  }

  async function handleDisconnect() {
    if (!confirm("Disconnect Google Business Profile?")) return;
    await fetch(`${API_BASE}/api/reviews/disconnect?tenant_id=${tenantId}`, { method: "DELETE", headers: hdrs() });
    setStatus({ connected: false });
    showToast("Google disconnected");
  }

  async function handlePoll() {
    setPolling(true);
    try {
      const res = await fetch(`${API_BASE}/api/reviews/poll?tenant_id=${tenantId}`, { method: "POST", headers: hdrs() });
      const data = await res.json();
      showToast(data.new_reviews > 0 ? `${data.new_reviews} new review${data.new_reviews > 1 ? "s" : ""} found` : "No new reviews");
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
      if (!res.ok) throw new Error("Failed to post");
      showToast("Response posted to Google ✓");
      setActiveId(null);
      setEditText("");
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

  function handleEdit(review) {
    setActiveId(activeId === review.id ? null : review.id);
    setEditText(review.ai_draft || "");
  }

  const s = {
    page: { background: "#F5F4F0", minHeight: "100vh", fontFamily: "'DM Sans', sans-serif", padding: "0 0 60px" },
    topbar: { background: "#fff", borderBottom: "1px solid #e5e5e5", padding: "14px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 },
    wrap: { maxWidth: 900, margin: "0 auto", padding: "0 20px" },
    card: { background: "#fff", borderRadius: 14, border: "1px solid #e8e6e0", overflow: "hidden", marginBottom: 12 },
    btn: (color = "#E8600A", bg = "rgba(232,96,10,0.1)") => ({ padding: "8px 16px", borderRadius: 8, border: `1px solid ${color}`, background: bg, color, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "'DM Sans', sans-serif", transition: "all 0.15s" }),
    filterBtn: (active) => ({ padding: "7px 16px", borderRadius: 8, border: active ? "1.5px solid #E8600A" : "1px solid #e8e6e0", background: active ? "rgba(232,96,10,0.08)" : "#fff", color: active ? "#E8600A" : "#888", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }),
  };

  // ── Not connected state ────────────────────────────────────────────────────
  if (status && !status.connected) {
    return (
      <div style={s.page}>
        <div style={s.topbar}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#1a1a1a" }}>Google Reviews</div>
            <div style={{ fontSize: 11, color: "#888" }}>AI-powered review responses</div>
          </div>
        </div>
        <div style={s.wrap}>
          {/* Plan gating for Basic — uncomment when plan gating is wired */}
          {/* status?.plan === "basic" && !status?.addon_active && <PlanGateCard /> */}

          <div style={{ ...s.card, padding: 40, textAlign: "center" }}>
            <div style={{ fontSize: 40, marginBottom: 16 }}>⭐</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#1a1a1a", marginBottom: 8 }}>Connect Google Business Profile</div>
            <div style={{ fontSize: 13, color: "#888", maxWidth: 420, margin: "0 auto 28px", lineHeight: 1.7 }}>
              Connect your Google Business account to automatically detect new reviews and generate AI-powered responses that boost your local SEO.
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
            <div style={{ fontSize: 10, color: "#bbb", marginTop: 12 }}>
              You'll be redirected to Google to authorize. Takes 30 seconds.
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Connected state ────────────────────────────────────────────────────────
  return (
    <div style={s.page}>
      {/* Toast */}
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
          <button onClick={handleDisconnect} style={s.btn("#888", "transparent")}>
            Disconnect
          </button>
        </div>
      </div>

      <div style={s.wrap}>

        {/* Filter tabs */}
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          {[
            { key: "pending", label: `Pending${pendingCount > 0 ? ` (${pendingCount})` : ""}` },
            { key: "posted", label: "Posted" },
            { key: "skipped", label: "Skipped" },
          ].map(f => (
            <button key={f.key} style={s.filterBtn(filter === f.key)} onClick={() => setFilter(f.key)}>
              {f.label}
            </button>
          ))}
        </div>

        {/* Review cards */}
        {loading ? (
          <div style={{ textAlign: "center", padding: 40, color: "#bbb", fontSize: 13 }}>Loading reviews...</div>
        ) : reviews.length === 0 ? (
          <div style={{ ...s.card, padding: 40, textAlign: "center" }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>
              {filter === "pending" ? "🎉" : filter === "posted" ? "📤" : "⏭"}
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#1a1a1a", marginBottom: 6 }}>
              {filter === "pending" ? "No reviews waiting" : filter === "posted" ? "No posted responses yet" : "No skipped reviews"}
            </div>
            <div style={{ fontSize: 12, color: "#888" }}>
              {filter === "pending" ? "Click \"Check for new reviews\" to fetch the latest from Google." : ""}
            </div>
          </div>
        ) : (
          reviews.map(review => (
            <div key={review.id} style={s.card}>
              {/* Review header */}
              <div style={{ padding: "14px 18px", borderBottom: "1px solid #f5f5f5", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                  <div style={{ width: 38, height: 38, borderRadius: "50%", background: `${STAR_COLORS[review.rating]}22`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700, color: STAR_COLORS[review.rating], flexShrink: 0 }}>
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

              {/* Review text */}
              {review.review_text && (
                <div style={{ padding: "12px 18px", background: "#fafaf9", borderBottom: "1px solid #f5f5f5", fontSize: 13, color: "#444", lineHeight: 1.7, fontStyle: "italic" }}>
                  "{review.review_text}"
                </div>
              )}

              {/* AI Draft */}
              {review.ai_draft && review.status === "pending" && (
                <div style={{ padding: "14px 18px", borderBottom: activeId === review.id ? "1px solid #f5f5f5" : "none" }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "#E8600A", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
                    <span>AI Draft Response</span>
                    <button onClick={() => handleRegenerate(review.id)} disabled={regenerating === review.id} style={{ fontSize: 10, color: "#2563eb", background: "none", border: "none", cursor: "pointer", fontWeight: 600, padding: 0 }}>
                      {regenerating === review.id ? "Regenerating..." : "↻ Regenerate"}
                    </button>
                  </div>
                  {activeId === review.id ? (
                    <textarea
                      value={editText}
                      onChange={e => setEditText(e.target.value)}
                      style={{ width: "100%", minHeight: 100, background: "#fafaf9", border: "1.5px solid #E8600A", borderRadius: 8, padding: "10px 12px", fontSize: 12, color: "#1a1a1a", fontFamily: "'DM Sans', sans-serif", lineHeight: 1.7, outline: "none", resize: "vertical", boxSizing: "border-box" }}
                    />
                  ) : (
                    <div style={{ fontSize: 12, color: "#444", lineHeight: 1.7, background: "#fafaf9", border: "1px solid #e8e6e0", borderRadius: 8, padding: "10px 12px" }}>
                      {review.ai_draft}
                    </div>
                  )}
                </div>
              )}

              {/* Posted response */}
              {review.status === "posted" && review.ai_draft && (
                <div style={{ padding: "14px 18px" }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "#16a34a", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
                    Posted Response · {review.posted_at ? new Date(review.posted_at).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : ""}
                  </div>
                  <div style={{ fontSize: 12, color: "#444", lineHeight: 1.7, background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8, padding: "10px 12px" }}>
                    {review.ai_draft}
                  </div>
                </div>
              )}

              {/* Actions */}
              {review.status === "pending" && (
                <div style={{ padding: "12px 18px", display: "flex", gap: 8, borderTop: "1px solid #f5f5f5", background: "#fafaf9" }}>
                  <button onClick={() => handleApprove(review)} disabled={posting} style={{ ...s.btn("#16a34a", "rgba(22,163,74,0.1)"), flex: 1 }}>
                    {posting ? "Posting..." : "✓ Approve & Post to Google"}
                  </button>
                  <button onClick={() => handleEdit(review)} style={{ ...s.btn(activeId === review.id ? "#E8600A" : "#888", "transparent") }}>
                    {activeId === review.id ? "Done editing" : "✏ Edit"}
                  </button>
                  <button onClick={() => handleSkip(review.id)} style={s.btn("#888", "transparent")}>
                    Skip
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
