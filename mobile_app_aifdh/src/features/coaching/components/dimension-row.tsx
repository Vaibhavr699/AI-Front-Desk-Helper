import { Ionicons } from "@expo/vector-icons";
import { Text, View } from "react-native";

import { colors } from "@/src/shared/theme/tokens";

import { DIMENSION_ICONS, formatDimensionLabel, scoreToColor } from "../lib/format";

type Props = {
  dimension: string;
  avgScore: number;
  samples: number;
};

const MAX_SCORE = 10;

export function DimensionRow({ dimension, avgScore, samples }: Props) {
  const colorSet = scoreToColor(avgScore);
  const percent = Math.max(2, Math.min(100, (avgScore / MAX_SCORE) * 100));
  const icon = DIMENSION_ICONS[dimension] || "ellipse-outline";

  return (
    <View className="flex-row items-center gap-3">
      <View className={`h-9 w-9 items-center justify-center rounded-xl ${colorSet.bg}`}>
        <Ionicons name={icon} size={16} color={colorSet.text === "text-emerald-700" ? "#059669" : colorSet.text === "text-brand-700" ? colors.brand[600] : colorSet.text === "text-amber-700" ? "#d97706" : "#dc2626"} />
      </View>
      <View className="flex-1 gap-1.5">
        <View className="flex-row items-center justify-between">
          <Text className="text-sm font-medium text-ink-primary">
            {formatDimensionLabel(dimension)}
          </Text>
          <Text className={`text-sm font-bold ${colorSet.text}`}>
            {avgScore.toFixed(1)}
          </Text>
        </View>
        <View className="h-1.5 w-full overflow-hidden rounded-full bg-surface-raised">
          <View
            className={`h-full rounded-full ${colorSet.bar}`}
            style={{ width: `${percent}%` }}
          />
        </View>
      </View>
    </View>
  );
}
