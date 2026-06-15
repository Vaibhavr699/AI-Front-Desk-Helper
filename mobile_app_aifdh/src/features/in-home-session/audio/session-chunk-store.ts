import * as FileSystem from "expo-file-system/legacy";

const ROOT = `${FileSystem.documentDirectory}in-home-chunks/`;

export type SessionChunk = {
  seq: number;
  uri: string;
};

function sessionDir(sessionId: string): string {
  return `${ROOT}${sessionId}/`;
}

function chunkUri(sessionId: string, seq: number): string {
  return `${sessionDir(sessionId)}${String(seq).padStart(6, "0")}.m4a`;
}

async function ensureDir(sessionId: string): Promise<void> {
  const dir = sessionDir(sessionId);
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }
}

export async function persistChunk(
  sessionId: string,
  seq: number,
  srcUri: string,
): Promise<string> {
  await ensureDir(sessionId);
  const dest = chunkUri(sessionId, seq);
  await FileSystem.moveAsync({ from: srcUri, to: dest });
  return dest;
}

export async function copyChunk(
  sessionId: string,
  seq: number,
  srcUri: string,
): Promise<{ uri: string; size: number }> {
  await ensureDir(sessionId);
  const dest = chunkUri(sessionId, seq);
  await FileSystem.copyAsync({ from: srcUri, to: dest });
  let size = 0;
  try {
    const info = await FileSystem.getInfoAsync(dest);
    if (info.exists && typeof info.size === "number") size = info.size;
  } catch {}
  return { uri: dest, size };
}

export async function listChunks(sessionId: string): Promise<SessionChunk[]> {
  const dir = sessionDir(sessionId);
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) return [];
  const names = await FileSystem.readDirectoryAsync(dir);
  return names
    .filter((n) => n.endsWith(".m4a"))
    .map((n) => ({ seq: parseInt(n.replace(".m4a", ""), 10), uri: `${dir}${n}` }))
    .filter((c) => Number.isFinite(c.seq))
    .sort((a, b) => a.seq - b.seq);
}

export async function deleteChunk(sessionId: string, seq: number): Promise<void> {
  try {
    await FileSystem.deleteAsync(chunkUri(sessionId, seq), { idempotent: true });
  } catch {}
}

export async function clearSession(sessionId: string): Promise<void> {
  try {
    await FileSystem.deleteAsync(sessionDir(sessionId), { idempotent: true });
  } catch {}
}

export async function listSessionsWithChunks(): Promise<string[]> {
  const info = await FileSystem.getInfoAsync(ROOT);
  if (!info.exists) return [];
  const dirs = await FileSystem.readDirectoryAsync(ROOT);
  const result: string[] = [];
  for (const d of dirs) {
    const chunks = await listChunks(d);
    if (chunks.length > 0) result.push(d);
  }
  return result;
}
