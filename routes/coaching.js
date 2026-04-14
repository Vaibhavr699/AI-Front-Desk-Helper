// routes/coaching.js
// Backend route for AI coaching chat
// Uses OpenAI to generate coaching responses with full business context injected
// 
// Add to server.js:
//   const coachingRouter = require("./routes/coaching");
//   app.use("/api/coaching", authMiddleware, coachingRouter);

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
// Returns all the context data the frontend needs to display in the context bar
router.get("/context", async (req, res) => {
  try {
    const tenantId = getTenantIdFromQuery(req);
    if (!tenantId) return res.status(400).json({ error: "tenant_id required" });

    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    const [activityData, goalsData] = await Promise.all([
      // Pull user_activity_summary from Supabase
      supabase
        ? supabase.from("user_activity_summary").select("*").eq("organization_id", tenantId)
        : Promise.resolve({ data: [] }),
      // Pull goals from PostgreSQL
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
// Pulls full business context, builds system prompt, calls OpenAI
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
    ] = await Promise.all([
      // Tenant info
      db.query("SELECT name, company_name, plan FROM tenants WHERE id = $1", [tenantId])
        .catch(() => ({ rows: [] })),

      // 30-day metrics
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

      // Current year goals + actuals
      db.query(
        "SELECT * FROM revenue_goals WHERE tenant_id = $1 AND year = $2 ORDER BY month ASC",
        [tenantId, currentYear]
      ).catch(() => ({ rows: [] })),

      // Pipeline
      db.query(
        `SELECT
          COUNT(*) FILTER (WHERE status NOT IN ('Closed','Lost')) as open_leads,
          COUNT(*) FILTER (WHERE LOWER(status) IN ('booked','confirmed','scheduled')) as jobs_scheduled,
          COALESCE(SUM(estimated_revenue_cents) FILTER (WHERE status NOT IN ('Closed','Lost')), 0) as pipeline_value
         FROM leads WHERE tenant_id = $1`,
        [tenantId]
      ).catch(() => ({ rows: [{}] })),

      // User activity from Supabase
      supabase
        ? supabase.from("user_activity_summary").select("*").eq("organization_id", tenantId)
        : Promise.resolve({ data: [] }),

      // Open estimates needing follow-up
      db.query(
        `SELECT COUNT(*) as stale_estimates,
          COALESCE(SUM(estimated_revenue_cents), 0) as stale_value
         FROM leads
         WHERE tenant_id = $1
           AND status NOT IN ('Booked','Closed','Lost','Won')
           AND created_at < now() - interval '5 days'`,
        [tenantId]
      ).catch(() => ({ rows: [{}] })),
    ]);

    const tenant = tenantResult.rows[0] || {};
    const metrics = metricsResult.rows[0] || {};
    const goals = goalsResult.rows || [];
    const pipeline = pipelineResult.rows[0] || {};
    const activity = activityResult?.data || [];
    const leads = leadsResult.rows[0] || {};

    // ── Build goal context ────────────────────────────────────────────────
    const currentMonthGoal = goals.find(g => g.month === currentMonth);
    const annualGoal = goals.reduce((a, g) => a + (g.revenue_goal || 0), 0);
    const ytdGoal = goals.filter(g => g.month <= currentMonth).reduce((a, g) => a + (g.revenue_goal || 0), 0);
    const ytdActual = goals.filter(g => g.month <= currentMonth).reduce((a, g) => a + (g.actual_revenue || 0), 0);
    const avgJobValue = currentMonthGoal?.avg_job_value || 0;
    const closeRate = currentMonthGoal?.close_rate || 0;

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
- Direct and blunt. No fluff, no "consider this", no "you might want to". You tell them exactly what to do.
- You lead with the dollar amount at stake, always. "$6,400 sitting in 8 stale estimates" not "you have some open estimates".
- You're energetic and confident — like a coach who genuinely wants them to win, not a chatbot being helpful.
- You ask ONE sharp follow-up question at the end to keep them accountable.
- You never give more than 3 points per response. Focused beats comprehensive.
- You use short punchy sentences. No 4-line paragraphs.
- When the data shows a problem, you name it directly: "Your close rate dropped 8 points. That's a follow-up problem, not a lead problem."
- When they're winning, you celebrate it briefly then push for more: "Good — $78k in April. Now let's make May your best month ever."

COACHING PHILOSOPHY:
- Speed to lead is the #1 lever in home services. Every hour of response delay costs money.
- Follow-up sequences on stale estimates are the fastest ROI in the business.
- Close rate is a skill, not luck — it's fixed with recordings, scripts, and practice.
- Lead source data tells you where to double down on ad spend.
- Team accountability without data is just nagging. Data makes it coaching.
- Franchise owners who track these numbers location-by-location outperform those who don't by 40%+.

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
5. Max 3 points per response. If you have more than 3, pick the 3 that make the most money
6. When behind on goal: calculate exactly how many leads/jobs needed to recover, name the fastest path
7. When team data shows someone underperforming: name them, show the revenue gap, offer a specific fix`;

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

module.exports = router;


// ── Add these to routes/coaching.js (or a separate routes/goals.js) ───────

// GET /api/goals/annual?year=YYYY
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
    console.error("GET /api/goals/annual error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/goals/annual
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
    console.error("POST /api/goals/annual error:", err);
    res.status(500).json({ error: "Server error" });
  }
});
