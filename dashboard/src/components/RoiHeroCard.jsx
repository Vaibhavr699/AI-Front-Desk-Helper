import { useEffect, useState } from "react";
import { useBrand } from "../contexts/BrandContext";

/**
 * RoiHeroCard — "Revenue Booked by AI" hero with REAL attribution.
 * (Jun 11, 2026)
 *
 * REPLACES the original Card 1 "Revenue Recovered by AI" hero in
 * Dashboard.jsx, whose breakdown rows were placeholder math (totalRecovered
 * × 0.39 / 0.29 / 0.22 / 0.10 with hardcoded bar widths) and whose ROI box
 * divided by a hardcoded $497/mo. Every number on this card comes from
 * GET /api/dashboard/roi-summary:
 *
 *   - Hero: month-to-date estimated revenue across all AI-created bookings
 *     (actuals used where present; cancelled/lost excluded).
 *   - "Moments you'd have missed": after-hours bookings (tenant's real
 *     business_hours, tenant tz) + leads resurrected by recovery touches.
 *   - Trend: month-to-date vs the SAME day-window of last month.
 *   - Rows: after-hours, follow-up resurrected, then top channels — bar
 *     widths are each row's true share of the month's total.
 *
 * Visuals match the existing hero exactly: same brand-aware navy/cream
 * palette keyed off useBrand().isDefault, same section-label pattern,
 * same shell. Drop-in:
 *
 *   import RoiHeroCard from "../components/RoiHeroCard";
 *   ...
 *   <RoiHeroCard tenantId={tenantId} />
 */

const MONTH = new Date().toLocaleString("default", { month: "long" });
const NOW_YEAR = new Date().getFullYear();
const fmtC = (cents) => "$" + Math.round((Number(cents) || 0) / 100).toLocaleString();

const CHANNEL_ICONS = {
  Phone: "📞",
  SMS: "💬",
  Website: "🌐",
  Social: "📣",
  Email: "✉️",
  Other: "⚡",
};

export default function RoiHeroCard({ tenantId }) {
  const { isDefault } = useBrand();
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);

  const token = typeof localStorage !== "undefined" ? localStorage.getItem("token") : "";
  const API_BASE = (typeof import.meta !== "undefined" && import.meta.env?.VITE_API_URL) || "";

  useEffect(() => {
    if (!tenantId) return;
    let alive = true;
    setData(null);
    setFailed(false);
    fetch(`${API_BASE}/api/dashboard/roi-summary?tenant_id=${encodeURIComponent(tenantId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`roi-summary ${r.status}`))))
      .then((d) => alive && setData(d))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  // ── Palette: copied from Dashboard.jsx's hero (Apr 19 contrast fix) ──
  const BRAND = "var(--brand-600)";
  const BRAND_SOFT = "rgba(var(--brand-600), 0.15)";
  const hero = isDefault
    ? {
        bg: "#1A2744", tileBg: "#243358", trackBg: "#2d3f60",
        eyebrow: "#8899bb", titleText: "#e8edf5", subText: "#8899bb",
        rowLabel: "#aab8cc", accentGreen: "#4ade80",
      }
    : {
        bg: "#F8F7F2", tileBg: "#ffffff", trackBg: "#e8e6e0",
        eyebrow: "#888", titleText: "#1a1a1a", subText: "#666",
        rowLabel: "#444", accentGreen: "#16a34a",
      };
  const heroShell = isDefault
    ? { background: hero.bg, borderRadius: 16, padding: 20, position: "relative", overflow: "hidden" }
    : { background: hero.bg, borderRadius: 16, padding: 20, position: "relative", overflow: "hidden", border: "1px solid #e8e6e0" };

  const secLabel = { display: "flex", alignItems: "center", gap: 6, marginBottom: 10 };
  const secBar = { width: 3, height: 13, background: BRAND, borderRadius: 2, flexShrink: 0 };
  const secTitle = { fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#1a1a1a" };
  const secSub = { fontSize: 10, color: "#888", marginLeft: "auto" };

  // Quiet failure: render nothing rather than a broken hero.
  if (failed) return null;

  const mtd = data?.month_to_date;
  const missed = mtd?.missed_moments;
  const total = mtd?.total_cents || 0;

  // Build the real breakdown rows: missed-moment categories first, then the
  // top channels. Bar width = each row's true share of the month's total.
  const rows = [];
  if (mtd) {
    if (missed.after_hours_count > 0) {
      rows.push({
        icon: "🌙",
        label: `After-hours bookings (${missed.after_hours_count})`,
        cents: missed.after_hours_cents,
        color: isDefault ? "#4ade80" : "#16a34a",
        barColor: "#16a34a",
      });
    }
    if (missed.recovery_count > 0) {
      rows.push({
        icon: "💰",
        label: `Resurrected by follow-up (${missed.recovery_count})`,
        cents: missed.recovery_cents,
        color: isDefault ? "#fb923c" : "#ea580c",
        barColor: BRAND,
      });
    }
    const channelColors = isDefault
      ? ["#60a5fa", "#c084fc", "#f472b6"]
      : ["#2563eb", "#7c3aed", "#db2777"];
    const channelBarColors = ["#2563eb", "#7c3aed", "#db2777"];
    (mtd.channels || []).slice(0, Math.max(0, 4 - rows.length)).forEach((ch, i) => {
      rows.push({
        icon: CHANNEL_ICONS[ch.label] || "⚡",
        label: `${ch.label} bookings (${ch.count})`,
        cents: ch.cents,
        color: channelColors[i % channelColors.length],
        barColor: channelBarColors[i % channelBarColors.length],
      });
    });
  }

  const trend = data?.trend_pct ?? 0;
  const trendUp = trend >= 0;

  return (
    <div>
      <div style={secLabel}>
        <div style={secBar} />
        <div style={secTitle}>Revenue Booked by AI</div>
        <div style={secSub}>This month · estimated</div>
      </div>
      <div style={heroShell}>
        <div style={{ position: "absolute", top: -40, right: -40, width: 200, height: 200, borderRadius: "50%", background: BRAND_SOFT, pointerEvents: "none" }} />

        {!data ? (
          // Skeleton while loading — same footprint, no layout jump.
          <div style={{ minHeight: 120, display: "flex", alignItems: "center" }}>
            <div style={{ fontSize: 11, color: hero.subText }}>Loading this month's numbers…</div>
          </div>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 12 }}>
              <div>
                <div style={{ fontSize: 9, color: hero.eyebrow, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 2 }}>
                  {MONTH} {NOW_YEAR} · booked through your AI front desk
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, color: hero.titleText }}>Revenue Booked by AI</div>
                <div style={{ fontSize: 40, fontWeight: 800, color: BRAND, lineHeight: 1, margin: "4px 0 3px" }}>
                  {fmtC(total)}
                </div>
                <div style={{ fontSize: 10, color: hero.subText }}>
                  {mtd.booking_count} booking{mtd.booking_count === 1 ? "" : "s"} this month
                  {missed.booking_count > 0 && (
                    <>
                      {" · "}
                      <span style={{ color: hero.accentGreen, fontWeight: 600 }}>
                        {fmtC(missed.total_cents)} from moments you'd have missed
                      </span>
                    </>
                  )}
                </div>
              </div>
              <div style={{ background: hero.tileBg, borderRadius: 10, padding: "10px 14px", textAlign: "right" }}>
                <div style={{ fontSize: 8, color: hero.eyebrow, textTransform: "uppercase", letterSpacing: "0.06em" }}>vs last month</div>
                <div style={{ fontSize: 28, fontWeight: 800, color: trendUp ? hero.accentGreen : "#f87171", lineHeight: 1 }}>
                  {trendUp ? "▲" : "▼"}{Math.abs(trend)}%
                </div>
                <div style={{ fontSize: 9, color: hero.eyebrow, marginTop: 2 }}>same days, last month</div>
              </div>
            </div>

            {rows.length > 0 ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 8 }}>
                {rows.map((r, i) => {
                  const pct = total > 0 ? Math.min(100, Math.round((r.cents / total) * 100)) : 0;
                  return (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ width: 24, height: 24, borderRadius: 6, background: hero.tileBg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, flexShrink: 0 }}>{r.icon}</div>
                      <div style={{ fontSize: 10, color: hero.rowLabel, flex: 1 }}>{r.label}</div>
                      <div style={{ width: 50, height: 3, background: hero.trackBg, borderRadius: 2, overflow: "hidden", flexShrink: 0 }}>
                        <div style={{ width: `${pct}%`, height: "100%", background: r.barColor, borderRadius: 2 }} />
                      </div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: r.color, flexShrink: 0, width: 56, textAlign: "right" }}>{fmtC(r.cents)}</div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ fontSize: 10, color: hero.subText }}>
                No bookings yet this month — this card fills in as the AI books appointments across phone, SMS, and web.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
