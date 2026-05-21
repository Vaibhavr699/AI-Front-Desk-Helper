import { Ionicons } from "@expo/vector-icons";
import { Text, View } from "react-native";

import { colors } from "@/src/shared/theme/tokens";

import type { CoachingDeliveryPrefs } from "../types";

type Props = {
  prefs: CoachingDeliveryPrefs;
};

type Channel = {
  key: keyof CoachingDeliveryPrefs;
  label: string;
  subtitle: string;
  icon: keyof typeof Ionicons.glyphMap;
};

const CHANNELS: Channel[] = [
  {
    key: "sidebar",
    label: "Tablet sidebar",
    subtitle: "Persistent coaching cards on the right of the screen",
    icon: "tablet-landscape-outline",
  },
  {
    key: "popup",
    label: "Phone pop-ups",
    subtitle: "Top-of-screen cards with color-coded urgency",
    icon: "phone-portrait-outline",
  },
  {
    key: "audio",
    label: "Earbud audio",
    subtitle: "Whispered coaching when a Bluetooth earbud is connected (Pro)",
    icon: "headset-outline",
  },
  {
    key: "watch",
    label: "Apple Watch",
    subtitle: "Glance alerts on a paired watch (Elite)",
    icon: "watch-outline",
  },
];

export function CoachingDeliveryCard({ prefs }: Props) {
  return (
    <View className="gap-4 rounded-2xl border border-dashed border-surface-border bg-white p-5">
      <View className="flex-row items-center justify-between gap-2">
        <View className="flex-row items-center gap-2">
          <Ionicons name="megaphone-outline" size={16} color={colors.ink.secondary} />
          <Text className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
            Coaching delivery
          </Text>
        </View>
        <View className="rounded-full bg-slate-100 px-2.5 py-1">
          <Text className="text-[10px] font-semibold text-slate-600">
            PHASE 6 D · COMING SOON
          </Text>
        </View>
      </View>

      <Text className="text-xs text-ink-muted">
        How real-time coaching reaches you during in-home sessions. We'll
        auto-detect connected devices at session start; these flags let you
        mute any channel.
      </Text>

      <View className="gap-3 opacity-60">
        {CHANNELS.map((c) => {
          const enabled = prefs[c.key] !== false;
          return (
            <View key={c.key} className="flex-row items-center gap-3">
              <View className="h-9 w-9 items-center justify-center rounded-lg bg-surface-raised">
                <Ionicons name={c.icon} size={16} color={colors.ink.muted} />
              </View>
              <View className="flex-1 gap-0.5">
                <Text className="text-sm font-medium text-ink-primary">
                  {c.label}
                </Text>
                <Text className="text-xs text-ink-muted">{c.subtitle}</Text>
              </View>
              <View
                className={`rounded-full px-2 py-1 ${enabled ? "bg-emerald-100" : "bg-slate-100"}`}
              >
                <Text
                  className={`text-[10px] font-semibold ${enabled ? "text-emerald-700" : "text-slate-600"}`}
                >
                  {enabled ? "ON" : "OFF"}
                </Text>
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}
