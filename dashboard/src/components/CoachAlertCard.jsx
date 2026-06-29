// CoachAlertCard.jsx
// Place in: dashboard/src/components/CoachAlertCard.jsx
//
// Usage in Dashboard.jsx:
//   import CoachAlertCard from "../components/CoachAlertCard";
//   <CoachAlertCard metrics={metrics} goals={goals} calls={calls} />
//
// The card generates 2-4 specific, dollar-quantified alerts from live data.
// Each alert has a severity (urgent/warning/good) and an action link.
//
// ── Jun 11, 2026 unit-bug fix ──────────────────────────────────────────────
// metrics.metrics.ops.avg_job_value comes from routes/dashboard.js in CENTS,
// but this card was using it as DOLLARS. That turned a ~$1,113 average job
// into "$111,364 avg", and the booking-rate alert's "left on the table" line
// into "$890,912 / $1,002,276" — fabricated-looking numbers that cost trust
// (the same disease as the old Revenue Recovered hero). Fixes:
//   1. avg_job_value is converted cents → dollars ONCE, at the top.
//   2. The dollars fallback (2400) is now applied AFTER conversion, so units
//      never get mixed depending on which branch runs.
//   3. "Missed revenue" on the booking-rate alert is clamped to the pipeline's
//      own estimated value — a shop can't leave more on the table than its
//      whole open pipeline is worth.
//   4. The "no goal set" alert no longer hardcodes "April" — it uses the
//      actual current month.

import { Link } from "react-router-dom";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// Sane default average job value, in DOLLARS, used only when the tenant has
// no computed avg yet. Kept in one place so it can't drift between branches.
const DEFAULT_AVG_JOB_DOLLARS = 2400;

function generateAlerts(metrics, goals, calls) {
  const alerts = [];
  const now = new Date();
  const nowMonth = now.getMonth();

  // ── Pull raw metrics, normalizing units up front ──────────────────────────
  const openLeads = metrics?.pipeline?.open_estimates || 0;
  const bookingRate = metrics?.totals?.booking_rate || 0;
  const calls30d = metrics?.totals?.calls || 0;
  const closeRate = metrics?.sales?.close_rate || 0;
  const confused = metrics?.ai?.calls_confused || 0;
  const todayCalls = metrics?.today?.calls || 0;
  const todayBooked = metrics?.today?.booked || 0;

  // avg_job_value is stored/returned in CENTS. Convert to dollars exactly once.
  const avgJobCents = metrics?.metrics?.ops?.avg_job_value || 0;
  const avgJobDollars = avgJobCents > 0
    ? Math.round(avgJobCents / 100)
    : DEFAULT_AVG_JOB_DOLLARS;

  // pipeline.estimated_revenue is also in CENTS.
  const pipelineEstimatedDollars = metrics?.pipeline?.estimated_revenue
    ? Math.round(metrics.pipeline.estimated_revenue / 100)
    : 0;

  // ── Goal pace alert ───────────────────────────────────────────────────────
  // goals.months[].revenue_goal / actual_revenue are in CENTS.
  const monthGoalRow = goals?.months?.find((m) => m.month === nowMonth);
  const monthGoal = monthGoalRow ? Math.round((monthGoalRow.revenue_goal || 0) / 100) : 0;
  const monthActual = monthGoalRow ? Math.round((monthGoalRow.actual_revenue || 0) / 100) : 0;

  if (monthGoal > 0 && monthActual > 0) {
    const dayOfMonth = now.getDate();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const expectedPct = Math.round((dayOfMonth / daysInMonth) * 100);
    const actualPct = Math.round((monthActual / monthGoal) * 100);
    const gap = Math.max(0, monthGoal - monthActual);
    const jobsNeeded = gap > 0 ? Math.ceil(gap / avgJobDollars) : 0;

    if (actualPct < expectedPct - 10 && gap > 0) {
      alerts.push({
        severity: "urgent",
        icon: "🎯",
        title: "Behind on monthly goal",
        detail: `$${gap.toLocaleString()} to go to hit your $${monthGoal.toLocaleString()} ${MONTH_NAMES[nowMonth]} target — about ${jobsNeeded} more job${jobsNeeded === 1 ? "" : "s"} at your $${avgJobDollars.toLocaleString()} average.`,
        action: "Adjust goals →",
        href: "/metrics",
      });
    } else if (actualPct >= expectedPct) {
      alerts.push({
        severity: "good",
        icon: "🏆",
        title: "Ahead of monthly goal pace",
        detail: `$${monthActual.toLocaleString()} booked — ${actualPct}% of your $${monthGoal.toLocaleString()} ${MONTH_NAMES[nowMonth]} target, with ${daysInMonth - dayOfMonth} days left.`,
        action: "View goals →",
        href: "/metrics",
      });
    }
  } else if (monthGoal === 0) {
    alerts.push({
      severity: "warning",
      icon: "📋",
      title: "No monthly goal set",
      detail: `You can't track pace without a target. Set your ${MONTH_NAMES[nowMonth]} goal — it takes about 30 seconds.`,
      action: "Set goals →",
      href: "/metrics",
    });
  }

  // ── Stale estimates alert ─────────────────────────────────────────────────
  // "At risk" = a conservative 40% of the open pipeline's estimated value.
  // Both numbers are already in dollars here.
  if (openLeads > 5 && pipelineEstimatedDollars > 0) {
    const atRisk = Math.round(pipelineEstimatedDollars * 0.4);
    alerts.push({
      severity: "urgent",
      icon: "⚡",
      title: `${openLeads} open estimates — about $${atRisk.toLocaleString()} at risk`,
      detail: `Estimates tend to go cold after about 5 days. Running the follow-up sequence now is the cheapest way to save them.`,
      action: "View follow-ups →",
      href: "/follow-ups",
    });
  }

  // ── Booking rate alert ────────────────────────────────────────────────────
  // missedJobs is an estimate of how many of the last-30-day calls didn't
  // convert that arguably should have (gap below the 30% target). missedRevenue
  // is then clamped to the open pipeline's value so it can never balloon into
  // an implausible headline number.
  if (bookingRate > 0 && bookingRate < 30) {
    const missedJobs = calls30d > 0
      ? Math.round(calls30d * ((30 - bookingRate) / 100))
      : 0;
    let missedRevenue = missedJobs * avgJobDollars;

    // Sanity clamp: you can't leave more on the table than your whole open
    // pipeline is worth. Prevents the "$890,912" fabricated-looking figure.
    if (pipelineEstimatedDollars > 0) {
      missedRevenue = Math.min(missedRevenue, pipelineEstimatedDollars);
    }

    alerts.push({
      severity: "urgent",
      icon: "📞",
      title: `Booking rate at ${bookingRate}% — below the 30% target`,
      detail: missedJobs > 0
        ? `Roughly ${missedJobs} call${missedJobs === 1 ? "" : "s"} didn't convert. At your $${avgJobDollars.toLocaleString()} average, that's about $${missedRevenue.toLocaleString()} in potential work worth reviewing. Pull the recordings.`
        : `Worth pulling recent recordings to see where calls are dropping off.`,
      action: "Review calls →",
      href: "/calls",
    });
  } else if (bookingRate >= 50) {
    alerts.push({
      severity: "good",
      icon: "📈",
      title: `Booking rate at ${bookingRate}% — above industry average`,
      detail: `Industry average is around 25%. Your AI is converting at ${bookingRate}%. Keep the follow-up sequences running.`,
      action: "View metrics →",
      href: "/metrics",
    });
  }

  // ── Confused calls alert ──────────────────────────────────────────────────
  if (confused > 5 && calls30d > 0) {
    const confusedPct = Math.round((confused / calls30d) * 100);
    if (confusedPct > 8) {
      alerts.push({
        severity: "warning",
        icon: "🎙",
        title: `${confusedPct}% of calls showed confusion signals`,
        detail: `${confused} caller${confused === 1 ? "" : "s"} sounded confused this month. The AI script may need clearer service descriptions or FAQ updates.`,
        action: "Update AI settings →",
        href: "/settings",
      });
    }
  }

  // ── Today's pace alert ────────────────────────────────────────────────────
  if (todayCalls > 0) {
    const todayRate = Math.round((todayBooked / todayCalls) * 100);
    if (todayRate === 0 && todayCalls >= 3) {
      alerts.push({
        severity: "warning",
        icon: "🔔",
        title: `${todayCalls} calls today — 0 bookings yet`,
        detail: `Something may be off with today's AI flow. Check the last few call recordings to find the drop-off point.`,
        action: "Review today's calls →",
        href: "/calls",
      });
    }
  }

  // ── No alerts fallback ────────────────────────────────────────────────────
  if (alerts.length === 0) {
    alerts.push({
      severity: "good",
      icon: "✅",
      title: "Everything looks good",
      detail: "No urgent issues detected. Your AI is running, follow-ups are active, and booking rate is healthy.",
      action: "View metrics →",
      href: "/metrics",
    });
  }

  return alerts.slice(0, 4);
}

const SEVERITY = {
  urgent: {
    border: "#fecaca",
    bg: "#fef2f2",
    iconBg: "#fee2e2",
    badge: "#dc2626",
    badgeBg: "#fef2f2",
    badgeText: "Urgent",
    titleColor: "#991b1b",
    detailColor: "#7f1d1d",
    dotColor: "#dc2626",
  },
  warning: {
    border: "#fed7aa",
    bg: "#fff7ed",
    iconBg: "#ffedd5",
    badge: "#c2410c",
    badgeBg: "#fff7ed",
    badgeText: "Attention",
    titleColor: "#9a3412",
    detailColor: "#7c2d12",
    dotColor: "#E8600A",
  },
  good: {
    border: "#bbf7d0",
    bg: "#f0fdf4",
    iconBg: "#dcfce7",
    badge: "#16a34a",
    badgeBg: "#f0fdf4",
    badgeText: "On Track",
    titleColor: "#166534",
    detailColor: "#14532d",
    dotColor: "#16a34a",
  },
};

export default function CoachAlertCard({ metrics, goals, calls }) {
  const alerts = generateAlerts(metrics, goals, calls);
  const urgentCount = alerts.filter((a) => a.severity === "urgent").length;
  const warningCount = alerts.filter((a) => a.severity === "warning").length;

  return (
    <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #e8e6e0", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: "12px 16px", borderBottom: "1px solid #f5f5f5", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 28, height: 28, borderRadius: "50%", background: "rgba(232,96,10,0.1)", border: "1.5px solid rgba(232,96,10,0.2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13 }}>🎯</div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#1a1a1a" }}>Coach's Alerts</div>
            <div style={{ fontSize: 10, color: "#888" }}>Based on your live data right now</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {urgentCount > 0 && (
            <div style={{ fontSize: 9, fontWeight: 700, padding: "2px 8px", borderRadius: 20, background: "#fef2f2", color: "#dc2626", border: "1px solid #fecaca" }}>
              {urgentCount} urgent
            </div>
          )}
          {warningCount > 0 && (
            <div style={{ fontSize: 9, fontWeight: 700, padding: "2px 8px", borderRadius: 20, background: "#fff7ed", color: "#c2410c", border: "1px solid #fed7aa" }}>
              {warningCount} attention
            </div>
          )}
        </div>
      </div>

      {/* Alert rows */}
      <div>
        {alerts.map((alert, i) => {
          const sev = SEVERITY[alert.severity];
          return (
            <div key={i} style={{
              padding: "12px 16px",
              borderBottom: i < alerts.length - 1 ? "1px solid #f5f5f5" : "none",
              background: sev.bg,
              display: "flex",
              alignItems: "flex-start",
              gap: 12,
            }}>
              {/* Icon */}
              <div style={{ width: 32, height: 32, borderRadius: 8, background: sev.iconBg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, flexShrink: 0, marginTop: 1 }}>
                {alert.icon}
              </div>

              {/* Content */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 3, flexWrap: "wrap" }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: sev.titleColor }}>{alert.title}</div>
                  <div style={{ fontSize: 9, fontWeight: 700, padding: "1px 6px", borderRadius: 8, background: sev.iconBg, color: sev.badge, border: `1px solid ${sev.border}` }}>
                    {sev.badgeText}
                  </div>
                </div>
                <div style={{ fontSize: 11, color: sev.detailColor, lineHeight: 1.65, marginBottom: 8 }}>
                  {alert.detail}
                </div>
                <Link to={alert.href} style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  fontSize: 10,
                  fontWeight: 700,
                  color: sev.badge,
                  background: "#fff",
                  border: `1px solid ${sev.border}`,
                  padding: "4px 10px",
                  borderRadius: 20,
                  textDecoration: "none",
                  transition: "all 0.15s",
                }}>
                  {alert.action}
                </Link>
              </div>

              {/* Severity dot */}
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: sev.dotColor, flexShrink: 0, marginTop: 6 }} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
