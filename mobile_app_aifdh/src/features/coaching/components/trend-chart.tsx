import { Ionicons } from "@expo/vector-icons";
import { Text, View } from "react-native";
import Svg, { Circle, Line, Path } from "react-native-svg";

import { colors } from "@/src/shared/theme/tokens";

import type { CoachingTrendPoint } from "../types";

type Props = {
  trend: CoachingTrendPoint[];
};

const VIEWBOX_WIDTH = 300;
const VIEWBOX_HEIGHT = 120;
const MAX_SCORE = 10;

export function TrendChart({ trend }: Props) {
  if (trend.length < 2) {
    return (
      <View className="gap-2 rounded-2xl border border-surface-border bg-white p-5">
        <Text className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
          Score trend
        </Text>
        <View className="items-center gap-2 py-8">
          <Ionicons name="bar-chart-outline" size={24} color={colors.ink.muted} />
          <Text className="text-sm text-ink-muted">
            Not enough data yet — your scored conversations will trend here.
          </Text>
        </View>
      </View>
    );
  }

  const xStep = VIEWBOX_WIDTH / (trend.length - 1);
  const points = trend.map((p, i) => {
    const x = i * xStep;
    const y = VIEWBOX_HEIGHT - (p.avg_score / MAX_SCORE) * VIEWBOX_HEIGHT;
    return { x, y, value: p.avg_score };
  });

  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
    .join(" ");

  const fillPath = `${path} L ${points[points.length - 1].x.toFixed(2)} ${VIEWBOX_HEIGHT} L 0 ${VIEWBOX_HEIGHT} Z`;

  return (
    <View className="gap-3 rounded-2xl border border-surface-border bg-white p-5">
      <Text className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
        Score trend
      </Text>
      <View>
        <Svg
          width="100%"
          height={140}
          viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
          preserveAspectRatio="none"
        >
          {[2.5, 5, 7.5].map((g) => {
            const y = VIEWBOX_HEIGHT - (g / MAX_SCORE) * VIEWBOX_HEIGHT;
            return (
              <Line
                key={g}
                x1={0}
                x2={VIEWBOX_WIDTH}
                y1={y}
                y2={y}
                stroke={colors.surface.divider}
                strokeWidth={1}
              />
            );
          })}
          <Path d={fillPath} fill={colors.brand[500]} opacity={0.12} />
          <Path
            d={path}
            stroke={colors.brand[600]}
            strokeWidth={2.5}
            fill="none"
          />
          {points.map((p, i) => (
            <Circle
              key={i}
              cx={p.x}
              cy={p.y}
              r={3}
              fill={colors.brand[600]}
            />
          ))}
        </Svg>
        <View className="mt-2 flex-row justify-between">
          <Text className="text-xs text-ink-muted">
            {new Date(trend[0].day).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
            })}
          </Text>
          <Text className="text-xs text-ink-muted">
            {new Date(trend[trend.length - 1].day).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
            })}
          </Text>
        </View>
      </View>
    </View>
  );
}
