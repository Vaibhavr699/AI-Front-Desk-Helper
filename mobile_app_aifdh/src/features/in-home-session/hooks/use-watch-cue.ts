import { useCallback, useEffect, useRef } from "react";
import { NativeEventEmitter, NativeModules, Platform } from "react-native";

import type { CoachingAlert } from "../types";

const { WatchBridge, WearOSBridge } = NativeModules;

export function useWatchCue() {
  const lastSentRef = useRef<string | null>(null);

  useEffect(() => {
    if (Platform.OS === "ios" && WatchBridge?.activateSession) {
      WatchBridge.activateSession();
    }
    if (Platform.OS === "android" && WearOSBridge?.connect) {
      WearOSBridge.connect();
    }
  }, []);

  const sendCueToWatch = useCallback((cue: CoachingAlert) => {
    if (lastSentRef.current === cue.id) return;
    lastSentRef.current = cue.id;

    const payload = {
      label: cue.watch_label || cue.headline.slice(0, 8).toUpperCase(),
      urgency: cue.urgency,
      vibration: cue.vibration || "single_tap",
      headline: cue.headline,
      timestamp: cue.fired_at,
    };

    if (Platform.OS === "ios" && WatchBridge?.sendMessage) {
      WatchBridge.sendMessage(payload, () => {}, () => {});
    }

    if (Platform.OS === "android" && WearOSBridge?.sendCue) {
      WearOSBridge.sendCue(JSON.stringify(payload));
    }
  }, []);

  const clearWatch = useCallback(() => {
    if (Platform.OS === "ios" && WatchBridge?.sendMessage) {
      WatchBridge.sendMessage({ label: "", urgency: "clear" }, () => {}, () => {});
    }
    if (Platform.OS === "android" && WearOSBridge?.clearCue) {
      WearOSBridge.clearCue();
    }
  }, []);

  return { sendCueToWatch, clearWatch };
}
