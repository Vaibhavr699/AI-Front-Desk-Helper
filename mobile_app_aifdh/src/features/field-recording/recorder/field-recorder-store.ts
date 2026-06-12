import { Audio } from "expo-av";
import * as FileSystem from "expo-file-system/legacy";

const MARKER_PATH = `${FileSystem.documentDirectory}active-recording.json`;

const RECORDING_OPTIONS: Audio.RecordingOptions = {
  isMeteringEnabled: false,
  android: {
    extension: ".m4a",
    outputFormat: Audio.AndroidOutputFormat.MPEG_4,
    audioEncoder: Audio.AndroidAudioEncoder.AAC,
    sampleRate: 44100,
    numberOfChannels: 1,
    bitRate: 128000,
  },
  ios: {
    extension: ".m4a",
    outputFormat: Audio.IOSOutputFormat.MPEG4AAC,
    audioQuality: Audio.IOSAudioQuality.HIGH,
    sampleRate: 44100,
    numberOfChannels: 1,
    bitRate: 128000,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: {
    mimeType: "audio/webm",
    bitsPerSecond: 128000,
  },
};

export type RecorderError = "permission" | "start_failed" | null;

export type RecorderSnapshot = {
  recording: boolean;
  duration: number;
  uri: string | null;
  permissionGranted: boolean;
  error: RecorderError;
  leadId: string | null;
};

export type OrphanMarker = {
  leadId: string | null;
  startedAt: number;
  uri: string | null;
};

let snapshot: RecorderSnapshot = {
  recording: false,
  duration: 0,
  uri: null,
  permissionGranted: false,
  error: null,
  leadId: null,
};

const listeners = new Set<() => void>();
let recordingRef: Audio.Recording | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let startTime = 0;

function emit(next: Partial<RecorderSnapshot>) {
  snapshot = { ...snapshot, ...next };
  listeners.forEach((l) => l());
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSnapshot(): RecorderSnapshot {
  return snapshot;
}

export async function ensurePermission(): Promise<boolean> {
  const { granted } = await Audio.requestPermissionsAsync();
  emit({ permissionGranted: granted });
  return granted;
}

async function writeMarker(marker: OrphanMarker): Promise<void> {
  try {
    await FileSystem.writeAsStringAsync(MARKER_PATH, JSON.stringify(marker));
  } catch {}
}

async function clearMarker(): Promise<void> {
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

export async function startRecording(leadId: string | null): Promise<boolean> {
  if (snapshot.recording) return true;
  const granted = snapshot.permissionGranted || (await ensurePermission());
  if (!granted) {
    emit({ error: "permission" });
    return false;
  }
  try {
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
      staysActiveInBackground: true,
    });
    const rec = new Audio.Recording();
    await rec.prepareToRecordAsync(RECORDING_OPTIONS);
    await rec.startAsync();
    recordingRef = rec;
    startTime = Date.now();
    await writeMarker({ leadId, startedAt: startTime, uri: rec.getURI() });
    emit({ recording: true, uri: null, duration: 0, error: null, leadId });
    timer = setInterval(() => {
      emit({ duration: Math.floor((Date.now() - startTime) / 1000) });
    }, 1000);
    return true;
  } catch (err) {
    console.warn("[fieldRecorder] start failed:", err);
    recordingRef = null;
    emit({ recording: false, error: "start_failed" });
    return false;
  }
}

export async function stopRecording(): Promise<string | null> {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  const rec = recordingRef;
  recordingRef = null;
  if (!rec) {
    emit({ recording: false });
    await clearMarker();
    return null;
  }
  let fileUri: string | null = null;
  try {
    await rec.stopAndUnloadAsync();
    fileUri = rec.getURI();
  } catch (err) {
    console.warn("[fieldRecorder] stop threw, attempting getURI:", err);
    try {
      fileUri = rec.getURI();
    } catch {}
  }
  emit({
    recording: false,
    uri: fileUri,
    duration: Math.floor((Date.now() - startTime) / 1000),
  });
  await clearMarker();
  return fileUri;
}

export function clearError(): void {
  emit({ error: null });
}
