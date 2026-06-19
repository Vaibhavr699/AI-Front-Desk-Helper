"use strict";

const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const bucket = process.env.AWS_S3_BUCKET_RECORDINGS;
const region = process.env.AWS_REGION || "us-east-1";

let client = null;
function getS3() {
  if (client) return client;
  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) return null;
  client = new S3Client({
    region,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });
  return client;
}

const CONTENT_TYPES = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
};

function extensionFor(mimetype) {
  if (mimetype === "image/png") return "png";
  if (mimetype === "image/webp") return "webp";
  if (mimetype === "image/heic" || mimetype === "image/heif") return "heic";
  return "jpg";
}

async function uploadAvatarToS3(userId, buffer, mimetype) {
  const s3 = getS3();
  if (!s3 || !bucket) return null;
  const ext = extensionFor(mimetype);
  const key = `avatars/${userId}.${ext}`;
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: CONTENT_TYPES[ext] || "image/jpeg",
      CacheControl: "private, max-age=0",
    }),
  );
  return key;
}

async function avatarSignedUrl(s3Key, expiresInSeconds = 3600) {
  if (!s3Key) return null;
  const s3 = getS3();
  if (!s3 || !bucket) return null;
  const command = new GetObjectCommand({ Bucket: bucket, Key: s3Key });
  return getSignedUrl(s3, command, { expiresIn: expiresInSeconds });
}

function isConfigured() {
  return Boolean(getS3() && bucket);
}

module.exports = { uploadAvatarToS3, avatarSignedUrl, isConfigured };
