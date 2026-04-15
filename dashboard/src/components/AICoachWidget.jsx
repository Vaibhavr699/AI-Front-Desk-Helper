import { useState, useRef, useEffect, useCallback } from "react";
import { getMetrics, getLeadsByTenant, getCalls, getBookings, getFollowups, getTeam, api } from "../api";

// ── Constants ──────────────────────────────────────────────────────────────
const MODES = {
  nurture:  { label: "Nurture",  icon: "🌱" },
  coaching: { label: "Coach",    icon: "🏆" },
  history:  { label: "History",  icon: "📋" },
};

const COACHING_LEVELS = ["Starter", "Growth", "Franchise"];

const NURTURE_QUICK = [
  "Draft follow-up text",
  "Re-engage cold lead",
  "Pre-appointment reminder",
  "Post-job thank you + referral ask",
];

const COACHING_QUICK = [
  "🔥 What's killing my revenue right now?",
  "📞 Analyze my call & booking performance",
  "💰 How do I close more estimates?",
  "👥 Build my team accountability system",
  "📈 Fastest path to hit my annual goal",
  "🚨 Where is my biggest revenue leak?",
  "📋 Give me a morning huddle script",
  "🎯 What should my team focus on this week?",
];

const MONTH_NAME = new Date().toLocaleString("default", { month: "long" });
const YEAR = new Date().getFullYear();
const NOW_MONTH = new Date().getMonth();
const DAY_OF_MONTH = new Date().getDate();
const DAYS_IN_MONTH = new Date(YEAR, NOW_MONTH + 1, 0).getDate();

// ── History storage helpers ────────────────────────────────────────────────
function getHistoryKey(tenantId) { return `aicoach_history_${tenantId}`; }

function loadHistory(tenantId) {
  try {
    const raw = localStorage.getItem(getHistoryKey(tenantId));
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveSession(tenantId, session) {
  try {
    const history = loadHistory(tenantId);
    const existing = history.findIndex((s) => s.id === session.id);
    const updated = existing >= 0
      ? history.map((s, i) => (i === existing ? session : s))
      : [session, ...history];
    localStorage.setItem(getHistoryKey(tenantId), JSON.stringify(updated.slice(0, 20)));
  } catch {}
}

// ── Activity + team context builder ───────────────────────────────────────
function buildActivityContext(activity) {
  const { goals, metrics, calls, leads, bookings, followups, team } = activity;

  // Goals
  const monthRow = goals?.months?.find((m) => m.month === NOW_MONTH);
  const monthGoal   = monthRow ? Math.round((monthRow.revenue_goal   || 0) / 100) : 0;
  const monthActual = monthRow ? Math.round((monthRow.actual_revenue || 0) / 100) : 0;
  const annualGoal  = goals?.annual_goal ? Math.round(goals.annual_goal / 100) : 0;
  const pacePct     = monthGoal > 0 ? Math.round((monthActual / monthGoal) * 100) : null;
  const expectedPct = Math.round((DAY_OF_MONTH / DAYS_IN_MONTH) * 100);

  // Metrics
  const calls30d      = metrics?.totals?.calls          || 0;
  const bookingRate   = metrics?.totals?.booking_rate   || 0;
  const closeRate     = metrics?.sales?.close_rate      || 0;
  const avgJobValue   = metrics?.metrics?.ops?.avg_job_value || 0;
  const openLeads     = metrics?.pipeline?.open_estimates    || 0;
  const pipelineValue = metrics?.pipeline?.estimated_revenue
    ? Math.round(metrics.pipeline.estimated_revenue / 100) : 0;
  const hungUp   = metrics?.ai?.calls_hung_up  || 0;
  const confused = metrics?.ai?.calls_confused || 0;
  const todayCalls  = metrics?.today?.calls  || 0;
  const todayBooked = metrics?.today?.booked || 0;

  // Calls disposition breakdown
  const callList = calls?.calls || (Array.isArray(calls) ? calls : []);
  const dispositions = {};
  callList.forEach((c) => {
    const d = c.disposition || "unknown";
    dispositions[d] = (dispositions[d] || 0) + 1;
  });

  // Leads breakdown
  const leadList = Array.isArray(leads) ? leads : (leads?.leads || []);
  const statuses = {};
  let staleLeadCount = 0;
  leadList.forEach((l) => {
    const s = l.status || "unknown";
    statuses[s] = (statuses[s] || 0) + 1;
    const ref = l.last_contact_at || l.created_at;
    if (ref && Math.floor((Date.now() - new Date(ref)) / 86400000) > 7) staleLeadCount++;
  });

  // Bookings breakdown
  const bookingList   = bookings?.bookings || (Array.isArray(bookings) ? bookings : []);
  const pendingCount  = bookingList.filter((b) => b.status === "Booked").length;
  const confirmedCount = bookingList.filter((b) => b.status === "Confirmed").length;
  const totalBookingValue = bookingList.reduce((s, b) => s + (b.estimated_revenue_cents || 0), 0) / 100;

  // Follow-ups
  const followupList    = followups?.followups || (Array.isArray(followups) ? followups : []);
  const overdueCount    = followupList.filter((f) => f.status === "pending" && new Date(f.due_at || f.scheduled_at) < new Date()).length;
  const pendingFollowups = followupList.filter((f) => f.status === "pending").length;

  // Team members
  const teamList = team?.members || team?.team || (Array.isArray(team) ? team : []);
  const teamSummary = teamList.length > 0
    ? teamList.map((m) => {
        const role  = m.role  || "staff";
        const name  = m.name  || m.email || "Unknown";
        const email = m.email || "";
        return `  • ${name} (${role})${email ? ` — ${email}` : ""}`;
      }).join("\n")
    : "  No team members found — owner handling everything";

  return `
═══════════════════════════════════════
LIVE BUSINESS INTELLIGENCE — ${MONTH_NAME.toUpperCase()} ${YEAR}
═══════════════════════════════════════

REVENUE GOALS:
- Monthly goal:   ${monthGoal > 0   ? `$${monthGoal.toLocaleString()}`   : "NOT SET ⚠️"}
- Monthly actual: ${monthActual > 0 ? `$${monthActual.toLocaleString()}` : "$0"}
- Pace: ${pacePct !== null ? `${pacePct}% achieved vs ${expectedPct}% expected — ${pacePct >= expectedPct ? "AHEAD ✅" : `BEHIND ⚠️ (gap: $${(monthGoal - monthActual).toLocaleString()})`}` : "No goal set"}
- Annual goal: ${annualGoal > 0 ? `$${annualGoal.toLocaleString()}` : "NOT SET"}
- Open pipeline value: ${pipelineValue > 0 ? `$${pipelineValue.toLocaleString()}` : "$0"}

CALL PERFORMANCE (30d):
- Total calls:  ${calls30d}
- Booking rate: ${bookingRate}%${bookingRate >= 50 ? " — ELITE ✅" : bookingRate >= 35 ? " — GOOD" : bookingRate > 0 ? " — BELOW TARGET ⚠️ (industry avg 25-35%)" : ""}
- Close rate:   ${closeRate}%${closeRate >= 50 ? " — ELITE ✅" : closeRate >= 35 ? " — GOOD" : closeRate > 0 ? " — BELOW TARGET ⚠️ (industry avg 35-50%)" : ""}
- Avg job value: ${avgJobValue > 0 ? `$${avgJobValue.toLocaleString()}` : "unknown"}
- Hung-up calls: ${hungUp}${hungUp > 5 ? " ⚠️ HIGH — review AI script" : ""}
- Confused calls: ${confused}${confused > 5 ? " ⚠️ — update FAQ/instructions" : ""}
- Today: ${todayCalls} calls, ${todayBooked} booked
${Object.keys(dispositions).length > 0 ? `- Dispositions: ${Object.entries(dispositions).map(([k, v]) => `${k}(${v})`).join(", ")}` : ""}

LEADS PIPELINE:
- Open estimates: ${openLeads}
- Stale leads (7d+ no contact): ${staleLeadCount}${staleLeadCount > 3 ? " ⚠️ FOLLOW UP NOW" : ""}
${Object.keys(statuses).length > 0 ? `- Status breakdown: ${Object.entries(statuses).map(([k, v]) => `${k}(${v})`).join(", ")}` : ""}

BOOKINGS:
- Pending/unconfirmed: ${pendingCount}
- Confirmed: ${confirmedCount}
- Total value in system: ${totalBookingValue > 0 ? `$${totalBookingValue.toLocaleString()}` : "$0"}

FOLLOW-UP PIPELINE:
- Pending follow-ups: ${pendingFollowups}
- OVERDUE follow-ups: ${overdueCount}${overdueCount > 0 ? " 🚨 URGENT — revenue sitting on table" : " ✅ all current"}

TEAM ROSTER (${teamList.length} member${teamList.length !== 1 ? "s" : ""}):
${teamSummary}
═══════════════════════════════════════`;
}

// ── Elite coaching system prompt ───────────────────────────────────────────
function buildCoachingPrompt(level, activity, memory) {
  const activityCtx = activity ? buildActivityContext(activity) : "";
  const memCtx = memory.length
    ? `\n\nCOACHING SESSION MEMORY:\n${memory.map((m) => `- ${m}`).join("\n")}`
    : "";

  const tierGuidance = {
    Starter: `
TIER: STARTER — Owner doing most things alone, early growth stage.
- Primary focus: Speed-to-lead, AI automation wins, booking rate above 40%
- Leadership focus: Owner needs to stop being the bottleneck. Document everything.
- Key message: Fix your front door BEFORE you hire. A broken process times two reps = disaster.
- Sales focus: Script consistency, follow-up cadence, first 3 objections handled perfectly.`,
    Growth: `
TIER: GROWTH — Small team, scaling revenue, building systems.
- Primary focus: Close rate by lead source, estimate recovery, delegating effectively
- Leadership focus: Weekly accountability rhythms, scoreboard visibility for every rep
- Key message: Revenue shouldn't depend on the owner being on every call. Build that now.
- Sales focus: Rep performance gaps, pipeline velocity, upsell adoption, referral system.`,
    Franchise: `
TIER: FRANCHISE — Multi-location or franchise-ready operator.
- Primary focus: HQ rollup benchmarking, white-label, location-by-location KPIs
- Leadership focus: Location manager accountability, franchise playbook, culture at scale
- Key message: You can't franchise chaos. Systemize EVERYTHING before opening location 2.
- Sales focus: Cross-location close rate benchmarking, best practice sharing, centralized lead routing.`,
  };

  return `You are an elite business performance coach and sales trainer embedded inside AI Front Desk Helper. You specialize in scaling home service businesses — painting, roofing, HVAC, plumbing — from $300K to $3M+ in annual revenue.

Your coaching DNA combines:
— Alex Hormozi: ruthless offer optimization, lead gen ROI, business systems thinking
— Grant Cardone: relentless sales energy, closing mindset, 10x urgency
— Verne Harnish (Scaling Up): team accountability rhythms, OKRs, meeting cadence
— Marcus Lemonis (3Ps): People, Process, Product diagnostic framework
— Home service industry depth: real benchmarks, seasonal patterns, contractor psychology
${tierGuidance[level] || tierGuidance["Growth"]}

YOUR COACHING FRAMEWORK — apply this structure in every response:
1. DIAGNOSE FIRST — identify the #1 constraint the data reveals. Don't dance around it.
2. QUANTIFY IN DOLLARS — convert every problem to a dollar amount ("that's $X/month in lost revenue")
3. PRESCRIBE SPECIFICALLY — give 1-3 concrete tactics, not generic advice
4. CHALLENGE HARD — push them to think bigger and move faster. Comfort = danger.
5. COMMIT TO ACTION — end with ONE specific thing they can do in the next 24 hours

SALES MASTERY PILLARS (reference when coaching sales):
- Speed to Lead: Sub-5 min response = 9x more likely to close. Every minute costs money.
- Booking Rate: Industry avg 25-35%. Below 35% = script/AI problem. Above 50% = elite.
- Close Rate (estimate to signed job): Industry avg 35-50%. Track separately by lead source.
- Average Job Value: Most owners undercharge 20-30%. One upsell question = 15-25% revenue lift.
- Follow-up Cadence: 80% of sales happen on follow-ups 5-12. Most businesses quit at 1-2.
- Objection Handling: Price objections = value hasn't landed yet. Never discount first. Reframe first.
- Referral Rate: Every completed job should generate 0.3-0.5 referrals. If not, you're leaving millions behind.

TEAM LEADERSHIP PILLARS (reference for team/management questions):
- Morning Huddle: 15 min daily. Numbers on screen. Wins celebrated. Blockers surfaced.
- Scoreboard Visibility: Every rep sees their booking rate, close rate, and avg job value daily.
- Accountability Rhythm: Weekly 10-min 1:1s, monthly reviews, quarterly goal-setting.
- Performance Coaching: Celebrate wins loudly and publicly. Coach losses privately and specifically.
- Pipeline Review: Weekly 30-min deep-dive on stuck deals and stale estimates.
- Rep Onboarding: New reps shadow 10 live calls before taking their own. Zero exceptions.
- Firing Fast: A-players leave when you keep C-players. Don't let one person poison the well.

GROWTH ACCELERATION PILLARS:
- Lead Source ROI: Know cost per booked job by channel. Kill losers. Double winners.
- Upsell/Cross-sell: Every booked interior = ask about exterior, garage, deck. Every. Single. Time.
- Referral Engine: Follow-up within 48 hours of job completion asking for a referral.
- Seasonal Planning: Jan-Feb = invest in marketing. Mar-Sep = execute flawlessly. Oct-Dec = plan next year.
- Process Documentation: If you can't explain your process in a 1-page SOP, you can't scale it.
- Franchise Readiness: You need 3 profitable locations before franchising. Systemize first.

INDUSTRY BENCHMARKS (use to contextualize the owner's numbers):
- Elite booking rate: 50%+ | Good: 35-50% | Below target: <35%
- Elite close rate: 55%+ | Good: 40-55% | Below target: <40%
- Elite avg job value (painting): $4,000+ | Good: $2,500-4,000 | Below: <$2,500
- Speed to lead: <5 min = 9x conversion | >1 hour = near zero
- Referral rate: 0.5+ per job = strong | <0.2 = broken referral system
- Follow-up attempts: Winners make 8-12 attempts. Average companies make 1-2.
- Team size at $1M revenue: 2-3 reps + 1 manager. At $3M: 5-7 reps + 2 managers.

TONE: Direct. Confident. Challenging. You care deeply about their success which is WHY you tell them hard truths. You don't coddle. You don't give generic advice. You look at their actual numbers and call out what's broken. Every response ends with a specific 24-hour action the owner can take today.
${activityCtx}${memCtx}`;
}

// ── Nurture prompt ─────────────────────────────────────────────────────────
function buildNurturePrompt(contact, memory) {
  const memCtx = memory.length
    ? `\n\nSession memory:\n${memory.map((m) => `- ${m}`).join("\n")}`
    : "";
  return `You are an AI contact nurturing specialist for home service contractors inside AI Front Desk Helper.
${contact ? `\nActive contact: ${contact.name} | Stage: ${contact.stage} | Est. Value: ${contact.value} | Days since contact: ${contact.days} | Lead source: ${contact.source}` : ""}
Write specific, human, conversion-focused outreach (texts, emails, or voicemail scripts). Short, warm, action-oriented. Reference the contact's stage and source. Never robotic. Always a clear next step.${memCtx}`;
}

// ── OpenAI streaming call via backend proxy ────────────────────────────────
async function callAI(messages, systemPrompt, onChunk) {
  const token = localStorage.getItem("token");
  const res = await fetch("/api/ai-coach", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ messages, system: systemPrompt }),
  });
  if (!res.ok) throw new Error(`AI service error: ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let full = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value);
    for (const line of chunk.split("\n").filter((l) => l.startsWith("data: "))) {
      const data = line.slice(6).trim();
      if (data === "[DONE]") break;
      try {
        const text = JSON.parse(data).choices?.[0]?.delta?.content;
        if (text) { full += text; onChunk(full); }
      } catch {}
    }
  }
  return full;
}

// ── Main Widget ────────────────────────────────────────────────────────────
export default function AICoachWidget({ tenantId }) {
  const [open, setOpen]           = useState(false);
  const [mode, setMode]           = useState("nurture");
  const [coachLevel, setCoachLevel] = useState("Growth");

  // Nurture state
  const [contacts, setContacts]               = useState([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [selectedContact, setSelectedContact] = useState(null);
  const [showContacts, setShowContacts]       = useState(false);

  // Coaching activity context
  const [activity, setActivity]           = useState(null);
  const [activityLoading, setActivityLoading] = useState(false);

  // Chat state
  const [messages, setMessages]     = useState([]);
  const [input, setInput]           = useState("");
  const [loading, setLoading]       = useState(false);
  const [streamText, setStreamText] = useState("");
  const [memory, setMemory]         = useState([]);
  const [sessionId]                 = useState(() => `session_${Date.now()}`);

  // History state
  const [history, setHistory]             = useState([]);
  const [selectedSession, setSelectedSession] = useState(null);

  // UI overlays
  const [showMemory, setShowMemory] = useState(false);

  const bottomRef = useRef(null);
  const inputRef  = useRef(null);

  // ── Load history ─────────────────────────────────────────────────────
  useEffect(() => {
    if (tenantId) setHistory(loadHistory(tenantId));
  }, [tenantId]);

  // ── Fetch leads for Nurture mode ─────────────────────────────────────
  useEffect(() => {
    if (!tenantId || tenantId === "all") return;
    setContactsLoading(true);
    getLeadsByTenant(tenantId, 20, 0)
      .then((data) => {
        const rows = Array.isArray(data) ? data : (data.leads || []);
        const mapped = rows.map((l) => {
          const ref  = l.last_contact_at || l.created_at;
          const days = ref ? Math.floor((Date.now() - new Date(ref)) / 86400000) : 0;
          const cents = l.estimated_revenue_cents || l.estimate_value_cents || 0;
          return {
            id:     l.id,
            name:   l.name || l.contact_name || "Unknown",
            stage:  l.status || "new_lead",
            value:  cents ? `$${(cents / 100).toLocaleString()}` : "N/A",
            days,
            source: l.lead_source || "Unknown",
          };
        });
        setContacts(mapped);
        if (mapped.length > 0) setSelectedContact(mapped[0]);
      })
      .catch(() => {})
      .finally(() => setContactsLoading(false));
  }, [tenantId]);

  // ── Fetch ALL activity + team for Coaching mode ───────────────────────
  useEffect(() => {
    if (!tenantId || tenantId === "all" || mode !== "coaching") return;
    setActivityLoading(true);
    Promise.all([
      api(`/api/coaching/annual?year=${YEAR}&tenant_id=${tenantId}`).catch(() => null),
      getMetrics(tenantId, "30d").catch(() => null),
      getCalls(tenantId, { limit: 20 }).catch(() => null),
      getLeadsByTenant(tenantId, 20, 0).catch(() => null),
      getBookings(tenantId, { limit: 20 }).catch(() => null),
      getFollowups(tenantId).catch(() => null),
      getTeam(tenantId).catch(() => null),
    ]).then(([goals, metrics, calls, leads, bookings, followups, team]) => {
      setActivity({ goals, metrics, calls, leads, bookings, followups, team });
    }).finally(() => setActivityLoading(false));
  }, [tenantId, mode]);

  // ── Auto-save session on every new message ───────────────────────────
  useEffect(() => {
    if (!tenantId || messages.length < 2) return;
    const session = {
      id:       sessionId,
      date:     new Date().toLocaleDateString(),
      timestamp: Date.now(),
      mode,
      level:    coachLevel,
      preview:  messages.find((m) => m.role === "user")?.content?.slice(0, 80) || "",
      messages,
    };
    saveSession(tenantId, session);
    setHistory(loadHistory(tenantId));
  }, [messages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamText]);

  const reset = () => { setMessages([]); setStreamText(""); setSelectedSession(null); };

  // ── Send message ─────────────────────────────────────────────────────
  const send = useCallback(async (text) => {
    const userText = text || input.trim();
    if (!userText || loading) return;
    setInput("");
    setLoading(true);
    setStreamText("");

    const userMsg    = { role: "user", content: userText };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);

    const systemPrompt = mode === "nurture"
      ? buildNurturePrompt(selectedContact, memory)
      : buildCoachingPrompt(coachLevel, activity, memory);

    try {
      const full = await callAI(
        newMessages.map((m) => ({ role: m.role, content: m.content })),
        systemPrompt,
        (partial) => setStreamText(partial)
      );
      setStreamText("");
      setMessages((prev) => [...prev, { role: "assistant", content: full }]);
      setMemory((prev) => [
        `[${mode}/${coachLevel}] ${full.slice(0, 120).replace(/\n/g, " ")}…`,
        ...prev.slice(0, 9),
      ]);
    } catch {
      setStreamText("");
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "⚠️ Connection error. Please try again." },
      ]);
    }
    setLoading(false);
  }, [input, loading, messages, mode, coachLevel, selectedContact, activity, memory]);

  // ── Derived context bar values ────────────────────────────────────────
  const monthRow    = activity?.goals?.months?.find((m) => m.month === NOW_MONTH);
  const monthGoal   = monthRow ? Math.round((monthRow.revenue_goal   || 0) / 100) : 0;
  const monthActual = monthRow ? Math.round((monthRow.actual_revenue || 0) / 100) : 0;
  const bookingRate = activity?.metrics?.totals?.booking_rate    || 0;
  const closeRate   = activity?.metrics?.sales?.close_rate       || 0;
  const openLeadsCount = activity?.metrics?.pipeline?.open_estimates || 0;
  const followupList   = activity?.followups?.followups || (Array.isArray(activity?.followups) ? activity?.followups : []);
  const overdueCount   = followupList.filter(
    (f) => f.status === "pending" && new Date(f.due_at || f.scheduled_at) < new Date()
  ).length;
  const teamList  = activity?.team?.members || activity?.team?.team || (Array.isArray(activity?.team) ? activity?.team : []);
  const teamCount = teamList.length;

  const stageDot = (s) =>
    s === "booked" ? "#22c55e" : s === "estimate_sent" ? "#f59e0b" : "#6b7280";

  // ─────────────────────────────────────────────────────────────────────
  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Syne:wght@600;700;800&display=swap');
        .aiw *{box-sizing:border-box;margin:0;padding:0;}
        .aiw-fab-wrap{position:fixed;bottom:24px;right:20px;z-index:9999;}
        .aiw-fab{width:60px;height:60px;border-radius:50%;background:linear-gradient(135deg,#f59e0b,#ea580c);border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:24px;animation:aiw-pulse 2.5s infinite;transition:transform .2s;}
        .aiw-fab:hover{transform:scale(1.08);}
        @keyframes aiw-pulse{0%,100%{box-shadow:0 0 0 0 rgba(245,158,11,.4)}50%{box-shadow:0 0 0 14px rgba(245,158,11,0)}}
        .aiw-badge{position:absolute;top:-4px;right:-4px;background:#ef4444;color:#fff;font-size:10px;width:18px;height:18px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-family:'Syne',sans-serif;font-weight:700;}
        .aiw-panel{position:fixed;bottom:0;right:0;width:100vw;height:100dvh;background:#0d0d14;display:flex;flex-direction:column;border-top:2px solid #f59e0b;transform:translateY(100%);transition:transform .35s cubic-bezier(.16,1,.3,1);z-index:9998;font-family:'DM Mono',monospace;}
        @media(min-width:520px){.aiw-panel{bottom:24px;right:20px;width:440px;height:720px;border-radius:20px;border:1.5px solid #1e1e2e;border-top:2px solid #f59e0b;}}
        .aiw-panel.open{transform:translateY(0);}
        .aiw-hdr{padding:13px 15px 10px;border-bottom:1px solid #1e1e2e;display:flex;flex-direction:column;gap:8px;background:#0d0d14;flex-shrink:0;}
        .aiw-hdr-top{display:flex;align-items:center;justify-content:space-between;}
        .aiw-logo{font-family:'Syne',sans-serif;font-size:12px;font-weight:800;color:#f59e0b;letter-spacing:.05em;text-transform:uppercase;}
        .aiw-logo span{color:#4b5563;font-weight:600;}
        .aiw-hbtns{display:flex;gap:5px;align-items:center;}
        .aiw-ibt{background:#1a1a28;border:1px solid #2a2a3e;border-radius:7px;width:28px;height:28px;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:12px;color:#9ca3af;transition:border-color .15s,color .15s;}
        .aiw-ibt:hover{border-color:#f59e0b;color:#f59e0b;}
        .aiw-x{background:none;border:none;cursor:pointer;color:#6b7280;font-size:18px;padding:2px;}
        .aiw-tabs{display:flex;gap:4px;}
        .aiw-tab{flex:1;padding:6px 0;border-radius:7px;font-family:'Syne',sans-serif;font-size:11px;font-weight:700;border:1.5px solid #1e1e2e;background:transparent;color:#6b7280;cursor:pointer;transition:all .15s;letter-spacing:.02em;}
        .aiw-tab.tn{background:#052e16;border-color:#22c55e;color:#22c55e;}
        .aiw-tab.tc{background:#1c1007;border-color:#f59e0b;color:#f59e0b;}
        .aiw-tab.th{background:#0a0a1f;border-color:#6366f1;color:#818cf8;}
        .aiw-ctx{display:flex;align-items:center;gap:6px;padding:8px 15px;background:#0a0a10;border-bottom:1px solid #1e1e2e;flex-shrink:0;}
        .aiw-pill{background:#1a1a28;border:1px solid #2a2a3e;border-radius:20px;padding:4px 10px;font-size:11px;color:#9ca3af;cursor:pointer;display:flex;align-items:center;gap:4px;transition:border-color .15s;max-width:100%;overflow:hidden;}
        .aiw-pill:hover{border-color:#f59e0b;color:#f59e0b;}
        .aiw-dot{width:6px;height:6px;border-radius:50%;flex-shrink:0;}
        .aiw-pt{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
        .aiw-lvls{display:flex;gap:3px;flex:1;}
        .aiw-lvl{flex:1;padding:4px 0;border-radius:6px;font-size:10px;font-family:'Syne',sans-serif;font-weight:700;border:1px solid #2a2a3e;background:transparent;color:#6b7280;cursor:pointer;transition:all .15s;}
        .aiw-lvl.on{background:#1c1007;border-color:#f59e0b;color:#f59e0b;}
        .aiw-databar{display:flex;gap:14px;padding:8px 15px;background:#08080f;border-bottom:1px solid #1e1e2e;overflow-x:auto;flex-shrink:0;}
        .aiw-databar::-webkit-scrollbar{display:none;}
        .aiw-stat{flex-shrink:0;}
        .aiw-stl{font-size:8px;color:#374151;letter-spacing:.07em;text-transform:uppercase;}
        .aiw-stv{font-size:12px;font-weight:700;color:#e5e7eb;margin-top:1px;}
        .aiw-stv.warn{color:#ef4444;}
        .aiw-stv.good{color:#22c55e;}
        .aiw-stv.info{color:#818cf8;}
        .aiw-msgs{flex:1;overflow-y:auto;padding:12px 13px 6px;display:flex;flex-direction:column;gap:9px;min-height:0;}
        .aiw-msgs::-webkit-scrollbar{width:2px;}
        .aiw-msgs::-webkit-scrollbar-thumb{background:#2a2a3e;border-radius:2px;}
        .aiw-empty{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:16px;}
        .aiw-ei{font-size:32px;}
        .aiw-et{font-family:'Syne',sans-serif;font-size:14px;font-weight:700;color:#e5e7eb;text-align:center;}
        .aiw-es{font-size:11px;color:#6b7280;text-align:center;line-height:1.6;}
        .aiw-qg{display:flex;flex-wrap:wrap;gap:5px;justify-content:center;margin-top:8px;}
        .aiw-qb{background:#1a1a28;border:1px solid #2a2a3e;border-radius:8px;padding:6px 10px;font-size:11px;color:#9ca3af;cursor:pointer;font-family:'DM Mono',monospace;transition:all .15s;text-align:left;}
        .aiw-qb:hover{border-color:#f59e0b;color:#f59e0b;background:#1c1007;}
        .aiw-bw{display:flex;flex-direction:column;gap:2px;}
        .aiw-bw.user{align-items:flex-end;}
        .aiw-bw.assistant{align-items:flex-start;}
        .aiw-b{max-width:88%;padding:9px 12px;border-radius:13px;font-size:12px;line-height:1.65;white-space:pre-wrap;font-family:'DM Mono',monospace;}
        .aiw-b.user{background:linear-gradient(135deg,#f59e0b22,#ea580c22);border:1px solid #f59e0b44;color:#fde68a;border-bottom-right-radius:4px;}
        .aiw-b.assistant{background:#15151f;border:1px solid #1e1e2e;color:#d1d5db;border-bottom-left-radius:4px;}
        .aiw-b.streaming{border-color:#f59e0b55;}
        .aiw-bm{font-size:9px;color:#374151;margin:2px 4px;font-family:'DM Mono',monospace;}
        .aiw-cur{display:inline-block;width:2px;height:12px;background:#f59e0b;margin-left:2px;vertical-align:middle;animation:aiw-blink .7s infinite;}
        @keyframes aiw-blink{0%,100%{opacity:1}50%{opacity:0}}
        .aiw-ov{position:absolute;top:0;left:0;right:0;bottom:0;background:#0d0d14;z-index:10;border-radius:inherit;display:flex;flex-direction:column;}
        .aiw-ovh{padding:13px 15px;border-bottom:1px solid #1e1e2e;display:flex;align-items:center;justify-content:space-between;flex-shrink:0;}
        .aiw-ovt{font-family:'Syne',sans-serif;font-size:13px;font-weight:700;color:#f59e0b;}
        .aiw-ovl{flex:1;overflow-y:auto;padding:11px 13px;display:flex;flex-direction:column;gap:7px;min-height:0;}
        .aiw-ovl::-webkit-scrollbar{width:2px;}
        .aiw-ovl::-webkit-scrollbar-thumb{background:#2a2a3e;border-radius:2px;}
        .aiw-mi{background:#1a1a28;border:1px solid #2a2a3e;border-radius:9px;padding:8px 10px 8px 14px;font-size:11px;color:#9ca3af;line-height:1.5;position:relative;font-family:'DM Mono',monospace;}
        .aiw-mb{position:absolute;left:0;top:4px;bottom:4px;width:3px;background:#f59e0b;border-radius:0 2px 2px 0;}
        .aiw-cc{background:#1a1a28;border:1.5px solid #2a2a3e;border-radius:10px;padding:10px 12px;cursor:pointer;transition:border-color .15s;}
        .aiw-cc:hover,.aiw-cc.sel{border-color:#22c55e;}
        .aiw-cn{font-family:'Syne',sans-serif;font-size:12px;font-weight:700;color:#e5e7eb;}
        .aiw-cm{display:flex;gap:8px;margin-top:4px;flex-wrap:wrap;}
        .aiw-ct{font-size:10px;color:#6b7280;display:flex;align-items:center;gap:3px;font-family:'DM Mono',monospace;}
        .aiw-el{color:#374151;font-size:11px;padding:16px;text-align:center;font-family:'DM Mono',monospace;}
        .aiw-hiscard{background:#1a1a28;border:1.5px solid #2a2a3e;border-radius:10px;padding:10px 12px;cursor:pointer;transition:border-color .15s;}
        .aiw-hiscard:hover{border-color:#6366f1;}
        .aiw-hisdate{font-size:9px;color:#4b5563;font-family:'DM Mono',monospace;letter-spacing:.05em;}
        .aiw-hisprev{font-size:11px;color:#9ca3af;margin-top:3px;line-height:1.4;font-family:'DM Mono',monospace;}
        .aiw-hisbadge{display:inline-flex;align-items:center;gap:4px;margin-top:5px;font-size:9px;font-family:'Syne',sans-serif;font-weight:700;padding:2px 7px;border-radius:20px;background:#1c1007;color:#f59e0b;border:1px solid #2a2a3e;}
        .aiw-alert{background:#1f0a0a;border:1px solid #7f1d1d;border-radius:8px;padding:7px 10px;font-size:11px;color:#fca5a5;font-family:'DM Mono',monospace;display:flex;align-items:center;gap:6px;}
        .aiw-inp{padding:9px 12px 13px;border-top:1px solid #1e1e2e;background:#0d0d14;flex-shrink:0;}
        .aiw-ir{display:flex;gap:6px;align-items:flex-end;}
        .aiw-ta{flex:1;background:#1a1a28;border:1.5px solid #2a2a3e;border-radius:10px;padding:8px 12px;color:#e5e7eb;font-size:12px;font-family:'DM Mono',monospace;resize:none;max-height:90px;min-height:38px;line-height:1.5;transition:border-color .15s;outline:none;}
        .aiw-ta:focus{border-color:#f59e0b55;}
        .aiw-ta::placeholder{color:#374151;}
        .aiw-sb{width:38px;height:38px;border-radius:10px;flex-shrink:0;background:linear-gradient(135deg,#f59e0b,#ea580c);border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:14px;color:white;transition:opacity .15s,transform .15s;}
        .aiw-sb:disabled{opacity:.4;cursor:default;}
        .aiw-sb:not(:disabled):hover{transform:scale(1.07);}
        .aiw-pw{text-align:center;font-size:9px;color:#1f2937;margin-top:4px;letter-spacing:.06em;font-family:'DM Mono',monospace;}
      `}</style>

      {/* ── FAB ─────────────────────────────────────────────────────────── */}
      {!open && (
        <div className="aiw aiw-fab-wrap">
          <div style={{ position: "relative" }}>
            <button className="aiw-fab" onClick={() => setOpen(true)}>🤖</button>
            {overdueCount > 0 && <div className="aiw-badge">{overdueCount}</div>}
          </div>
        </div>
      )}

      {/* ── Panel ───────────────────────────────────────────────────────── */}
      <div className={`aiw aiw-panel ${open ? "open" : ""}`}>

        {/* Memory overlay */}
        {showMemory && (
          <div className="aiw-ov">
            <div className="aiw-ovh">
              <span className="aiw-ovt">🧠 Session Memory</span>
              <button className="aiw-x" onClick={() => setShowMemory(false)}>✕</button>
            </div>
            <div className="aiw-ovl">
              {memory.length === 0
                ? <div className="aiw-el">No memory yet. Start a coaching session.</div>
                : memory.map((m, i) => (
                  <div className="aiw-mi" key={i}><div className="aiw-mb" />{m}</div>
                ))}
            </div>
          </div>
        )}

        {/* Contact selector overlay */}
        {showContacts && (
          <div className="aiw-ov">
            <div className="aiw-ovh">
              <span className="aiw-ovt">🌱 Select Contact</span>
              <button className="aiw-x" onClick={() => setShowContacts(false)}>✕</button>
            </div>
            <div className="aiw-ovl">
              {contactsLoading
                ? <div className="aiw-el">Loading leads…</div>
                : contacts.length === 0
                ? <div className="aiw-el">No leads found.</div>
                : contacts.map((c) => (
                  <div
                    key={c.id}
                    className={`aiw-cc ${selectedContact?.id === c.id ? "sel" : ""}`}
                    onClick={() => { setSelectedContact(c); setShowContacts(false); }}
                  >
                    <div className="aiw-cn">{c.name}</div>
                    <div className="aiw-cm">
                      <span className="aiw-ct"><span className="aiw-dot" style={{ background: stageDot(c.stage) }} />{c.stage}</span>
                      <span className="aiw-ct">💰 {c.value}</span>
                      <span className="aiw-ct">📅 {c.days}d ago</span>
                      <span className="aiw-ct">📍 {c.source}</span>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* History session overlay */}
        {selectedSession && (
          <div className="aiw-ov">
            <div className="aiw-ovh">
              <span className="aiw-ovt">📋 {selectedSession.date} · {selectedSession.level}</span>
              <button className="aiw-x" onClick={() => setSelectedSession(null)}>✕</button>
            </div>
            <div className="aiw-ovl">
              {selectedSession.messages.map((m, i) => (
                <div key={i} className={`aiw-bw ${m.role}`}>
                  <div className={`aiw-b ${m.role}`}>{m.content}</div>
                  <div className="aiw-bm">{m.role === "user" ? "You" : "AI Coach"}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Header */}
        <div className="aiw-hdr">
          <div className="aiw-hdr-top">
            <div className="aiw-logo">AI Front Desk <span>Helper</span></div>
            <div className="aiw-hbtns">
              <button className="aiw-ibt" title="Session memory" onClick={() => setShowMemory(true)}>🧠</button>
              <button className="aiw-ibt" title="New conversation" onClick={reset}>↺</button>
              <button className="aiw-x" onClick={() => setOpen(false)}>✕</button>
            </div>
          </div>
          <div className="aiw-tabs">
            {Object.entries(MODES).map(([key, val]) => (
              <button
                key={key}
                className={`aiw-tab ${mode === key ? (key === "nurture" ? "tn" : key === "coaching" ? "tc" : "th") : ""}`}
                onClick={() => { setMode(key); if (key !== "history") reset(); }}
              >
                {val.icon} {val.label}
                {key === "history" && history.length > 0 && (
                  <span style={{ marginLeft: 3, fontSize: 9, background: "#6366f133", color: "#818cf8", padding: "1px 5px", borderRadius: 10 }}>
                    {history.length}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Context / level bar */}
        {mode !== "history" && (
          <div className="aiw-ctx">
            {mode === "nurture" ? (
              <div className="aiw-pill" onClick={() => setShowContacts(true)}>
                <span className="aiw-dot" style={{ background: stageDot(selectedContact?.stage) }} />
                <span className="aiw-pt">
                  {selectedContact ? `${selectedContact.name} · ${selectedContact.stage}` : "Select a lead"} ▾
                </span>
              </div>
            ) : (
              <div className="aiw-lvls">
                {COACHING_LEVELS.map((l) => (
                  <button key={l} className={`aiw-lvl ${coachLevel === l ? "on" : ""}`} onClick={() => setCoachLevel(l)}>{l}</button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Live data bar — coaching only */}
        {mode === "coaching" && (
          <div className="aiw-databar">
            {activityLoading ? (
              <div className="aiw-stl" style={{ alignSelf: "center" }}>Loading intel…</div>
            ) : (
              <>
                {monthGoal > 0 && (
                  <div className="aiw-stat">
                    <div className="aiw-stl">{MONTH_NAME} Goal</div>
                    <div className="aiw-stv">${monthGoal.toLocaleString()}</div>
                  </div>
                )}
                {monthGoal > 0 && (
                  <div className="aiw-stat">
                    <div className="aiw-stl">Actual</div>
                    <div className={`aiw-stv ${monthActual >= monthGoal ? "good" : monthActual < monthGoal * 0.7 ? "warn" : ""}`}>
                      ${monthActual.toLocaleString()}
                    </div>
                  </div>
                )}
                {bookingRate > 0 && (
                  <div className="aiw-stat">
                    <div className="aiw-stl">Booking %</div>
                    <div className={`aiw-stv ${bookingRate >= 50 ? "good" : bookingRate < 35 ? "warn" : ""}`}>{bookingRate}%</div>
                  </div>
                )}
                {closeRate > 0 && (
                  <div className="aiw-stat">
                    <div className="aiw-stl">Close %</div>
                    <div className={`aiw-stv ${closeRate >= 50 ? "good" : closeRate < 35 ? "warn" : ""}`}>{closeRate}%</div>
                  </div>
                )}
                {openLeadsCount > 0 && (
                  <div className="aiw-stat">
                    <div className="aiw-stl">Open Est.</div>
                    <div className="aiw-stv">{openLeadsCount}</div>
                  </div>
                )}
                {overdueCount > 0 && (
                  <div className="aiw-stat">
                    <div className="aiw-stl">Overdue F/U</div>
                    <div className="aiw-stv warn">{overdueCount} 🚨</div>
                  </div>
                )}
                {teamCount > 0 && (
                  <div className="aiw-stat">
                    <div className="aiw-stl">Team</div>
                    <div className="aiw-stv info">{teamCount} 👥</div>
                  </div>
                )}
                {!monthGoal && !bookingRate && !closeRate && (
                  <div className="aiw-stl" style={{ alignSelf: "center" }}>No data yet — set goals in Metrics</div>
                )}
              </>
            )}
          </div>
        )}

        {/* ── History tab content ── */}
        {mode === "history" ? (
          <div className="aiw-msgs">
            {history.length === 0 ? (
              <div className="aiw-empty">
                <div className="aiw-ei">📋</div>
                <div className="aiw-et">No sessions yet</div>
                <div className="aiw-es">Your coaching sessions save here automatically. Switch to Coach tab to get started.</div>
              </div>
            ) : (
              history.map((session) => (
                <div key={session.id} className="aiw-hiscard" onClick={() => setSelectedSession(session)}>
                  <div className="aiw-hisdate">{session.date} · {session.messages.length} messages</div>
                  <div className="aiw-hisprev">{session.preview || "Session started"}</div>
                  <div>
                    <span className="aiw-hisbadge">
                      {session.mode === "nurture" ? "🌱" : "🏆"} {session.mode} {session.level ? `· ${session.level}` : ""}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        ) : (
          /* ── Chat content ── */
          <div className="aiw-msgs">
            {mode === "coaching" && overdueCount > 0 && messages.length === 0 && (
              <div className="aiw-alert">
                🚨 {overdueCount} overdue follow-up{overdueCount > 1 ? "s" : ""} — ask your coach what to prioritize
              </div>
            )}

            {messages.length === 0 && !streamText ? (
              <div className="aiw-empty">
                <div className="aiw-ei">{MODES[mode].icon}</div>
                <div className="aiw-et">
                  {mode === "nurture"
                    ? selectedContact ? `Nurturing ${selectedContact.name}` : "Select a lead to start"
                    : `${coachLevel} Performance Coach`}
                </div>
                <div className="aiw-es">
                  {mode === "nurture"
                    ? "AI-powered outreach for your pipeline."
                    : `Elite coaching powered by your live data.\nTeam of ${teamCount > 0 ? teamCount : "?"} · Direct, data-driven, results-focused.`}
                </div>
                <div className="aiw-qg">
                  {(mode === "nurture" ? NURTURE_QUICK : COACHING_QUICK).map((a) => (
                    <button key={a} className="aiw-qb" onClick={() => send(a)}>{a}</button>
                  ))}
                </div>
              </div>
            ) : (
              <>
                {messages.map((m, i) => (
                  <div key={i} className={`aiw-bw ${m.role}`}>
                    <div className={`aiw-b ${m.role}`}>{m.content}</div>
                    <div className="aiw-bm">{m.role === "user" ? "You" : "AI Coach"}</div>
                  </div>
                ))}
                {streamText && (
                  <div className="aiw-bw assistant">
                    <div className="aiw-b assistant streaming">
                      {streamText}<span className="aiw-cur" />
                    </div>
                  </div>
                )}
              </>
            )}
            <div ref={bottomRef} />
          </div>
        )}

        {/* Input — coaching and nurture only */}
        {mode !== "history" && (
          <div className="aiw-inp">
            <div className="aiw-ir">
              <textarea
                ref={inputRef}
                className="aiw-ta"
                placeholder={mode === "nurture" ? "Draft a message for this lead…" : "Ask your coach anything…"}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                rows={1}
              />
              <button className="aiw-sb" onClick={() => send()} disabled={loading || !input.trim()}>
                {loading ? "⏳" : "↑"}
              </button>
            </div>
            <div className="aiw-pw">POWERED BY AI FRONT DESK HELPER · GPT-4o</div>
          </div>
        )}
      </div>
    </>
  );
}
