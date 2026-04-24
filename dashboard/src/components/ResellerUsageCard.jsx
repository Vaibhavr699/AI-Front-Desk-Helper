import React, { useState } from "react";
import { useNavigate } from "react-router-dom";

/**
 * ResellerUsageCard — shows current month's voice + SMS usage against tier caps.
 * Renders below the tier hero on /reseller. Uses existing design tokens so it
 * feels native (stone palette, 10px uppercase labels, rounded-2xl cards).
 *
 * Props:
 *   usage: object from GET /api/reseller/usage
 *           Shape: { reseller, caps, usage, overage, meta, per_customer }
 *
 * Empty-state policy: if no caps are configured (tier hasn't been assigned
 * usage limits yet), the card doesn't render. We return null and let the
 * parent manage layout.
 */
export default function ResellerUsageCard({ usage }) {
  const navigate = useNavigate();
  const [showAllCustomers, setShowAllCustomers] = useState(false);

  if (!usage || !usage.caps) return null;

  const voiceCap = Number(usage.caps.voice_minutes || 0);
  const smsCap   = Number(usage.caps.sms || 0);

  // Don't render if no caps configured — this reseller tier hasn't been
  // set up with usage limits yet. Better to stay silent than show "0/0".
  if (voiceCap === 0 && smsCap === 0) return null;

  const voiceUsed = Number(usage.usage.total_voice_minutes || 0);
  const smsUsed   = Number(usage.usage.total_sms || 0);
  const voicePct  = Number(usage.usage.voice_pct_of_cap || 0);
  const smsPct    = Number(usage.usage.sms_pct_of_cap || 0);

  const overageVoiceMin   = Number(usage.overage.voice_minutes || 0);
  const overageSmsCount   = Number(usage.overage.sms || 0);
  const overageVoiceCents = Number(usage.overage.voice_charge_cents || 0);
  const overageSmsCents   = Number(usage.overage.sms_charge_cents || 0);
  const totalOverageCents = Number(usage.overage.total_charge_cents || 0);
  const hasOverage        = totalOverageCents > 0;

  const daysRemaining = Number(usage.meta.days_remaining || 0);
  const customerCount = Number(usage.meta.customer_count || 0);

  // Per-customer breakdown sorted by voice desc (backend already sorts this,
  // but defensive in case structure changes)
  const allCustomers = [...(usage.per_customer || [])].sort(
    (a, b) => Number(b.voice_minutes) - Number(a.voice_minutes)
  );
  const topCustomers     = allCustomers.slice(0, 3);
  const hiddenCount      = Math.max(0, allCustomers.length - 3);
  const displayCustomers = showAllCustomers ? allCustomers : topCustomers;

  // Warning state — "approaching cap" CTA when either bar >= 80%
  const approachingCap = (voicePct >= 80 || smsPct >= 80) && !hasOverage;
  const atOrOverCap    = voicePct >= 100 || smsPct >= 100;

  return (
    <div className="rounded-2xl bg-white border border-stone-200 p-6 mb-6">
      {/* Header row */}
      <div className="flex items-start justify-between mb-5">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-stone-400 mb-1">
            Usage this month
          </div>
          <div className="text-lg font-bold text-stone-900">
            {MONTH_NAMES[usage.meta.billing_month] || "This month"}{" "}
            {usage.meta.billing_year}
          </div>
          <div className="text-xs text-stone-500 mt-0.5">
            {customerCount} {customerCount === 1 ? "customer" : "customers"} ·{" "}
            {daysRemaining} {daysRemaining === 1 ? "day" : "days"} left
          </div>
        </div>
        {hasOverage && (
          <div className="text-right">
            <div className="text-[10px] font-bold uppercase tracking-wider text-red-600 mb-0.5">
              Overage accrued
            </div>
            <div className="text-xl font-bold text-red-600 tabular-nums">
              {formatMoney(totalOverageCents)}
            </div>
          </div>
        )}
      </div>

      {/* Voice + SMS progress bars */}
      <div className="space-y-4 mb-5">
        {voiceCap > 0 && (
          <UsageBar
            label="Voice minutes"
            used={voiceUsed}
            cap={voiceCap}
            pct={voicePct}
            usedFormatter={(n) => `${Math.round(n).toLocaleString()} min`}
            capFormatter={(n) => `${n.toLocaleString()} min`}
            overageAmount={overageVoiceMin}
            overageCharge={overageVoiceCents}
            overageUnitLabel="min"
          />
        )}
        {smsCap > 0 && (
          <UsageBar
            label="SMS messages"
            used={smsUsed}
            cap={smsCap}
            pct={smsPct}
            usedFormatter={(n) => `${n.toLocaleString()} SMS`}
            capFormatter={(n) => `${n.toLocaleString()} SMS`}
            overageAmount={overageSmsCount}
            overageCharge={overageSmsCents}
            overageUnitLabel="SMS"
          />
        )}
      </div>

      {/* Upgrade CTA — only when approaching or at cap */}
      {approachingCap && (
        <div className="rounded-lg bg-amber-50 border border-amber-100 px-4 py-3 mb-5 flex items-start justify-between gap-3">
          <div className="flex-1">
            <div className="text-xs font-bold text-amber-900 mb-0.5">
              Approaching your cap
            </div>
            <div className="text-xs text-amber-800">
              Upgrading now avoids overage charges for the rest of this month.
            </div>
          </div>
          <button
            type="button"
            onClick={() => navigate("/reseller/plans")}
            className="shrink-0 px-3 py-1.5 text-xs font-bold text-amber-900 bg-amber-100 hover:bg-amber-200 rounded-lg transition-colors"
          >
            View plans
          </button>
        </div>
      )}

      {atOrOverCap && hasOverage && (
        <div className="rounded-lg bg-red-50 border border-red-100 px-4 py-3 mb-5 flex items-start justify-between gap-3">
          <div className="flex-1">
            <div className="text-xs font-bold text-red-900 mb-0.5">
              You're in overage
            </div>
            <div className="text-xs text-red-800">
              Continued usage this month bills at your tier's overage rate. Upgrade to reset caps.
            </div>
          </div>
          <button
            type="button"
            onClick={() => navigate("/reseller/plans")}
            className="shrink-0 px-3 py-1.5 text-xs font-bold text-red-900 bg-red-100 hover:bg-red-200 rounded-lg transition-colors"
          >
            Upgrade
          </button>
        </div>
      )}

      {/* Per-customer breakdown — top 3 + expand link */}
      {allCustomers.length > 0 && (
        <div className="pt-5 border-t border-stone-100">
          <div className="text-[10px] font-bold uppercase tracking-wider text-stone-400 mb-3">
            {showAllCustomers ? "All customers" : "Top customers by voice usage"}
          </div>
          <div className="space-y-2">
            {displayCustomers.map((c, idx) => (
              <CustomerUsageRow
                key={c.tenant_id}
                rank={idx + 1}
                customer={c}
                networkVoice={voiceUsed}
              />
            ))}
          </div>
          {hiddenCount > 0 && (
            <button
              type="button"
              onClick={() => setShowAllCustomers(!showAllCustomers)}
              className="mt-3 text-xs font-bold text-stone-600 hover:text-stone-900 transition-colors"
            >
              {showAllCustomers
                ? "Show top 3 only"
                : `View all ${allCustomers.length} customers →`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * UsageBar — one of the two main progress bars (voice / SMS).
 *
 * Color thresholds match existing Reseller.jsx customer-capacity bar logic:
 *   • emerald when healthy (< 80%)
 *   • amber when approaching cap (80-99%)
 *   • red when at or over cap (>= 100%)
 *
 * Overage information renders inline on the right when cap is breached,
 * showing both the count over and the $ charge accrued.
 */
function UsageBar({
  label,
  used,
  cap,
  pct,
  usedFormatter,
  capFormatter,
  overageAmount,
  overageCharge,
  overageUnitLabel,
}) {
  // Color: at/over cap is red, approaching (>=80) is amber, else emerald.
  // Using same palette as existing customer-capacity bar in Reseller.jsx.
  const barColor =
    pct >= 100 ? "bg-red-500" :
    pct >= 80  ? "bg-amber-500" :
                 "bg-emerald-500";

  const hasOverage = overageAmount > 0;

  return (
    <div>
      <div className="flex items-baseline justify-between text-xs mb-1.5">
        <div className="flex items-center gap-2">
          <span className="font-bold text-stone-700">{label}</span>
          {hasOverage && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-red-50 border border-red-100 rounded text-[10px] font-bold text-red-700 uppercase tracking-wider">
              Overage
            </span>
          )}
        </div>
        <div className="flex items-baseline gap-1.5 tabular-nums">
          <span className="font-black text-stone-900">{usedFormatter(used)}</span>
          <span className="text-stone-400 font-medium">of {capFormatter(cap)}</span>
          <span className={`font-bold ${
            pct >= 100 ? "text-red-600" :
            pct >= 80  ? "text-amber-600" :
                         "text-stone-500"
          }`}>
            {pct}%
          </span>
        </div>
      </div>
      <div className="h-2 bg-stone-100 rounded-full overflow-hidden">
        <div
          className={`h-full ${barColor} transition-all`}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
      {hasOverage && (
        <div className="mt-1.5 flex items-center justify-between text-[11px]">
          <span className="text-red-600 font-medium tabular-nums">
            +{overageAmount.toLocaleString()} {overageUnitLabel} over cap
          </span>
          <span className="text-red-600 font-bold tabular-nums">
            {formatMoney(overageCharge)} charge
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * CustomerUsageRow — single row in the per-customer breakdown.
 *
 * Shows customer name, voice minutes, SMS count, and % of network voice.
 * Rank badge only shown when not in "view all" mode (top 3 display).
 */
function CustomerUsageRow({ rank, customer, networkVoice }) {
  const pctOfNetwork = networkVoice > 0
    ? Math.round((Number(customer.voice_minutes) / networkVoice) * 1000) / 10
    : 0;

  const rankColors = {
    1: "bg-amber-100 text-amber-700 border-amber-200",
    2: "bg-stone-100 text-stone-600 border-stone-200",
    3: "bg-orange-50 text-orange-700 border-orange-200",
  };
  const showRankBadge = rank <= 3;

  return (
    <div className="flex items-center justify-between py-1.5 text-xs">
      <div className="flex items-center gap-2 min-w-0 flex-1">
        {showRankBadge && (
          <span
            className={`shrink-0 inline-flex items-center justify-center min-w-[22px] h-5 px-1 text-[10px] font-black rounded border ${rankColors[rank]}`}
          >
            #{rank}
          </span>
        )}
        <span className="font-bold text-stone-700 truncate">
          {customer.tenant_name}
        </span>
      </div>
      <div className="flex items-center gap-4 shrink-0 text-stone-500 tabular-nums">
        <span>
          <span className="font-bold text-stone-900">
            {Math.round(Number(customer.voice_minutes)).toLocaleString()}
          </span>
          <span className="text-[10px] ml-1">min</span>
        </span>
        <span>
          <span className="font-bold text-stone-900">
            {Number(customer.sms_count).toLocaleString()}
          </span>
          <span className="text-[10px] ml-1">SMS</span>
        </span>
        <span className="w-12 text-right text-[10px] font-bold text-stone-400">
          {pctOfNetwork}%
        </span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────
const MONTH_NAMES = [
  "", "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

function formatMoney(cents) {
  if (cents == null || isNaN(cents)) return "$0.00";
  const dollars = Number(cents) / 100;
  if (Math.abs(dollars) < 10) {
    return `$${dollars.toFixed(2)}`;
  }
  return `$${Math.round(dollars).toLocaleString()}`;
}
