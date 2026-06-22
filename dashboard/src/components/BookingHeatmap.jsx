import React, { useState, useEffect } from "react";
import { Clock } from "lucide-react";
import { getBookingHeatmap } from "../api";

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

  const { days, buckets, bucketLabels, maxCount, total, hasOutcomeData } = data;

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
      background: `rgba(232, 96, 10, ${alpha.toFixed(2)})`,
      color: textWhite ? "#fff" : "#7c2d12",
    };
  }

  return (
    <section className="space-y-4 pt-4">
      <div className="flex items-center gap-3 py-1">
        <div className="w-1 h-3.5 bg-brand-600 rounded-full shadow-sm" />
        <h2 className="text-xs font-bold text-gray-900 uppercase tracking-widest leading-none">
          Booking Patterns
        </h2>
      </div>

      <div className="bg-white border border-gray-200/60 rounded-xl shadow-sm overflow-hidden">
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

        <div className="p-6 overflow-x-auto">
          <table className="w-full border-separate" style={{ borderSpacing: 4 }}>
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

          <div className="flex items-center gap-4 mt-4 pl-1">
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
            <span className="text-[10px] text-gray-300 ml-auto">
              Cells with a single booking stay gray — too little data to read as a pattern.
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
