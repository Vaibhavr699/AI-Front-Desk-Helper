import React from "react";
import { Info, AlertCircle, CheckCircle2 } from "lucide-react";

/**
 * InsightBar — rose / orange / emerald semantic banner.
 *
 * All three colors here are MEANING colors, not brand. Rose means "bad,"
 * emerald means "good," orange means "caution." Swapping warning orange
 * for the tenant's brand color would break that mental model — a green-
 * brand tenant would have a green "warning" next to a green "success,"
 * indistinguishable at a glance. Keeping orange for warning on purpose.
 *
 * If we ever want to re-theme this banner entirely, the right move is a
 * full redesign (e.g. icon-only severity + neutral background), not a
 * brand-color swap.
 */
export const InsightBar = ({ type, title, description }) => {
  const isError = type === 'error';
  const isWarning = type === 'warning';
  const isSuccess = type === 'success';
  const bgColor = isError ? 'bg-rose-50 border-rose-100' : isWarning ? 'bg-orange-50 border-orange-100' : 'bg-emerald-50 border-emerald-100';
  const textColor = isError ? 'text-rose-900 font-bold' : isWarning ? 'text-orange-900 font-bold' : 'text-emerald-900 font-bold';
  const dotColor = isError ? 'bg-rose-500' : isWarning ? 'bg-orange-500' : 'bg-emerald-500';
  return (
    <div className={`p-4 rounded-lg border shadow-sm flex items-start gap-4 transition-all hover:shadow-md ${bgColor}`}>
      <div className={`mt-0.5 w-5 h-5 rounded-full ${dotColor} flex items-center justify-center shrink-0 shadow-sm border border-white/20 animate-pulse`}>
         {isError && <AlertCircle size={10} className="text-white" />}
         {isWarning && <Info size={10} className="text-white" />}
         {isSuccess && <CheckCircle2 size={10} className="text-white" />}
      </div>
      <div>
        <h4 className={`text-sm tracking-tight ${textColor}`}>{title}</h4>
        <p className="text-[12px] opacity-75 font-medium leading-relaxed mt-1 text-gray-700">{description}</p>
      </div>
    </div>
  );
};
