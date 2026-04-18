import React from "react";
import { useBrand } from "../../contexts/BrandContext";

/**
 * MetricHero — big revenue-per-call hero at the top of the Metrics page.
 *
 * Brand-aware palette (Apr 19, 2026 P0 fix):
 *   - ai_branded (AFDH default) → near-black bg (#111111) + AFDH orange
 *     headline. Unchanged from the original hand-tuned look.
 *   - white_label tenants       → cream bg (#F8F7F2) + brand-color headline.
 *     Fixes the contrast bug where dark-brand tenants (e.g. Gladiators
 *     #03222a) rendered the headline number invisibly on near-black.
 *
 * The dark hero already popped against the page's neutral background, so
 * for ai_branded we don't touch it. For WL, the cream tile sits cleanly
 * on the page and gives any brand color (light or dark) room to breathe.
 *
 * Semantic colors (green check-mark logic, rose "lost without AI") stay
 * the same across both modes because they're meaning-carriers, not brand.
 */
export const MetricHero = ({ revPerCall, callsHandled, confirmedRevenue, lostWithoutAi }) => {
  const { isDefault } = useBrand();

  const formatK = (cents) => {
    const val = cents / 100;
    if (val >= 1000) {
      return (val / 1000).toFixed(1) + "K";
    }
    return val.toLocaleString();
  };

  // The headline number color. AFDH gets its signature orange; WL tenants
  // get their own brand color via the CSS variable so dark colors (like
  // Gladiators' teal) still show up against the cream surface.
  const BRAND_HEADLINE = isDefault ? "#ff6a00" : "rgb(var(--brand-600))";

  // One bag of styles for each palette. Keeps the JSX clean and makes it
  // obvious what's changing between modes.
  const theme = isDefault
    ? {
        shell:
          "bg-[#111111] rounded-xl p-8 text-white flex flex-col lg:flex-row lg:items-center justify-between shadow-2xl relative overflow-hidden ring-1 ring-white/10 group hover:shadow-orange-500/5 transition-all duration-700",
        accentBlob: "absolute top-0 right-0 w-[500px] h-[500px] bg-orange-500/5 blur-[120px] -mr-64 -mt-64 pointer-events-none group-hover:bg-orange-500/10 transition-all duration-1000",
        eyebrow: "text-[10px] font-bold text-white/40 uppercase tracking-[0.25em] mb-4 flex items-center gap-2",
        eyebrowAccent: "text-orange-500/80",
        caption: "text-sm text-white/50 max-w-sm leading-relaxed font-medium",
        captionStrong: "text-white font-bold",
        bigNumber: "text-3xl font-bold text-white leading-none tracking-tight",
        statLabel: "text-[10px] font-bold text-white/30 uppercase tracking-[0.15em] whitespace-nowrap mt-2",
        divider: "space-y-1 col-span-2 md:col-span-1 border-t md:border-t-0 md:border-l border-white/10 pt-4 md:pt-0 md:pl-10",
        lostColor: "text-rose-500",
      }
    : {
        shell:
          "bg-[#F8F7F2] rounded-xl p-8 text-gray-900 flex flex-col lg:flex-row lg:items-center justify-between shadow-sm relative overflow-hidden ring-1 ring-gray-200/60 group hover:shadow-md transition-all duration-700",
        // Subtle brand-tinted glow instead of hardcoded orange, keeps the
        // atmospheric depth without clashing with a tenant's color.
        accentBlob: "absolute top-0 right-0 w-[500px] h-[500px] blur-[120px] -mr-64 -mt-64 pointer-events-none transition-all duration-1000",
        eyebrow: "text-[10px] font-bold text-gray-500 uppercase tracking-[0.25em] mb-4 flex items-center gap-2",
        eyebrowAccent: "text-[color:rgb(var(--brand-600))]",
        caption: "text-sm text-gray-500 max-w-sm leading-relaxed font-medium",
        captionStrong: "text-gray-900 font-bold",
        bigNumber: "text-3xl font-bold text-gray-900 leading-none tracking-tight",
        statLabel: "text-[10px] font-bold text-gray-400 uppercase tracking-[0.15em] whitespace-nowrap mt-2",
        divider: "space-y-1 col-span-2 md:col-span-1 border-t md:border-t-0 md:border-l border-gray-200 pt-4 md:pt-0 md:pl-10",
        lostColor: "text-rose-600", // slightly darker on cream so it still stops the eye
      };

  return (
    <div className={theme.shell}>
      {/* Atmospheric accent blob. On WL we drop the hardcoded orange/5
          and tint with the tenant's brand color instead. */}
      <div
        className={theme.accentBlob}
        style={isDefault ? undefined : { background: "rgba(var(--brand-600), 0.06)" }}
      />

      <div className="relative z-10 mb-8 lg:mb-0">
        <h3 className={theme.eyebrow}>
          REVENUE PER CALL ANSWERED — <span className={theme.eyebrowAccent}>YOUR #1 ROI METRIC</span>
        </h3>
        <div className="flex items-baseline gap-3">
          {/* The big headline number — this is the one that was invisible
              for Gladiators before today's fix. Now uses brand-600 on cream. */}
          <div
            className="text-6xl font-bold tracking-tighter leading-none mb-4 font-sans drop-shadow-sm"
            style={{ color: BRAND_HEADLINE }}
          >
            ${revPerCall}
          </div>
        </div>
        <p className={theme.caption}>
          Every call the AI answers is worth <span className={theme.captionStrong}>${revPerCall}</span> in confirmed revenue
        </p>
      </div>

      <div className="relative z-10 grid grid-cols-2 md:grid-cols-3 gap-10 lg:gap-16 items-start">
        <div className="space-y-1">
          <div className={theme.bigNumber}>{callsHandled}</div>
          <div className={theme.statLabel}>Calls answered</div>
        </div>
        <div className="space-y-1">
          <div className={theme.bigNumber}>${formatK(confirmedRevenue)}</div>
          <div className={theme.statLabel}>Confirmed revenue</div>
        </div>
        <div className={theme.divider}>
          <div className={`text-3xl font-bold ${theme.lostColor} leading-none tracking-tight`}>
            ${formatK(lostWithoutAi)}
          </div>
          <div cl
