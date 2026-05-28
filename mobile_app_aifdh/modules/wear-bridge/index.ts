import { requireOptionalNativeModule } from "expo-modules-core";

export type WatchCuePayload = {
  label: string;
  urgency: "green" | "yellow" | "orange" | "red";
  vibration: "single_tap" | "double_tap" | "long_buzz";
  headline: string;
};

type WearBridgeModule = {
  sendCue(payloadJson: string): Promise<boolean>;
  clearCue(): Promise<boolean>;
  isWatchConnected(): Promise<boolean>;
};

const native = requireOptionalNativeModule<WearBridgeModule>("WearBridge");

export const WearBridge = {
  available: native != null,

  async sendCue(payload: WatchCuePayload): Promise<boolean> {
    if (!native) return false;
    try {
      return await native.sendCue(JSON.stringify(payload));
    } catch {
      return false;
    }
  },

  async clearCue(): Promise<boolean> {
    if (!native) return false;
    try {
      return await native.clearCue();
    } catch {
      return false;
    }
  },

  async isWatchConnected(): Promise<boolean> {
    if (!native) return false;
    try {
      return await native.isWatchConnected();
    } catch {
      return false;
    }
  },
};
