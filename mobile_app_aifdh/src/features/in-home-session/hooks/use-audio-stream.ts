import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
  type RecordingOptions,
} from "expo-audio";
import * as FileSystem from "expo-file-system/legacy";
import { useCallback, useEffect, useRef, useState } from "react";
import { Vibration } from "react-native";

import { uploadSessionChunk } from "../api";
import { clearSession, copyChunk, listChunks } from "../audio/session-chunk-store";
import type { InHomeWsClient } from "../ws-client";

const MIN_CHUNK_BYTES = 2000;

const RECORDING_OPTIONS: RecordingOptions = {
  ...RecordingPresets.HIGH_QUALITY,
  isMeteringEnabled: false,
  sampleRate: 22050,
  numberOfChannels: 1,
  bitRate: 64000,
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
  const recorder = useAudioRecorder(RECORDING_OPTIONS);
  const [streaming, setStreaming] = useState(false);
  const [permissionGranted, setPermissionGranted] = useState(false);
  const [error, setError] = useState(false);
  const chunkTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activeRef = useRef(false);
  const busyRef = useRef(false);
  const seqRef = useRef(0);
  const failuresRef = useRef(0);
  const ackedRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    AudioModule.requestRecordingPermissionsAsync()
      .then((res) => setPermissionGranted(!!res.granted))
      .catch(() => {});
  }, []);

  const beginSegment = useCallback(async (): Promise<boolean> => {
    try {
      await recorder.prepareToRecordAsync(RECORDING_OPTIONS);
      recorder.record();
      failuresRef.current = 0;
      return true;
    } catch (err) {
      console.warn("[useAudioStream] segment start failed:", err);
      failuresRef.current += 1;
      if (failuresRef.current >= MAX_RESTART_ATTEMPTS) {
        setError(true);
        setStreaming(false);
        Vibration.vibrate([0, 200, 100, 200]);
      }
      return false;
    }
  }, [recorder]);

  const startStreaming = useCallback(async () => {
    if (!permissionGranted || !wsClient) return;
    if (activeRef.current) return;
    activeRef.current = true;
    setError(false);
    failuresRef.current = 0;
    seqRef.current = 0;
    ackedRef.current = new Set();

    try {
      await setAudioModeAsync({
        playsInSilentMode: true,
        allowsRecording: true,
        shouldPlayInBackground: true,
      });
    } catch (err) {
      console.warn("[useAudioStream] audio mode failed:", err);
    }

    const ok = await beginSegment();
    if (!ok) {
      activeRef.current = false;
      return;
    }
    setStreaming(true);

    chunkTimerRef.current = setInterval(async () => {
      if (busyRef.current || !activeRef.current) return;
      busyRef.current = true;
      const seq = seqRef.current++;
      try {
        await recorder.stop();
        const uri = recorder.uri;
        if (uri) {
          // Copy (not move) so the recorder keeps its own file intact for the
          // next segment, then verify the chunk actually has audio before
          // sending — empty/tiny chunks would be silently dropped server-side.
          const { uri: stored, size } = await copyChunk(sessionId, seq, uri);
          console.log(`[useAudioStream] chunk seq=${seq} bytes=${size}`);
          if (size >= MIN_CHUNK_BYTES && wsClient) {
            const b64 = await FileSystem.readAsStringAsync(stored, {
              encoding: FileSystem.EncodingType.Base64,
            });
            const body = decodeBase64(b64);
            wsClient.sendBinary(prefixSeq(seq, body));
          } else if (size < MIN_CHUNK_BYTES) {
            console.warn(`[useAudioStream] chunk seq=${seq} too small (${size}b), skipped`);
          }
        } else {
          console.warn(`[useAudioStream] chunk seq=${seq} had no uri after stop`);
        }
        if (activeRef.current) {
          await beginSegment();
        }
      } catch (err) {
        console.warn("[useAudioStream] chunk error:", err);
        if (activeRef.current) {
          await beginSegment();
        }
      } finally {
        busyRef.current = false;
      }
    }, CHUNK_INTERVAL_MS);
  }, [permissionGranted, wsClient, sessionId, beginSegment, recorder]);

  const stopStreaming = useCallback(async () => {
    activeRef.current = false;
    if (chunkTimerRef.current) {
      clearInterval(chunkTimerRef.current);
      chunkTimerRef.current = null;
    }
    try {
      if (recorder.isRecording) {
        await recorder.stop();
        const uri = recorder.uri;
        if (uri) {
          const seq = seqRef.current++;
          await copyChunk(sessionId, seq, uri);
        }
      }
    } catch {}
    busyRef.current = false;
    setStreaming(false);
  }, [sessionId, recorder]);

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
