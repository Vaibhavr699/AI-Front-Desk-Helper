"use strict";

/**
 * routes/voicemailGreeting.js  (Phase 3A, Jun 2026)
 *
 * Lets a tenant record their outgoing voicemail greeting in-browser and host
 * it, so the "Audio URL" field on the AI-Control tab can be populated without
 * the owner needing their own CDN.
 *
 * Flow:
 *   1. Frontend (VoicemailGreetingRecorder.jsx) records mic audio and encodes
 *      it to 16-bit PCM WAV client-side (Twilio <Play>-compatible — no server
 *      transcode, no ffmpeg).
 *   2. It POSTs the raw WAV bytes here.
 *   3. We validate + upload to the Supabase Storage bucket 'voicemail-greetings'
 *      (public) using SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (same env the
 *      image pool already uses).
 *   4. We return the public URL. The frontend drops it into the existing
 *      voicemail_message_url field; the tenant's normal Save persists it.
 *
 * This route deliberately does NOT write to the tenant row — persistence stays
 * on the existing updateTenant allowlist path so there's one save surface.
 *
 * MOUNT (in server.js, alongside the other authenticated /api routers):
 *   const voicemailGreetingRouter = require("./routes/voicemailGreeting");
 *   app.use("/api/voicemail-greeting", <yourAuthMiddleware>, voicemailGreetingRouter);
 * Use the SAME auth middleware that guards /api/tenants so only a logged-in
 * tenant can upload. The handler also requires a tenantId and that it match the
 * authenticated tenant when req.tenant is present.
 */

const express = require("express");

const router = express.Router();

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "";
const BUCKET = "voicemail-greetings";

// ~5MB cap. 16kHz mono 16-bit PCM is ~32KB/sec, so 5MB ≈ 2.7 min — plenty for
// a greeting, and a hard stop against a runaway upload.
const MAX_BYTES = 5 * 1024 * 1024;

// Accept the raw WAV body for this router only. express.raw buffers req.body
// into a Buffer when the content-type matches. We allow audio/wav + audio/wave
// + the octet-stream fallback some browsers send.
router.use(
  express.raw({
    type: ["audio/wav", "audio/wave", "audio/x-wav", "application/octet-stream"],
    limit: MAX_BYTES,
  })
);

function isLikelyWav(buf) {
  // RIFF....WAVE header check — first 4 bytes "RIFF", bytes 8-11 "WAVE".
  if (!Buffer.isBuffer(buf) || buf.length < 44) return false;
  return (
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WAVE"
  );
}

/**
 * POST /api/voicemail-greeting/upload?tenantId=...
 * Body: raw WAV bytes (audio/wav).
 * Returns: { ok: true, url } | { ok:false, error }
 */
router.post("/upload", async (req, res) => {
  try {
    const tenantId = String(req.query.tenantId || req.body?.tenantId || "").trim();
    if (!tenantId) {
      return res.status(400).json({ ok: false, error: "Missing tenantId." });
    }

    // If the auth middleware attached a tenant, make sure the caller isn't
    // uploading on behalf of someone else.
    const authedTenantId =
      req.tenant?.id || req.tenantId || req.user?.tenant_id || null;
    if (authedTenantId && String(authedTenantId) !== tenantId) {
      return res.status(403).json({ ok: false, error: "Tenant mismatch." });
    }

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      console.error("[VM Greeting] Missing SUPABASE_URL / SERVICE_ROLE_KEY env");
      return res.status(500).json({ ok: false, error: "Storage not configured." });
    }

    const audio = req.body;
    if (!Buffer.isBuffer(audio) || audio.length === 0) {
      return res.status(400).json({
        ok: false,
        error: "No audio received. Record a greeting and try again.",
      });
    }
    if (audio.length > MAX_BYTES) {
      return res.status(413).json({
        ok: false,
        error: "Recording too long. Keep it under about 2 minutes.",
      });
    }
    if (!isLikelyWav(audio)) {
      return res.status(400).json({
        ok: false,
        error: "Audio must be a WAV file.",
      });
    }

    // Deterministic-ish path: one greeting per tenant, timestamped so a re-record
    // busts any CDN cache (Twilio fetches by URL; a new URL guarantees fresh audio).
    const objectPath = `${tenantId}/greeting-${Date.now()}.wav`;
    const uploadUrl = `${SUPABASE_URL.replace(/\/+$/, "")}/storage/v1/object/${BUCKET}/${objectPath}`;

    const resp = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        "Content-Type": "audio/wav",
        "x-upsert": "true",
        "cache-control": "public, max-age=31536000",
      },
      body: audio,
    });

    if (!resp.ok) {
      const detail = await resp.text().catch(() => "");
      console.error(
        "[VM Greeting] Supabase upload failed status=%s detail=%s tenant=%s",
        resp.status, detail.slice(0, 300), tenantId
      );
      // Most common cause: the bucket doesn't exist yet.
      if (resp.status === 400 && /bucket/i.test(detail)) {
        return res.status(500).json({
          ok: false,
          error: "Storage bucket not found. Ask support to create the voicemail-greetings bucket.",
        });
      }
      return res.status(502).json({ ok: false, error: "Upload failed. Try again." });
    }

    const publicUrl = `${SUPABASE_URL.replace(/\/+$/, "")}/storage/v1/object/public/${BUCKET}/${objectPath}`;
    console.log("[VM Greeting] uploaded tenant=%s bytes=%d url=%s", tenantId, audio.length, publicUrl);

    return res.json({ ok: true, url: publicUrl });
  } catch (err) {
    console.error("[VM Greeting] upload error:", err.message);
    return res.status(500).json({ ok: false, error: "Unexpected error. Try again." });
  }
});

module.exports = router;
