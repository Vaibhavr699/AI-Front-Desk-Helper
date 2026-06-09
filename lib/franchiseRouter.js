"use strict";

// ═══════════════════════════════════════════════════════════════════════════
// lib/franchiseRouter.js — Franchisor shared-number routing (Jun 8, 2026)
//
// PURPOSE
// One franchisor inbound number (voice OR SMS) fans out to N child-location
// tenants. A "location" is a child row in `tenants` (parent_id → franchisor).
//
// MODE "A" (instructions-only): a shared-number call/thread opens in a neutral
// franchisor persona, captures the property ZIP, then loads the matched child
// location's full text persona (name, instructions, objection handlers, FAQs,
// service-area) and reassigns the call/lead record to the child. Booking,
// cadence, calendar, transfer, and coaching all key off the child.
//
// HARD CONSTRAINT: OpenAI Realtime cannot change `voice` mid-session, so the
// raw TTS timbre stays whatever the call opened with. Everything the caller
// hears in *words* is per-location; only the voice timbre is franchisor-level.
//
// FAIL-CLOSED PHILOSOPHY (matches the Paragon recovery lessons):
//   - no-match  → capture lead as out-of-area, route to nearest location for a
//                 HUMAN to claim, notify HQ. NEVER auto-book.
//   - overlap   → two children claim the same ZIP = a CONFIG error. Route to HQ,
//                 log it. Never silently pick one.
// Nothing here ever books. Booking only happens after a clean single match,
// downstream, via the existing bookingEngine.
//
// MASTER GATE: parent tenant must have franchise_shared_number_enabled = true.
// Off by default → this entire module is inert for every existing tenant
// (Gladiators, Paragon, etc.). A number that resolves to a tenant without the
// flag behaves exactly as before.
//
// service_area canonical shape (jsonb):
//   { "zips": ["68022","68135"], "home_zip": "68022" }
// Legacy boundary shape from mig 068 ({ type, values, home_city, ... }) is also
// read for the `zips` type so SMS service-area boundaries keep working.
// ═══════════════════════════════════════════════════════════════════════════

const db = require("./db");

// ── ZIP helpers ─────────────────────────────────────────────────────────────

/** Normalize a raw ZIP-ish string to a 5-digit US ZIP, or "" if not parseable. */
function normalizeZip(raw) {
  if (raw == null) return "";
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length < 5) return "";
  return digits.slice(0, 5);
}

/**
 * Pull the ZIP array out of a tenant's service_area jsonb, supporting both the
 * canonical shape and the legacy mig-068 boundary shape (type === "zips").
 * Returns a de-duped array of normalized 5-digit strings (possibly empty).
 */
function extractZips(serviceArea) {
  if (!serviceArea || typeof serviceArea !== "object") return [];
  let list = [];
  if (Array.isArray(serviceArea.zips)) {
    list = serviceArea.zips;
  } else if (serviceArea.type === "zips" && Array.isArray(serviceArea.values)) {
    // legacy mig-068 boundary shape
    list = serviceArea.values;
  }
  const out = [];
  const seen = new Set();
  for (const z of list) {
    const n = normalizeZip(z);
    if (n && !seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
  }
  return out;
}

/** Pull a child's declared home/base ZIP for proximity routing, or "". */
function extractHomeZip(serviceArea) {
  if (!serviceArea || typeof serviceArea !== "object") return "";
  return normalizeZip(serviceArea.home_zip || "");
}

// ── Context resolution ────────────────────────────────────────────────────────

/**
 * Decide how an inbound number should be handled.
 *
 * @param {string} toNumber  The dialed/destination number (Twilio `To`).
 * @returns {Promise<object>} One of:
 *   { mode: "direct" }                       — not a franchisor shared number;
 *                                               caller falls through to the
 *                                               existing single-tenant path.
 *   { mode: "franchisor", parent, children } — shared number, routing engaged.
 *
 * "direct" is returned whenever ANY of these is true:
 *   - the number doesn't resolve to a tenant we know
 *   - the resolved tenant has no children
 *   - the resolved tenant does NOT have franchise_shared_number_enabled = true
 *
 * Never throws — on any DB error it returns { mode: "direct" } so a hiccup can
 * never break inbound call handling. Worst case the franchisor number behaves
 * like a normal single-tenant number for one call.
 */
async function resolveInboundContext(toNumber) {
  try {
    if (!toNumber) return { mode: "direct" };

    // Resolve the dialed number → owning tenant via phone_numbers, then load
    // the tenant row (we need parent flags + opener text).
    const pnRes = await db.query(
      `SELECT tenant_id FROM phone_numbers
        WHERE phone = $1
        ORDER BY is_primary DESC NULLS LAST
        LIMIT 1`,
      [toNumber]
    );
    const ownerTenantId = pnRes.rows[0]?.tenant_id || null;
    if (!ownerTenantId) return { mode: "direct" };

    const parentRes = await db.query(
      `SELECT id, name, company_name, parent_id,
              franchise_shared_number_enabled,
              franchise_neutral_opener,
              transfer_numbers
         FROM tenants
        WHERE id = $1
        LIMIT 1`,
      [ownerTenantId]
    );
    const parent = parentRes.rows[0] || null;
    if (!parent) return { mode: "direct" };

    // Master gate — explicit opt-in only.
    if (parent.franchise_shared_number_enabled !== true) {
      return { mode: "direct" };
    }

    // Must actually have children to fan out to.
    const childRes = await db.query(
      `SELECT id, name, company_name, parent_id, service_area, transfer_numbers
         FROM tenants
        WHERE parent_id = $1
          AND (is_suspended IS NULL OR is_suspended = false)
          AND deleted_at IS NULL`,
      [parent.id]
    );
    const children = childRes.rows || [];
    if (children.length === 0) {
      // Flag is on but no live children — treat as direct so the parent's own
      // number still books for the parent rather than dead-ending.
      return { mode: "direct" };
    }

    return { mode: "franchisor", parent, children };
  } catch (err) {
    console.error("[FranchiseRouter] resolveInboundContext failed toNumber=%s err=%s — defaulting to direct", toNumber, err.message);
    return { mode: "direct" };
  }
}

// ── ZIP → child matching (fail-closed) ────────────────────────────────────────

/**
 * Match a captured ZIP against the children's declared service-area ZIP lists.
 *
 * @param {Array}  children  Rows from resolveInboundContext (have service_area).
 * @param {string} rawZip    The ZIP the caller gave.
 * @returns {object} exactly one of:
 *   { status: "matched",  child }            — exactly one child claims the ZIP
 *   { status: "no_match" }                   — zero children claim it
 *   { status: "overlap",  children: [...] }  — >1 child claims it (config error)
 *   { status: "invalid_zip" }                — couldn't parse a 5-digit ZIP
 *
 * Pure function — no DB, no side effects. Fail-closed: overlap and no-match are
 * distinct from matched and NEVER resolve to an arbitrary pick.
 */
function matchZipToChild(children, rawZip) {
  const zip = normalizeZip(rawZip);
  if (!zip) return { status: "invalid_zip" };

  const claimants = [];
  for (const child of children || []) {
    const zips = extractZips(child.service_area);
    if (zips.includes(zip)) claimants.push(child);
  }

  if (claimants.length === 1) return { status: "matched", child: claimants[0] };
  if (claimants.length === 0) return { status: "no_match" };
  return { status: "overlap", children: claimants };
}

/**
 * Pick the geographically-nearest child to an unmatched ZIP, by numeric ZIP
 * proximity to each child's declared home_zip. Dependency-free (no geocoding).
 * Approximate by design — it only decides which HUMAN sees an out-of-area lead,
 * never a booking. Children without a home_zip are skipped. Returns the child
 * row or null if none have a home_zip.
 */
function nearestChildByZip(children, rawZip) {
  const target = parseInt(normalizeZip(rawZip), 10);
  if (!Number.isFinite(target)) return null;

  let best = null;
  let bestDist = Infinity;
  for (const child of children || []) {
    const home = extractHomeZip(child.service_area);
    if (!home) continue;
    const dist = Math.abs(parseInt(home, 10) - target);
    if (dist < bestDist) {
      bestDist = dist;
      best = child;
    }
  }
  return best;
}

// ── Config-time validation (catch overlaps before they hit a live call) ───────

/**
 * Validate a franchisor's child service areas. Call this when a franchisor
 * edits ZIP lists (dashboard) so overlaps surface at config time instead of as
 * a live-call fail-closed event — the same "validate at write, not just at
 * read" discipline that should have caught the Paragon toggle issue earlier.
 *
 * @param {string} parentId
 * @returns {Promise<object>} {
 *   ok: boolean,                      // true if no overlaps and ≥1 child has zips
 *   overlaps: [{ zip, childIds:[] }], // ZIPs claimed by >1 child
 *   childrenWithoutZips: [childId],   // children that declared no ZIPs
 *   childrenWithoutHomeZip: [childId],// children missing home_zip (no nearest routing)
 * }
 */
async function validateServiceAreas(parentId) {
  const res = await db.query(
    `SELECT id, service_area FROM tenants
      WHERE parent_id = $1
        AND (is_suspended IS NULL OR is_suspended = false)
        AND deleted_at IS NULL`,
    [parentId]
  );
  const children = res.rows || [];

  const zipToChildren = new Map();
  const childrenWithoutZips = [];
  const childrenWithoutHomeZip = [];

  for (const child of children) {
    const zips = extractZips(child.service_area);
    if (zips.length === 0) childrenWithoutZips.push(child.id);
    if (!extractHomeZip(child.service_area)) childrenWithoutHomeZip.push(child.id);
    for (const z of zips) {
      if (!zipToChildren.has(z)) zipToChildren.set(z, []);
      zipToChildren.get(z).push(child.id);
    }
  }

  const overlaps = [];
  for (const [zip, ids] of zipToChildren.entries()) {
    if (ids.length > 1) overlaps.push({ zip, childIds: ids });
  }

  return {
    ok: overlaps.length === 0 && childrenWithoutZips.length < children.length,
    overlaps,
    childrenWithoutZips,
    childrenWithoutHomeZip,
  };
}

// ── Audit-logged reassignment ─────────────────────────────────────────────────

/**
 * Reassign an in-flight call (and its lead) from the franchisor parent to the
 * matched child, and write an audit trail row: "entered as franchisor parent,
 * routed to child X by ZIP Y". Coaching, booking, recovery, and revenue all key
 * off the child after this — so a franchise call is never silently attributed
 * to the parent (which would break per-location coaching + the data flywheel).
 *
 * @param {object} p
 * @param {string} p.parentId
 * @param {string} p.childId
 * @param {string} p.zip
 * @param {string} [p.callId]   calls.id (voice path)
 * @param {string} [p.leadId]   leads.id (voice + SMS)
 * @returns {Promise<void>} never throws — logs and continues on failure.
 */
async function reassignToChild({ parentId, childId, zip, callId = null, leadId = null }) {
  const normZip = normalizeZip(zip);
  try {
    if (callId) {
      await db.query("UPDATE calls SET tenant_id = $1 WHERE id = $2", [childId, callId]);
    }
    if (leadId) {
      await db.query("UPDATE leads SET tenant_id = $1, updated_at = now() WHERE id = $2", [childId, leadId]);
    }

    // Audit trail. franchise_routing_events is created in the migration. The
    // INSERT is wrapped so a missing table (migration not yet run) degrades to
    // a log line rather than breaking the call.
    await db.query(
      `INSERT INTO franchise_routing_events
         (parent_tenant_id, child_tenant_id, zip, call_id, lead_id, outcome, created_at)
       VALUES ($1, $2, $3, $4, $5, 'matched', now())`,
      [parentId, childId, normZip, callId, leadId]
    );
    console.log("[FranchiseRouter] reassigned parent=%s → child=%s zip=%s callId=%s leadId=%s",
      parentId, childId, normZip, callId || "(none)", leadId || "(none)");
  } catch (err) {
    console.error("[FranchiseRouter] reassignToChild failed parent=%s child=%s err=%s", parentId, childId, err.message);
  }
}

/**
 * Log a fail-closed routing outcome (no_match / overlap) to the audit trail.
 * Best-effort; never throws.
 */
async function logRoutingOutcome({ parentId, zip, outcome, callId = null, leadId = null, routedToChildId = null }) {
  try {
    await db.query(
      `INSERT INTO franchise_routing_events
         (parent_tenant_id, child_tenant_id, zip, call_id, lead_id, outcome, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())`,
      [parentId, routedToChildId, normalizeZip(zip), callId, leadId, outcome]
    );
  } catch (err) {
    console.error("[FranchiseRouter] logRoutingOutcome failed parent=%s outcome=%s err=%s", parentId, outcome, err.message);
  }
}

// ── Opener text ───────────────────────────────────────────────────────────────

/** The neutral franchisor opener spoken/sent before ZIP capture. */
function buildNeutralOpener(parent) {
  const custom = (parent?.franchise_neutral_opener || "").trim();
  if (custom) return custom;
  const brand = parent?.company_name || parent?.name || "us";
  return `Thanks for calling ${brand} — let me get you to the right local team. What's the ZIP code for the property?`;
}

module.exports = {
  // resolution
  resolveInboundContext,
  // matching
  matchZipToChild,
  nearestChildByZip,
  // validation
  validateServiceAreas,
  // reassignment + audit
  reassignToChild,
  logRoutingOutcome,
  // opener
  buildNeutralOpener,
  // helpers (exported for tests / SMS path reuse)
  normalizeZip,
  extractZips,
  extractHomeZip,
};
