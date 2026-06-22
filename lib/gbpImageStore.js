"use strict";

/**
 * lib/gbpImageStore.js
 *
 * Image hosting for GBP posts.
 *
 * Google's localPosts API requires a post's image to be referenced by a
 * PUBLIC HTTPS URL (media.sourceUrl) — you cannot inline-upload bytes in the
 * post-create call. So every post image, whether the owner uploaded it or
 * picked an existing GBP photo, must live at a stable public URL we control.
 *
 * Both paths converge here:
 *   - storeBuffer(buf, mime)  → owner uploaded a file
 *   - storeFromUrl(url)       → owner picked an existing GBP photo (we fetch
 *                               its bytes and re-host, because Google's own
 *                               googleUrl values are not reliable as a post
 *                               sourceUrl).
 *
 * ── Storage location ───────────────────────────────────────────────────────
 * Files are written to GBP_MEDIA_DIR (default ./gbp-media) and served by
 * server.js at:  app.use("/gbp-media", express.static(GBP_MEDIA_DIR))
 * The public URL is `${PUBLIC_BACKEND_URL}/gbp-media/<file>`.
 *
 * NOTE ON DURABILITY: Render's default filesystem is EPHEMERAL — files vanish
 * on deploy/restart. For a PUBLISHED post this is fine (Google copies the
 * image into its own storage at publish time and never re-fetches our URL).
 * For a DRAFT image waiting on approval, a deploy in between would lose it.
 * To make draft images durable, mount a Render Disk and point GBP_MEDIA_DIR
 * at it — no code change required. Until then, generate→approve in one sitting.
 */

const fs   = require("fs");
const path = require("path");
const crypto = require("crypto");
const axios = require("axios");

const MEDIA_DIR = process.env.GBP_MEDIA_DIR || path.join(__dirname, "..", "gbp-media");
const PUBLIC_BASE = (process.env.PUBLIC_BACKEND_URL || "https://ai-front-desk-backend.onrender.com").replace(/\/+$/, "");

// Google localPosts accepts JPG/PNG. Map mime → extension; reject others.
const MIME_EXT = {
  "image/jpeg": "jpg",
  "image/jpg":  "jpg",
  "image/png":  "png",
};

// Google's recommended minimum is 250x250 / 10KB+. We can't cheaply check
// dimensions without an image lib, so we enforce a sane byte floor/ceiling:
// > 5KB (rejects empty/broken) and < 10MB (Google's hard cap is large but
// huge files slow the post create + our re-host).
const MIN_BYTES = 5 * 1024;
const MAX_BYTES = 10 * 1024 * 1024;

function ensureDir() {
  try {
    fs.mkdirSync(MEDIA_DIR, { recursive: true });
  } catch (e) {
    // mkdir -p semantics; ignore EEXIST
    if (e.code !== "EEXIST") throw e;
  }
}

function publicUrlFor(filename) {
  return `${PUBLIC_BASE}/gbp-media/${filename}`;
}

/**
 * Persist a raw image buffer. Returns { ok, url, filename } or { ok:false, reason }.
 */
function storeBuffer(buffer, mime) {
  if (!Buffer.isBuffer(buffer)) return { ok: false, reason: "not_a_buffer" };
  const ext = MIME_EXT[(mime || "").toLowerCase()];
  if (!ext) return { ok: false, reason: "unsupported_type", message: "Only JPG and PNG are supported." };
  if (buffer.length < MIN_BYTES) return { ok: false, reason: "too_small", message: "Image is too small or empty." };
  if (buffer.length > MAX_BYTES) return { ok: false, reason: "too_large", message: "Image exceeds 10MB." };

  ensureDir();
  const filename = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}.${ext}`;
  const fullPath = path.join(MEDIA_DIR, filename);
  fs.writeFileSync(fullPath, buffer);
  return { ok: true, url: publicUrlFor(filename), filename };
}

/**
 * Fetch an image from a (Google) URL and re-host it. Used by the
 * pick-existing-photo path. Returns { ok, url, filename } or { ok:false }.
 */
async function storeFromUrl(sourceUrl) {
  if (!sourceUrl || !/^https?:\/\//i.test(sourceUrl)) {
    return { ok: false, reason: "bad_url" };
  }
  let resp;
  try {
    resp = await axios.get(sourceUrl, { responseType: "arraybuffer", timeout: 15000, maxContentLength: MAX_BYTES });
  } catch (e) {
    return { ok: false, reason: "fetch_failed", message: e.message };
  }
  const contentType = (resp.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
  // Some Google photo URLs serve generic content-type; default to jpg if it's an image.
  const mime = MIME_EXT[contentType] ? contentType : "image/jpeg";
  return storeBuffer(Buffer.from(resp.data), mime);
}

module.exports = {
  storeBuffer,
  storeFromUrl,
  MEDIA_DIR,
  publicUrlFor,
};
