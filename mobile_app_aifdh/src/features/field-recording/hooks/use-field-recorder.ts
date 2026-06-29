import { useCallback } from "react";
import { Linking } from "react-native";
import { useSyncExternalStore } from "react";

import {
  clearError,
  getSnapshot,
  startRecording as startRecordingStore,
  stopRecording as stopRecordingStore,
  subscribe,
} from "../recorder/field-recorder-store";

export function useFieldRecorder() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const startRecording = useCallback(
    (leadId: string | null = null) => startRecordingStore(leadId),
    [],
  );

  const stopRecording = useCallback(() => stopRecordingStore(), []);

  const openSettings = useCallback(() => {
    Linking.openSettings().catch(() => {});
  }, []);

  return {
    recording: snapshot.recording,
    duration: snapshot.duration,
    uri: snapshot.uri,
    permissionGranted: snapshot.permissionGranted,
    error: snapshot.error,
    metering: snapshot.metering,
    startRecording,
    stopRecording,
    clearError,
    openSettings,
  };
}
