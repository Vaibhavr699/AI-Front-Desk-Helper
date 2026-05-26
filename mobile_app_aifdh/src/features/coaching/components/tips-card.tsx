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
    <View className="gap-4 rounded-2xl bg-white p-6">
      <View className="flex-row items-center gap-2">
        <View className="h-7 w-7 items-center justify-center rounded-lg bg-amber-50">
          <Ionicons name="bulb-outline" size={15} color="#d97706" />
        </View>
        <Text className="text-sm font-semibold text-ink-secondary">
          Coaching tips
        </Text>
      </View>
      <View className="gap-4">
        {tips.map((tip, i) => (
          <View key={i} className="flex-row gap-3">
            <View className="mt-0.5 h-5 w-5 items-center justify-center rounded-full bg-surface-raised">
              <Text className="text-[10px] font-bold text-ink-dim">{i + 1}</Text>
            </View>
            <View className="flex-1 gap-1">
              <Text className="text-sm font-semibold text-ink-primary">
                {tip.title}
              </Text>
              <Text className="text-sm leading-relaxed text-ink-muted">
                {tip.body}
              </Text>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}
