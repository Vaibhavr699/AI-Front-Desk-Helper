import { Ionicons } from "@expo/vector-icons";
import { Text, View } from "react-native";

import { formatCurrencyRange } from "@/src/shared/lib/format";
import { colors } from "@/src/shared/theme/tokens";

import type { WidgetEstimate } from "../types";

type Props = {
  estimate: WidgetEstimate | null;
};

export function WidgetEstimateCard({ estimate }: Props) {
  if (!estimate) return null;

  const range = formatCurrencyRange(estimate.low_cents, estimate.high_cents);
  const estimatedAt = estimate.estimated_at
    ? new Date(estimate.estimated_at).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      })
    : null;

  return (
    <View className="gap-3 rounded-sm border border-brand-200 bg-brand-50 p-4">
      <View className="flex-row items-center gap-2">
        <Ionicons name="globe-outline" size={16} color={colors.brand[700]} />
        <Text className="text-xs font-semibold uppercase tracking-wider text-brand-700">
          Customer used website estimator
        </Text>
      </View>

      <View className="gap-1">
        <Text className="text-xs font-medium text-ink-muted">
          Ballpark shown to customer
        </Text>
        <Text className="text-2xl font-bold text-ink-primary">{range}</Text>
      </View>

      {estimate.scope_summary ? (
        <View className="gap-1">
          <Text className="text-xs font-medium text-ink-muted">
            Scope they entered
          </Text>
          <Text className="text-sm text-ink-secondary">
            {estimate.scope_summary}
          </Text>
        </View>
      ) : null}

      {estimatedAt ? (
        <Text className="text-xs text-ink-muted">Estimated {estimatedAt}</Text>
      ) : null}

      <View className="flex-row items-start gap-2 rounded-xl bg-amber-50 px-3 py-2">
        <Ionicons name="warning-outline" size={14} color="#b45309" />
        <Text className="flex-1 text-xs text-amber-800">
          Be prepared to explain variance when your real quote differs from this
          ballpark.
        </Text>
      </View>
    </View>
  );
}
