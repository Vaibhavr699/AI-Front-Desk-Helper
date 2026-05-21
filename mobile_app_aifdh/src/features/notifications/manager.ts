import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { colors } from "@/src/shared/theme/tokens";

import { registerPushToken } from "./api";

let handlerRegistered = false;

export function ensureNotificationHandler(): void {
  if (handlerRegistered) return;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
    }),
  });
  handlerRegistered = true;
}

async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync("default", {
    name: "default",
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: colors.brand[500],
  });
}

async function resolvePermissions(): Promise<boolean> {
  const existing = await Notifications.getPermissionsAsync();
  if (existing.granted) return true;
  if (!existing.canAskAgain) return false;
  const requested = await Notifications.requestPermissionsAsync();
  return requested.granted;
}

function resolveProjectId(): string | undefined {
  return (
    (Constants.expoConfig?.extra?.eas as { projectId?: string } | undefined)
      ?.projectId ?? Constants.easConfig?.projectId
  );
}

export async function registerForPushNotifications(): Promise<string | null> {
  if (!Device.isDevice) return null;
  ensureNotificationHandler();
  await ensureAndroidChannel();

  const granted = await resolvePermissions();
  if (!granted) return null;

  const projectId = resolveProjectId();
  try {
    const result = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    await registerPushToken(result.data);
    return result.data;
  } catch (err) {
    if (__DEV__) {
      console.warn("[notifications] register failed:", err);
    }
    return null;
  }
}
