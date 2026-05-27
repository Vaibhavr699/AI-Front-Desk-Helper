"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const OpenAI = require("openai");

let _s3 = null;
function getS3() {
  if (_s3) return _s3;
  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) return null;
  _s3 = new S3Client({
    region: process.env.AWS_REGION || "us-east-1",
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });
  return _s3;
}

let _openai = null;
function getOpenAI() {
  if (_openai) return _openai;
  _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

async function uploadToS3(tenantId, conversationId, buffer, extension) {
  const s3 = getS3();
  const bucket = process.env.AWS_S3_BUCKET_RECORDINGS;
  if (!s3 || !bucket) return null;
  const key = `field-recordings/${tenantId}/${conversationId}.${extension}`;
  await s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: buffer,
    ContentType: extension === "m4a" ? "audio/mp4" : "audio/wav",
  }));
  return key;
}

async function transcribeBuffer(buffer, extension) {
  const openai = getOpenAI();
  const tmpFile = path.join(os.tmpdir(), `field-rec-${Date.now()}.${extension}`);
  fs.writeFileSync(tmpFile, buffer);
  try {
    const resp = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tmpFile),
      model: "whisper-1",
      response_format: "verbose_json",
      timestamp_granularities: ["segment"],
    });
    const segments = (resp.segments || []).map((s) => ({
      speaker: "unknown",
      text: s.text.trim(),
      at: new Date(Date.now() - ((resp.duration || 0) - s.start) * 1000).toISOString(),
      start: s.start,
      end: s.end,
    }));
    return { text: resp.text, segments, duration: Math.round(resp.duration || 0) };
  } finally {
    try { fs.unlinkSync(tmpFile); } catch {}
  }
}

module.exports = { uploadToS3, transcribeBuffer };
