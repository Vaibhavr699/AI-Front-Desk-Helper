"use strict";

/**
 * services/gbpScheduler.js
 *
 * GBP Traction G4 — auto-posting cron brain.
 *
 * Modes (from gbp_post_schedule.enabled + auto_publish):
 *   Off        : enabled=false              → skipped entirely
 *   Draft-only : enabled=true, auto=false   → generate a draft, leave in queue
 *   Full-auto  : enabled=true, auto=true    → generate, attach image, publish
 *
 * Cadence: posts_per_week + preferred_days[] (0=Sun..6=Sat) + preferred_hour
 * (tenant-local-ish; we use server time + a simple spacing rule). The cron
 * runs hourly; this service decides which tenants are DUE this hour.
 *
 * "Due" rule (intentionally simple + robust, not a full scheduler):
 *   - today's weekday must be in preferred_days (if set)
 *   - current hour must be >= preferred_hour
 *   - we must not have already generated/published today
 *   - and we must be under this week's posts_per_week budget
 * This produces roughly posts_per_week posts on the preferred days, one per
 * due day, without needing per-slot bookkeeping. Good enough for 1-7/week.
 *
 * Full-auto image sourcing: owner pool first (lib/gbpImagePool round-robin),
 * else round-robin the tenant's existing GBP photos (listLocationPhotos).
 * If neither yields an image, we DON'T publish — we leave the generated post
 * as a draft and note why, so a full-auto tenant with no images degrades to
 * draft-only rather than failing silently.
 *
 * Never throws out of runScheduledPosts — per-tenant errors are caught and
 * logged so one bad tenant can't break the sweep.
 */

const db = require("../lib/db");
const gbpPosting = require("./gbpPosting");
const gbpImagePool = require("../lib/gbpImagePool");
const gbpImageStore = require("../lib/gbpImageStore");

function startOfWeek(d = new Date()) {
  const x = new Date(d);
  const day = x.getDay(); // 0=Sun
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - day);
  return x;
}

function isSameDay(a, b) {
  if (!a || !b) return false;
  const da = new Date(a), dbb = new Date(b);
  return da.getFullYear() === dbb.getFullYear() && da.getMonth() === dbb.getMonth() && da.getDate() === dbb.getDate();
}

/**
 * Count posts this tenant has produced (generated for draft-only, published for
 * full-auto) since the start of this week — used to enforce posts_per_week.
 */
async function countThisWeek(tenantId, autoPublish) {
  const weekStart = startOfWeek().toISOString();
  if (autoPublish) {
    const r = await db.query(
      `SELECT COUNT(*) FROM gbp_posts
        WHERE tenant_id = $1 AND status = 'published' AND published_at >= $2
          AND source IN ('ai_generated','recurring')`,
      [tenantId, weekStart]
    );
    return parseInt(r.rows[0].count, 10);
  }
  const r = await db.query(
    `SELECT COUNT(*) FROM gbp_posts
      WHERE tenant_id = $1 AND created_at >= $2 AND source IN ('ai_generated','recurring')`,
    [tenantId, weekStart]
  );
  return parseInt(r.rows[0].count, 10);
}

/**
 * Decide whether a schedule row is due right now. Returns { due, reason }.
 */
async function isDue(sched) {
  const now = new Date();
  const weekday = now.getDay();
  const hour = now.getHours();

  const days = Array.isArray(sched.preferred_days) && sched.preferred_days.length
    ? sched.preferred_days : [2, 4]; // default Tue/Thu
  if (!days.includes(weekday)) return { due: false, reason: `not a preferred day (today=${weekday})` };

  if (hour < (sched.preferred_hour ?? 10)) {
    return { due: false, reason: `before preferred hour (${sched.preferred_hour ?? 10})` };
  }

  // Already acted today?
  const lastMark = sched.auto_publish ? sched.last_published_at : sched.last_generated_at;
  if (isSameDay(lastMark, now)) return { due: false, reason: "already ran today" };

  // Weekly budget
  const made = await countThisWeek(sched.tenant_id, sched.auto_publish);
  if (made >= (sched.posts_per_week ?? 2)) {
    return { due: false, reason: `weekly budget reached (${made}/${sched.posts_per_week ?? 2})` };
  }

  return { due: true, reason: "due" };
}

/**
 * Full-auto: source an image for a freshly generated draft.
 * Pool round-robin first; else round-robin existing GBP photos. Returns the
 * public media_url to attach, or null if no image source is available.
 */
async function sourceImageForAuto(tenantId) {
  // Gather existing GBP photos as the fallback set.
  let fallbackUrls = [];
  try {
    const media = await gbpPosting.listLocationPhotos(tenantId, { limit: 30 });
    if (media.ok) fallbackUrls = media.photos.map(p => p.url).filter(Boolean);
  } catch (_) { /* best-effort */ }

  const pick = await gbpImagePool.pickNextImage(tenantId, fallbackUrls);
  if (!pick) return null;

  // Pool images are already public+durable → use directly.
  if (pick.source === "pool") return pick.url;

  // GBP-photo fallback: re-host so Google gets a stable URL we control.
  const stored = await gbpImageStore.storeFromUrl(pick.url);
  if (stored.ok) return stored.url;
  return null;
}

/**
 * Process one schedule row. Generates a draft; in full-auto, attaches an image
 * and publishes. Returns a short note describing what happened (also stored on
 * the schedule row for the UI). Never throws.
 */
async function processOne(sched) {
  const tenantId = sched.tenant_id;
  try {
    const gen = await gbpPosting.generateDraftsForTenant(tenantId, { count: 1, postType: "STANDARD" });
    if (!gen.ok || !gen.drafts?.length) {
      return await note(tenantId, `generation failed (${gen.reason || "no draft"})`, { generated: false });
    }
    const draft = gen.drafts[0];

    // Tag as recurring so the weekly counter + provenance are correct.
    await db.query("UPDATE gbp_posts SET source = 'recurring' WHERE id = $1", [draft.id]);

    if (!sched.auto_publish) {
      // Draft-only: leave it in the queue for owner approval.
      return await note(tenantId, "draft generated (awaiting approval)", { generated: true });
    }

    // Full-auto: source image, attach, publish.
    const mediaUrl = await sourceImageForAuto(tenantId);
    if (!mediaUrl) {
      return await note(
        tenantId,
        "draft generated but NO image available (add photos to your pool or profile) — left as draft",
        { generated: true }
      );
    }
    await db.query("UPDATE gbp_posts SET media_url = $2, updated_at = now() WHERE id = $1", [draft.id, mediaUrl]);

    const pub = await gbpPosting.publishPost(tenantId, draft.id, { approvedBy: null });
    if (!pub.ok) {
      return await note(tenantId, `auto-publish failed (${pub.reason}) — left as draft/failed`, { generated: true });
    }
    return await note(tenantId, "auto-published ✓", { generated: true, published: true });
  } catch (e) {
    console.error("[GBP Scheduler] processOne tenant=%s error=%s", tenantId, e.message);
    return await note(tenantId, `error: ${e.message}`, {});
  }
}

/**
 * Stamp the schedule cursors + last_run_note. `marks` controls which timestamp
 * columns advance so the "already ran today" guard works per-mode.
 */
async function note(tenantId, text, { generated = false, published = false } = {}) {
  const sets = ["last_run_note = $2", "updated_at = now()"];
  if (generated) sets.push("last_generated_at = now()");
  if (published) sets.push("last_published_at = now()");
  await db.query(
    `UPDATE gbp_post_schedule SET ${sets.join(", ")} WHERE tenant_id = $1`,
    [tenantId, text]
  );
  console.log("[GBP Scheduler] tenant=%s → %s", tenantId, text);
  return text;
}

/**
 * Main sweep — called by the hourly cron. Finds enabled schedules, runs the
 * due ones. Caps per-sweep work so a backlog can't run away.
 */
async function runScheduledPosts() {
  let rows;
  try {
    const res = await db.query(
      `SELECT s.*, t.google_account_id, t.google_location_id
         FROM gbp_post_schedule s
         JOIN tenants t ON t.id = s.tenant_id
        WHERE s.enabled = true
        LIMIT 200`
    );
    rows = res.rows;
  } catch (e) {
    console.error("[GBP Scheduler] sweep query failed:", e.message);
    return { ok: false };
  }

  if (!rows.length) return { ok: true, processed: 0 };

  let processed = 0;
  for (const sched of rows) {
    // Must be connected to publish/audit-read.
    if (!(sched.google_account_id && sched.google_location_id)) {
      await note(sched.tenant_id, "skipped: Google not connected", {});
      continue;
    }
    const { due, reason } = await isDue(sched);
    if (!due) {
      // Don't spam last_run_note for the common "not due" case; only log.
      continue;
    }
    await processOne(sched);
    processed++;
  }
  console.log("[GBP Scheduler] sweep done: %d enabled, %d processed", rows.length, processed);
  return { ok: true, processed };
}

module.exports = {
  runScheduledPosts,
  // exported for testing
  isDue,
  sourceImageForAuto,
};
