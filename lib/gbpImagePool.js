"use strict";

/**
 * lib/gbpImagePool.js
 *
 * Durable image storage for the GBP auto-poster (G4).
 *
 * Why this exists separately from lib/gbpImageStore.js: that store writes to
 * Render's EPHEMERAL disk, which is fine for manual publish (Google fetches the
 * image within seconds) but NOT for an auto-poster pool, where an image may sit
 * unused for two weeks before the cron grabs it. A pool image must survive
 * deploys, so it goes to Supabase Storage (durable, public bucket → public
 * HTTPS URL, which is exactly what Google localPosts needs).
 *
 * Graceful fallback: if Supabase env isn't configured, uploads fall back to the
 * ephemeral local store so the feature still works for testing — it just won't
 * survive a deploy. The owner-facing UI should note that.
 *
 * Bucket: a PUBLIC bucket named `gbp-pool-images`. Create it once in the
 * Supabase dashboard (Storage → New bucket → public), or it's auto-created on
 * first upload if the service-role key has permission.
 */

const crypto = require("crypto");
const axios = require("axios");
const db = require("../lib/db");
const localStore = require("./gbpImageStore");

const BUCKET = process.env.GBP_POOL_BUCKET || "gbp-pool-images";

// Lazy Supabase client — only built if env is present.
let _supabase = null;
function supabase() {
  if (_supabase) return _supabase;
  const url = process.env.SUPABASE_URL;
  // Prefer service-role key for storage writes; fall back to anon if that's all
  // that's configured (works if bucket policy allows public insert).
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  try {
    const { createClient } = require("@supabase/supabase-js");
    _supabase = createClient(url, key, { auth: { persistSession: false } });
    return _supabase;
  } catch (e) {
    console.warn("[GBP Pool] supabase-js not available: %s", e.message);
    return null;
  }
}

const MIME_EXT = { "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png" };

/**
 * Upload a buffer to the durable pool. Returns { ok, url, storageKey, durable }.
 * durable=false means it fell back to ephemeral local disk.
 */
async function uploadToPool(tenantId, buffer, mime) {
  const ext = MIME_EXT[(mime || "").toLowerCase()];
  if (!ext) return { ok: false, reason: "unsupported_type", message: "Only JPG and PNG supported." };
  if (!Buffer.isBuffer(buffer) || buffer.length < 5 * 1024) return { ok: false, reason: "too_small" };
  if (buffer.length > 10 * 1024 * 1024) return { ok: false, reason: "too_large" };

  const sb = supabase();
  if (sb) {
    const key = `${tenantId}/${Date.now()}-${crypto.randomBytes(6).toString("hex")}.${ext}`;
    try {
      const { error } = await sb.storage.from(BUCKET).upload(key, buffer, {
        contentType: mime,
        upsert: false,
      });
      if (error) throw new Error(error.message);
      const { data } = sb.storage.from(BUCKET).getPublicUrl(key);
      return { ok: true, url: data.publicUrl, storageKey: key, durable: true };
    } catch (e) {
      console.error("[GBP Pool] Supabase upload failed, falling back to local: %s", e.message);
      // fall through to local
    }
  }

  // Fallback: ephemeral local store (works, but not durable across deploys).
  const local = localStore.storeBuffer(buffer, mime);
  if (!local.ok) return local;
  return { ok: true, url: local.url, storageKey: null, durable: false };
}

/**
 * Fetch an image from a URL (e.g. an existing GBP photo) and add it to the
 * durable pool. Returns the same shape as uploadToPool.
 */
async function addFromUrl(tenantId, sourceUrl) {
  if (!sourceUrl || !/^https?:\/\//i.test(sourceUrl)) return { ok: false, reason: "bad_url" };
  let resp;
  try {
    resp = await axios.get(sourceUrl, { responseType: "arraybuffer", timeout: 15000, maxContentLength: 10 * 1024 * 1024 });
  } catch (e) {
    return { ok: false, reason: "fetch_failed", message: e.message };
  }
  const ct = (resp.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
  const mime = MIME_EXT[ct] ? ct : "image/jpeg";
  return uploadToPool(tenantId, Buffer.from(resp.data), mime);
}

/**
 * Insert a pool row after a successful upload.
 */
async function recordPoolImage(tenantId, { imageUrl, storageKey, source = "upload", label = null }) {
  const res = await db.query(
    `INSERT INTO gbp_image_pool (tenant_id, image_url, storage_key, source, label, created_at)
     VALUES ($1, $2, $3, $4, $5, now())
     RETURNING id, image_url, source, label, use_count, created_at`,
    [tenantId, imageUrl, storageKey, source, label]
  );
  return res.rows[0];
}

async function listPool(tenantId) {
  const res = await db.query(
    `SELECT id, image_url, source, label, use_count, last_used_at, created_at
       FROM gbp_image_pool WHERE tenant_id = $1 ORDER BY created_at DESC`,
    [tenantId]
  );
  return res.rows;
}

async function deletePoolImage(tenantId, id) {
  // Look up storage key first so we can remove the actual object.
  const row = await db.query(
    "SELECT storage_key FROM gbp_image_pool WHERE id = $1 AND tenant_id = $2",
    [id, tenantId]
  );
  if (!row.rows[0]) return { ok: false, reason: "not_found" };

  const key = row.rows[0].storage_key;
  if (key) {
    const sb = supabase();
    if (sb) {
      try { await sb.storage.from(BUCKET).remove([key]); }
      catch (e) { console.warn("[GBP Pool] storage remove failed (continuing): %s", e.message); }
    }
  }
  await db.query("DELETE FROM gbp_image_pool WHERE id = $1 AND tenant_id = $2", [id, tenantId]);
  return { ok: true };
}

/**
 * Pick the next image for an auto-post, round-robin.
 * Priority: owner pool (if any) → caller supplies fallbackUrls (existing GBP
 * photos). Advances the cursor on gbp_post_schedule. Returns
 * { url, source } or null if nothing available.
 *
 * fallbackUrls: array of existing GBP photo URLs (from listLocationPhotos),
 * used only when the pool is empty.
 */
async function pickNextImage(tenantId, fallbackUrls = []) {
  const pool = await listPool(tenantId);

  // Read + advance the cursor atomically-ish (last-write-wins is fine here).
  const cur = await db.query(
    "SELECT image_cursor FROM gbp_post_schedule WHERE tenant_id = $1",
    [tenantId]
  );
  let cursor = cur.rows[0]?.image_cursor ?? 0;

  let chosen = null;
  if (pool.length > 0) {
    const idx = cursor % pool.length;
    const row = pool[idx];
    chosen = { url: row.image_url, source: "pool", poolId: row.id };
  } else if (fallbackUrls.length > 0) {
    const idx = cursor % fallbackUrls.length;
    chosen = { url: fallbackUrls[idx], source: "gbp_photo", poolId: null };
  }

  if (!chosen) return null;

  // advance cursor + bump pool use stats
  await db.query(
    "UPDATE gbp_post_schedule SET image_cursor = $2, updated_at = now() WHERE tenant_id = $1",
    [tenantId, cursor + 1]
  );
  if (chosen.poolId) {
    await db.query(
      "UPDATE gbp_image_pool SET use_count = use_count + 1, last_used_at = now() WHERE id = $1",
      [chosen.poolId]
    );
  }
  return chosen;
}

module.exports = {
  uploadToPool,
  addFromUrl,
  recordPoolImage,
  listPool,
  deletePoolImage,
  pickNextImage,
  BUCKET,
};
