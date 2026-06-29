"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.join(os.tmpdir(), "in-home-session-chunks");

function sessionDir(sessionId) {
  return path.join(ROOT, String(sessionId));
}

function chunkPath(sessionId, seq) {
  const name = String(seq).padStart(6, "0") + ".m4a";
  return path.join(sessionDir(sessionId), name);
}

function ensureDir(sessionId) {
  const dir = sessionDir(sessionId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeChunk(sessionId, seq, buffer) {
  ensureDir(sessionId);
  fs.writeFileSync(chunkPath(sessionId, seq), buffer);
}

function listChunkPaths(sessionId) {
  const dir = sessionDir(sessionId);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((n) => n.endsWith(".m4a"))
    .sort()
    .map((n) => path.join(dir, n));
}

function clearSession(sessionId) {
  const dir = sessionDir(sessionId);
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
}

module.exports = { sessionDir, chunkPath, writeChunk, listChunkPaths, clearSession };
