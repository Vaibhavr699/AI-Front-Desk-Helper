import { Text, View } from "react-native";

import { formatDimensionLabel, scoreToColor } from "../lib/format";

type Props = {
  dimension: string;
  avgScore: number;
  samples: number;
};

const MAX_SCORE = 10;

export function DimensionRow({ dimension, avgScore, samples }: Props) {
  const colorSet = scoreToColor(avgScore);
  const percent = Math.max(2, Math.min(100, (avgScore / MAX_SCORE) * 100));

  return (
    <View className="gap-2">
      <View className="flex-row items-baseline justify-between">
        <Text className="text-sm font-medium text-ink-primary">
          {formatDimensionLabel(dimension)}
        </Text>
        <View className="flex-row items-baseline gap-2">
          <Text className={`text-sm font-bold ${colorSet.text}`}>
            {avgScore.toFixed(1)}
          </Text>
          <Text className="text-xs text-ink-muted">
            ({samples} call{samples === 1 ? "" : "s"})
          </Text>
        </View>
      </View>
      <View className="h-2 w-full overflow-hidden rounded-full bg-surface-raised">
        <View
          className={`h-full ${colorSet.bar}`}
          style={{ width: `${percent}%` }}
        />
      </View>
    </View>
  );
}
