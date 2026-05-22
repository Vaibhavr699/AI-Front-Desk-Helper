import { Text, View } from "react-native";

import type { DiscReading } from "../types";

type Props = {
  reading: DiscReading | null;
  size?: "lg" | "xl";
};

const PALETTE: Record<string, { bg: string; text: string; ring: string }> = {
  D: { bg: "bg-red-100", text: "text-red-700", ring: "border-red-300" },
  I: { bg: "bg-amber-100", text: "text-amber-700", ring: "border-amber-300" },
  S: { bg: "bg-emerald-100", text: "text-emerald-700", ring: "border-emerald-300" },
  C: { bg: "bg-brand-100", text: "text-brand-700", ring: "border-brand-300" },
};

export function DiscLiveBadge({ reading, size = "lg" }: Props) {
  if (!reading || reading.primary === "unknown") {
    return (
      <View
        className={`items-center justify-center rounded-2xl border border-dashed border-surface-border bg-surface-raised ${size === "xl" ? "h-24 w-24" : "h-16 w-16"}`}
      >
        <Text className={`font-bold text-ink-muted ${size === "xl" ? "text-3xl" : "text-xl"}`}>
          ?
        </Text>
      </View>
    );
  }
  const swatch = PALETTE[reading.primary];
  const confidencePct = Math.round(reading.confidence * 100);
  return (
    <View className="items-center gap-2">
      <View
        className={`items-center justify-center rounded-2xl border-2 ${swatch.bg} ${swatch.ring} ${size === "xl" ? "h-24 w-24" : "h-16 w-16"}`}
      >
        <Text
          className={`font-bold ${swatch.text} ${size === "xl" ? "text-5xl" : "text-3xl"}`}
        >
          {reading.primary}
        </Text>
      </View>
      <View className="items-center">
        <Text className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
          {reading.primary}-type
          {reading.secondary ? ` / ${reading.secondary}` : ""}
        </Text>
        <Text className="text-xs text-ink-muted">{confidencePct}% confidence</Text>
      </View>
    </View>
  );
}
