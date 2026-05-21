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
    <View className="gap-4 rounded-2xl border border-surface-border bg-white p-5">
      <Text className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
        Dimension breakdown
      </Text>
      {dimensions.length === 0 ? (
        <View className="items-center gap-2 py-6">
          <Ionicons name="podium-outline" size={22} color={colors.ink.muted} />
          <Text className="text-sm text-ink-muted">
            No dimension scores in this window yet.
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
