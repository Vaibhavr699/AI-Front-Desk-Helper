import { Ionicons } from "@expo/vector-icons";
import { Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";

import { colors } from "@/src/shared/theme/tokens";

import type { CoachingTrendPoint } from "../types";

type Props = {
  avgScore: number | null;
  conversations: number;
  windowDays: number;
  trend: CoachingTrendPoint[];
};

const SPARK_W = 88;
const SPARK_H = 36;

function MiniSparkline({ trend }: { trend: CoachingTrendPoint[] }) {
  if (trend.length < 2) {
    return (
      <View
        style={{ width: SPARK_W, height: SPARK_H }}
        className="items-center justify-center"
      >
        <View className="h-px w-full bg-surface-border" />
      </View>
    );
  }
  const xStep = SPARK_W / (trend.length - 1);
  const d = trend
    .map((p, i) => {
      const x = i * xStep;
      const score = Math.max(0, Math.min(10, p.avg_score));
      const y = SPARK_H - (score / 10) * SPARK_H;
      return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <Svg width={SPARK_W} height={SPARK_H}>
      <Path
        d={d}
        stroke={colors.brand[600]}
        strokeWidth={2}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function ScoreSnapshot({
  avgScore,
  conversations,
  windowDays,
  trend,
}: Props) {
  const delta =
    trend.length >= 2
      ? trend[trend.length - 1].avg_score - trend[0].avg_score
      : 0;
  const up = delta > 0.05;
  const down = delta < -0.05;

  return (
    <View className="flex-row items-center justify-between gap-4 rounded-sm bg-white p-4">
      <View className="gap-1">
        <View className="flex-row items-baseline gap-2">
          <Text className="text-2xl font-bold text-ink-primary">
            {avgScore != null ? avgScore.toFixed(1) : "—"}
          </Text>
          <Text className="text-xs text-ink-dim">avg score</Text>
          {up || down ? (
            <View className="flex-row items-center gap-0.5">
              <Ionicons
                name={up ? "arrow-up" : "arrow-down"}
                size={12}
                color={up ? "#059669" : "#dc2626"}
              />
              <Text
                className={`text-xs font-semibold ${up ? "text-emerald-600" : "text-red-600"}`}
              >
                {Math.abs(delta).toFixed(1)}
              </Text>
            </View>
          ) : null}
        </View>
        <Text className="text-xs text-ink-muted">
          {conversations} {conversations === 1 ? "call" : "calls"} · last{" "}
          {windowDays} days
        </Text>
      </View>
      <MiniSparkline trend={trend} />
    </View>
  );
}
