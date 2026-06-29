import * as FileSystem from "expo-file-system/legacy";
import * as Network from "expo-network";
import { AppState, type AppStateStatus } from "react-native";

import { endInHomeSession } from "./api";

const QUEUE_PATH = `${FileSystem.documentDirectory}pending-session-ends.json`;

type PendingEnd = {
  sessionId: string;
  outcome: string;
  queuedAt: number;
  discProgression?: unknown;
};

let flushing = false;
let initialized = false;

async function readQueue(): Promise<PendingEnd[]> {
  try {
    const info = await FileSystem.getInfoAsync(QUEUE_PATH);
    if (!info.exists) return [];
    const raw = await FileSystem.readAsStringAsync(QUEUE_PATH);
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeQueue(items: PendingEnd[]): Promise<void> {
  try {
    await FileSystem.writeAsStringAsync(QUEUE_PATH, JSON.stringify(items));
  } catch {}
}

export async function queueSessionEnd(
  sessionId: string,
  outcome: string,
  discProgression?: unknown,
): Promise<void> {
  const items = await readQueue();
  if (items.some((i) => i.sessionId === sessionId)) return;
  items.push({ sessionId, outcome, queuedAt: Date.now(), discProgression });
  await writeQueue(items);
}

async function isOnline(): Promise<boolean> {
  try {
    const state = await Network.getNetworkStateAsync();
    return !!state.isConnected && state.isInternetReachable !== false;
  } catch {
    return true;
  }
}

export async function flushSessionEnds(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    let items = await readQueue();
    if (items.length === 0) return;
    if (!(await isOnline())) return;

    const remaining: PendingEnd[] = [];
    for (const item of items) {
      try {
        await endInHomeSession(item.sessionId, {
          outcome: item.outcome,
          disc_progression: item.discProgression,
        });
      } catch {
        remaining.push(item);
      }
    }
    await writeQueue(remaining);
  } finally {
    flushing = false;
  }
}

export function initSessionEndQueue(): void {
  if (initialized) return;
  initialized = true;
  flushSessionEnds();
  AppState.addEventListener("change", (s: AppStateStatus) => {
    if (s === "active") flushSessionEnds();
  });
}
