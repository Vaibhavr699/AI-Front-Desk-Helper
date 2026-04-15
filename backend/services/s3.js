"use strict";

const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const db = require("../lib/db");
const twilio = require("../lib/twilio");

let bucket = process.env.AWS_S3_BUCKET_RECORDINGS;
let region = process.env.AWS_REGION || "us-east-1";

// Sanitize bucket name & detect region: 
// if it's a URL like https://bucket-name.s3.region.amazonaws.com, extract both
if (bucket && (bucket.startsWith("http://") || bucket.startsWith("https://"))) {
  try {
    const url = new URL(bucket);
    const hostParts = url.hostname.split('.');
    
    // Pattern 1: [bucket, s3, region, amazonaws, com]
    // Pattern 2: [bucket, s3-external-*, amazonaws, com]
    // Pattern 3: [bucket, s3, amazonaws, com] (default us-east-1)
    
    bucket = hostParts[0];
    if (hostParts.length >= 4 && hostParts[1].startsWith("s3")) {
      // If it's bucket.s3.region.amazonaws.com, region is segment 2
      if (hostParts[2] !== "amazonaws") {
        region = hostParts[2];
      }
    }
    console.log("[S3] Auto-detected bucket=%s region=%s", bucket, region);
  } catch (e) {
    console.error("[S3] Failed to parse bucket URL:", e.message);
  }
}

let client = null;
function getClient() {
  if (client) return client;
  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) return null;

  client = new S3Client({
    region,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    }
  });
  console.log("[S3] Initialized client for region=%s bucket=%s", region, bucket);
  return client;
}

async function uploadRecordingToS3(tenantId, recordingSid) {
  const s3 = getClient();
  if (!s3 || !bucket) return;
  const rec = await db.query(
    "SELECT id FROM recordings WHERE twilio_sid = $1",
    [recordingSid]
  ).then((r) => r.rows[0]);
  if (!rec) return;

  const tenant = await db.query(
    "SELECT id, twilio_account_sid, twilio_auth_token FROM tenants WHERE id = $1",
    [tenantId]
  ).then((r) => r.rows[0]);
  const authInfo = twilio.getAuthForTenant(tenant);
  if (!authInfo) return;
  // Fetch MP3 from Twilio (same as transcription: .json meta then .mp3 URL with Basic auth)
  const auth = Buffer.from(`${authInfo.accountSid}:${authInfo.authToken}`).toString("base64");
  const metaUrl = `https://api.twilio.com/2010-04-01/Accounts/${authInfo.accountSid}/Recordings/${recordingSid}.json`;
  const metaResp = await fetch(metaUrl, { headers: { Authorization: `Basic ${auth}` } });
  if (!metaResp.ok) throw new Error("Fetch recording meta failed");
  const meta = await metaResp.json();
  let mp3Url = (meta.uri || "").replace(".json", ".mp3");
  if (mp3Url && !mp3Url.startsWith("http")) mp3Url = `https://api.twilio.com${mp3Url}`;
  const resp = await fetch(mp3Url, { headers: { Authorization: `Basic ${auth}` } });
  if (!resp.ok) throw new Error("Fetch recording failed");
  const body = await resp.arrayBuffer();
  const key = `recordings/${tenantId}/${recordingSid}.mp3`;
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: Buffer.from(body),
      ContentType: "audio/mpeg",
    })
  );
  await db.query(
    "UPDATE recordings SET s3_key = $1, updated_at = now() WHERE id = $2",
    [key, rec.id]
  );
}

module.exports = { uploadRecordingToS3 };
