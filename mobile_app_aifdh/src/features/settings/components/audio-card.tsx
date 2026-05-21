import { Ionicons } from "@expo/vector-icons";
import { Text, View } from "react-native";

import { colors } from "@/src/shared/theme/tokens";

type Props = {
  preferredDevice: string | null;
};

export function AudioCard({ preferredDevice }: Props) {
  return (
    <View className="gap-4 rounded-2xl border border-dashed border-surface-border bg-white p-5">
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center gap-2">
          <Ionicons name="headset-outline" size={16} color={colors.ink.secondary} />
          <Text className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
            Audio & earbud
          </Text>
        </View>
        <View className="rounded-full bg-amber-100 px-2.5 py-1">
          <Text className="text-[10px] font-semibold text-amber-700">
            PRO · PHASE 6 D V1
          </Text>
        </View>
      </View>

      <Text className="text-xs text-ink-muted">
        Pair a Bluetooth earbud for hands-free coaching whispered directly in
        your ear during in-home estimates.
      </Text>

      <View className="flex-row items-center gap-3 rounded-xl bg-surface-raised p-3 opacity-70">
        <View className="h-9 w-9 items-center justify-center rounded-lg bg-white">
          <Ionicons name="bluetooth-outline" size={16} color={colors.ink.muted} />
        </View>
        <View className="flex-1 gap-0.5">
          <Text className="text-sm font-medium text-ink-primary">
            Preferred earbud
          </Text>
          <Text className="text-xs text-ink-muted">
            {preferredDevice ?? "Not paired"}
          </Text>
        </View>
      </View>
    </View>
  );
}
