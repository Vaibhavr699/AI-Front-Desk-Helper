import React from "react";

export const MetricHero = ({ revPerCall, callsHandled, confirmedRevenue, lostWithoutAi }) => {
  const formatK = (cents) => {
    const val = cents / 100;
    if (val >= 1000) {
      return (val / 1000).toFixed(1) + "K";
    }
    return val.toLocaleString();
  };

  return (
    <div className="bg-[#111111] rounded-xl p-8 text-white flex flex-col lg:flex-row lg:items-center justify-between shadow-2xl relative overflow-hidden ring-1 ring-white/10 group hover:shadow-orange-500/5 transition-all duration-700">
      {/* Premium background accent */}
      <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-orange-500/5 blur-[120px] -mr-64 -mt-64 pointer-events-none group-hover:bg-orange-500/10 transition-all duration-1000"></div>
      
      <div className="relative z-10 mb-8 lg:mb-0">
        <h3 className="text-[10px] font-bold text-white/40 uppercase tracking-[0.25em] mb-4 flex items-center gap-2">
          REVENUE PER CALL ANSWERED — <span className="text-orange-500/80">YOUR #1 ROI METRIC</span>
        </h3>
        <div className="flex items-baseline gap-3">
          <div className="text-6xl font-bold text-[#ff6a00] tracking-tighter leading-none mb-4 font-sans drop-shadow-sm">${revPerCall}</div>
        </div>
        <p className="text-sm text-white/50 max-w-sm leading-relaxed font-medium">
          Every call the AI answers is worth <span className="text-white font-bold">${revPerCall}</span> in confirmed revenue
        </p>
      </div>
      
      <div className="relative z-10 grid grid-cols-2 md:grid-cols-3 gap-10 lg:gap-16 items-start">
        <div className="space-y-1">
          <div className="text-3xl font-bold text-white leading-none tracking-tight">{callsHandled}</div>
          <div className="text-[10px] font-bold text-white/30 uppercase tracking-[0.15em] whitespace-nowrap mt-2">Calls answered</div>
        </div>
        <div className="space-y-1">
          <div className="text-3xl font-bold text-white leading-none tracking-tight">${formatK(confirmedRevenue)}</div>
          <div className="text-[10px] font-bold text-white/30 uppercase tracking-[0.15em] whitespace-nowrap mt-2">Confirmed revenue</div>
        </div>
        <div className="space-y-1 col-span-2 md:col-span-1 border-t md:border-t-0 md:border-l border-white/10 pt-4 md:pt-0 md:pl-10">
          <div className="text-3xl font-bold text-rose-500 leading-none tracking-tight">${formatK(lostWithoutAi)}</div>
          <div className="text-[10px] font-bold text-white/30 uppercase tracking-[0.15em] whitespace-nowrap mt-2">Lost without AI</div>
        </div>
      </div>
    </div>
  );
};
