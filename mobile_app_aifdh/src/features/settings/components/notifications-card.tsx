import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { Switch, Text, View } from "react-native";

import { colors } from "@/src/shared/theme/tokens";

import {
  loadNotificationPrefs,
  saveNotificationPrefs,
} from "../notification-prefs-storage";
import {
  DEFAULT_NOTIFICATION_PREFS,
  NOTIFICATION_LABELS,
  type NotificationKey,
  type NotificationPrefs,
} from "../types";

const ORDER: NotificationKey[] = [
  "new_lead",
  "appointment_reminder",
  "briefing_ready",
  "coaching_feedback",
  "manager_message",
  "variance_coaching",
  "live_coach_alert",
  "roleplay_invite",
];

const FUTURE_PHASE: NotificationKey[] = ["live_coach_alert", "roleplay_invite"];

export function NotificationsCard() {
  const [prefs, setPrefs] = useState<NotificationPrefs>(
    DEFAULT_NOTIFICATION_PREFS,
  );

  useEffect(() => {
    loadNotificationPrefs().then(setPrefs);
  }, []);

  function toggle(key: NotificationKey) {
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    saveNotificationPrefs(next);
  }

  return (
    <View className="gap-4 rounded-2xl border border-surface-border bg-white p-5">
      <View className="flex-row items-center gap-2">
        <Ionicons name="notifications-outline" size={16} color={colors.ink.secondary} />
        <Text className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
          Notifications
        </Text>
      </View>

      <View className="gap-1">
        {ORDER.map((key, i) => {
          const meta = NOTIFICATION_LABELS[key];
          const isFuture = FUTURE_PHASE.includes(key);
          return (
            <View
              key={key}
              className={`flex-row items-center gap-3 py-3 ${i < ORDER.length - 1 ? "border-b border-surface-divider" : ""}`}
            >
              <View className="flex-1 gap-0.5">
                <Text className="text-sm font-medium text-ink-primary">
                  {meta.title}
                </Text>
                <Text className="text-xs text-ink-muted">{meta.subtitle}</Text>
              </View>
              <Switch
                value={!isFuture && prefs[key]}
                onValueChange={() => toggle(key)}
                disabled={isFuture}
                trackColor={{ false: "#cbd5e1", true: colors.brand[500] }}
                thumbColor="#ffffff"
              />
            </View>
          );
        })}
      </View>

      <Text className="text-xs text-ink-dim">
        Stored on this device. Push delivery turns on when you register for
        notifications on first sign-in.
      </Text>
    </View>
  );
}
