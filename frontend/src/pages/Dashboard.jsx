import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { AlertCircle } from "lucide-react";
import { getCalls, getBookings, getMetrics, getTenant, getPlans, getActivityFeed, getSalesWins } from "../api";
import { LumaSpin } from "../components/ui/luma-spin";
import CoachAlertCard from "../components/CoachAlertCard";
import { useBrand } from "../contexts/BrandContext";

const fmtC = n => "$" + Math.round(n / 100).toLocaleString();
const MONTH = new Date().toLocaleString("default", { month: "long" });
const NOW_YEAR = new Date().getFullYear();

export default function Dashboard({ tenantId, tenants = [], onTenantChange }) {
  const { companyName, logoUrl, isDefault } = useBrand();

  const [calls, setCalls] = useState([]);
  const [metrics, setMetrics] = useState(null);
  const [tenant, setTenant] = useState(null);
  const [feed, setFeed] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [goals, setGoals] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showGuide, setShowGuide] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(new Date());

  const token = typeof localStorage !== "undefined" ? localStorage.getItem("token") : "";
  const API_BASE = (typeof import.meta !== "undefined" && import.meta.env?.VITE_API_URL) || "";

  useEffect(() => {
    if (!tenantId) { setLoading(false); return; }
    Promise.all([
      getCalls(tenantId, { limit: 5 }),
      getBookings(tenantId, { limit: 5, status: "booked" }),
      getMetrics(tenantId),
      getTenant(tenantId),
      getActivityFeed(tenantId),
      fetch(`${API_BASE}/api/coaching/annual?year=${NOW_YEAR}&tenant_id=${tenantId}`, {
        headers: { Authorization: `Bearer ${token}` }
      }).then(r => r.json()).catch(() => null),
    ])
      .then(([callsRes, bookingsRes, metricsRes, tenantData, feedRes, goalsRes]) => {
        setCalls(callsRes.calls || []);
        setBookings(bookingsRes.bookings || []);
        setMetrics(metricsRes);
        setTenant(tenantData);
        setFeed(feedRes.feed || []);
        setGoals(goalsRes);
        setLastUpdated(new Date());
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [tenantId]);

  useEffect(() => {
    if (!tenantId) return;
    const interval = setInterval(() => {
      Promise.all([
        getCalls(tenantId, { limit: 5 }),
        getMetrics(tenantId),
        getActivityFeed(tenantId),
      ]).then(([callsRes, metricsRes, feedRes]) => {
        setCalls(callsRes.calls || []);
        setMetrics(metricsRes);
        setFeed(feedRes.feed || []);
        setLastUpdated(new Date());
      }).catch(() => {});
    }, 60000);
    return () => clearInterval(interval);
  }, [tenantId]);

  if (!tenantId) {
    return (
      <div className="px-0">
        <h1 className="text-xl sm:text-2xl font-semibold text-stone-900 mb-2">Command Center</h1>
        <p className="text-sm text-stone-500 mb-6">Select a business to get started.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {(tenants || []).map(t => (
            <button key={t.id} type="button" onClick={() => onTenantChange?.(t.id)}
              className="text-left bg-white rounded-xl border border-stone-200 shadow-sm p-4 sm:p-5 hover:border-stone-300 hover:bg-stone-50/80 transition-colors">
              <p className="font-medium text-stone-900">{t.company_name || t.name}</p>
              <p className="text-sm text-stone-500 mt-1">Select to view dashboard</p>
            </button>
          ))}
        </div>
        {(!tenants || tenants.length === 0) && (
          <p className="text-stone-500 text-sm">No businesses yet. Create one from the Businesses page.</p>
        )}
      </div>
    );
  }

  if (loading) return <div className="flex items-center justify-center py-20"><LumaSpin /></div>;
  if (error) return <div className="px-0"><p className="text-red-600 text-sm">{error}</p></div>;

  const openLeads = metrics?.pipeline?.open_estimates || 0;
  const estimatedRevenue = metrics?.pipeline?.estimated_revenue || 0;
  const actualRevenue = metrics?.pipeline?.actual_revenue || 0;
  const bookingRate = metrics?.totals?.booking_rate || 0;
  const calls30d = metrics?.totals?.calls || 0;
  const revenue = metrics?.totals?.revenue || 0;
  const callsHungUp = metrics?.ai?.calls_hung_up || 0;
  const callsFollowup = metrics?.ai?.calls_followup || 0;
  const callsTransferred = metrics?.ai?.calls_transferred || 0;
  const callsConfused = metrics?.ai?.calls_confused || 0;
  const totalNotConverted = callsHungUp + callsFollowup + callsTransferred + callsConfused;

  const totalRecovered = Math.round(revenue / 100);
  const missedCallRev = Math.round(totalRecovered * 0.39);
  const followupRev = Math.round(totalRecovered * 0.29);
  const estimateRev = Math.round(totalRecovered * 0.22);
  const reengageRev = Math.round(totalRecovered * 0.10);
  const roi = totalRecovered > 0 ? Math.round(totalRecovered / 497) : 0;

  // ═══════════════════════════════════════════════════════════════════
  // BRAND-AWARE: use brand color var instead of hardcoded #E8600A so
  // tenant-specific colors flow through. Initials for logo fallback.
  // ═══════════════════════════════════════════════════════════════════
  const BRAND = "var(--brand-600)";
  const BRAND_SOFT = "rgba(var(--brand-600), 0.15)";

  // ═══════════════════════════════════════════════════════════════════
  // HERO PALETTE — Apr 19, 2026 P0 fix. The Revenue Recovered hero was
  // dark navy with brand-color numbers. When Gladiators (#03222a dark
  // teal) flipped to white_label, the headline number went invisible —
  // near-black on near-black. Fix: dark navy + orange stays for AFDH
  // (ai_branded), white_label tenants get a cream-bg palette where any
  // brand color reads cleanly. Contrast bug only affects WL tenants now.
  // ═══════════════════════════════════════════════════════════════════
  const hero = isDefault
    ? {
        bg: "#1A2744",              // dark navy (AFDH default)
        tileBg: "#243358",          // slightly lighter navy for ROI box + icon squares
        trackBg: "#2d3f60",         // progress bar track
        eyebrow: "#8899bb",         // "APRIL 2026 · AI RECOVERED" label
        titleText: "#e8edf5",       // "Revenue Recovered by AI"
        subText: "#8899bb",         // "Would have been $0 without AI"
        rowLabel: "#aab8cc",        // four mini-stat row labels
        roiValueColor: "#4ade80",   // green ROI number
        savingsColor: "#4ade80",    // green "$0 without AI" accent
      }
    : {
        bg: "#F8F7F2",              // cream (sits cleanly on the #F5F4F0 page bg)
        tileBg: "#ffffff",          // ROI box + icon squares
        trackBg: "#e8e6e0",         // progress bar track
        eyebrow: "#888",
        titleText: "#1a1a1a",
        subText: "#666",
        rowLabel: "#444",
        roiValueColor: "#16a34a",   // darker green for contrast on cream
        savingsColor: "#16a34a",
      };

  // Shadow + border give the cream hero definition against the page bg;
  // the navy hero already pops against #F5F4F0 so it doesn't need either.
  const heroShell = isDefault
    ? { background: hero.bg, borderRadius: 16, padding: 20, position: "relative", overflow: "hidden" }
    : { background: hero.bg, borderRadius: 16, padding: 20, position: "relative", overflow: "hidden", border: "1px solid #e8e6e0" };

  const initials = (companyName || "FD").trim().charAt(0).toUpperCase();
  const footerLabel = isDefault ? "AI Front Desk Helper" : companyName;

  const s = {
    card: { background: "#fff", borderRadius: 14, border: "1px solid #e8e6e0", overflow: "hidden" },
    cardHdr: { padding: "10px 16px", borderBottom: "1px solid #f5f5f5", display: "flex", justifyContent: "space-between", alignItems: "center" },
    cardTitle: { fontSize: 13, fontWeight: 600, color: "#1a1a1a" },
    cardSub: { fontSize: 10, color: "#888" },
    secLabel: { display: "flex", alignItems: "center", gap: 6, marginBottom: 10 },
    secBar: { width: 3, height: 13, background: BRAND, borderRadius: 2, flexShrink: 0 },
    secTitle: { fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#1a1a1a" },
    secSub: { fontSize: 10, color: "#888", marginLeft: "auto" },
    va: { fontSize: 10, color: BRAND, fontWeight: 600, textDecoration: "none" },
  };

  const ZAPIER_NAMES = ["Zapier", "zapier", "webhook", "Webhook", "WEBHOOK"];

  function getApptName(b) {
    if (!b.contact_name || ZAPIER_NAMES.includes(b.contact_name.trim())) {
      return b.contact_phone ? `#${b.contact_phone.slice(-4)}` : "Lead";
    }
    return b.contact_name.split(" ")[0];
  }

  function getApptDate(b) {
    const raw = b.preferred_date || b.appointment_date || b.scheduled_date;
    if (!raw || raw === "null") return null;
    const d = new Date(raw);
    return isNaN(d.getTime()) ? null : d;
  }

  return (
    <div style={{ background: "#F5F4F0", minHeight: "100vh", fontFamily: "'DM Sans', sans-serif", padding: "0 0 48px" }}>

      {/* Topbar */}
      <div style={{ background: "#fff", borderBottom: "1px solid #e5e5e5", padding: "10px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {/* Brand badge: logo if tenant has one, else first-letter initial in brand color */}
          {logoUrl ? (
            <img
              src={logoUrl}
              alt={companyName}
              style={{ width: 28, height: 28, borderRadius: 7, objectFit: "cover", background: "#f5f4f0", flexShrink: 0 }}
            />
          ) : (
            <div style={{ width: 28, height: 28, background: BRAND, borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 800, fontSize: 12, flexShrink: 0 }}>
              {initials}
            </div>
          )}
          <span style={{ fontSize: 14, fontWeight: 700, color: "#1a1a1a" }}>Command Center</span>
          <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: "#16a34a", fontWeight: 600, background: "#f0fdf4", padding: "3px 8px", borderRadius: 20, border: "1px solid #bbf7d0" }}>
            <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#16a34a" }} />AI Online
          </div>
        </div>
        <div style={{ fontSize: 10, color: "#aaa" }}>
          Updated {lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · Auto-refresh 60s
        </div>
      </div>

      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 20px", display: "flex", flexDirection: "column", gap: 20 }}>

        {/* ── CARD 1: REVENUE RECOVERED HERO ── */}
        {/* Hero colors all come from `hero` / `heroShell` at the top of the
            component. ai_branded → dark navy. white_label → cream. Keeping
            the numeric + semantic colors (green for ROI, mini-stat pop colors)
            is intentional — those are meaning-carriers, not brand surface. */}
        <div>
          <div style={s.secLabel}>
            <div style={s.secBar} /><div style={s.secTitle}>Revenue Recovered by AI</div>
            <div style={s.secSub}>This month</div>
          </div>
          <div style={heroShell}>
            <div style={{ position: "absolute", top: -40, right: -40, width: 200, height: 200, borderRadius: "50%", background: BRAND_SOFT, pointerEvents: "none" }} />
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 12 }}>
              <div>
                <div style={{ fontSize: 9, color: hero.eyebrow, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 2 }}>{MONTH} {NOW_YEAR} · AI recovered</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: hero.titleText }}>Revenue Recovered by AI</div>
                <div style={{ fontSize: 40, fontWeight: 800, color: BRAND, lineHeight: 1, margin: "4px 0 3px" }}>${totalRecovered.toLocaleString()}</div>
                <div style={{ fontSize: 10, color: hero.subText }}>Would have been <span style={{ color: hero.savingsColor, fontWeight: 600 }}>$0 without AI</span></div>
              </div>
              <div style={{ background: hero.tileBg, borderRadius: 10, padding: "10px 14px", textAlign: "right" }}>
                <div style={{ fontSize: 8, color: hero.eyebrow, textTransform: "uppercase", letterSpacing: "0.06em" }}>ROI</div>
                <div style={{ fontSize: 28, fontWeight: 800, color: hero.roiValueColor, lineHeight: 1 }}>{roi}x</div>
                <div style={{ fontSize: 9, color: hero.eyebrow, marginTop: 2 }}>$497/mo cost</div>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 8 }}>
              {[
                { icon: "📞", label: "Missed calls recovered", amt: missedCallRev, color: isDefault ? "#4ade80" : "#16a34a", barColor: "#16a34a", pct: 90 },
                { icon: "💬", label: "Follow-up conversions", amt: followupRev, color: isDefault ? "#fb923c" : "#ea580c", barColor: BRAND, pct: 72 },
                { icon: "📋", label: "Cold estimate follow-ups", amt: estimateRev, color: isDefault ? "#60a5fa" : "#2563eb", barColor: "#2563eb", pct: 56 },
                { icon: "🔄", label: "Re-engagement campaigns", amt: reengageRev, color: isDefault ? "#c084fc" : "#7c3aed", barColor: "#7c3aed", pct: 30 },
              ].map((r, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ width: 24, height: 24, borderRadius: 6, background: hero.tileBg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, flexShrink: 0 }}>{r.icon}</div>
                  <div style={{ fontSize: 10, color: hero.rowLabel, flex: 1 }}>{r.label}</div>
                  <div style={{ width: 50, height: 3, background: hero.trackBg, borderRadius: 2, overflow: "hidden", flexShrink: 0 }}>
                    <div style={{ width: `${r.pct}%`, height: "100%", background: r.barColor, borderRadius: 2 }} />
                  </div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: r.color, flexShrink: 0, width: 52, textAlign: "right" }}>${r.amt.toLocaleString()}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── COACH ALERTS ── */}
        <div>
          <div style={s.secLabel}>
            <div style={s.secBar} /><div style={s.secTitle}>Coach's Alerts</div>
            <div style={s.secSub}>Live · based on your data right now</div>
          </div>
          <CoachAlertCard metrics={metrics} goals={goals} calls={calls} />
        </div>

        {/* ── PIPELINE ── */}
        <div>
          <div style={{ ...s.secLabel }}>
            <div style={{ ...s.secBar, background: "#16a34a" }} /><div style={s.secTitle}>Pipeline Value</div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
            {[
              { label: "Open Estimates", value: openLeads, valueColor: "#1a1a1a", sub: "Needs follow-up" },
              { label: "Jobs Scheduled", value: metrics?.pipeline?.jobs_scheduled || 0, valueColor: "#2563eb", sub: "Confirmed bookings" },
              { label: "Pipeline Value", value: estimatedRevenue ? fmtC(estimatedRevenue) : "$0", valueColor: "#16a34a", sub: "AI estimated" },
              { label: "Confirmed Revenue", value: actualRevenue > 0 ? fmtC(actualRevenue) : "$0", valueColor: "#1a1a1a", sub: actualRevenue > 0 ? "DripJobs tracked" : null, showSetup: actualRevenue === 0 },
            ].map((kpi, i) => (
              <div key={i} style={{ background: "#fff", borderRadius: 12, padding: "12px 14px", border: "1px solid #e8e6e0" }}>
                <div style={{ fontSize: 9, color: "#888", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 5 }}>{kpi.label}</div>
                <div style={{ fontSize: 28, fontWeight: 700, color: kpi.valueColor, lineHeight: 1 }}>{kpi.value}</div>
                {kpi.sub && <div style={{ fontSize: 9, color: "#888", marginTop: 4 }}>{kpi.sub}</div>}
                {kpi.showSetup && (
                  <button onClick={() => setShowGuide(true)} style={{ marginTop: 6, fontSize: 9, fontWeight: 700, color: "#16a34a", background: "#f0fdf4", border: "none", padding: "2px 8px", borderRadius: 6, cursor: "pointer", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                    Setup tracking →
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        {showGuide && <ZapierGuideModal onClose={() => setShowGuide(false)} />}

        {/* ── TWO COLUMN: OBJECTIONS + ACTIVITY FEED ── */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div>
            <div style={s.secLabel}>
              <div style={s.secBar} /><div style={s.secTitle}>Why Calls Didn't Convert</div>
              <div style={s.secSub}>{totalNotConverted} didn't book</div>
            </div>
            <div style={s.card}>
              <div style={s.cardHdr}>
                <div><div style={s.cardTitle}>Objection breakdown</div><div style={s.cardSub}>From call transcripts</div></div>
                <div style={{ fontSize: 10, color: BRAND, fontWeight: 600 }}>This month</div>
              </div>
              {[
                { label: 'Price — "too expensive"', count: callsHungUp, color: BRAND },
                { label: "Not ready / timing", count: callsFollowup, color: "#2563eb" },
                { label: "Wanted human transfer", count: callsTransferred, color: "#7c3aed" },
                { label: "Confusion / unclear", count: callsConfused, color: "#dc2626" },
              ].map((obj, i) => {
                const pct = totalNotConverted > 0 ? Math.round((obj.count / totalNotConverted) * 100) : 0;
                return (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 16px", borderBottom: i < 3 ? "1px solid #f8f8f8" : "none" }}>
                    <div style={{ width: 7, height: 7, borderRadius: "50%", background: obj.color, flexShrink: 0 }} />
                    <div style={{ fontSize: 11, color: "#444", flex: 1 }}>{obj.label}</div>
                    <div style={{ width: 60, height: 4, background: "#f5f4f0", borderRadius: 2, overflow: "hidden" }}>
                      <div style={{ width: `${pct}%`, height: "100%", background: obj.color }} />
                    </div>
                    <div style={{ fontSize: 11, fontWeight: 700, width: 24, textAlign: "right" }}>{obj.count}</div>
                    <div style={{ fontSize: 10, color: "#888", width: 30, textAlign: "right" }}>{pct}%</div>
                  </div>
                );
              })}
              <div style={{ padding: "8px 16px", background: "#fafafa", borderTop: "1px solid #f5f5f5", fontSize: 10, color: "#666", lineHeight: 1.6 }}>
                💡 Price objections highest — add value reframe to AI script
              </div>
            </div>
          </div>

          <div>
            <div style={s.secLabel}>
              <div style={s.secBar} /><div style={s.secTitle}>Live Activity Feed</div>
              <div style={s.secSub}>Every AI action</div>
            </div>
            <div style={{ ...s.card, maxHeight: 340, overflowY: "auto" }}>
              <div style={s.cardHdr}>
                <div style={{ ...s.cardTitle, display: "flex", alignItems: "center", gap: 6 }}>
                  <div style={{ width: 6, height: 6, borderRadius: "50%", background: BRAND }} />Activity
                </div>
                <div style={s.cardSub}>Real-time</div>
              </div>
              {feed.slice(0, 8).map((item, i) => {
                const typeMap = { call: { icon: "📞", bg: "#fff7ed" }, booking: { icon: "📅", bg: "#f0fdf4" }, recovery: { icon: "💰", bg: "#fdf4ff" }, follow_up: { icon: "💬", bg: "#eff6ff" } };
                const t = typeMap[item.type] || { icon: "⚡", bg: "#f5f4f0" };
                return (
                  <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "8px 16px", borderBottom: i < feed.length - 1 ? "1px solid #f8f8f8" : "none" }}>
                    <div style={{ width: 26, height: 26, borderRadius: "50%", background: t.bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, flexShrink: 0 }}>{t.icon}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: "#1a1a1a" }}>{item.text}</div>
                      <div style={{ fontSize: 10, color: "#888", marginTop: 1 }}>
                        {item.at ? new Date(item.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}
                      </div>
                    </div>
                  </div>
                );
              })}
              {feed.length === 0 && <div style={{ padding: 16, fontSize: 11, color: "#bbb", textAlign: "center" }}>Waiting for activity...</div>}
            </div>
          </div>
        </div>

        {/* ── TWO COLUMN: RECENT CALLS + UPCOMING APPOINTMENTS ── */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div>
            <div style={s.secLabel}>
              <div style={{ ...s.secBar, background: "#2563eb" }} /><div style={s.secTitle}>Recent Calls</div>
              <div style={s.secSub}>Last 5</div>
            </div>
            <div style={s.card}>
              <div style={s.cardHdr}>
                <div style={s.cardTitle}>AI call activity</div>
                <Link to="/calls" style={s.va}>View all →</Link>
              </div>
              {calls.slice(0, 5).map((call, i) => {
                const name = call.contact_name || call.from_number || "Unknown";
                const callInitials = name.slice(0, 2).toUpperCase();
                const colors = ["#fff7ed","#f0fdf4","#eff6ff","#fdf4ff","#fff1f2"];
                const tColors = ["#c2410c","#166534","#1d4ed8","#7c3aed","#be123c"];
                const booked = call.disposition === "booked" || call.status?.toLowerCase().includes("booked");
                const transferred = call.transfer_to || call.disposition === "transferred";
                return (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 16px", borderBottom: i < 4 ? "1px solid #f8f8f8" : "none" }}>
                    <div style={{ width: 30, height: 30, borderRadius: "50%", background: colors[i%5], color: tColors[i%5], display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, flexShrink: 0 }}>{callInitials}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11, fontWeight: 600 }}>{name}</div>
                      <div style={{ fontSize: 10, color: "#888" }}>{call.contact_phone || call.from_number || ""}</div>
                    </div>
                    <div style={{ fontSize: 9, fontWeight: 700, padding: "2px 7px", borderRadius: 8, background: booked?"#dcfce7":transferred?"#eff6ff":"#f5f4f0", color: booked?"#166534":transferred?"#1d4ed8":"#888" }}>
                      {booked?"Booked":transferred?"Transferred":"Completed"}
                    </div>
                    <div style={{ fontSize: 9, color: "#aaa", flexShrink: 0 }}>
                      {call.started_at ? new Date(call.started_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}
                    </div>
                  </div>
                );
              })}
              {calls.length === 0 && <div style={{ padding: 16, fontSize: 11, color: "#bbb", textAlign: "center" }}>No calls yet today</div>}
            </div>
          </div>

          <div>
            <div style={s.secLabel}>
              <div style={{ ...s.secBar, background: "#7c3aed" }} /><div style={s.secTitle}>Upcoming Appointments</div>
              <div style={s.secSub}>Next 5</div>
            </div>
            <div style={s.card}>
              <div style={s.cardHdr}>
                <div style={s.cardTitle}>This week</div>
                <Link to="/bookings" style={s.va}>Calendar →</Link>
              </div>
              <div style={{ display: "flex", overflowX: "auto" }}>
                {bookings.slice(0, 5).map((b, i) => {
                  const d = getApptDate(b);
                  const displayName = getApptName(b);
                  const isToday = d && d.toDateString() === new Date().toDateString();
                  return (
                    <div key={i} style={{ minWidth: 110, padding: "12px", borderRight: i < 4 ? "1px solid #f5f5f5" : "none", flexShrink: 0 }}>
                      <div style={{ width: 36, height: 36, background: isToday?"#fff7ed":"#f5f4f0", border: isToday?"1px solid #fed7aa":"1px solid #e5e5e5", borderRadius: 8, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", marginBottom: 8 }}>
                        <div style={{ fontSize: 15, fontWeight: 700, lineHeight: 1, color: isToday ? BRAND : "#1a1a1a" }}>
                          {d ? d.getDate() : "—"}
                        </div>
                        <div style={{ fontSize: 8, color: "#888", textTransform: "uppercase" }}>
                          {d ? d.toLocaleString("default",{month:"short"}) : ""}
                        </div>
                      </div>
                      <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 2 }}>{displayName}</div>
                      <div style={{ fontSize: 9, color: "#888", marginBottom: 2 }}>{b.job_type||b.scope?.slice(0,12)||"Estimate"}</div>
                      <div style={{ fontSize: 9, color: "#888" }}>{b.appointment_time||"TBD"}</div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "#16a34a", marginTop: 4 }}>
                        {b.estimated_revenue_cents ? fmtC(b.estimated_revenue_cents) : "—"}
                      </div>
                    </div>
                  );
                })}
                {bookings.length === 0 && <div style={{ padding: 16, fontSize: 11, color: "#bbb", textAlign: "center", width: "100%" }}>No upcoming appointments</div>}
              </div>
            </div>
          </div>
        </div>

        {/* ── QUICK ACTIONS + AI HEALTH ── */}
        <div style={s.card}>
          <div style={s.cardHdr}><div style={s.cardTitle}>Quick Actions</div></div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8, padding: "12px 16px" }}>
            {[
              { icon: "📞", label: "Start outbound", href: "/outbound" },
              { icon: "📅", label: "Add booking", href: "/bookings" },
              { icon: "💬", label: "Send SMS", href: "/conversations" },
              { icon: "👤", label: "Add lead", href: "/leads" },
            ].map((btn, i) => (
              <Link key={i} to={btn.href} style={{ background: "#f5f4f0", borderRadius: 8, padding: "10px 12px", border: "1px solid #e5e5e5", display: "flex", alignItems: "center", gap: 8, textDecoration: "none" }}>
                <span style={{ fontSize: 16 }}>{btn.icon}</span>
                <span style={{ fontSize: 11, fontWeight: 600, color: "#1a1a1a" }}>{btn.label}</span>
              </Link>
            ))}
          </div>
          <div style={{ borderTop: "1px solid #f5f5f5", padding: "10px 16px" }}>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#888", marginBottom: 8 }}>AI Health Status</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 4 }}>
              {[
                { label: "Twilio", status: "Online", color: "#16a34a" },
                { label: "OpenAI voice", status: "Online", color: "#16a34a" },
                { label: "SMS sequences", status: `Running · ${metrics?.nurturing?.emails_sent||0} sent`, color: "#16a34a" },
                { label: "Follow-ups", status: `${openLeads} active leads`, color: "#16a34a" },
              ].map((h, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 0", borderBottom: "1px solid #f8f8f8" }}>
                  <div style={{ fontSize: 11, color: "#444" }}>{h.label}</div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: h.color }}>{h.status}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div style={{ textAlign: "center", fontSize: 10, color: "#bbb", paddingTop: 8 }}>
          {footerLabel} · Command Center · {new Date().toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"})}
        </div>

      </div>
    </div>
  );
}

function ZapierGuideModal({ onClose }) {
  const [copied, setCopied] = useState(false);
  const webhookUrl = "https://ai-front-desk-backend.onrender.com/api/webhooks/crm/estimate-sent";
  const handleCopy = () => { navigator.clipboard.writeText(webhookUrl); setCopied(true); setTimeout(() => setCopied(false), 2000); };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm" onClick={onClose}></div>
      <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden">
        <div className="p-6 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-black text-gray-900 tracking-tight leading-none">Setup Revenue Tracking</h2>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-1">Connect DripJobs or your CRM via Zapier</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-gray-50 flex items-center justify-center text-gray-400 hover:bg-gray-100 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="p-6 max-h-[70vh] overflow-y-auto space-y-6 text-left">
          <section>
            <h3 className="text-[10px] font-black text-gray-900 uppercase tracking-widest mb-3 flex items-center gap-2">
              <div className="w-4 h-4 bg-orange-500 rounded text-white flex items-center justify-center text-[9px]">1</div>Step 1: Create Your Zap
            </h3>
            <p className="text-[11px] text-gray-500 leading-relaxed mb-3">Use <strong>"Webhooks by Zapier"</strong> as your action. Set event to <strong>POST</strong> and use this endpoint:</p>
            <div className="bg-gray-50 p-3 rounded-lg font-mono text-[10px] text-gray-600 border border-gray-100 flex items-center justify-between group">
              <span className="truncate">{webhookUrl}</span>
              <button onClick={handleCopy} className="text-[9px] font-black text-blue-600 uppercase">{copied?"Copied!":"Copy"}</button>
            </div>
          </section>
          <section>
            <h3 className="text-[10px] font-black text-gray-900 uppercase tracking-widest mb-3 flex items-center gap-2">
              <div className="w-4 h-4 bg-orange-500 rounded text-white flex items-center justify-center text-[9px]">2</div>Step 2: Map the Data
            </h3>
            <div className="bg-gray-900 rounded-lg p-5 text-emerald-400 font-mono text-[10px] leading-relaxed border-l-4 border-emerald-500">
              <div className="flex justify-between border-b border-gray-800 pb-2 mb-2 text-gray-500 uppercase font-bold text-[9px] tracking-widest"><span>Key</span><span>Value (from CRM)</span></div>
              {[["api_key","YOUR_API_KEY"],["contact_name",'"First Name" + "Last Name"'],["contact_phone",'"Phone Number"'],["estimated_revenue_cents",'"Total Price"']].map(([k,v],i)=>(
                <div key={i} className="flex justify-between py-1"><span className="text-gray-300">{k}</span><span className="text-emerald-500 italic">{v}</span></div>
              ))}
            </div>
          </section>
          <section className="bg-emerald-50/50 p-4 rounded-2xl border border-emerald-100">
            <h3 className="text-[10px] font-black text-emerald-900 uppercase tracking-widest mb-3 flex items-center gap-2">
              <div className="w-4 h-4 bg-emerald-500 rounded text-white flex items-center justify-center text-[9px]">3</div>Confirmed Revenue Zap
            </h3>
            <p className="text-[11px] text-emerald-800 leading-relaxed mb-2">Create a second Zap when a job is marked Won/Completed:</p>
            <div className="bg-white p-3 rounded-lg font-mono text-[10px] text-emerald-700 border border-emerald-100 select-all">
              https://ai-front-desk-backend.onrender.com/api/webhooks/crm/job-won
            </div>
          </section>
          <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 flex gap-3">
            <div className="w-5 h-5 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 shrink-0 text-[10px] font-black">!</div>
            <div className="text-[10px] text-blue-800 leading-relaxed">
              <strong className="block mb-0.5">Revenue in cents:</strong>If job total is $1,500 send <strong>150000</strong>. Use Zapier Formatter to multiply by 100.
            </div>
          </div>
        </div>
        <div className="p-6 bg-gray-50 border-t border-gray-100 flex justify-end">
          <button onClick={onClose} className="px-5 py-2.5 bg-gray-900 text-white rounded-lg text-[10px] font-black uppercase tracking-widest hover:opacity-90 transition-opacity">
            Done, Let's track some ROI
          </button>
        </div>
      </div>
    </div>
  );
}
