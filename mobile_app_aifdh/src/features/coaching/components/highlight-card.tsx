import { Ionicons } from "@expo/vector-icons";
import { Text, View } from "react-native";

import { colors } from "@/src/shared/theme/tokens";

import { formatDimensionLabel } from "../lib/format";
import type { CoachingDimensionAverage } from "../types";

type Props = {
  kind: "best" | "weakest";
  dimension: CoachingDimensionAverage | null;
};

export function HighlightCard({ kind, dimension }: Props) {
  const isBest = kind === "best";
  const label = isBest ? "Best dimension" : "Weakest dimension";
  const accentBg = isBest ? "bg-emerald-50" : "bg-amber-50";
  const accentBorder = isBest ? "border-emerald-200" : "border-amber-200";
  const accentText = isBest ? "text-emerald-700" : "text-amber-700";
  const iconColor = isBest ? "#059669" : "#d97706";
  const iconName = isBest ? "trophy" : "trending-down";

  if (!dimension) {
    return (
      <View
        className={`flex-1 gap-2 rounded-2xl border border-dashed border-surface-border bg-white p-4`}
      >
        <Text className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
          {label}
        </Text>
        <Text className="text-sm text-ink-muted">No data yet</Text>
      </View>
    );
  }

  return (
    <View className={`flex-1 gap-2 rounded-2xl border ${accentBorder} ${accentBg} p-4`}>
      <View className="flex-row items-center gap-2">
        <Ionicons name={iconName} size={14} color={iconColor} />
        <Text className={`text-xs font-semibold uppercase tracking-wider ${accentText}`}>
          {label}
        </Text>
      </View>
      <Text className="text-base font-semibold text-ink-primary">
        {formatDimensionLabel(dimension.dimension)}
      </Text>
      <Text className={`text-2xl font-bold ${accentText}`}>
        {dimension.avg_score.toFixed(1)}
      </Text>
    </View>
  );
}
