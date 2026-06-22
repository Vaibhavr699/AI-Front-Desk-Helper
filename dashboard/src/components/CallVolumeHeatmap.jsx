import React, { useState, useEffect } from "react";
import { PhoneCall } from "lucide-react";
import { getCallHeatmap } from "../api";

export default function CallVolumeHeatmap({ tenantId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!tenantId) return;
    setLoading(true);
    getCallHeatmap(tenantId)
      .then((d) => {
        if (d.error) throw new Error(d.error);
        setData(d);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [tenantId]);

  if (error) return null;
  if (loading || !data) return null;
  if (!data.total || data.total === 0) return null;

  const {
    days = [],
    hours = [],
    hourly = [],
    stats = { min: 0, avg: 0, max: 0 },
    maxCount = 1,
    total,
    window_days = 90,
  } = data;

  const fmtHour = (h) => {
    const hr = ((h + 11) % 12) + 1;
    const ap = h < 12 ? "a" : "p";
    return `${hr}${ap}`;
  };

  function cellStyle(count) {
    if (count === 0) return { background: "#fafafa", color: "#e5e7eb" };
    if (count < 2) return { background: "#eff6ff", color: "#93c5fd" };
    const intensity = Math.min(1, count / maxCount);
    const alpha = 0.18 + intensity * 0.82;
    const textWhite = alpha > 0.5;
    return {
      background: `rgba(37, 99, 235, ${alpha.toFixed(2)})`,
      color: textWhite ? "#fff" : "#1e3a8a",
    };
  }

  const hourlyMax = hourly.reduce((m, h) => Math.max(m, h.count), 0) || 1;
  const peak = hourly.reduce(
    (best, h) => (h.count > best.count ? h : best),
    { hour: null, count: 0 }
  );

  const CELL_W = 30;
  const CELL_H = 30;

  return (
    <section className="space-y-4 pt-4">
      <div className="flex items-center gap-3 py-1">
        <div className="w-1 h-3.5 bg-blue-600 rounded-full shadow-sm" />
        <h2 className="text-xs font-bold text-gray-900 uppercase tracking-widest leading-none">
          Call Patterns
        </h2>
      </div>

      <div className="bg-white border border-gray-200/60 rounded-xl shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/10">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
              <PhoneCall size={16} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-gray-900 leading-tight">
                When the phones ring
              </h3>
              <p className="text-[10px] text-gray-400 font-medium">
                Call volume by day &amp; hour · {total.toLocaleString()} calls · last {window_days} days
              </p>
            </div>
          </div>
          <div className="px-2.5 py-1 rounded-full bg-gray-50 border border-gray-100 text-[9px] font-bold text-gray-400 uppercase tracking-widest">
            Volume
          </div>
        </div>

        <div className="p-6 space-y-8">
          <div className="flex gap-5">
            <div className="flex flex-col justify-center gap-5 shrink-0 pr-1">
              <RailStat label="Min" value={stats.min} />
              <RailStat label="Avg" value={stats.avg} />
              <RailStat label="Max" value={stats.max} />
            </div>

            <div className="overflow-x-auto">
              <table className="border-separate" style={{ borderSpacing: 3 }}>
                <thead>
                  <tr>
                    <th />
                    {hours.map((h) => (
                      <th
                        key={h}
                        className="text-center text-[9px] font-bold text-gray-400 pb-1"
                        style={{ minWidth: CELL_W }}
                      >
                        {h % 3 === 1 ? fmtHour(h) : ""}
                      </th>
                    ))}
                    <th className="text-center text-[9px] font-bold text-gray-300 uppercase tracking-wider pb-1 pl-2">
                      Tot
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {days.map((day) => (
                    <tr key={day.dow}>
                      <td className="text-right text-[11px] font-bold text-gray-600 pr-2 whitespace-nowrap">
                        {day.label}
                      </td>
                      {day.cells.map((c) => {
                        const st = cellStyle(c.count);
                        return (
                          <td key={c.hour} style={{ padding: 0 }}>
                            <div
                              className="rounded flex items-center justify-center text-[10px] font-bold transition-transform hover:scale-[1.12] hover:z-10 relative"
                              style={{
                                height: CELL_H,
                                width: CELL_W,
                                background: st.background,
                                color: st.color,
                              }}
                              title={`${day.label} ${fmtHour(c.hour)}: ${c.count} call${c.count === 1 ? "" : "s"}`}
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

              <div className="flex items-center gap-4 mt-3 pl-1 flex-wrap">
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded-sm" style={{ background: "#eff6ff" }} />
                  <span className="text-[10px] text-gray-400 font-medium">light</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded-sm" style={{ background: "rgba(37,99,235,0.35)" }} />
                  <span className="text-[10px] text-gray-400 font-medium">steady</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded-sm" style={{ background: "rgba(37,99,235,0.95)" }} />
                  <span className="text-[10px] text-gray-400 font-medium">busiest</span>
                </div>
                <span className="text-[10px] text-gray-300 ml-auto">
                  Hours shown 7a–9p · earlier/later calls fold into the edge columns.
                </span>
              </div>
            </div>
          </div>

          {hourly.length > 0 && (
            <div className="border-t border-gray-100 pt-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h4 className="text-xs font-bold text-gray-900 leading-tight">
                    Hourly distribution
                  </h4>
                  <p className="text-[10px] text-gray-400 font-medium">
                    Calls received, by hour of day
                  </p>
                </div>
                {peak.hour != null && peak.count > 0 && (
                  <div className="text-right">
                    <div className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">
                      Peak
                    </div>
                    <div className="text-[11px] font-bold text-blue-700">
                      {fmtHour(peak.hour)} · {peak.count}
                    </div>
                  </div>
                )}
              </div>

              <div className="flex items-end gap-1.5 h-36">
                {hourly.map((h) => {
                  const pct = Math.round((h.count / hourlyMax) * 100);
                  const isPeak = h.hour === peak.hour && h.count > 0;
                  return (
                    <div
                      key={h.hour}
                      className="flex-1 flex flex-col items-center justify-end h-full group"
                      title={`${fmtHour(h.hour)}: ${h.count} call${h.count === 1 ? "" : "s"}`}
                    >
                      <div className="text-[9px] font-bold text-gray-400 mb-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        {h.count}
                      </div>
                      <div
                        className="w-full rounded-t transition-all"
                        style={{
                          height: `${Math.max(pct, h.count > 0 ? 5 : 1)}%`,
                          minHeight: h.count > 0 ? 3 : 1,
                          background: isPeak
                            ? "rgba(37,99,235,0.95)"
                            : h.count > 0
                            ? "rgba(37,99,235,0.35)"
                            : "#f3f4f6",
                        }}
                      />
                      <div className="text-[8px] font-medium text-gray-400 mt-1 whitespace-nowrap">
                        {h.hour % 2 === 1 ? fmtHour(h.hour) : ""}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

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
