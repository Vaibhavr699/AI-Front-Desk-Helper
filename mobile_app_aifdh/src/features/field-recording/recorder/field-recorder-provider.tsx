import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
  type RecordingOptions,
} from "expo-audio";
import { useCallback, useEffect, useRef } from "react";

import {
  clearMarker,
  emit,
  meteringToLevel,
  registerController,
  writeMarker,
} from "./field-recorder-store";

const RECORDING_OPTIONS: RecordingOptions = {
  ...RecordingPresets.HIGH_QUALITY,
  isMeteringEnabled: true,
  sampleRate: 22050,
  numberOfChannels: 1,
  bitRate: 64000,
};

export function FieldRecorderProvider({ children }: { children: React.ReactNode }) {
  const recorder = useAudioRecorder(RECORDING_OPTIONS);
  const state = useAudioRecorderState(recorder, 250);
  const leadIdRef = useRef<string | null>(null);
  const startedAtRef = useRef(0);

  useEffect(() => {
    AudioModule.requestRecordingPermissionsAsync()
      .then((res) => emit({ permissionGranted: !!res.granted }))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!state) return;
    const patch: Record<string, unknown> = {
      recording: state.isRecording,
    };
    if (typeof state.durationMillis === "number") {
      patch.duration = Math.floor(state.durationMillis / 1000);
    }
    if (typeof state.metering === "number") {
      patch.metering = state.isRecording ? meteringToLevel(state.metering) : 0;
    }
    if (state.isRecording && state.mediaServicesDidReset) {
      patch.error = "start_failed";
    }
    emit(patch);
  }, [state]);

  const start = useCallback(
    async (leadId: string | null): Promise<boolean> => {
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      if (!perm.granted) {
        emit({ error: "permission", permissionGranted: false });
        return false;
      }
      emit({ permissionGranted: true });
      try {
        await setAudioModeAsync({
          playsInSilentMode: true,
          allowsRecording: true,
          shouldPlayInBackground: true,
        });
        await recorder.prepareToRecordAsync(RECORDING_OPTIONS);
        recorder.record();
        leadIdRef.current = leadId;
        startedAtRef.current = Date.now();
        await writeMarker({ leadId, startedAt: startedAtRef.current, uri: recorder.uri });
        emit({ recording: true, uri: null, duration: 0, error: null, leadId, metering: 0 });
        return true;
      } catch (err) {
        console.warn("[fieldRecorder] start failed:", err);
        emit({ recording: false, error: "start_failed" });
        return false;
      }
    },
    [recorder],
  );

  const stop = useCallback(async (): Promise<string | null> => {
    let uri: string | null = null;
    try {
      await recorder.stop();
      uri = recorder.uri;
    } catch (err) {
      console.warn("[fieldRecorder] stop threw, reading uri:", err);
      uri = recorder.uri;
    }
    emit({ recording: false, uri, metering: 0 });
    await clearMarker();
    return uri;
  }, [recorder]);

  useEffect(() => {
    registerController({ start, stop });
    return () => registerController(null);
  }, [start, stop]);

  return <>{children}</>;
}
