import * as Network from "expo-network";
import { AppState, type AppStateStatus } from "react-native";

import { uploadFieldRecording } from "../api";
import {
  listPending,
  resetStuckUploading,
  updatePendingStatus,
} from "./queue-db";
import { removePending } from "./recording-queue";
import type { PendingRecording } from "./types";

const INTERVAL_MS = 30_000;
const MAX_AUTO_ATTEMPTS = 8;

type Snapshot = {
  pending: PendingRecording[];
  syncing: boolean;
};

let snapshot: Snapshot = { pending: [], syncing: false };
const listeners = new Set<() => void>();

let initialized = false;
let flushing = false;
let intervalId: ReturnType<typeof setInterval> | null = null;

function emit(next: Partial<Snapshot>) {
  snapshot = { ...snapshot, ...next };
  listeners.forEach((l) => l());
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSnapshot(): Snapshot {
  return snapshot;
}

async function refresh(): Promise<PendingRecording[]> {
  const pending = await listPending();
  emit({ pending });
  return pending;
}

async function isOnline(): Promise<boolean> {
  try {
    const state = await Network.getNetworkStateAsync();
    if (state.isConnected === false) return false;
    if (state.isInternetReachable === false) return false;
    return true;
  } catch {
    return true;
  }
}

export async function flush(): Promise<void> {
  if (flushing) return;
  flushing = true;
  emit({ syncing: true });
  try {
    if (!(await isOnline())) return;

    const queue = await listPending();
    for (const rec of queue) {
      if (rec.status === "uploading") continue;
      if (rec.status === "failed" && rec.attempts >= MAX_AUTO_ATTEMPTS) continue;
      if (!(await isOnline())) break;

      await updatePendingStatus(rec.id, "uploading");
      await refresh();
      try {
        await uploadFieldRecording(rec.file_uri, {
          lead_id: rec.lead_id,
          consent_status: rec.consent_status,
          consent_method: rec.consent_method,
          consent_state: rec.consent_state,
          duration_seconds: rec.duration_seconds,
        });
        await removePending(rec);
      } catch (err) {
        await updatePendingStatus(rec.id, "failed", {
          attempts: rec.attempts + 1,
          lastError: err instanceof Error ? err.message : "Upload failed",
        });
      }
      await refresh();
    }
  } finally {
    flushing = false;
    emit({ syncing: false });
  }
}

export function triggerSync(): void {
  void flush();
}

export async function retry(id: string): Promise<void> {
  await updatePendingStatus(id, "pending");
  await refresh();
  triggerSync();
}

export async function discard(rec: PendingRecording): Promise<void> {
  await removePending(rec);
  await refresh();
}

function handleAppStateChange(state: AppStateStatus) {
  if (state === "active") triggerSync();
}

export async function initSyncManager(): Promise<void> {
  if (initialized) return;
  initialized = true;

  await resetStuckUploading();
  await refresh();

  AppState.addEventListener("change", handleAppStateChange);

  intervalId = setInterval(() => {
    if (snapshot.pending.length > 0) triggerSync();
  }, INTERVAL_MS);

  triggerSync();
}

export function stopSyncManager(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}
