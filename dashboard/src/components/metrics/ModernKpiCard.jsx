import React from "react";

/**
 * ModernKpiCard — the five primary KPI tiles on the Metrics page.
 * Brand-aware: the hover color-shift on the value now uses the tenant's
 * brand color via the brand-600 Tailwind token instead of hardcoded orange.
 */
export const ModernKpiCard = ({ 
  label, 
  value, 
  trendValue, 
  trendLabel, 
  trendDirection,
  topBadge, 
  topBadgeColor 
}) => {
  const isUp = trendDirection === 'up';
  const isDown = trendDirection === 'down';
  const trendColor = isUp ? 'text-emerald-600' : isDown ? 'text-rose-600' : 'text-gray-400';
  return (
    <div className="bg-white border border-gray-200/60 rounded-xl p-5 shadow-sm relative pt-12 hover:border-gray-300 hover:shadow-md transition-all duration-300 group">
      {topBadge && (
        <div className={`absolute top-4 left-5 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider transition-all border ${topBadgeColor || "text-emerald-700 bg-emerald-50 border-emerald-100"}`}>
          {topBadge}
        </div>
      )}
      <div className="text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-2 leading-none">{label}</div>
      {/* Hover accent now uses brand-600 (AFDH orange for ai_branded tenants,
          tenant's brand color for white_label) instead of hardcoded orange-600. */}
      <div className="text-3xl font-bold text-gray-900 tracking-tight mb-3 leading-none group-hover:text-brand-600 transition-colors">{value}</div>
      <div className="flex items-center gap-2">
        {trendValue && (
          <span className={`text-[10px] font-bold flex items-center gap-0.5 ${trendColor}`}>
            {isUp ? "↑" : isDown ? "↓" : "→"} {trendValue}
          </span>
        )}
        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-tight">{trendLabel}</span>
      </div>
    </div>
  );
};
