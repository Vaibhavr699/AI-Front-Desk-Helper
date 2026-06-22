import React, { useState, useEffect } from "react";
import { Clock } from "lucide-react";
import { getBookingHeatmap } from "../api";

// ─────────────────────────────────────────────────────────────────────────
// BOOKING HEAT MAP  (Jun 22, 2026)  —  grid + hourly sidebar
//
// LEFT: day-of-week (rows) × time-of-day bucket (cols) grid, shaded by
//   booking VOLUME. Coarse on purpose — at ~30-some bookings an hour-by-hour
//   grid is mostly single-booking noise, so we bucket into morning/midday/
//   afternoon where each cell carries weight. Cells with n<2 stay gray.
//
// RIGHT (new): a min/avg/max rail + an hourly-distribution bar chart, so the
//   card reads as a full analytics module (matches the density of competitor
//   dashboards) using data we already compute backend-side:
//     data.stats  = { min, avg, max }   across non-empty cells
//     data.hourly = [{ hour, count }]   raw per-hour totals, real biz hours only
//
// CLOSE-RATE LAYER (later): when the CRM job-completed loop is live and
//   bookings flip to Completed w/ revenue, the backend flips
//   hasOutcomeData=true and each cell gains won/close-rate — no rebuild.
//
// USAGE (Metrics → PerformanceView, right AFTER <CustomerIntelSection ... />):
//     <BookingHeatmap tenantId={tenantId} />
// ─────────────────────────────────────────────────────────────────────────

export default function BookingHeatmap({ tenantId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!tenantId) return;
    setLoading(true);
    getBookingHeatmap(tenantId)
      .then((d) => {
        if (d.error) throw new Error(d.error);
        setData(d);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [tenantId]);

  // Fail soft — never break the Metrics page if this one section errors.
  if (error) return null;
  if (loading || !data) return null;
  if (!data.total || data.total === 0) return null; // nothing to show yet

  const {
    days,
    buckets,
    bucketLabels,
    maxCount,
    total,
    hasOutcomeData,
    hourly = [],
    stats = { min: 0, avg: 0, max: 0 },
  } = data;

  // Shade a cell by volume relative to the busiest cell. Guard: n<2 stays
  // neutral regardless of intensity, so a lone booking never reads as "hot".
  function cellStyle(count) {
    if (count < 2) {
      return {
        background: count === 0 ? "#fafafa" : "#f3f4f6",
        color: count === 0 ? "#d1d5db" : "#9ca3af",
      };
    }
    const intensity = Math.min(1, count / maxCount);
    const alpha = 0.18 + intensity * 0.82;
    const textWhite = alpha > 0.55;
    return {
      background: `rgba(232, 96, 10, ${alpha.toFixed(2)})`, // --brand-600 #E8600A
      color: textWhite ? "#fff" : "#7c2d12",
    };
  }

  // Hourly bar heights are relative to the busiest hour.
  const hourlyMax = hourly.reduce((m, h) => Math.max(m, h.count), 0) || 1;
  const fmtHour = (h) => {
    const hr = ((h + 11) % 12) + 1; // 0->12, 13->1
    const ap = h < 12 ? "a" : "p";
    return `${hr}${ap}`;
  };
  const peak = hourly.reduce(
    (best, h) => (h.count > best.count ? h : best),
    { hour: null, count: 0 }
  );

  return (
    <section className="space-y-4 pt-4">
      {/* SectionTitle — inline copy so the file is self-contained */}
      <div className="flex items-center gap-3 py-1">
        <div className="w-1 h-3.5 bg-brand-600 rounded-full shadow-sm" />
        <h2 className="text-xs font-bold text-gray-900 uppercase tracking-widest leading-none">
          Booking Patterns
        </h2>
      </div>

      <div className="bg-white border border-gray-200/60 rounded-xl shadow-sm overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/10">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-brand-50 text-brand-600 flex items-center justify-center shrink-0">
              <Clock size={16} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-gray-900 leading-tight">
                When customers schedule
              </h3>
              <p className="text-[10px] text-gray-400 font-medium">
                Booking volume by day &amp; time of day · {total} appointments
              </p>
            </div>
          </div>
          <div className="px-2.5 py-1 rounded-full bg-gray-50 border border-gray-100 text-[9px] font-bold text-gray-400 uppercase tracking-widest">
            {hasOutcomeData ? "Volume + outcomes" : "Volume"}
          </div>
        </div>

        {/* Outcome-pending note — sets expectation + teases the close-rate layer */}
        {!hasOutcomeData && (
          <div className="px-6 py-3 bg-blue-50/50 border-b border-blue-100 flex items-start gap-3">
            <div className="w-4 h-4 mt-0.5 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-[10px] font-black shrink-0">
              i
            </div>
            <p className="text-[11px] text-blue-800 leading-relaxed">
              This shows <strong>when</strong> appointments are booked. Once
              completed jobs &amp; revenue are flowing from your CRM, each cell
              will also show <strong>which times close best</strong>.
            </p>
          </div>
        )}

        {/* Body: grid (left) + sidebar (right) */}
        <div className="p-6 flex flex-col lg:flex-row gap-8">
          {/* ── LEFT: min/avg/max rail + grid ───────────────────────────── */}
          <div className="flex gap-5">
            {/* min / avg / max rail */}
            <div className="flex flex-col justify-center gap-5 shrink-0 pr-1">
              <RailStat label="Min" value={stats.min} />
              <RailStat label="Avg" value={stats.avg} />
              <RailStat label="Max" value={stats.max} />
            </div>

            {/* grid */}
            <div className="overflow-x-auto">
              <table className="border-separate" style={{ borderSpacing: 4 }}>
                <thead>
                  <tr>
                    <th className="text-left text-[10px] font-bold text-gray-400 uppercase tracking-wider pr-2" />
                    {buckets.map((b) => (
                      <th
                        key={b}
                        className="text-center text-[10px] font-bold text-gray-400 uppercase tracking-wider pb-1"
                      >
                        {bucketLabels[b]}
                      </th>
                    ))}
                    <th className="text-center text-[10px] font-bold text-gray-300 uppercase tracking-wider pb-1 pl-2">
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {days.map((day) => (
                    <tr key={day.dow}>
                      <td className="text-right text-[11px] font-bold text-gray-600 pr-3 whitespace-nowrap">
                        {day.label}
                      </td>
                      {day.cells.map((c) => {
                        const st = cellStyle(c.count);
                        return (
                          <td key={c.bucket} style={{ padding: 0 }}>
                            <div
                              className="rounded-md flex items-center justify-center text-[13px] font-bold transition-transform hover:scale-[1.04]"
                              style={{
                                height: 40,
                                minWidth: 64,
                                background: st.background,
                                color: st.color,
                              }}
                              title={`${day.label} ${bucketLabels[c.bucket]}: ${c.count} booking${c.count === 1 ? "" : "s"}`}
                            >
                              {c.count > 0 ? c.count : ""}
                            </div>
                          </td>
                        );
                      })}
                      <td className="text-center text-[11px] font-bold text-gray-400 pl-2">
                        {day.total}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Legend */}
              <div className="flex items-center gap-4 mt-4 pl-1 flex-wrap">
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded-sm" style={{ background: "#f3f4f6" }} />
                  <span className="text-[10px] text-gray-400 font-medium">1 (low signal)</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded-sm" style={{ background: "rgba(232,96,10,0.35)" }} />
                  <span className="text-[10px] text-gray-400 font-medium">building</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded-sm" style={{ background: "rgba(232,96,10,0.95)" }} />
                  <span className="text-[10px] text-gray-400 font-medium">busiest</span>
                </div>
              </div>
            </div>
          </div>

          {/* ── RIGHT: hourly distribution ──────────────────────────────── */}
          {hourly.length > 0 && (
            <div className="flex-1 min-w-0 lg:border-l lg:border-gray-100 lg:pl-8">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h4 className="text-xs font-bold text-gray-900 leading-tight">
                    Hourly distribution
                  </h4>
                  <p className="text-[10px] text-gray-400 font-medium">
                    Appointments started, by hour
                  </p>
                </div>
                {peak.hour != null && peak.count > 0 && (
                  <div className="text-right">
                    <div className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">
                      Peak
                    </div>
                    <div className="text-[11px] font-bold text-brand-700">
                      {fmtHour(peak.hour)} · {peak.count}
                    </div>
                  </div>
                )}
              </div>

              {/* Bars */}
              <div className="flex items-end gap-2 h-40">
                {hourly.map((h) => {
                  const pct = Math.round((h.count / hourlyMax) * 100);
                  const isPeak = h.hour === peak.hour && h.count > 0;
                  return (
                    <div
                      key={h.hour}
                      className="flex-1 flex flex-col items-center justify-end h-full group"
                      title={`${fmtHour(h.hour)}: ${h.count} booking${h.count === 1 ? "" : "s"}`}
                    >
                      <div className="text-[9px] font-bold text-gray-400 mb-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        {h.count}
                      </div>
                      <div
                        className="w-full rounded-t-md transition-all"
                        style={{
                          height: `${Math.max(pct, h.count > 0 ? 6 : 2)}%`,
                          minHeight: h.count > 0 ? 4 : 2,
                          background: isPeak
                            ? "rgba(232,96,10,0.95)"
                            : h.count > 0
                            ? "rgba(232,96,10,0.35)"
                            : "#f3f4f6",
                        }}
                      />
                      <div className="text-[9px] font-medium text-gray-400 mt-1.5 whitespace-nowrap">
                        {fmtHour(h.hour)}
                      </div>
                    </div>
                  );
                })}
              </div>

              <p className="text-[10px] text-gray-300 mt-4 leading-relaxed">
                Cells with a single booking stay gray on the grid — too little
                data to read as a pattern yet.
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

// Small stat block for the min/avg/max rail to the left of the grid.
function RailStat({ label, value }) {
  return (
    <div className="text-right">
      <div className="text-xl font-bold text-gray-900 tracking-tighter leading-none">
        {value}
      </div>
      <div className="text-[9px] font-bold text-gray-400 uppercase tracking-widest mt-0.5">
        {label}
      </div>
    </div>
  );
}
