import { Audio } from "expo-av";
import * as FileSystem from "expo-file-system/legacy";
import { useCallback, useEffect, useRef, useState } from "react";
import { Vibration } from "react-native";

import { uploadSessionChunk } from "../api";
import { clearSession, listChunks, persistChunk } from "../audio/session-chunk-store";
import type { InHomeWsClient } from "../ws-client";

const RECORDING_OPTIONS: Audio.RecordingOptions = {
  isMeteringEnabled: false,
  android: {
    extension: ".m4a",
    outputFormat: Audio.AndroidOutputFormat.MPEG_4,
    audioEncoder: Audio.AndroidAudioEncoder.AAC,
    sampleRate: 44100,
    numberOfChannels: 1,
    bitRate: 96000,
  },
  ios: {
    extension: ".m4a",
    outputFormat: Audio.IOSOutputFormat.MPEG4AAC,
    audioQuality: Audio.IOSAudioQuality.MEDIUM,
    sampleRate: 44100,
    numberOfChannels: 1,
    bitRate: 96000,
  },
  web: {
    mimeType: "audio/webm",
    bitsPerSecond: 96000,
  },
};

const CHUNK_INTERVAL_MS = 4000;
const MAX_RESTART_ATTEMPTS = 3;

function prefixSeq(seq: number, body: ArrayBuffer): ArrayBuffer {
  const out = new Uint8Array(4 + body.byteLength);
  const view = new DataView(out.buffer);
  view.setUint32(0, seq, false);
  out.set(new Uint8Array(body), 4);
  return out.buffer;
}

export type AudioStreamState = {
  streaming: boolean;
  permissionGranted: boolean;
  error: boolean;
  startStreaming: () => Promise<void>;
  stopStreaming: () => Promise<void>;
  markAcked: (seq: number) => void;
  flushUnacked: () => Promise<void>;
};

export function useAudioStream(
  wsClient: InHomeWsClient | null,
  sessionId: string,
): AudioStreamState {
  const [streaming, setStreaming] = useState(false);
  const [permissionGranted, setPermissionGranted] = useState(false);
  const [error, setError] = useState(false);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const chunkTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activeRef = useRef(false);
  const busyRef = useRef(false);
  const seqRef = useRef(0);
  const failuresRef = useRef(0);
  const ackedRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    Audio.requestPermissionsAsync().then(({ granted }) => {
      setPermissionGranted(granted);
    });
  }, []);

  const onRecordingStatus = useCallback((status: Audio.RecordingStatus) => {
    if (!activeRef.current || busyRef.current) return;
    if (status.canRecord && !status.isRecording) {
      console.warn("[useAudioStream] recording stopped unexpectedly (interruption)");
      setError(true);
      setStreaming(false);
      Vibration.vibrate([0, 200, 100, 200]);
    }
  }, []);

  const createRecorder = useCallback(async (): Promise<boolean> => {
    try {
      const { recording } = await Audio.Recording.createAsync(
        RECORDING_OPTIONS,
        onRecordingStatus,
      );
      recordingRef.current = recording;
      failuresRef.current = 0;
      return true;
    } catch (err) {
      console.warn("[useAudioStream] recorder create failed:", err);
      recordingRef.current = null;
      failuresRef.current += 1;
      if (failuresRef.current >= MAX_RESTART_ATTEMPTS) {
        setError(true);
        setStreaming(false);
        Vibration.vibrate([0, 200, 100, 200]);
      }
      return false;
    }
  }, [onRecordingStatus]);

  const startStreaming = useCallback(async () => {
    if (!permissionGranted || !wsClient) return;
    if (activeRef.current) return;
    activeRef.current = true;
    setError(false);
    failuresRef.current = 0;
    seqRef.current = 0;
    ackedRef.current = new Set();

    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
      });
    } catch (err) {
      console.warn("[useAudioStream] audio mode failed:", err);
    }

    const ok = await createRecorder();
    if (!ok) {
      activeRef.current = false;
      return;
    }
    setStreaming(true);

    chunkTimerRef.current = setInterval(async () => {
      if (busyRef.current || !recordingRef.current || !activeRef.current) return;
      busyRef.current = true;
      const current = recordingRef.current;
      const seq = seqRef.current++;
      try {
        await current.stopAndUnloadAsync();
        const uri = current.getURI();
        if (uri) {
          const stored = await persistChunk(sessionId, seq, uri);
          if (wsClient) {
            const b64 = await FileSystem.readAsStringAsync(stored, {
              encoding: FileSystem.EncodingType.Base64,
            });
            const body = decodeBase64(b64);
            wsClient.sendBinary(prefixSeq(seq, body));
          }
        }
        if (activeRef.current) {
          await createRecorder();
        }
      } catch (err) {
        console.warn("[useAudioStream] chunk error:", err);
        if (activeRef.current) {
          await createRecorder();
        }
      } finally {
        busyRef.current = false;
      }
    }, CHUNK_INTERVAL_MS);
  }, [permissionGranted, wsClient, sessionId, createRecorder]);

  const stopStreaming = useCallback(async () => {
    activeRef.current = false;
    if (chunkTimerRef.current) {
      clearInterval(chunkTimerRef.current);
      chunkTimerRef.current = null;
    }
    const current = recordingRef.current;
    recordingRef.current = null;
    if (current) {
      try {
        const status = await current.getStatusAsync();
        if (status.canRecord || status.isRecording) {
          await current.stopAndUnloadAsync();
          const uri = current.getURI();
          if (uri) {
            const seq = seqRef.current++;
            await persistChunk(sessionId, seq, uri);
          }
        }
      } catch {}
    }
    busyRef.current = false;
    setStreaming(false);
  }, [sessionId]);

  const markAcked = useCallback((seq: number) => {
    ackedRef.current.add(seq);
  }, []);

  const flushUnacked = useCallback(async () => {
    let chunks;
    try {
      chunks = await listChunks(sessionId);
    } catch {
      return;
    }
    for (const chunk of chunks) {
      if (ackedRef.current.has(chunk.seq)) continue;
      try {
        await uploadSessionChunk(sessionId, chunk.seq, chunk.uri);
      } catch (err) {
        console.warn("[useAudioStream] gap-fill upload failed seq=%s", chunk.seq, err);
      }
    }
    await clearSession(sessionId);
  }, [sessionId]);

  useEffect(() => {
    return () => {
      stopStreaming();
    };
  }, [stopStreaming]);

  return {
    streaming,
    permissionGranted,
    error,
    startStreaming,
    stopStreaming,
    markAcked,
    flushUnacked,
  };
}

function decodeBase64(b64: string): ArrayBuffer {
  const binary = globalThis.atob(b64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
