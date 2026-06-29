import { Ionicons } from "@expo/vector-icons";
import { memo, useMemo } from "react";
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

function TrendChartBase({ trend }: Props) {
  const geo = useMemo(() => {
    if (trend.length < 2) return null;
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
    return { points, path, fillPath };
  }, [trend]);

  if (!geo) {
    return (
      <View className="gap-3 rounded-sm bg-white p-6">
        <View className="flex-row items-center gap-2">
          <Ionicons name="trending-up-outline" size={16} color={colors.ink.secondary} />
          <Text className="text-sm font-semibold text-ink-secondary">
            Score trend
          </Text>
        </View>
        <View className="items-center gap-3 py-8">
          <View className="h-12 w-12 items-center justify-center rounded-full bg-surface-raised">
            <Ionicons name="bar-chart-outline" size={22} color={colors.ink.dim} />
          </View>
          <Text className="text-sm text-ink-muted">
            Need more data to show a trend
          </Text>
        </View>
      </View>
    );
  }

  const { points, path, fillPath } = geo;

  return (
    <View className="gap-3 rounded-sm bg-white p-6">
      <View className="flex-row items-center gap-2">
        <Ionicons name="trending-up-outline" size={16} color={colors.ink.secondary} />
        <Text className="text-sm font-semibold text-ink-secondary">
          Score trend
        </Text>
      </View>
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
                stroke="#f0f0f0"
                strokeWidth={1}
              />
            );
          })}
          <Path d={fillPath} fill={colors.brand[500]} opacity={0.08} />
          <Path
            d={path}
            stroke={colors.brand[600]}
            strokeWidth={2.5}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {points.map((p, i) => (
            <Circle
              key={i}
              cx={p.x}
              cy={p.y}
              r={3.5}
              fill="#fff"
              stroke={colors.brand[600]}
              strokeWidth={2}
            />
          ))}
        </Svg>
        <View className="mt-2 flex-row justify-between">
          <Text className="text-[11px] text-ink-dim">
            {new Date(trend[0].day).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
            })}
          </Text>
          <Text className="text-[11px] text-ink-dim">
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

export const TrendChart = memo(TrendChartBase);
