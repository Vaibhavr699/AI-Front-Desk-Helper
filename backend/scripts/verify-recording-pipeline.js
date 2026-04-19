#!/usr/bin/env node
"use strict";

/**
 * Verify Call Recording + Transcription + Storage pipeline.
 * Run: node scripts/verify-recording-pipeline.js
 *
 * Checks:
 * - Env (BASE_URL, OPENAI_API_KEY, optional AWS S3)
 * - Recent calls and recordings in DB (transcript, recording_url, s3_key)
 * - Admin endpoints for transcript (GET /api/calls/:id, GET /api/recordings/:id)
 */

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const db = require("../lib/db");

async function main() {
  console.log("=== Call Recording + Transcription + Storage verification ===\n");

  const baseUrl = process.env.BASE_URL;
  const openai = !!process.env.OPENAI_API_KEY;
  const s3 = !!(
    process.env.AWS_S3_BUCKET_RECORDINGS &&
    process.env.AWS_ACCESS_KEY_ID &&
    process.env.AWS_SECRET_ACCESS_KEY
  );

  console.log("Environment:");
  console.log("  BASE_URL (for Twilio recording-status callback):", baseUrl ? "✓ set" : "✗ NOT SET (recordings/transcription will not run)");
  console.log("  OPENAI_API_KEY (Whisper transcription):", openai ? "✓ set" : "✗ NOT SET");
  console.log("  AWS S3 (recordings bucket):", s3 ? "✓ configured" : "○ optional (skipped)");
  console.log("");

  const conn = process.env.DATABASE_URL || process.env.SUPABASE_DATABASE_URL;
  if (!conn) {
    console.log("DATABASE_URL / SUPABASE_DATABASE_URL: ✗ NOT SET");
    process.exit(1);
  }

  const calls = await db.query(`
    SELECT c.id, c.twilio_call_sid, c.from_number, c.started_at, c.recording_sid,
           (SELECT json_agg(json_build_object(
             'id', r.id, 'twilio_sid', r.twilio_sid, 'status', r.status,
             'has_transcript', (r.transcript IS NOT NULL AND r.transcript != ''),
             'transcript_src', r.transcript_src, 'recording_url', (r.recording_url IS NOT NULL),
             's3_key', r.s3_key, 'duration_sec', r.duration_sec
           )) FROM recordings r WHERE r.call_id = c.id) AS recordings
    FROM calls c
    ORDER BY c.started_at DESC
    LIMIT 10
  `);

  console.log("Last 10 calls (recordings + transcript + storage):");
  if (!calls.rows.length) {
    console.log("  No calls in database. Place a test call to verify the pipeline.");
    process.exit(0);
  }

  for (const row of calls.rows) {
    const recs = row.recordings || [];
    const withTranscript = recs.filter((r) => r.has_transcript).length;
    const withS3 = recs.filter((r) => r.s3_key).length;
    console.log(`  Call ${row.id.slice(0, 8)}... from=${row.from_number || "—"} started=${row.started_at?.toISOString?.()?.slice(0, 19) || "—"}`);
    console.log(`    recordings: ${recs.length}, with transcript: ${withTranscript}, with s3_key: ${withS3}`);
    if (recs.length && !withTranscript && recs[0].status === "completed") {
      console.log(`    → Transcript may still be processing (Whisper runs async). Check again in a minute.`);
    }
  }

  console.log("\nAdmin endpoints (require auth):");
  console.log("  GET /api/calls/:id  → call with recordings[] (each has transcript, recording_url, s3_key)");
  console.log("  GET /api/recordings/:id → single recording (transcript, recording_url, s3_key)");
  console.log("  GET /api/recordings/:id/audio → stream audio (for playback)");
  console.log("\nDashboard: Calls → click a call → Recording + Transcript section.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
