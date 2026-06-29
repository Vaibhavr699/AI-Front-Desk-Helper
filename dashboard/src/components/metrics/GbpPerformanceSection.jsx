import React, { useState, useEffect } from "react";
import { getGbpPerformance } from "../../api";
import { PhoneCall, Globe, MapPin, Eye } from "lucide-react";

// Maps the Metrics page's range selector to GBP's supported day windows.
// GBP data lags 2-3 days, so 'today' alone is always empty → show last 7.
function rangeToDays(timeRange) {
  switch (timeRange) {
    case "today": return 7;
    case "7d":    return 7;
    case "30d":   return 30;
    case "90d":   return 90;
    case "all":   return 90;
    default:      return 30;
  }
}

const METRICS = [
  { key: "calls",      label: "Calls",         Icon: PhoneCall, color: "#16a34a", hex: "text-emerald-600" },
  { key: "website",    label: "Website clicks", Icon: Globe,     color: "#2563eb", hex: "text-blue-600" },
  { key: "directions", label: "Directions",    Icon: MapPin,    color: "#E8702A", hex: "text-brand-600" },
  { key: "impressions",label: "Impressions",   Icon: Eye,       color: "#9ca3af", hex: "text-gray-500" },
];

// Dependency-free SVG bar trend — same pattern as the Sankey/heatmap sections.
function MiniTrend({ series, metricKey, color }) {
  const W = 760, H = 120, padL = 28, padR = 10, padT = 10, padB = 18;
  if (!series || series.length === 0) return null;
  const vals = series.map(d => d[metricKey] || 0);
  const max = Math.max(1, ...vals);
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const n = series.length;
  const barW = Math.max(2, (innerW / n) - 2);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }}>
      {[0, 0.5, 1].map((f, i) => {
        const y = padT + innerH * (1 - f);
        return (
          <g key={i}>
            <line x1={padL} y1={y} x2={W - padR} y2={y} stroke="#f1f1f1" strokeWidth={1} />
            <text x={padL - 5} y={y + 3} textAnchor="end" fontSize={8} fill="#cbd0d6">{Math.round(max * f)}</text>
          </g>
        );
      })}
      {series.map((d, i) => {
        const v = d[metricKey] || 0;
        const h = (v / max) * innerH;
        const x = padL + (innerW / n) * i + 1;
        const y = padT + innerH - h;
        return <rect key={i} x={x} y={y} width={barW} height={h} rx={1.5} fill={color} opacity={0.85} />;
      })}
      {[0, Math.floor(n / 2), n - 1].map((idx, i) => {
        const d = series[idx];
        if (!d) return null;
        const x = padL + (innerW / n) * idx + barW / 2;
        const label = new Date(d.date).toLocaleDateString("en-US", { month: "short", day: "numeric" });
        return <text key={i} x={x} y={H - 4} textAnchor="middle" fontSize={8} fill="#9ca3af">{label}</text>;
      })}
    </svg>
  );
}

function SectionTitle({ title }) {
  return (
    <div className="flex items-center gap-3 py-1">
      <div className="w-1 h-3.5 bg-brand-600 rounded-full shadow-sm"></div>
      <h2 className="text-xs font-bold text-gray-900 uppercase tracking-widest leading-none">{title}</h2>
    </div>
  );
}

export default function GbpPerformanceSection({ tenantId, timeRange }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [activeMetric, setActiveMetric] = useState("calls");

  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    getGbpPerformance(tenantId, rangeToDays(timeRange))
      .then(d => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setFailed(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [tenantId, timeRange]);

  // Invisible failure: if GBP isn't connected / add-on inactive / errored,
  // the section simply doesn't render (the endpoint 403s or returns nothing).
  if (failed) return null;
  if (!loading && (!data || !data.series || data.series.length === 0)) return null;

  const totals = data?.totals || {};
  const series = data?.series || [];
  const active = METRICS.find(m => m.key === activeMetric) || METRICS[0];

  return (
    <section className="space-y-3 pt-4">
      <SectionTitle title="Google Business Profile" />

      <div className="bg-white border border-gray-200/60 rounded-xl shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/10">
          <div>
            <h3 className="text-sm font-bold text-gray-900 leading-tight">How your profile is performing on Google</h3>
            <p className="text-[10px] text-gray-400 font-medium">Calls, clicks &amp; directions your profile produced · data lags 2&ndash;3 days</p>
          </div>
          <div className="px-2.5 py-1 rounded-full bg-gray-50 border border-gray-100 text-[9px] font-bold text-gray-400 uppercase tracking-widest">
            Google
          </div>
        </div>

        {loading ? (
          <div className="px-6 py-10 text-center text-xs font-bold text-gray-400 uppercase tracking-tighter">Loading profile metrics…</div>
        ) : (
          <div className="p-6 space-y-5">
            {/* Action-first stat tiles (click to switch the trend) */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {METRICS.map(m => {
                const isActive = activeMetric === m.key;
                return (
                  <button
                    key={m.key}
                    onClick={() => setActiveMetric(m.key)}
                    className={`text-left rounded-xl border p-4 transition-all ${isActive ? "border-brand-300 bg-brand-50/40 shadow-sm" : "border-gray-200/60 bg-white hover:border-gray-300"}`}
                  >
                    <div className="flex items-center gap-2 mb-1.5">
                      <m.Icon size={13} className="text-gray-400" />
                      <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{m.label}</span>
                    </div>
                    <div className={`text-2xl font-bold tracking-tighter leading-none ${m.hex}`}>
                      {(totals[m.key] ?? 0).toLocaleString()}
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Trend for the selected metric */}
            <div className="pt-2">
              <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">{active.label} · trend</div>
              <MiniTrend series={series} metricKey={activeMetric} color={active.color} />
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
