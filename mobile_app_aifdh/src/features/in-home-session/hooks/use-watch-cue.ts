import { useCallback, useRef } from "react";
import { Platform } from "react-native";

import { WearBridge } from "@/modules/wear-bridge";

import type { CoachingAlert } from "../types";

type WatchUrgency = "green" | "yellow" | "orange" | "red";
type WatchVibration = "single_tap" | "double_tap" | "long_buzz";

export function useWatchCue() {
  const lastSentRef = useRef<string | null>(null);

  const sendCueToWatch = useCallback((cue: CoachingAlert) => {
    if (lastSentRef.current === cue.id) return;
    lastSentRef.current = cue.id;

    if (Platform.OS === "android") {
      WearBridge.sendCue({
        label: cue.watch_label || cue.headline.slice(0, 8).toUpperCase(),
        urgency: (cue.urgency as WatchUrgency) || "yellow",
        vibration: (cue.vibration as WatchVibration) || "single_tap",
        headline: cue.headline,
      });
    }
    // iOS (Apple Watch) bridge wired in a later phase.
  }, []);

  const clearWatch = useCallback(() => {
    if (Platform.OS === "android") {
      WearBridge.clearCue();
    }
  }, []);

  return { sendCueToWatch, clearWatch };
}
