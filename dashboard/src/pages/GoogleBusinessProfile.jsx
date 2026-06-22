import { useState, useEffect, useCallback } from "react";

const API_BASE = import.meta.env.VITE_API_URL || "";
const token = () => localStorage.getItem("token");
const hdrs = () => ({
  Authorization: `Bearer ${token()}`,
  "Content-Type": "application/json",
});
const NO_CACHE = { headers: hdrs(), cache: "no-store" };
const cacheBust = () => `&_t=${Date.now()}`;

async function fetchWithTimeout(url, opts = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ── Health score ring ──────────────────────────────────────────────────────
function ScoreRing({ score }) {
  const s = Math.max(0, Math.min(100, score ?? 0));
  const radius = 52;
  const circ = 2 * Math.PI * radius;
  const offset = circ * (1 - s / 100);
  const color = s >= 85 ? "#16a34a" : s >= 60 ? "#E8600A" : "#dc2626";
  return (
    <div style={{ position: "relative", width: 130, height: 130, flexShrink: 0 }}>
      <svg width={130} height={130} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={65} cy={65} r={radius} fill="none" stroke="#eee" strokeWidth={11} />
        <circle
          cx={65} cy={65} r={radius} fill="none" stroke={color} strokeWidth={11}
          strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 0.8s ease" }}
        />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <div style={{ fontSize: 32, fontWeight: 800, color, lineHeight: 1 }}>{s}</div>
        <div style={{ fontSize: 10, color: "#888", textTransform: "uppercase", letterSpacing: "0.06em", marginTop: 2 }}>Health</div>
      </div>
    </div>
  );
}

const SEV_STYLE = {
  high:   { bg: "#fef2f2", border: "#fecaca", dot: "#dc2626", label: "High" },
  medium: { bg: "#fff7ed", border: "#fed7aa", dot: "#E8600A", label: "Medium" },
  low:    { bg: "#fafaf9", border: "#e8e6e0", dot: "#888",    label: "Low" },
};

// ── Dependency-free SVG trend chart (matches the Jun 22 Sankey/heatmap style) ─
function TrendChart({ series, metricKey, color }) {
  const W = 820, H = 180, padL = 36, padR = 12, padT = 14, padB = 24;
  if (!series || series.length === 0) {
    return <div style={{ padding: 30, textAlign: "center", color: "#bbb", fontSize: 12 }}>No data in this range yet.</div>;
  }
  const vals = series.map(d => d[metricKey] || 0);
  const max = Math.max(1, ...vals);
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const n = series.length;
  const barW = Math.max(2, (innerW / n) - 2);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }}>
      {/* y gridlines */}
      {[0, 0.5, 1].map((f, i) => {
        const y = padT + innerH * (1 - f);
        return (
          <g key={i}>
            <line x1={padL} y1={y} x2={W - padR} y2={y} stroke="#eee" strokeWidth={1} />
            <text x={padL - 6} y={y + 3} textAnchor="end" fontSize={9} fill="#bbb">{Math.round(max * f)}</text>
          </g>
        );
      })}
      {/* bars */}
      {series.map((d, i) => {
        const v = d[metricKey] || 0;
        const h = (v / max) * innerH;
        const x = padL + (innerW / n) * i + 1;
        const y = padT + innerH - h;
        return <rect key={i} x={x} y={y} width={barW} height={h} rx={1.5} fill={color} opacity={0.85} />;
      })}
      {/* x labels: first, middle, last */}
      {[0, Math.floor(n / 2), n - 1].map((idx, i) => {
        const d = series[idx];
        if (!d) return null;
        const x = padL + (innerW / n) * idx + barW / 2;
        const label = new Date(d.date).toLocaleDateString("en-US", { month: "short", day: "numeric" });
        return <text key={i} x={x} y={H - 6} textAnchor="middle" fontSize={9} fill="#999">{label}</text>;
      })}
    </svg>
  );
}

export default function GoogleBusinessProfile({ tenantId }) {
  const [status, setStatus] = useState(null);
  const [tenantPlan, setTenantPlan] = useState("basic");
  const [subTab, setSubTab] = useState("health"); // health | drafts | published
  const [toast, setToast] = useState(null);

  // health
  const [audit, setAudit] = useState(null);
  const [auditLoading, setAuditLoading] = useState(false);

  // drafts / published
  const [posts, setPosts] = useState([]);
  const [postsLoading, setPostsLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [editId, setEditId] = useState(null);
  const [editText, setEditText] = useState("");
  const [savingId, setSavingId] = useState(null);
  const [publishingId, setPublishingId] = useState(null);

  // image picker modal
  const [pickerForPost, setPickerForPost] = useState(null);
  const [photos, setPhotos] = useState([]);
  const [photosLoading, setPhotosLoading] = useState(false);
  const [attachingUrl, setAttachingUrl] = useState(null);
  const [uploadingId, setUploadingId] = useState(null);

  // schedule + image pool (G4)
  const [schedule, setSchedule] = useState(null);
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [pool, setPool] = useState([]);
  const [poolLoading, setPoolLoading] = useState(false);
  const [poolUploading, setPoolUploading] = useState(false);

  // performance (G5)
  const [perf, setPerf] = useState(null);
  const [perfLoading, setPerfLoading] = useState(false);
  const [perfRange, setPerfRange] = useState(30);
  const [perfMetric, setPerfMetric] = useState("calls");

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3200);
  };

  // OAuth redirect feedback (shared connect flow with Reviews)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("connected") === "true") {
      showToast("Google Business Profile connected ✓");
      window.history.replaceState({}, "", "/google-business");
    }
    if (params.get("error") === "oauth_failed") {
      showToast("Google connection failed. Please try again.", "error");
      window.history.replaceState({}, "", "/google-business");
    }
  }, []);

  const loadStatus = useCallback(async () => {
    if (!tenantId) return;
    let data = null;
    try {
      const res = await fetchWithTimeout(
        `${API_BASE}/api/gbp/status?tenant_id=${tenantId}${cacheBust()}`,
        NO_CACHE, 10000
      );
      data = await res.json();
    } catch (e) {
      data = { connected: false };
    }
    setStatus(data);
  }, [tenantId]);

  const loadTenantPlan = useCallback(async () => {
    if (!tenantId) return;
    try {
      const res = await fetchWithTimeout(
        `${API_BASE}/api/dashboard/tenant?tenant_id=${tenantId}${cacheBust()}`,
        NO_CACHE, 8000
      );
      const data = await res.json();
      setTenantPlan(data?.plan || "basic");
    } catch {
      setTenantPlan("basic");
    }
  }, [tenantId]);

  const loadAudit = useCallback(async () => {
    if (!tenantId) return;
    try {
      const res = await fetch(`${API_BASE}/api/gbp/audit?tenant_id=${tenantId}${cacheBust()}`, NO_CACHE);
      const data = await res.json();
      setAudit(data.has_audit ? data : null);
    } catch {
      setAudit(null);
    }
  }, [tenantId]);

  const loadPosts = useCallback(async (statusFilter) => {
    if (!tenantId) return;
    setPostsLoading(true);
    try {
      const res = await fetch(
        `${API_BASE}/api/gbp/posts?tenant_id=${tenantId}&status=${statusFilter}${cacheBust()}`,
        NO_CACHE
      );
      const data = await res.json();
      setPosts(data.posts || []);
    } catch {
      setPosts([]);
    } finally {
      setPostsLoading(false);
    }
  }, [tenantId]);

  const loadSchedule = useCallback(async () => {
    if (!tenantId) return;
    try {
      const res = await fetch(`${API_BASE}/api/gbp/schedule?tenant_id=${tenantId}${cacheBust()}`, NO_CACHE);
      const data = await res.json();
      setSchedule(data.schedule || null);
    } catch { setSchedule(null); }
  }, [tenantId]);

  const loadPool = useCallback(async () => {
    if (!tenantId) return;
    setPoolLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/gbp/pool?tenant_id=${tenantId}${cacheBust()}`, NO_CACHE);
      const data = await res.json();
      setPool(data.images || []);
    } catch { setPool([]); }
    finally { setPoolLoading(false); }
  }, [tenantId]);

  const loadPerf = useCallback(async (range) => {
    if (!tenantId) return;
    setPerfLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/gbp/performance?tenant_id=${tenantId}&range=${range}${cacheBust()}`, NO_CACHE);
      const data = await res.json();
      setPerf(res.ok ? data : null);
    } catch { setPerf(null); }
    finally { setPerfLoading(false); }
  }, [tenantId]);

  useEffect(() => { loadStatus(); loadTenantPlan(); }, [loadStatus, loadTenantPlan]);

  // Load the right data when the connected user switches sub-tabs.
  useEffect(() => {
    if (status === null) return;
    if (!status.connected) return;
    if (subTab === "health") loadAudit();
    else if (subTab === "drafts") loadPosts("draft");
    else if (subTab === "published") loadPosts("published");
    else if (subTab === "schedule") { loadSchedule(); loadPool(); }
    else if (subTab === "performance") loadPerf(perfRange);
  }, [status, subTab, loadAudit, loadPosts, loadSchedule, loadPool, loadPerf, perfRange]);

  // ── Actions ───────────────────────────────────────────────────────────────
  async function handleConnect() {
    try {
      const res = await fetch(
        `${API_BASE}/api/reviews/oauth/url?tenant_id=${tenantId}${cacheBust()}`,
        NO_CACHE
      );
      const data = await res.json();
      if (data.url) window.location.href = data.url;
      else showToast(data.error || "Failed to get OAuth URL", "error");
    } catch { showToast("Failed to connect Google", "error"); }
  }

  async function runAudit() {
    setAuditLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/gbp/audit/run?tenant_id=${tenantId}`, {
        method: "POST", headers: hdrs(),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || data.error || "Audit failed");
      showToast("Audit complete ✓");
      await loadAudit();
    } catch (e) { showToast(e.message || "Audit failed", "error"); }
    finally { setAuditLoading(false); }
  }

  async function handleGenerate() {
    setGenerating(true);
    try {
      const res = await fetch(`${API_BASE}/api/gbp/posts/generate?tenant_id=${tenantId}`, {
        method: "POST", headers: hdrs(), body: JSON.stringify({ count: 1 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Generation failed");
      showToast("Draft generated ✓");
      await loadPosts("draft");
    } catch (e) { showToast(e.message || "Generation failed", "error"); }
    finally { setGenerating(false); }
  }

  async function handleSaveEdit(post) {
    setSavingId(post.id);
    try {
      const res = await fetch(`${API_BASE}/api/gbp/posts/${post.id}?tenant_id=${tenantId}`, {
        method: "PATCH", headers: hdrs(), body: JSON.stringify({ summary: editText }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || "Save failed"); }
      setEditId(null); setEditText("");
      await loadPosts("draft");
      showToast("Draft updated");
    } catch (e) { showToast(e.message || "Save failed", "error"); }
    finally { setSavingId(null); }
  }

  async function handleArchive(id) {
    if (!confirm("Archive this draft?")) return;
    try {
      await fetch(`${API_BASE}/api/gbp/posts/${id}?tenant_id=${tenantId}`, { method: "DELETE", headers: hdrs() });
      await loadPosts("draft");
      showToast("Draft archived");
    } catch { showToast("Archive failed", "error"); }
  }

  async function handleUpload(post, file) {
    if (!file) return;
    setUploadingId(post.id);
    try {
      const fd = new FormData();
      fd.append("image", file);
      const res = await fetch(`${API_BASE}/api/gbp/posts/${post.id}/image?tenant_id=${tenantId}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token()}` }, // no Content-Type — browser sets multipart boundary
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || data.error || "Upload failed");
      await loadPosts("draft");
      showToast("Image attached ✓");
    } catch (e) { showToast(e.message || "Upload failed", "error"); }
    finally { setUploadingId(null); }
  }

  async function openPicker(post) {
    setPickerForPost(post);
    setPhotosLoading(true);
    setPhotos([]);
    try {
      const res = await fetch(`${API_BASE}/api/gbp/media?tenant_id=${tenantId}${cacheBust()}`, NO_CACHE);
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || data.error || "Could not load photos");
      setPhotos(data.photos || []);
    } catch (e) { showToast(e.message || "Could not load photos", "error"); setPickerForPost(null); }
    finally { setPhotosLoading(false); }
  }

  async function pickPhoto(photo) {
    if (!pickerForPost) return;
    setAttachingUrl(photo.url);
    try {
      const res = await fetch(`${API_BASE}/api/gbp/posts/${pickerForPost.id}/image-from-google?tenant_id=${tenantId}`, {
        method: "POST", headers: hdrs(), body: JSON.stringify({ source_url: photo.url }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || data.error || "Could not attach photo");
      setPickerForPost(null);
      await loadPosts("draft");
      showToast("Image attached ✓");
    } catch (e) { showToast(e.message || "Could not attach photo", "error"); }
    finally { setAttachingUrl(null); }
  }

  async function handlePublish(post) {
    if (!post.media_url) { showToast("Add an image before publishing", "error"); return; }
    if (!confirm("Publish this post to your live Google Business Profile?")) return;
    setPublishingId(post.id);
    try {
      const res = await fetch(`${API_BASE}/api/gbp/posts/${post.id}/approve?tenant_id=${tenantId}`, {
        method: "POST", headers: hdrs(),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || data.error || "Publish failed");
      showToast("Published to Google ✓");
      await loadPosts("draft");
    } catch (e) { showToast(e.message || "Publish failed", "error"); }
    finally { setPublishingId(null); }
  }

  // ── Schedule + pool actions (G4) ───────────────────────────────────────────
  async function saveSchedule(patch) {
    setScheduleSaving(true);
    try {
      const res = await fetch(`${API_BASE}/api/gbp/schedule?tenant_id=${tenantId}`, {
        method: "PATCH", headers: hdrs(), body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      setSchedule(data.schedule);
      showToast("Schedule updated");
    } catch (e) { showToast(e.message || "Save failed", "error"); }
    finally { setScheduleSaving(false); }
  }

  async function uploadToPool(file) {
    if (!file) return;
    setPoolUploading(true);
    try {
      const fd = new FormData();
      fd.append("image", file);
      const res = await fetch(`${API_BASE}/api/gbp/pool?tenant_id=${tenantId}`, {
        method: "POST", headers: { Authorization: `Bearer ${token()}` }, body: fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || data.error || "Upload failed");
      await loadPool();
      showToast(data.durable === false ? "Added (note: not durable until storage configured)" : "Image added to pool ✓");
    } catch (e) { showToast(e.message || "Upload failed", "error"); }
    finally { setPoolUploading(false); }
  }

  async function deleteFromPool(id) {
    try {
      await fetch(`${API_BASE}/api/gbp/pool/${id}?tenant_id=${tenantId}`, { method: "DELETE", headers: hdrs() });
      await loadPool();
      showToast("Removed from pool");
    } catch { showToast("Remove failed", "error"); }
  }

  async function refreshPerf() {
    setPerfLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/gbp/performance/run?tenant_id=${tenantId}`, {
        method: "POST", headers: hdrs(),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.error === "api_not_enabled") {
          showToast("Enable the Business Profile Performance API in Google Cloud, then retry", "error");
        } else {
          throw new Error(data.detail || data.error || "Refresh failed");
        }
      } else {
        setPerf(data);
        showToast(`Refreshed · ${data.fetched_days || 0} days from Google ✓`);
      }
    } catch (e) { showToast(e.message || "Refresh failed", "error"); }
    finally { setPerfLoading(false); }
  }

  // ── Styles (mirrors Reviews.jsx) ───────────────────────────────────────────
  const s = {
    page: { background: "#F5F4F0", minHeight: "100vh", fontFamily: "'DM Sans', sans-serif", padding: "0 0 60px" },
    topbar: { background: "#fff", borderBottom: "1px solid #e5e5e5", padding: "14px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 },
    wrap: { maxWidth: 900, margin: "0 auto", padding: "0 20px" },
    card: { background: "#fff", borderRadius: 14, border: "1px solid #e8e6e0", overflow: "hidden", marginBottom: 12 },
    btn: (color = "#E8600A", bg = "rgba(232,96,10,0.1)") => ({ padding: "8px 16px", borderRadius: 8, border: `1px solid ${color}`, background: bg, color, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }),
    filterBtn: (active) => ({ padding: "7px 16px", borderRadius: 8, border: active ? "1.5px solid #E8600A" : "1px solid #e8e6e0", background: active ? "rgba(232,96,10,0.08)" : "#fff", color: active ? "#E8600A" : "#888", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }),
  };

  const Toast = () => toast ? (
    <div style={{ position: "fixed", top: 20, right: 20, zIndex: 200, background: toast.type === "error" ? "#fef2f2" : "#f0fdf4", border: `1px solid ${toast.type === "error" ? "#fecaca" : "#bbf7d0"}`, borderRadius: 10, padding: "10px 18px", fontSize: 12, fontWeight: 600, color: toast.type === "error" ? "#dc2626" : "#16a34a", boxShadow: "0 4px 12px rgba(0,0,0,0.08)" }}>
      {toast.msg}
    </div>
  ) : null;

  // ── Loading ────────────────────────────────────────────────────────────────
  if (status === null) {
    return (
      <div style={s.page}>
        <div style={s.topbar}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#1a1a1a" }}>Google Business Profile</div>
            <div style={{ fontSize: 11, color: "#888" }}>Loading...</div>
          </div>
        </div>
        <div style={{ ...s.wrap, textAlign: "center", padding: 40, color: "#bbb", fontSize: 13 }}>Loading…</div>
      </div>
    );
  }

  // ── Not connected → reuse the shared Google connect flow ───────────────────
  if (!status.connected) {
    return (
      <div style={s.page}>
        <Toast />
        <div style={s.topbar}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#1a1a1a" }}>Google Business Profile</div>
            <div style={{ fontSize: 11, color: "#888" }}>Profile audit, AI posting & performance</div>
          </div>
        </div>
        <div style={s.wrap}>
          <div style={{ ...s.card, padding: 40, textAlign: "center" }}>
            <div style={{ fontSize: 40, marginBottom: 16 }}>📍</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#1a1a1a", marginBottom: 8 }}>Connect Google Business Profile</div>
            <div style={{ fontSize: 13, color: "#888", maxWidth: 440, margin: "0 auto 28px", lineHeight: 1.7 }}>
              Connect your Google Business account to audit your profile, generate AI posts tuned for local & AI search, and publish them with one click.
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, maxWidth: 520, margin: "0 auto 32px" }}>
              {[
                { icon: "🔎", title: "Profile audit", desc: "Health score + prioritized gaps" },
                { icon: "✍️", title: "AI posts", desc: "SEO & AI-search optimized" },
                { icon: "📤", title: "One-click publish", desc: "Straight to your live profile" },
              ].map((f, i) => (
                <div key={i} style={{ background: "#fafaf9", border: "1px solid #e8e6e0", borderRadius: 10, padding: "14px 12px" }}>
                  <div style={{ fontSize: 22, marginBottom: 6 }}>{f.icon}</div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#1a1a1a", marginBottom: 3 }}>{f.title}</div>
                  <div style={{ fontSize: 11, color: "#888", lineHeight: 1.5 }}>{f.desc}</div>
                </div>
              ))}
            </div>
            <button onClick={handleConnect} style={{ ...s.btn(), padding: "12px 32px", fontSize: 14 }}>Connect Google Account →</button>
          </div>
        </div>
      </div>
    );
  }

  // ── Connected ───────────────────────────────────────────────────────────────
  return (
    <div style={s.page}>
      <Toast />

      <div style={s.topbar}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#1a1a1a" }}>Google Business Profile</div>
          <div style={{ fontSize: 11, color: "#16a34a", display: "flex", alignItems: "center", gap: 4 }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#16a34a" }} />
            {status.location_name || "Connected to Google Business"}
          </div>
        </div>
        {subTab === "drafts" && (
          <button onClick={handleGenerate} disabled={generating} style={s.btn()}>
            {generating ? "Generating…" : "+ Generate draft"}
          </button>
        )}
        {subTab === "health" && (
          <button onClick={runAudit} disabled={auditLoading} style={s.btn("#2563eb", "rgba(37,99,235,0.08)")}>
            {auditLoading ? "Auditing…" : "Run audit"}
          </button>
        )}
        {subTab === "performance" && (
          <button onClick={refreshPerf} disabled={perfLoading} style={s.btn("#2563eb", "rgba(37,99,235,0.08)")}>
            {perfLoading ? "Refreshing…" : "Refresh from Google"}
          </button>
        )}
      </div>

      <div style={s.wrap}>
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          {[
            { key: "health", label: "Health" },
            { key: "drafts", label: "Drafts" },
            { key: "published", label: "Published" },
            { key: "schedule", label: "Schedule" },
            { key: "performance", label: "Performance" },
          ].map(t => (
            <button key={t.key} style={s.filterBtn(subTab === t.key)} onClick={() => setSubTab(t.key)}>{t.label}</button>
          ))}
        </div>

        {/* ── HEALTH ── */}
        {subTab === "health" && (
          !audit ? (
            <div style={{ ...s.card, padding: 40, textAlign: "center" }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>🔎</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#1a1a1a", marginBottom: 6 }}>No audit yet</div>
              <div style={{ fontSize: 12, color: "#888", marginBottom: 18 }}>Run an audit to score your profile and find growth gaps.</div>
              <button onClick={runAudit} disabled={auditLoading} style={s.btn()}>{auditLoading ? "Auditing…" : "Run audit"}</button>
            </div>
          ) : (
            <>
              <div style={{ ...s.card, padding: 24, display: "flex", alignItems: "center", gap: 28 }}>
                <ScoreRing score={audit.health_score} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: "#1a1a1a", marginBottom: 4 }}>
                    {audit.profile_snapshot?.title || status.location_name || "Your profile"}
                  </div>
                  <div style={{ fontSize: 12, color: "#888", marginBottom: 14 }}>
                    {audit.gaps?.length ? `${audit.gaps.length} opportunit${audit.gaps.length === 1 ? "y" : "ies"} to improve` : "No gaps found — profile is in great shape"}
                    {audit.generated_at ? ` · audited ${new Date(audit.generated_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : ""}
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {[
                      ["Posts", audit.profile_snapshot?.days_since_last_post == null ? "none" : `${audit.profile_snapshot.days_since_last_post}d ago`],
                      ["Photos", `${audit.profile_snapshot?.photo_count ?? 0}${audit.profile_snapshot?.newest_photo_days != null ? ` · newest ${audit.profile_snapshot.newest_photo_days}d` : ""}`],
                      ["Reviews", `${audit.profile_snapshot?.review_response_rate ?? 0}% answered`],
                      ["Category", audit.profile_snapshot?.primary_category || "—"],
                    ].map(([k, v], i) => (
                      <div key={i} style={{ background: "#fafaf9", border: "1px solid #e8e6e0", borderRadius: 8, padding: "6px 10px" }}>
                        <span style={{ fontSize: 10, color: "#888", textTransform: "uppercase", letterSpacing: "0.05em" }}>{k}: </span>
                        <span style={{ fontSize: 12, color: "#1a1a1a", fontWeight: 600 }}>{v}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {(audit.gaps || []).map((g, i) => {
                const sev = SEV_STYLE[g.severity] || SEV_STYLE.low;
                return (
                  <div key={i} style={{ ...s.card, padding: "14px 18px", display: "flex", gap: 12, alignItems: "flex-start" }}>
                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: sev.dot, marginTop: 5, flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: "#1a1a1a" }}>{g.label}</span>
                        <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 7px", borderRadius: 20, background: sev.bg, color: sev.dot, border: `1px solid ${sev.border}`, textTransform: "uppercase" }}>{sev.label}</span>
                      </div>
                      <div style={{ fontSize: 12, color: "#666", lineHeight: 1.6 }}>{g.advice}</div>
                      {g.key === "post_recency" && (
                        <button onClick={() => setSubTab("drafts")} style={{ ...s.btn(), marginTop: 8, padding: "5px 12px" }}>Create a post →</button>
                      )}
                    </div>
                  </div>
                );
              })}
            </>
          )
        )}

        {/* ── DRAFTS ── */}
        {subTab === "drafts" && (
          postsLoading ? (
            <div style={{ textAlign: "center", padding: 40, color: "#bbb", fontSize: 13 }}>Loading drafts…</div>
          ) : posts.length === 0 ? (
            <div style={{ ...s.card, padding: 40, textAlign: "center" }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>✍️</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#1a1a1a", marginBottom: 6 }}>No drafts yet</div>
              <div style={{ fontSize: 12, color: "#888", marginBottom: 18 }}>Generate an AI post tuned for local & AI search.</div>
              <button onClick={handleGenerate} disabled={generating} style={s.btn()}>{generating ? "Generating…" : "+ Generate draft"}</button>
            </div>
          ) : (
            posts.map(post => (
              <div key={post.id} style={s.card}>
                {post.media_url ? (
                  <img src={post.media_url} alt="" style={{ width: "100%", maxHeight: 260, objectFit: "cover", display: "block", background: "#f5f4f0" }} />
                ) : (
                  <div style={{ padding: "18px", background: "#fafaf9", borderBottom: "1px solid #f5f5f5", display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
                    <span style={{ fontSize: 12, color: "#dc2626", fontWeight: 600 }}>⚠ Image required to publish</span>
                    <button onClick={() => document.getElementById(`up-${post.id}`).click()} disabled={uploadingId === post.id} style={s.btn("#888", "transparent")}>
                      {uploadingId === post.id ? "Uploading…" : "Upload"}
                    </button>
                    <button onClick={() => openPicker(post)} style={s.btn("#2563eb", "rgba(37,99,235,0.08)")}>Choose from Google</button>
                    <input id={`up-${post.id}`} type="file" accept="image/png,image/jpeg" style={{ display: "none" }}
                      onChange={e => handleUpload(post, e.target.files?.[0])} />
                  </div>
                )}

                <div style={{ padding: "14px 18px" }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "#E8600A", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>AI Draft</div>
                  {editId === post.id ? (
                    <textarea value={editText} onChange={e => setEditText(e.target.value)} style={{ width: "100%", minHeight: 120, background: "#fafaf9", border: "1.5px solid #E8600A", borderRadius: 8, padding: "10px 12px", fontSize: 13, color: "#1a1a1a", fontFamily: "'DM Sans', sans-serif", lineHeight: 1.7, outline: "none", resize: "vertical", boxSizing: "border-box" }} />
                  ) : (
                    <div style={{ fontSize: 13, color: "#444", lineHeight: 1.7, background: "#fafaf9", border: "1px solid #e8e6e0", borderRadius: 8, padding: "10px 12px", whiteSpace: "pre-wrap" }}>{post.summary}</div>
                  )}
                  {post.media_url && (
                    <div style={{ marginTop: 8 }}>
                      <button onClick={() => document.getElementById(`up-${post.id}`).click()} disabled={uploadingId === post.id} style={{ ...s.btn("#888", "transparent"), fontSize: 11, padding: "5px 10px" }}>
                        {uploadingId === post.id ? "Uploading…" : "Replace image"}
                      </button>
                      <button onClick={() => openPicker(post)} style={{ ...s.btn("#2563eb", "rgba(37,99,235,0.08)"), fontSize: 11, padding: "5px 10px", marginLeft: 6 }}>Choose from Google</button>
                      <input id={`up-${post.id}`} type="file" accept="image/png,image/jpeg" style={{ display: "none" }} onChange={e => handleUpload(post, e.target.files?.[0])} />
                    </div>
                  )}
                </div>

                <div style={{ padding: "12px 18px", display: "flex", gap: 8, borderTop: "1px solid #f5f5f5", background: "#fafaf9", flexWrap: "wrap" }}>
                  <button onClick={() => handlePublish(post)} disabled={publishingId === post.id || !post.media_url}
                    title={!post.media_url ? "Add an image first" : ""}
                    style={{ ...s.btn("#16a34a", "rgba(22,163,74,0.1)"), flex: 1, opacity: post.media_url ? 1 : 0.5, cursor: post.media_url ? "pointer" : "not-allowed" }}>
                    {publishingId === post.id ? "Publishing…" : "✓ Approve & Publish to Google"}
                  </button>
                  {editId === post.id ? (
                    <button onClick={() => handleSaveEdit(post)} disabled={savingId === post.id} style={s.btn("#E8600A", "rgba(232,96,10,0.1)")}>
                      {savingId === post.id ? "Saving…" : "Save"}
                    </button>
                  ) : (
                    <button onClick={() => { setEditId(post.id); setEditText(post.summary || ""); }} style={s.btn("#888", "transparent")}>✏ Edit</button>
                  )}
                  <button onClick={() => handleArchive(post.id)} style={s.btn("#888", "transparent")}>Archive</button>
                </div>
              </div>
            ))
          )
        )}

        {/* ── PUBLISHED ── */}
        {subTab === "published" && (
          postsLoading ? (
            <div style={{ textAlign: "center", padding: 40, color: "#bbb", fontSize: 13 }}>Loading…</div>
          ) : posts.length === 0 ? (
            <div style={{ ...s.card, padding: 40, textAlign: "center" }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>📤</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#1a1a1a", marginBottom: 6 }}>Nothing published yet</div>
              <div style={{ fontSize: 12, color: "#888" }}>Approved posts will appear here once they're live on Google.</div>
            </div>
          ) : (
            posts.map(post => (
              <div key={post.id} style={s.card}>
                {post.media_url && <img src={post.media_url} alt="" style={{ width: "100%", maxHeight: 260, objectFit: "cover", display: "block", background: "#f5f4f0" }} />}
                <div style={{ padding: "14px 18px" }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "#16a34a", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
                    Published{post.published_at ? ` · ${new Date(post.published_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : ""}
                  </div>
                  <div style={{ fontSize: 13, color: "#444", lineHeight: 1.7, background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8, padding: "10px 12px", whiteSpace: "pre-wrap" }}>{post.summary}</div>
                </div>
              </div>
            ))
          )
        )}
      </div>

      {/* ── SCHEDULE (G4) ── */}
      {subTab === "schedule" && (
        <div style={{ ...s.wrap, paddingTop: 0 }}>
          {!schedule ? (
            <div style={{ textAlign: "center", padding: 40, color: "#bbb", fontSize: 13 }}>Loading schedule…</div>
          ) : (
            <>
              {/* Mode selector */}
              <div style={{ ...s.card, padding: 20, marginBottom: 12 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#1a1a1a", marginBottom: 4 }}>Auto-posting</div>
                <div style={{ fontSize: 12, color: "#888", marginBottom: 16 }}>
                  Keep your profile active automatically. Recent posts lift local ranking and feed AI search engines.
                </div>
                <div style={{ display: "grid", gap: 10 }}>
                  {[
                    { key: "off", title: "Off", desc: "No automatic posts. You create and publish manually.", color: "#888" },
                    { key: "draft", title: "Draft only (recommended)", desc: "We generate posts on your schedule and leave them in Drafts for you to approve. Nothing goes live without your click.", color: "#E8600A" },
                    { key: "auto", title: "Full auto", desc: "We generate AND publish posts on your schedule, using images from your pool (or your existing profile photos). Posts go live with no review.", color: "#16a34a" },
                  ].map(opt => {
                    const active = schedule.mode === opt.key;
                    return (
                      <div key={opt.key}
                        onClick={() => { if (opt.key === "auto" && !active) { if (!confirm("Full auto publishes to your live Google profile with no review. Continue?")) return; } saveSchedule({ mode: opt.key }); }}
                        style={{ border: active ? `1.5px solid ${opt.color}` : "1px solid #e8e6e0", background: active ? `${opt.color}0d` : "#fff", borderRadius: 10, padding: "12px 14px", cursor: "pointer", display: "flex", gap: 12, alignItems: "flex-start" }}>
                        <div style={{ width: 16, height: 16, borderRadius: "50%", border: `2px solid ${active ? opt.color : "#ccc"}`, marginTop: 2, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                          {active && <div style={{ width: 8, height: 8, borderRadius: "50%", background: opt.color }} />}
                        </div>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 600, color: "#1a1a1a" }}>{opt.title}</div>
                          <div style={{ fontSize: 12, color: "#666", lineHeight: 1.5, marginTop: 2 }}>{opt.desc}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Cadence — only relevant when not Off */}
              {schedule.mode !== "off" && (
                <div style={{ ...s.card, padding: 20, marginBottom: 12 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#1a1a1a", marginBottom: 16 }}>Cadence</div>

                  <div style={{ marginBottom: 18 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "#444", marginBottom: 8 }}>Posts per week</div>
                    <div style={{ display: "flex", gap: 6 }}>
                      {[1, 2, 3, 4, 5].map(n => (
                        <button key={n} onClick={() => saveSchedule({ posts_per_week: n })}
                          style={s.filterBtn(schedule.posts_per_week === n)}>{n}</button>
                      ))}
                    </div>
                  </div>

                  <div style={{ marginBottom: 18 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "#444", marginBottom: 8 }}>Preferred days</div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d, i) => {
                        const days = schedule.preferred_days || [];
                        const on = days.includes(i);
                        return (
                          <button key={i}
                            onClick={() => {
                              const next = on ? days.filter(x => x !== i) : [...days, i].sort((a, b) => a - b);
                              if (next.length === 0) { showToast("Pick at least one day", "error"); return; }
                              saveSchedule({ preferred_days: next });
                            }}
                            style={s.filterBtn(on)}>{d}</button>
                        );
                      })}
                    </div>
                  </div>

                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "#444", marginBottom: 8 }}>Preferred hour</div>
                    <select value={schedule.preferred_hour ?? 10}
                      onChange={e => saveSchedule({ preferred_hour: parseInt(e.target.value, 10) })}
                      style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #e8e6e0", fontSize: 12, fontFamily: "'DM Sans', sans-serif", background: "#fff", cursor: "pointer" }}>
                      {Array.from({ length: 24 }, (_, h) => (
                        <option key={h} value={h}>{h === 0 ? "12 AM" : h < 12 ? `${h} AM` : h === 12 ? "12 PM" : `${h - 12} PM`}</option>
                      ))}
                    </select>
                    <span style={{ fontSize: 11, color: "#888", marginLeft: 10 }}>{scheduleSaving ? "Saving…" : ""}</span>
                  </div>

                  {schedule.last_run_note && (
                    <div style={{ marginTop: 16, fontSize: 11, color: "#888", background: "#fafaf9", border: "1px solid #e8e6e0", borderRadius: 8, padding: "8px 12px" }}>
                      Last auto-run: {schedule.last_run_note}
                    </div>
                  )}
                </div>
              )}

              {/* Image pool — only relevant for Full auto */}
              {schedule.mode === "auto" && (
                <div style={{ ...s.card, padding: 20 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#1a1a1a", marginBottom: 4 }}>Image pool</div>
                  <div style={{ fontSize: 12, color: "#888", marginBottom: 16 }}>
                    Full-auto posts need an image. Add photos here and we'll rotate through them. If the pool is empty, we'll fall back to your existing Google profile photos.
                  </div>

                  <div style={{ marginBottom: 16 }}>
                    <button onClick={() => document.getElementById("pool-up").click()} disabled={poolUploading} style={s.btn()}>
                      {poolUploading ? "Uploading…" : "+ Add photo"}
                    </button>
                    <input id="pool-up" type="file" accept="image/png,image/jpeg" style={{ display: "none" }}
                      onChange={e => uploadToPool(e.target.files?.[0])} />
                  </div>

                  {poolLoading ? (
                    <div style={{ textAlign: "center", padding: 24, color: "#bbb", fontSize: 13 }}>Loading…</div>
                  ) : pool.length === 0 ? (
                    <div style={{ fontSize: 12, color: "#888", padding: "12px 0" }}>
                      No images in your pool yet. Auto-posts will use your existing profile photos until you add some.
                    </div>
                  ) : (
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 10 }}>
                      {pool.map(img => (
                        <div key={img.id} style={{ position: "relative", borderRadius: 8, overflow: "hidden", border: "1px solid #e8e6e0", aspectRatio: "1", background: "#f5f4f0" }}>
                          <img src={img.image_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                          <button onClick={() => deleteFromPool(img.id)}
                            style={{ position: "absolute", top: 4, right: 4, width: 22, height: 22, borderRadius: "50%", border: "none", background: "rgba(0,0,0,0.55)", color: "#fff", fontSize: 14, cursor: "pointer", lineHeight: 1 }}>×</button>
                          {img.use_count > 0 && (
                            <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, background: "rgba(0,0,0,0.5)", color: "#fff", fontSize: 9, padding: "2px 4px", textAlign: "center" }}>
                              used {img.use_count}×
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── PERFORMANCE (G5) ── */}
      {subTab === "performance" && (
        <div style={{ ...s.wrap, paddingTop: 0 }}>
          {perfLoading && !perf ? (
            <div style={{ textAlign: "center", padding: 40, color: "#bbb", fontSize: 13 }}>Loading…</div>
          ) : (
            <>
              {/* range selector */}
              <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                {[7, 30, 90].map(r => (
                  <button key={r} style={s.filterBtn(perfRange === r)} onClick={() => { setPerfRange(r); }}>
                    {r} days
                  </button>
                ))}
              </div>

              {/* action-first summary tiles */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 12 }}>
                {[
                  { key: "calls", label: "Calls", color: "#16a34a", val: perf?.totals?.calls },
                  { key: "website", label: "Website clicks", color: "#2563eb", val: perf?.totals?.website },
                  { key: "directions", label: "Directions", color: "#E8600A", val: perf?.totals?.directions },
                  { key: "impressions", label: "Impressions", color: "#888", val: perf?.totals?.impressions },
                ].map(tile => {
                  const active = perfMetric === tile.key;
                  return (
                    <div key={tile.key} onClick={() => setPerfMetric(tile.key)}
                      style={{ ...s.card, marginBottom: 0, padding: "14px 16px", cursor: "pointer", border: active ? `1.5px solid ${tile.color}` : "1px solid #e8e6e0", background: active ? `${tile.color}0d` : "#fff" }}>
                      <div style={{ fontSize: 10, color: "#888", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>{tile.label}</div>
                      <div style={{ fontSize: 26, fontWeight: 800, color: tile.color, lineHeight: 1 }}>{(tile.val ?? 0).toLocaleString()}</div>
                    </div>
                  );
                })}
              </div>

              {/* trend chart for the selected metric */}
              <div style={{ ...s.card, padding: 18 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#1a1a1a" }}>
                    {({ calls: "Calls", website: "Website clicks", directions: "Direction requests", impressions: "Impressions" })[perfMetric]} · last {perfRange} days
                  </div>
                </div>
                {(!perf || !perf.series || perf.series.length === 0) ? (
                  <div style={{ padding: "30px 20px", textAlign: "center" }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#1a1a1a", marginBottom: 6 }}>No performance data yet</div>
                    <div style={{ fontSize: 12, color: "#888", lineHeight: 1.6, maxWidth: 460, margin: "0 auto" }}>
                      Metrics populate as your profile gets traffic. Google's data also lags 2–3 days. Click <strong>Refresh from Google</strong> above to pull the latest, or check back after the nightly sync.
                    </div>
                  </div>
                ) : (
                  <TrendChart
                    series={perf.series}
                    metricKey={perfMetric}
                    color={({ calls: "#16a34a", website: "#2563eb", directions: "#E8600A", impressions: "#999" })[perfMetric]}
                  />
                )}
              </div>

              <div style={{ fontSize: 11, color: "#aaa", textAlign: "center", marginTop: 12 }}>
                Source: Google Business Profile Performance · synced nightly · data lags 2–3 days
              </div>
            </>
          )}
        </div>
      )}

      {pickerForPost && (
        <div onClick={() => setPickerForPost(null)} style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 14, maxWidth: 720, width: "100%", maxHeight: "80vh", overflow: "hidden", display: "flex", flexDirection: "column" }}>
            <div style={{ padding: "16px 20px", borderBottom: "1px solid #eee", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#1a1a1a" }}>Choose a photo from your profile</div>
              <button onClick={() => setPickerForPost(null)} style={{ background: "none", border: "none", fontSize: 20, color: "#888", cursor: "pointer" }}>×</button>
            </div>
            <div style={{ padding: 16, overflowY: "auto" }}>
              {photosLoading ? (
                <div style={{ textAlign: "center", padding: 40, color: "#bbb", fontSize: 13 }}>Loading photos…</div>
              ) : photos.length === 0 ? (
                <div style={{ textAlign: "center", padding: 40, color: "#bbb", fontSize: 13 }}>No photos found on your profile.</div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 10 }}>
                  {photos.map((p, i) => (
                    <div key={i} onClick={() => !attachingUrl && pickPhoto(p)} style={{ position: "relative", cursor: attachingUrl ? "wait" : "pointer", borderRadius: 8, overflow: "hidden", border: "1px solid #e8e6e0", aspectRatio: "1", background: "#f5f4f0" }}>
                      <img src={p.thumbnail || p.url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", opacity: attachingUrl === p.url ? 0.4 : 1 }} />
                      {attachingUrl === p.url && (
                        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 600, color: "#E8600A" }}>Attaching…</div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
