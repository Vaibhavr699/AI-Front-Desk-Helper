"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const ffmpegPath = require("ffmpeg-static");
const { listChunkPaths } = require("../lib/inHomeChunkStore");

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, args);
    let stderr = "";
    proc.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-500)}`));
    });
  });
}

async function stitchSession(sessionId) {
  const chunks = listChunkPaths(sessionId);
  if (chunks.length === 0) return null;

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), `stitch-${sessionId}-`));
  const listFile = path.join(workDir, "list.txt");
  const outFile = path.join(workDir, "session.m4a");
  const manifest = chunks.map((c) => `file '${c.replace(/'/g, "'\\''")}'`).join("\n");
  fs.writeFileSync(listFile, manifest + "\n");

  try {
    await runFfmpeg([
      "-y",
      "-f", "concat",
      "-safe", "0",
      "-i", listFile,
      "-c", "copy",
      outFile,
    ]);
    const buffer = fs.readFileSync(outFile);
    return { buffer, chunkCount: chunks.length, workDir };
  } catch (err) {
    try {
      fs.rmSync(workDir, { recursive: true, force: true });
    } catch {}
    throw err;
  }
}

function cleanupWorkDir(workDir) {
  if (!workDir) return;
  try {
    fs.rmSync(workDir, { recursive: true, force: true });
  } catch {}
}

module.exports = { stitchSession, cleanupWorkDir };
