import { requireOptionalNativeModule } from "expo";
import { useSyncExternalStore } from "react";

type NativeAudioRoute = {
  isExternalAudioConnected: () => boolean;
};

const native = requireOptionalNativeModule<NativeAudioRoute>("AudioRoute");

let testOverride = false;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export function isExternalAudioConnected(): boolean {
  try {
    if (native?.isExternalAudioConnected) return native.isExternalAudioConnected();
  } catch {}
  return false;
}

export function isAudioOutputReady(): boolean {
  return testOverride || isExternalAudioConnected();
}

export function getAudioTestOverride(): boolean {
  return testOverride;
}

export function setAudioTestOverride(value: boolean): void {
  if (testOverride === value) return;
  testOverride = value;
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useAudioOutputReady(): boolean {
  return useSyncExternalStore(subscribe, isAudioOutputReady, isAudioOutputReady);
}

export function useAudioTestOverride(): boolean {
  return useSyncExternalStore(subscribe, getAudioTestOverride, getAudioTestOverride);
}
