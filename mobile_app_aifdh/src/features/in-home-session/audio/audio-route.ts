import { requireOptionalNativeModule } from "expo";
import { useSyncExternalStore } from "react";

type EventSubscription = { remove: () => void };

type NativeAudioRoute = {
  isExternalAudioConnected: () => boolean;
  addListener: (event: string, listener: () => void) => EventSubscription;
};

const native = requireOptionalNativeModule<NativeAudioRoute>("AudioRoute");

let testOverride = false;
let nativeSubscription: EventSubscription | null = null;
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
  if (!nativeSubscription) {
    try {
      nativeSubscription = native?.addListener("onChange", emit) ?? null;
    } catch {}
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && nativeSubscription) {
      nativeSubscription.remove();
      nativeSubscription = null;
    }
  };
}

export function useAudioOutputReady(): boolean {
  return useSyncExternalStore(subscribe, isAudioOutputReady, isAudioOutputReady);
}

export function useAudioTestOverride(): boolean {
  return useSyncExternalStore(subscribe, getAudioTestOverride, getAudioTestOverride);
}
