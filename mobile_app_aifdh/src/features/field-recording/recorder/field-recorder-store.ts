import * as FileSystem from "expo-file-system/legacy";

const MARKER_PATH = `${FileSystem.documentDirectory}active-recording.json`;

export type RecorderError = "permission" | "start_failed" | null;

export type RecorderSnapshot = {
  recording: boolean;
  duration: number;
  uri: string | null;
  permissionGranted: boolean;
  error: RecorderError;
  leadId: string | null;
  metering: number;
};

export type OrphanMarker = {
  leadId: string | null;
  startedAt: number;
  uri: string | null;
};

type Controller = {
  start: (leadId: string | null) => Promise<boolean>;
  stop: () => Promise<string | null>;
};

let snapshot: RecorderSnapshot = {
  recording: false,
  duration: 0,
  uri: null,
  permissionGranted: false,
  error: null,
  leadId: null,
  metering: 0,
};

const listeners = new Set<() => void>();
let controller: Controller | null = null;

export function emit(next: Partial<RecorderSnapshot>) {
  snapshot = { ...snapshot, ...next };
  listeners.forEach((l) => l());
}

export function meteringToLevel(db: number): number {
  const clamped = Math.max(-60, Math.min(0, db));
  return (clamped + 60) / 60;
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSnapshot(): RecorderSnapshot {
  return snapshot;
}

export function registerController(c: Controller | null): void {
  controller = c;
}

export async function startRecording(leadId: string | null = null): Promise<boolean> {
  if (!controller) {
    emit({ error: "start_failed" });
    return false;
  }
  return controller.start(leadId);
}

export async function stopRecording(): Promise<string | null> {
  if (!controller) return null;
  return controller.stop();
}

export function clearError(): void {
  emit({ error: null });
}

export async function writeMarker(marker: OrphanMarker): Promise<void> {
  try {
    await FileSystem.writeAsStringAsync(MARKER_PATH, JSON.stringify(marker));
  } catch {}
}

export async function clearMarker(): Promise<void> {
  try {
    await FileSystem.deleteAsync(MARKER_PATH, { idempotent: true });
  } catch {}
}

export async function readOrphanMarker(): Promise<OrphanMarker | null> {
  try {
    const info = await FileSystem.getInfoAsync(MARKER_PATH);
    if (!info.exists) return null;
    const raw = await FileSystem.readAsStringAsync(MARKER_PATH);
    const parsed = JSON.parse(raw) as OrphanMarker;
    if (typeof parsed?.startedAt !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function discardOrphanMarker(): Promise<void> {
  await clearMarker();
}
