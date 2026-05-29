import { useSyncExternalStore } from "react";

import { discard, getSnapshot, retry, subscribe, triggerSync } from "./sync-manager";

export function usePendingRecordings() {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return {
    pending: snap.pending,
    syncing: snap.syncing,
    retry,
    discard,
    triggerSync,
  };
}
