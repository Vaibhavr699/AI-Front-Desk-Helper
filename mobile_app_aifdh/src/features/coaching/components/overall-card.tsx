import { Ionicons } from "@expo/vector-icons";
import { Text, View } from "react-native";

import { colors } from "@/src/shared/theme/tokens";

type Props = {
  avgScore: number | null;
  conversations: number;
  windowDays: number;
};

export function OverallCard({ avgScore, conversations, windowDays }: Props) {
  const display = avgScore != null ? avgScore.toFixed(1) : "—";
  const scoreColor =
    avgScore == null
      ? "text-ink-muted"
      : avgScore >= 8
        ? "text-emerald-600"
        : avgScore >= 6
          ? "text-brand-600"
          : avgScore >= 4
            ? "text-amber-600"
            : "text-red-600";

  return (
    <View className="rounded-sm bg-white p-6">
      <View className="flex-row items-center gap-2">
        <View className="h-8 w-8 items-center justify-center rounded-full bg-brand-50">
          <Ionicons name="analytics-outline" size={16} color={colors.brand[600]} />
        </View>
        <Text className="text-sm font-medium text-ink-muted">
          Last {windowDays} days
        </Text>
      </View>
      <View className="mt-4 flex-row items-baseline gap-1">
        <Text className={`text-5xl font-bold ${scoreColor}`}>{display}</Text>
        <Text className="text-lg text-ink-dim">/ 10</Text>
      </View>
      <View className="mt-3 flex-row items-center gap-1.5">
        <Ionicons name="chatbubbles-outline" size={14} color={colors.ink.muted} />
        <Text className="text-sm text-ink-muted">
          {conversations} scored conversation{conversations === 1 ? "" : "s"}
        </Text>
      </View>
    </View>
  );
}
