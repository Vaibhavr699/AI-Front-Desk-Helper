import { Ionicons } from "@expo/vector-icons";
import { Text, View } from "react-native";

import { colors } from "@/src/shared/theme/tokens";

import { tipsFor } from "../lib/tips";

type Props = {
  weakestDimension: string | null;
};

export function TipsCard({ weakestDimension }: Props) {
  const tips = tipsFor(weakestDimension);

  return (
    <View className="gap-4 rounded-2xl border border-surface-border bg-white p-5">
      <View className="flex-row items-center gap-2">
        <Ionicons name="bulb-outline" size={16} color={colors.brand[700]} />
        <Text className="text-xs font-semibold uppercase tracking-wider text-brand-700">
          Coaching tips
        </Text>
      </View>
      <View className="gap-4">
        {tips.map((tip, i) => (
          <View key={i} className="gap-1">
            <Text className="text-sm font-semibold text-ink-primary">
              {tip.title}
            </Text>
            <Text className="text-sm leading-relaxed text-ink-secondary">
              {tip.body}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}
