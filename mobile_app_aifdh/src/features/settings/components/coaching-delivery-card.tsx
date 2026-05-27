import { Ionicons } from "@expo/vector-icons";
import { Switch, Text, View } from "react-native";

import type { SeatTier } from "@/src/shared/types/api";
import { colors } from "@/src/shared/theme/tokens";

import type { CoachingDeliveryPrefs } from "../types";

type Props = {
  prefs: CoachingDeliveryPrefs;
  seatTier: SeatTier;
  onToggle: (key: keyof CoachingDeliveryPrefs, value: boolean) => void;
};

type Channel = {
  key: keyof CoachingDeliveryPrefs;
  label: string;
  subtitle: string;
  icon: keyof typeof Ionicons.glyphMap;
  minTier: SeatTier;
};

const TIER_RANK: Record<SeatTier, number> = { standard: 0, pro: 1, elite: 2 };

const CHANNELS: Channel[] = [
  {
    key: "sidebar",
    label: "Tablet sidebar",
    subtitle: "Persistent coaching cards on the right of the screen",
    icon: "tablet-landscape-outline",
    minTier: "standard",
  },
  {
    key: "popup",
    label: "Phone pop-ups",
    subtitle: "Top-of-screen banner with color-coded urgency",
    icon: "phone-portrait-outline",
    minTier: "standard",
  },
  {
    key: "audio",
    label: "Earbud audio",
    subtitle: "Whispered coaching when a Bluetooth earbud is connected",
    icon: "headset-outline",
    minTier: "pro",
  },
  {
    key: "watch",
    label: "Watch alerts",
    subtitle: "Haptic glance on Apple Watch or Wear OS",
    icon: "watch-outline",
    minTier: "elite",
  },
];

const TIER_LABEL: Record<SeatTier, string> = {
  standard: "Standard",
  pro: "Pro",
  elite: "Elite",
};

export function CoachingDeliveryCard({ prefs, seatTier, onToggle }: Props) {
  const currentRank = TIER_RANK[seatTier] ?? 0;

  return (
    <View className="gap-4 rounded-sm border border-surface-border bg-white p-5">
      <View className="flex-row items-center gap-2">
        <Ionicons name="megaphone-outline" size={16} color={colors.ink.secondary} />
        <Text className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
          Coaching delivery
        </Text>
      </View>

      <Text className="text-xs text-ink-muted">
        How real-time coaching reaches you during in-home sessions. Toggle any
        channel on or off.
      </Text>

      <View className="gap-3">
        {CHANNELS.map((c) => {
          const locked = currentRank < (TIER_RANK[c.minTier] ?? 0);
          const enabled = !locked && prefs[c.key] !== false;

          return (
            <View key={c.key} className={`flex-row items-center gap-3 ${locked ? "opacity-50" : ""}`}>
              <View className="h-9 w-9 items-center justify-center rounded-lg bg-surface-raised">
                <Ionicons name={c.icon} size={16} color={locked ? colors.ink.dim : colors.ink.muted} />
              </View>
              <View className="flex-1 gap-0.5">
                <View className="flex-row items-center gap-2">
                  <Text className="text-sm font-medium text-ink-primary">
                    {c.label}
                  </Text>
                  {locked ? (
                    <View className="rounded-full bg-slate-100 px-2 py-0.5">
                      <Text className="text-[9px] font-semibold text-slate-500">
                        Requires {TIER_LABEL[c.minTier]}
                      </Text>
                    </View>
                  ) : null}
                </View>
                <Text className="text-xs text-ink-muted">{c.subtitle}</Text>
              </View>
              <Switch
                value={enabled}
                disabled={locked}
                onValueChange={(v) => onToggle(c.key, v)}
                trackColor={{ false: "#d1d5db", true: colors.brand[500] }}
              />
            </View>
          );
        })}
      </View>
    </View>
  );
}
