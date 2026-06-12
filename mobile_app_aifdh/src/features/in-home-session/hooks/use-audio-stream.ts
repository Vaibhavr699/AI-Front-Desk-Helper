import { Audio } from "expo-av";
import { useCallback, useEffect, useRef, useState } from "react";

import type { InHomeWsClient } from "../ws-client";

// .m4a/AAC — a complete compressed file per chunk, which Whisper transcribes
// directly. (Android expo-av can't emit raw PCM, so we record compressed and
// transcribe each chunk via Whisper batch on the backend.)
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

export function useAudioStream(wsClient: InHomeWsClient | null) {
  const [streaming, setStreaming] = useState(false);
  const [permissionGranted, setPermissionGranted] = useState(false);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const chunkTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activeRef = useRef(false); // synchronous guard against double-start
  const busyRef = useRef(false); // synchronous guard against overlapping chunk swaps

  useEffect(() => {
    Audio.requestPermissionsAsync().then(({ granted }) => {
      setPermissionGranted(granted);
    });
  }, []);

  const startStreaming = useCallback(async () => {
    if (!permissionGranted || !wsClient) return;
    if (activeRef.current) return; // already streaming/starting — bail synchronously
    activeRef.current = true;

    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
      });
      const { recording } = await Audio.Recording.createAsync(RECORDING_OPTIONS);
      recordingRef.current = recording;
      setStreaming(true);
    } catch (err) {
      console.warn("[useAudioStream] start failed:", err);
      activeRef.current = false;
      return;
    }

    chunkTimerRef.current = setInterval(async () => {
      if (busyRef.current || !recordingRef.current || !wsClient) return;
      busyRef.current = true;
      const current = recordingRef.current;
      try {
        await current.stopAndUnloadAsync();
        const uri = current.getURI();
        if (uri) {
          const response = await fetch(uri);
          const blob = await response.blob();
          const reader = new FileReader();
          reader.onloadend = () => {
            if (reader.result instanceof ArrayBuffer) {
              wsClient.sendBinary(reader.result);
            }
          };
          reader.readAsArrayBuffer(blob);
        }
        // Start the next chunk only after the previous fully unloaded.
        if (activeRef.current) {
          const { recording } = await Audio.Recording.createAsync(RECORDING_OPTIONS);
          recordingRef.current = recording;
        }
      } catch (err) {
        console.warn("[useAudioStream] chunk error:", err);
      } finally {
        busyRef.current = false;
      }
    }, CHUNK_INTERVAL_MS);
  }, [permissionGranted, wsClient]);

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
        }
      } catch {}
    }
    busyRef.current = false;
    setStreaming(false);
  }, []);

  useEffect(() => {
    return () => {
      stopStreaming();
    };
  }, [stopStreaming]);

  return { streaming, permissionGranted, startStreaming, stopStreaming };
}
