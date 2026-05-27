import { Ionicons } from "@expo/vector-icons";
import { Text, View } from "react-native";

import { DIMENSION_ICONS, formatDimensionLabel } from "../lib/format";
import type { CoachingDimensionAverage } from "../types";

type Props = {
  kind: "best" | "weakest";
  dimension: CoachingDimensionAverage | null;
};

export function HighlightCard({ kind, dimension }: Props) {
  const isBest = kind === "best";

  if (!dimension) {
    return (
      <View className="flex-1 items-center gap-2 rounded-sm bg-white p-5">
        <View className="h-10 w-10 items-center justify-center rounded-full bg-surface-raised">
          <Ionicons name={isBest ? "trophy-outline" : "trending-down-outline"} size={18} color="#aaa" />
        </View>
        <Text className="text-xs font-medium text-ink-dim">
          {isBest ? "Best" : "Weakest"}
        </Text>
        <Text className="text-xs text-ink-muted">No data yet</Text>
      </View>
    );
  }

  const icon = DIMENSION_ICONS[dimension.dimension] || "ellipse-outline";

  return (
    <View
      className={`flex-1 items-center gap-2 rounded-sm p-5 ${
        isBest ? "bg-emerald-50" : "bg-amber-50"
      }`}
    >
      <View
        className={`h-10 w-10 items-center justify-center rounded-full ${
          isBest ? "bg-emerald-100" : "bg-amber-100"
        }`}
      >
        <Ionicons
          name={icon}
          size={18}
          color={isBest ? "#059669" : "#d97706"}
        />
      </View>
      <Text className={`text-xs font-semibold uppercase tracking-wider ${isBest ? "text-emerald-600" : "text-amber-600"}`}>
        {isBest ? "Strongest" : "Focus area"}
      </Text>
      <Text className="text-sm font-semibold text-ink-primary">
        {formatDimensionLabel(dimension.dimension)}
      </Text>
      <Text className={`text-2xl font-bold ${isBest ? "text-emerald-600" : "text-amber-600"}`}>
        {dimension.avg_score.toFixed(1)}
      </Text>
    </View>
  );
}
