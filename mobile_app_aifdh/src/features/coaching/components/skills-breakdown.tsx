import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { colors } from "@/src/shared/theme/tokens";

import {
  DIMENSION_ICONS,
  formatDimensionLabel,
  scoreToColor,
} from "../lib/format";
import type { CoachingDimensionAverage } from "../types";

type Props = {
  dimensions: CoachingDimensionAverage[];
  best: CoachingDimensionAverage | null;
  weakest: CoachingDimensionAverage | null;
  defaultOpen?: boolean;
};

export function SkillsBreakdown({
  dimensions,
  best,
  weakest,
  defaultOpen = false,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);

  if (dimensions.length === 0) return null;

  return (
    <View className="gap-3 rounded-sm bg-white p-4">
      <Pressable
        onPress={() => setOpen((o) => !o)}
        accessibilityRole="button"
        accessibilityLabel={open ? "Collapse all skills" : "Expand all skills"}
        className="flex-row items-center justify-between"
      >
        <View className="flex-row items-center gap-2">
          <Ionicons name="podium-outline" size={16} color={colors.ink.secondary} />
          <Text className="text-sm font-semibold text-ink-secondary">
            All skills
          </Text>
        </View>
        <Ionicons
          name={open ? "chevron-up" : "chevron-down"}
          size={16}
          color={colors.ink.muted}
        />
      </Pressable>

      {best ? (
        <View className="flex-row items-center gap-1.5">
          <Ionicons name="checkmark-circle" size={14} color="#059669" />
          <Text className="text-xs text-ink-muted">
            Strongest:{" "}
            <Text className="font-semibold text-ink-secondary">
              {formatDimensionLabel(best.dimension)} ({best.avg_score.toFixed(1)})
            </Text>
          </Text>
        </View>
      ) : null}

      {open ? (
        <View className="gap-3 pt-1">
          {dimensions.map((d) => {
            const swatch = scoreToColor(d.avg_score);
            const isWeakest = weakest?.dimension === d.dimension;
            const pct = Math.max(4, Math.min(100, (d.avg_score / 10) * 100));
            return (
              <View key={d.dimension} className="flex-row items-center gap-2.5">
                <Ionicons
                  name={DIMENSION_ICONS[d.dimension] ?? "ellipse-outline"}
                  size={14}
                  color={colors.ink.muted}
                />
                <Text
                  className="w-24 text-xs text-ink-secondary"
                  numberOfLines={1}
                >
                  {formatDimensionLabel(d.dimension)}
                </Text>
                <View className="h-2 flex-1 overflow-hidden rounded-full bg-surface-raised">
                  <View
                    className={`h-full rounded-full ${swatch.bar}`}
                    style={{ width: `${pct}%` }}
                  />
                </View>
                <Text
                  className={`w-7 text-right text-xs font-semibold ${swatch.text}`}
                >
                  {d.avg_score.toFixed(1)}
                </Text>
                <View
                  className={`h-1.5 w-1.5 rounded-full ${isWeakest ? "bg-brand-600" : "bg-transparent"}`}
                />
              </View>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}
