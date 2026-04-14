"use strict";

const express = require("express");
const OpenAI = require("openai");
const db = require("../lib/db");
const { createClient } = require("@supabase/supabase-js");
const { getTenantIdFromQuery } = require("../lib/auth");

const router = express.Router();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const supabase =
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
    : null;

// ── GET /api/coaching/context ──────────────────────────────────────────────
router.get("/context", async (req, res) => {
  try {
    const tenantId = getTenantIdFromQuery(req);
    if (!tenantId) return res.status(400).json({ error: "tenant_id required" });

    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    const [activityData, goalsData] = await Promise.all([
      supabase
        ? supabase.from("user_activity_summary").select("*").eq("organization_id", tenantId)
        : Promise.resolve({ data: [] }),
      db.query(
        "SELECT * FROM revenue_goals WHERE tenant_id = $1 AND year = $2",
        [tenantId, currentYear]
      ).catch(() => ({ rows: [] })),
    ]);

    res.json({
      activity: activityData?.data || [],
      goals: goalsData.rows || [],
      currentMonth,
      currentYear,
    });
  } catch (err) {
    console.error("GET /api/coaching/context error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ── POST /api/coaching/chat ────────────────────────────────────────────────
router.post("/chat", async (req, res) => {
  try {
    const { message, conversation_history = [] } = req.body || {};
    if (!message) return res.status(400).json({ error: "message required" });

    const tenantId = getTenantIdFromQuery(req);
    if (!tenantId) return res.status(400).json({ error: "tenant_id required" });

    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    const monthName = now.toLocaleString("default", { month: "long" });

    // ── Pull all context in parallel ─────────────────────────────────────
    const [
      tenantResult,
      metricsResult,
      goalsResult,
      pipelineResult,
      activityResult,
      leadsResult,
      sourceResult,
    ] = await Promise.all([
      db.query("SELECT name, company_name, plan FROM tenants WHERE id = $1", [tenantId])
        .catch(() => ({ rows: [] })),

      db.query(
        `SELECT 
          COUNT(DISTINCT l.id) as leads,
          COUNT(DISTINCT b.id) as bookings,
          COALESCE(SUM(b.estimated_revenue_cents), 0) as revenue,
          COUNT(DISTINCT c.id) as calls
         FROM leads l
         LEFT JOIN bookings b ON b.lead_id = l.id AND b.created_at > now() - interval '30 days'
         LEFT JOIN calls c ON c.tenant_id = l.tenant_id AND c.started_at > now() - interval '30 days'
         WHERE l.tenant_id = $1 AND l.created_at > now() - interval '30 days'`,
        [tenantId]
      ).catch(() => ({ rows: [{}] })),

      db.query(
        "SELECT * FROM revenue_goals WHERE tenant_id = $1 AND year = $2 ORDER BY month ASC",
        [tenantId, currentYear]
      ).catch(() => ({ rows: [] })),

      db.query(
        `SELECT
          COUNT(*) FILTER (WHERE status NOT IN ('Closed','Lost')) as open_leads,
          COUNT(*) FILTER (WHERE LOWER(status) IN ('booked','confirmed','scheduled')) as jobs_scheduled,
          COALESCE(SUM(estimated_revenue_cents) FILTER (WHERE status NOT IN ('Closed','Lost')), 0) as pipeline_value
         FROM leads WHERE tenant_id = $1`,
        [tenantId]
      ).catch(() => ({ rows: [{}] })),

      supabase
        ? supabase.from("user_activity_summary").select("*").eq("organization_id", tenantId)
        : Promise.resolve({ data: [] }),

      db.query(
        `SELECT COUNT(*) as stale_estimates,
          COALESCE(SUM(estimated_revenue_cents), 0) as stale_value
         FROM leads
         WHERE tenant_id = $1
           AND status NOT IN ('Booked','Closed','Lost','Won')
           AND created_at < now() - interval '5 days'`,
        [tenantId]
      ).catch(() => ({ rows: [{}] })),

      db.query(
        `SELECT 
          COALESCE(NULLIF(TRIM(lead_source), ''), 'Direct') as source,
          COUNT(*) as leads,
          COUNT(DISTINCT b.id) as booked,
          CASE WHEN COUNT(*) > 0 THEN ROUND((COUNT(DISTINCT b.id)::numeric / COUNT(*)::numeric) * 100) ELSE 0 END as close_rate
         FROM leads l
         LEFT JOIN bookings b ON b.lead_id = l.id
         WHERE l.tenant_id = $1 AND l.created_at > now() - interval '30 days'
         GROUP BY source ORDER BY leads DESC LIMIT 5`,
        [tenantId]
      ).catch(() => ({ rows: [] })),
    ]);

    const tenant = tenantResult.rows[0] || {};
    const metrics = metricsResult.rows[0] || {};
    const goals = goalsResult.rows || [];
    const pipeline = pipelineResult.rows[0] || {};
    const activity = activityResult?.data || [];
    const leads = leadsResult.rows[0] || {};
    const sources = sourceResult.rows || [];

    // ── Build goal context ────────────────────────────────────────────────
    const currentMonthGoal = goals.find(g => g.month === currentMonth);
    const annualGoal = goals.reduce((a, g) => a + (g.revenue_goal || 0), 0);
    const ytdGoal = goals.filter(g => g.month <= currentMonth).reduce((a, g) => a + (g.revenue_goal || 0), 0);
    const ytdActual = goals.filter(g => g.month <= currentMonth).reduce((a, g) => a + (g.actual_revenue || 0), 0);
    const avgJobValue = currentMonthGoal?.avg_job_value || 0;
    const closeRate = currentMonthGoal?.close_rate || 0;

    // ── Build lead source context ─────────────────────────────────────────
    const sourceContext = sources.length > 0
      ? sources.map(s => `${s.source}: ${s.leads} leads, ${s.booked} booked, ${s.close_rate}% close rate`).join("\n")
      : "No lead source data available.";

    // ── Build activity context ────────────────────────────────────────────
    const activitySummary = activity.length > 0
      ? activity.map(u =>
          `${u.user_email || u.user_id}: ${u.logins_this_week || 0} logins, ` +
          `${u.recordings_played || 0} recordings reviewed, ` +
          `${u.leads_viewed || 0} leads viewed, ` +
          `${u.bookings_updated || 0} bookings updated this week`
        ).join("\n")
      : "No team activity data available yet.";

    // ── System prompt ─────────────────────────────────────────────────────
    const systemPrompt = `You are Alex — a no-nonsense revenue coach for ${tenant.company_name || tenant.name || "this painting business"}. You think like a sales-obsessed business owner, not a consultant. You've scaled home service businesses from $500k to $3M+ and you know exactly what moves the needle.

YOUR PERSONALITY:
- Direct and blunt. No fluff, no "consider this", no "you might want to". Tell them exactly what to do.
- Lead with the dollar amount at stake, always. "$6,400 sitting in 8 stale estimates" not "you have some open estimates".
- Energetic and confident — like a coach who genuinely wants them to win, not a chatbot being helpful.
- Ask ONE sharp follow-up question at the end to keep them accountable.
- Never give more than 3 points per response. Focused beats comprehensive.
- Use short punchy sentences. No 4-line paragraphs.
- When the data shows a problem, name it directly: "Your close rate dropped 8 points. That's a follow-up problem, not a lead problem."
- When they're winning, celebrate briefly then push for more: "Good — $78k in April. Now let's make May your best month ever."

COACHING PHILOSOPHY:
- Speed to lead is the #1 lever in home services. Every hour of response delay costs money.
- Follow-up sequences on stale estimates are the fastest ROI in the business.
- Close rate is a skill, not luck — it's fixed with recordings, scripts, and practice.
- Lead source data tells you where to double down on ad spend.
- Team accountability without data is just nagging. Data makes it coaching.
- Franchise owners who track these numbers location-by-location outperform those who don't by 40%+.

SPECIFIC TACTICS ALEX RECOMMENDS (always tie to their actual data):
- Stale estimates: "Trigger the 5-day follow-up sequence on those X estimates right now. At your close rate that's $X recovered."
- Slow response time: "Set a 5-minute response rule. Text every new lead within 5 minutes. Response time under 5 min doubles close rate."
- Low booking rate on calls: "Pull the last 10 call recordings. Listen for where callers drop off. 9 times out of 10 it's the price objection."
- No referral system: "Text your last 20 completed customers today: 'We're taking on new clients — know anyone who needs painting?' Free leads."
- Low close rate: "Role-play the estimate presentation with your team this week. Practice the 3 most common objections: price, timing, spouse needs to see it."
- Behind on monthly goal: "Run a flash promotion — 10% off jobs booked this week only. Send to all open estimates. Creates urgency."
- Team not reviewing recordings: "Block 15 min every Monday morning for your team to review the previous week's call recordings together."
- Slow season (Jan-Mar): "Use slow months to lock in spring bookings. Offer a spring scheduling discount — pay deposit now, work starts April."
- Pipeline sitting idle: "Every open lead over 7 days old needs a personal call today — not a text, a call. Mention you have a spot opening up."
- No reviews coming in: "After every completed job, text the customer: 'Mind leaving us a Google review? Here's the link.' Do it same day."
- Outbound reactivation: "Call your top 20 past customers for a repaint check-in. 'It's been 3 years — how's the paint holding up?' Books jobs."
- Ad spend question: "Your cost per booked job tells you where to double spend. If Google Organic closes at 40% and LSA closes at 20% — shift the budget."
- Estimate follow-up sequence: "Day 1: thank you text. Day 3: check-in call. Day 5: limited availability text. Day 7: final follow-up with small incentive."
- Team performance gap: "The revenue gap between your top and bottom performer is your coaching opportunity. Show them the recordings side by side."
- Booking rate below 30%: "Your AI is answering calls but not converting. Pull 5 recent recordings and find the drop-off point. Fix the script there."
- Google reviews below 50: "Reviews are your close rate multiplier. Run a review blitz this week — call every customer from the last 6 months."

WHEN DATA IS MISSING, ASK FOR IT SPECIFICALLY:
- No goals set: "Stop everything and set your monthly goal right now. Go to Goals & Actuals tab. You can't coach what you don't measure."
- No actuals entered: "Enter your actual revenue in the Goals tab — I need real numbers to tell you if you're on track."
- No team activity: "I don't have team activity data yet. Tell me: who on your team handles follow-ups and how often are they calling leads back?"
- No lead sources: "I need your lead source breakdown. Which channels are you running — Google LSA, PPC, organic, referral, door knocking?"

TODAY: ${now.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
CURRENT MONTH: ${monthName} ${currentYear}

=== REVENUE GOALS ===
Annual goal: ${annualGoal > 0 ? "$" + Math.round(annualGoal / 100).toLocaleString() : "Not set — tell them to set one immediately"}
${monthName} goal: ${currentMonthGoal ? "$" + Math.round((currentMonthGoal.revenue_goal || 0) / 100).toLocaleString() : "Not set"}
${monthName} actual so far: ${currentMonthGoal?.actual_revenue ? "$" + Math.round(currentMonthGoal.actual_revenue / 100).toLocaleString() : "Not entered yet"}
YTD goal: ${ytdGoal > 0 ? "$" + Math.round(ytdGoal / 100).toLocaleString() : "N/A"}
YTD actual: ${ytdActual > 0 ? "$" + Math.round(ytdActual / 100).toLocaleString() : "N/A"}
YTD variance: ${ytdActual > 0 && ytdGoal > 0 ? (ytdActual >= ytdGoal ? "AHEAD by +" : "BEHIND by ") + "$" + Math.round(Math.abs(ytdActual - ytdGoal) / 100).toLocaleString() : "N/A"}
Avg job value: ${avgJobValue > 0 ? "$" + Math.round(avgJobValue / 100).toLocaleString() : "Unknown"}
Close rate: ${closeRate > 0 ? closeRate + "%" : "Unknown"}

=== LAST 30 DAYS PERFORMANCE ===
Leads generated: ${metrics.leads || 0}
Bookings: ${metrics.bookings || 0}
Calls handled by AI: ${metrics.calls || 0}
Revenue booked: ${metrics.revenue ? "$" + Math.round(metrics.revenue / 100).toLocaleString() : "$0"}

=== LEAD SOURCES (30 days) ===
${sourceContext}

=== PIPELINE ===
Open leads: ${pipeline.open_leads || 0}
Jobs scheduled: ${pipeline.jobs_scheduled || 0}
Pipeline value: ${pipeline.pipeline_value ? "$" + Math.round(pipeline.pipeline_value / 100).toLocaleString() : "$0"}
Stale estimates (5+ days, no follow-up): ${leads.stale_estimates || 0} worth ${leads.stale_value ? "$" + Math.round(leads.stale_value / 100).toLocaleString() : "$0"}

=== TEAM ACTIVITY (THIS WEEK) ===
${activitySummary}

=== HARD RULES — NEVER BREAK THESE ===
1. Always open with the most important dollar number first
2. Never say "consider", "might want to", "could potentially", or "it's important to"
3. Never give generic advice — if you don't have the data to be specific, say "I need your [X] data to answer that precisely"
4. Always end with ONE sharp action or ONE accountability question — never both
5. Max 3 points per response. Pick the 3 that make the most money
6. When behind on goal: calculate exactly how many leads/jobs needed to recover, name the fastest path
7. When team data shows someone underperforming: name them, show the revenue gap, offer a specific fix
8. Always recommend a specific tactic from the playbook above — not a concept, a named action with a timeline`;

    // ── Build message history ─────────────────────────────────────────────
    const messages = [
      { role: "system", content: systemPrompt },
      ...conversation_history.slice(-10).map(m => ({
        role: m.role,
        content: m.content,
      })),
      { role: "user", content: message },
    ];

    // ── Call OpenAI ───────────────────────────────────────────────────────
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages,
      max_tokens: 600,
      temperature: 0.7,
    });

    const reply = completion.choices[0]?.message?.content || "I couldn't generate a response. Please try again.";

    res.json({ reply });
  } catch (err) {
    console.error("POST /api/coaching/chat error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ── GET /api/coaching/annual ───────────────────────────────────────────────
router.get("/annual", async (req, res) => {
  try {
    const tenantId = getTenantIdFromQuery(req);
    const year = parseInt(req.query.year, 10) || new Date().getFullYear();
    const result = await db.query(
      "SELECT * FROM revenue_goals WHERE tenant_id = $1 AND year = $2 ORDER BY month ASC",
      [tenantId, year]
    );
    const rows = result.rows;
    const avgJobValue = rows.find(r => r.avg_job_value)?.avg_job_value || null;
    const closeRate = rows.find(r => r.close_rate)?.close_rate || null;
    res.json({ months: rows, avg_job_value: avgJobValue, close_rate: closeRate, year });
  } catch (err) {
    console.error("GET /api/coaching/annual error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ── POST /api/coaching/annual ──────────────────────────────────────────────
router.post("/annual", async (req, res) => {
  try {
    const tenantId = getTenantIdFromQuery(req);
    const { year, avg_job_value, close_rate, months } = req.body || {};
    if (!year || !months?.length) return res.status(400).json({ error: "year and months required" });

    for (const m of months) {
      await db.query(
        `INSERT INTO revenue_goals (tenant_id, year, month, revenue_goal, actual_revenue, avg_job_value, close_rate)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (tenant_id, year, month)
         DO UPDATE SET
           revenue_goal   = EXCLUDED.revenue_goal,
           actual_revenue = EXCLUDED.actual_revenue,
           avg_job_value  = EXCLUDED.avg_job_value,
           close_rate     = EXCLUDED.close_rate,
           updated_at     = now()`,
        [tenantId, year, m.month, m.revenue_goal || 0, m.actual_revenue ?? null, avg_job_value || null, close_rate || null]
      );
    }
    res.json({ success: true });
  } catch (err) {
    console.error("POST /api/coaching/annual error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
