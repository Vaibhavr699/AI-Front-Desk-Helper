import { Ionicons } from "@expo/vector-icons";
import { Pressable, Text, View } from "react-native";

import { colors } from "@/src/shared/theme/tokens";

import {
  DIMENSION_ICONS,
  formatDimensionLabel,
  scoreToColor,
} from "../lib/format";
import { tipsFor } from "../lib/tips";
import type { CoachingDimensionAverage } from "../types";

type Props = {
  weakest: CoachingDimensionAverage | null;
  onPractice: (dimension?: string) => void;
};

function iconColorFor(score: number): string {
  if (score >= 8) return "#059669";
  if (score >= 6) return colors.brand[600];
  if (score >= 4) return "#d97706";
  return "#dc2626";
}

export function FocusCard({ weakest, onPractice }: Props) {
  if (!weakest) return null;

  const label = formatDimensionLabel(weakest.dimension);
  const swatch = scoreToColor(weakest.avg_score);
  const icon = DIMENSION_ICONS[weakest.dimension] ?? "flag-outline";
  const tip = tipsFor(weakest.dimension)[0];

  return (
    <View className="gap-4 rounded-sm border border-brand-100 bg-white p-5">
      <View className="flex-row items-center gap-1.5">
        <Ionicons name="flag" size={13} color={colors.brand[600]} />
        <Text className="text-xs font-semibold uppercase tracking-wider text-brand-600">
          Work on this
        </Text>
      </View>

      <View className="flex-row items-center gap-3">
        <View
          className={`h-12 w-12 items-center justify-center rounded-sm ${swatch.bg}`}
        >
          <Ionicons name={icon} size={22} color={iconColorFor(weakest.avg_score)} />
        </View>
        <View className="flex-1">
          <Text className="text-xl font-bold text-ink-primary">{label}</Text>
          <Text className="text-xs text-ink-muted">Your lowest-scoring skill</Text>
        </View>
        <View className="items-end">
          <Text className={`text-2xl font-bold ${swatch.text}`}>
            {weakest.avg_score.toFixed(1)}
          </Text>
          <Text className="text-[10px] text-ink-dim">out of 10</Text>
        </View>
      </View>

      {tip ? (
        <View className="gap-1 rounded-sm bg-surface-raised p-3.5">
          <Text className="text-sm font-semibold text-ink-primary">
            {tip.title}
          </Text>
          <Text className="text-sm leading-relaxed text-ink-muted">
            {tip.body}
          </Text>
        </View>
      ) : null}

      <Pressable
        onPress={() => onPractice(weakest.dimension)}
        accessibilityRole="button"
        accessibilityLabel={`Practice ${label} with a roleplay`}
        className="h-12 flex-row items-center justify-center gap-2 rounded-sm bg-brand-600 active:bg-brand-700"
      >
        <Ionicons name="play" size={16} color="#ffffff" />
        <Text className="text-sm font-semibold text-white">Practice this</Text>
      </Pressable>
    </View>
  );
}
