import { Ionicons } from "@expo/vector-icons";
import { Text, View } from "react-native";

import { colors } from "@/src/shared/theme/tokens";

import type { CoachingDimensionAverage } from "../types";

import { DimensionRow } from "./dimension-row";

type Props = {
  dimensions: CoachingDimensionAverage[];
};

export function DimensionsCard({ dimensions }: Props) {
  return (
    <View className="gap-5 rounded-sm bg-white p-6">
      <View className="flex-row items-center gap-2">
        <Ionicons name="podium-outline" size={16} color={colors.ink.secondary} />
        <Text className="text-sm font-semibold text-ink-secondary">
          Dimension breakdown
        </Text>
      </View>
      {dimensions.length === 0 ? (
        <View className="items-center gap-3 py-8">
          <View className="h-12 w-12 items-center justify-center rounded-full bg-surface-raised">
            <Ionicons name="bar-chart-outline" size={22} color={colors.ink.dim} />
          </View>
          <Text className="text-sm text-ink-muted">
            No dimension scores yet
          </Text>
        </View>
      ) : (
        <View className="gap-4">
          {dimensions.map((d) => (
            <DimensionRow
              key={d.dimension}
              dimension={d.dimension}
              avgScore={d.avg_score}
              samples={d.samples}
            />
          ))}
        </View>
      )}
    </View>
  );
}
