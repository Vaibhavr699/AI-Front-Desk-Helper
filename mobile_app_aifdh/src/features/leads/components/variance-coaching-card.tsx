import { Ionicons } from "@expo/vector-icons";
import { Text, View } from "react-native";

import { colors } from "@/src/shared/theme/tokens";

import type { VarianceCoaching } from "../types";

type Props = {
  coaching: VarianceCoaching | null;
};

function dollars(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export function VarianceCoachingCard({ coaching }: Props) {
  if (!coaching) return null;
  const directionLabel =
    coaching.direction === "within"
      ? "Within ballpark"
      : coaching.direction === "above"
        ? `+${coaching.variance_pct.toFixed(0)}% above ballpark`
        : `${coaching.variance_pct.toFixed(0)}% below ballpark`;
  const accentBg =
    coaching.direction === "within"
      ? "bg-emerald-50 border-emerald-200"
      : "bg-amber-50 border-amber-200";
  const accentText =
    coaching.direction === "within" ? "text-emerald-700" : "text-amber-800";

  return (
    <View className="gap-4 rounded-2xl border border-surface-border bg-white p-4">
      <View className="flex-row items-center gap-2">
        <Ionicons name="trending-up-outline" size={16} color={colors.brand[700]} />
        <Text className="text-xs font-semibold uppercase tracking-wider text-brand-700">
          Price variance coaching
        </Text>
      </View>

      <View className="gap-2">
        <Row label="Your quote" value={dollars(coaching.quote_total_cents)} />
        <Row
          label="Widget ballpark"
          value={`${dollars(coaching.widget_low_cents)} – ${dollars(coaching.widget_high_cents)}`}
        />
        <View
          className={`self-start rounded-full border px-3 py-1 ${accentBg}`}
        >
          <Text className={`text-xs font-semibold ${accentText}`}>
            {directionLabel}
          </Text>
        </View>
      </View>

      {coaching.reasons.length > 0 ? (
        <View className="gap-2">
          <Text className="text-xs font-medium text-ink-muted">
            Likely reasons
          </Text>
          {coaching.reasons.map((r, i) => (
            <View key={i} className="flex-row gap-2">
              <Text className="text-sm text-ink-muted">•</Text>
              <Text className="flex-1 text-sm text-ink-secondary">{r}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {coaching.talking_points.length > 0 ? (
        <View className="gap-2 border-t border-surface-divider pt-3">
          <Text className="text-xs font-medium text-ink-muted">
            Suggested talking points
          </Text>
          {coaching.talking_points.map((p, i) => (
            <View key={i} className="flex-row gap-2">
              <Ionicons
                name="chatbubble-ellipses-outline"
                size={14}
                color={colors.brand[600]}
                style={{ marginTop: 2 }}
              />
              <Text className="flex-1 text-sm text-ink-secondary">{p}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-baseline justify-between">
      <Text className="text-sm text-ink-muted">{label}</Text>
      <Text className="text-sm font-semibold text-ink-primary">{value}</Text>
    </View>
  );
}
