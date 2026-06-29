import React from "react";

export const OutcomeBar = ({ label, count, pct, trend, color, dotColor, subtext }) => {
  const isPositive = trend && trend.startsWith('+');
  const isNegative = trend && trend.startsWith('-');
  const isNeutral = !trend || trend === '0%';

  return (
    <div className="flex items-center gap-4 group hover:bg-gray-50/30 p-1.5 -mx-1.5 rounded-lg transition-all">
      <div className="w-32 flex items-center gap-2 shrink-0">
        <div className={`w-2.5 h-2.5 rounded-full shadow-[inset_0_-1px_0_rgba(0,0,0,0.1)] ${dotColor}`}></div>
        <span className="text-xs font-bold text-gray-700">{label}</span>
      </div>
      <div className="flex-1 flex items-center gap-2 pr-6">
        <div className="flex-1 h-7 bg-gray-50 rounded-md overflow-hidden relative border border-gray-100/30 shadow-[inset_0_1px_2px_rgba(0,0,0,0.02)]">
          <div 
            className={`h-full ${color} rounded-md flex items-center px-4 text-[10px] font-black text-white whitespace-nowrap transition-all duration-1000 ease-out shadow-sm`}
            style={{ width: `${Math.max(pct, 1.5)}%` }}
          >
            {pct > 12 && <span>{count} {subtext || "calls"}</span>}
          </div>
        </div>
      </div>
      <div className="w-[160px] flex items-center justify-between shrink-0 font-mono">
        <span className="text-[13px] font-black text-gray-900 w-12 text-right">{count}</span>
        <span className="text-[11px] font-bold text-gray-400 w-12 text-right">{pct}%</span>
        <span className={`text-[10px] font-black w-20 text-right flex items-center justify-end gap-1 ${isPositive ? 'text-emerald-500' : isNegative ? 'text-rose-500' : 'text-gray-300'}`}>
          {isPositive && "↑ "}
          {isNegative && "↓ "}
          {isNeutral && "→ "}
          {trend || "0%"}
        </span>
      </div>
    </div>
  );
};
