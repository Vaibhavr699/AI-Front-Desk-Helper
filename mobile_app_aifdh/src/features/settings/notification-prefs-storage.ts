import { secureStorage } from "@/src/shared/storage/secure-store";

import {
  DEFAULT_NOTIFICATION_PREFS,
  type NotificationPrefs,
} from "./types";

const STORAGE_KEY = "aifdh.notification_prefs";

export async function loadNotificationPrefs(): Promise<NotificationPrefs> {
  const stored = await secureStorage.getJson<Partial<NotificationPrefs>>(
    STORAGE_KEY,
  );
  return { ...DEFAULT_NOTIFICATION_PREFS, ...(stored ?? {}) };
}

export async function saveNotificationPrefs(
  prefs: NotificationPrefs,
): Promise<void> {
  await secureStorage.setJson(STORAGE_KEY, prefs);
}
