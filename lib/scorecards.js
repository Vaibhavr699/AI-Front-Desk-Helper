"use strict";

const db = require("./db");

const DEFAULT_WALKTHROUGH = [
  { key: "rooms", label: "Rooms" },
  { key: "scope", label: "Scope" },
  { key: "timeline", label: "Timeline" },
  { key: "budget", label: "Budget" },
  { key: "close", label: "Close" },
];

function slugify(label) {
  return String(label)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

function normalizeWalkthrough(input) {
  if (!Array.isArray(input)) return null;
  const seen = new Set();
  const out = [];
  for (const item of input) {
    const label = typeof item?.label === "string" ? item.label.trim() : "";
    if (!label) continue;
    let key = typeof item?.key === "string" && item.key.trim() ? slugify(item.key) : slugify(label);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ key, label: label.slice(0, 40) });
    if (out.length >= 12) break;
  }
  return out.length > 0 ? out : null;
}

async function getWalkthrough(tenantId) {
  if (!tenantId) return DEFAULT_WALKTHROUGH;
  try {
    const r = await db.query(
      "SELECT walkthrough FROM tenant_scorecards WHERE tenant_id = $1",
      [tenantId],
    );
    const wt = r.rows[0]?.walkthrough;
    const normalized = normalizeWalkthrough(wt);
    return normalized || DEFAULT_WALKTHROUGH;
  } catch (err) {
    console.error("[scorecards] getWalkthrough failed:", err.message);
    return DEFAULT_WALKTHROUGH;
  }
}

async function setWalkthrough(tenantId, walkthrough, updatedBy) {
  const normalized = normalizeWalkthrough(walkthrough);
  if (!normalized) {
    throw new Error("walkthrough must be a non-empty array of { label } items");
  }
  await db.query(
    `INSERT INTO tenant_scorecards (tenant_id, walkthrough, updated_by, updated_at)
     VALUES ($1, $2::jsonb, $3, now())
     ON CONFLICT (tenant_id)
     DO UPDATE SET walkthrough = $2::jsonb, updated_by = $3, updated_at = now()`,
    [tenantId, JSON.stringify(normalized), updatedBy || null],
  );
  return normalized;
}

const VALID_CUE_KEYS = new Set([
  "ask_discovery",
  "listen",
  "disc_reframe",
  "missing_close",
  "address_objection",
  "slow_down",
  "build_rapport",
  "confirm_next_step",
]);

function normalizeCueEmphasis(input) {
  const priority = Array.isArray(input?.priority_cues)
    ? input.priority_cues.filter((c) => VALID_CUE_KEYS.has(c)).slice(0, 8)
    : [];
  const guidance =
    typeof input?.guidance === "string" ? input.guidance.trim().slice(0, 600) : "";
  return { priority_cues: [...new Set(priority)], guidance };
}

async function getCueEmphasis(tenantId) {
  if (!tenantId) return { priority_cues: [], guidance: "" };
  try {
    const r = await db.query(
      "SELECT cue_emphasis FROM tenant_scorecards WHERE tenant_id = $1",
      [tenantId],
    );
    return normalizeCueEmphasis(r.rows[0]?.cue_emphasis || {});
  } catch (err) {
    console.error("[scorecards] getCueEmphasis failed:", err.message);
    return { priority_cues: [], guidance: "" };
  }
}

async function setCueEmphasis(tenantId, emphasis, updatedBy) {
  const normalized = normalizeCueEmphasis(emphasis);
  await db.query(
    `INSERT INTO tenant_scorecards (tenant_id, cue_emphasis, updated_by, updated_at)
     VALUES ($1, $2::jsonb, $3, now())
     ON CONFLICT (tenant_id)
     DO UPDATE SET cue_emphasis = $2::jsonb, updated_by = $3, updated_at = now()`,
    [tenantId, JSON.stringify(normalized), updatedBy || null],
  );
  return normalized;
}

const DEFAULT_SCORING_DIMENSIONS = [
  { key: "rapport", label: "Rapport", criteria: "opened warmly, used customer name, built personal connection, found common ground" },
  { key: "property_walkthrough", label: "Property Walkthrough", criteria: "surveyed the space methodically (rooms/areas/condition/history per area)", contexts: ["visit"] },
  { key: "discovery", label: "Discovery", criteria: "uncovered motivation, timeline, budget signal, decision-maker structure" },
  { key: "listening", label: "Listening", criteria: "let the customer finish, reflected back what they heard, did not talk over or interrupt" },
  { key: "education", label: "Education", criteria: "positioned expertise (process, materials, timeline, warranty) without jargon-dumping" },
  { key: "value_framing", label: "Value Framing", criteria: "connected solution to customer's stated needs; anchored on transformation, not features" },
  { key: "objection_handling", label: "Objection Handling", criteria: "acknowledged + validated + reframed; not defensive, not capitulating" },
  { key: "close", label: "Close", criteria: "asked for the sale or specific next step; locked a date/action/commitment" },
  { key: "next_steps", label: "Next Steps", criteria: "secured a concrete follow-up: appointment, signature, or committed action with a date" },
  { key: "professionalism", label: "Professionalism", criteria: "tone, language, respect for time, clarity; penalize filler/talking over customer" },
];

const VALID_DIMENSION_CONTEXTS = new Set(["visit", "roleplay"]);

function normalizeDimensionContexts(input) {
  if (!Array.isArray(input)) return null;
  const out = [];
  for (const c of input) {
    const v = typeof c === "string" ? c.trim().toLowerCase() : "";
    if (VALID_DIMENSION_CONTEXTS.has(v) && !out.includes(v)) out.push(v);
  }
  return out.length > 0 ? out : null;
}

function normalizeScoringDimensions(input) {
  if (!Array.isArray(input)) return null;
  const seen = new Set();
  const out = [];
  for (const item of input) {
    const label = typeof item?.label === "string" ? item.label.trim() : "";
    if (!label) continue;
    let key = typeof item?.key === "string" && item.key.trim() ? slugify(item.key) : slugify(label);
    if (!key || seen.has(key)) continue;
    const criteria = typeof item?.criteria === "string" ? item.criteria.trim().slice(0, 300) : "";
    seen.add(key);
    const dim = { key, label: label.slice(0, 60), criteria };
    const contexts = normalizeDimensionContexts(item?.contexts);
    if (contexts) dim.contexts = contexts;
    out.push(dim);
    if (out.length >= 12) break;
  }
  return out.length >= 2 ? out : null;
}

function dimensionAppliesTo(dimension, context) {
  const contexts = dimension?.contexts;
  if (!Array.isArray(contexts) || contexts.length === 0) return true;
  return contexts.includes(context);
}

async function getScoringDimensions(tenantId) {
  if (!tenantId) return DEFAULT_SCORING_DIMENSIONS;
  try {
    const r = await db.query(
      "SELECT scoring_dimensions FROM tenant_scorecards WHERE tenant_id = $1",
      [tenantId],
    );
    const normalized = normalizeScoringDimensions(r.rows[0]?.scoring_dimensions);
    return normalized || DEFAULT_SCORING_DIMENSIONS;
  } catch (err) {
    console.error("[scorecards] getScoringDimensions failed:", err.message);
    return DEFAULT_SCORING_DIMENSIONS;
  }
}

async function setScoringDimensions(tenantId, dimensions, updatedBy) {
  const normalized = normalizeScoringDimensions(dimensions);
  if (!normalized) {
    throw new Error("scoring_dimensions must be an array of at least 2 { label } items");
  }
  await db.query(
    `INSERT INTO tenant_scorecards (tenant_id, scoring_dimensions, updated_by, updated_at)
     VALUES ($1, $2::jsonb, $3, now())
     ON CONFLICT (tenant_id)
     DO UPDATE SET scoring_dimensions = $2::jsonb, updated_by = $3, updated_at = now()`,
    [tenantId, JSON.stringify(normalized), updatedBy || null],
  );
  return normalized;
}

module.exports = {
  DEFAULT_WALKTHROUGH,
  DEFAULT_SCORING_DIMENSIONS,
  getWalkthrough,
  setWalkthrough,
  normalizeWalkthrough,
  slugify,
  getCueEmphasis,
  setCueEmphasis,
  normalizeCueEmphasis,
  getScoringDimensions,
  setScoringDimensions,
  normalizeScoringDimensions,
  dimensionAppliesTo,
};
