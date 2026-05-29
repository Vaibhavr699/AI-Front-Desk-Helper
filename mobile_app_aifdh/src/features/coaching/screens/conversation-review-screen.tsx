import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { colors } from "@/src/shared/theme/tokens";

import { DIMENSION_ICONS, formatDimensionLabel, scoreToColor } from "../lib/format";
import { useConversationReview } from "../queries";
import type { CoachingDimensionDetail } from "../types";

type Props = { id: string };

function formatWhen(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}

function DimensionFeedback({
  item,
  tone,
}: {
  item: CoachingDimensionDetail;
  tone: "strength" | "improvement";
}) {
  const accent =
    tone === "strength"
      ? { bg: "bg-emerald-50", chip: "bg-emerald-100", text: "text-emerald-700" }
      : { bg: "bg-amber-50", chip: "bg-amber-100", text: "text-amber-700" };
  const icon = DIMENSION_ICONS[item.dimension] || "ellipse-outline";
  return (
    <View className={`gap-2 rounded-sm p-4 ${accent.bg}`}>
      <View className="flex-row items-center gap-2">
        <View className={`h-7 w-7 items-center justify-center rounded-full ${accent.chip}`}>
          <Ionicons name={icon} size={14} color={tone === "strength" ? "#047857" : "#b45309"} />
        </View>
        <Text className="flex-1 text-sm font-semibold text-ink-primary">
          {formatDimensionLabel(item.dimension)}
        </Text>
        <Text className={`text-sm font-bold ${accent.text}`}>
          {item.score.toFixed(1)}
        </Text>
      </View>
      {item.rationale && (
        <Text className="text-xs leading-relaxed text-ink-secondary">
          {item.rationale}
        </Text>
      )}
    </View>
  );
}

function DimensionRow({ item }: { item: CoachingDimensionDetail }) {
  const swatch = scoreToColor(item.score);
  const pct = Math.max(0, Math.min(100, (item.score / 10) * 100));
  return (
    <View className="gap-1.5">
      <View className="flex-row items-center justify-between">
        <Text className="text-sm text-ink-secondary">
          {formatDimensionLabel(item.dimension)}
        </Text>
        <Text className={`text-sm font-semibold ${swatch.text}`}>
          {item.score.toFixed(1)}
        </Text>
      </View>
      <View className="h-2 overflow-hidden rounded-sm bg-surface-raised">
        <View className={`h-full rounded-sm ${swatch.bar}`} style={{ width: `${pct}%` }} />
      </View>
    </View>
  );
}

export function ConversationReviewScreen({ id }: Props) {
  const router = useRouter();
  const { data, isLoading, isError, error, refetch } = useConversationReview(id);

  return (
    <SafeAreaView className="flex-1 bg-surface-base" edges={["top"]}>
      <View className="flex-row items-center gap-3 border-b border-surface-divider px-5 py-3">
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          className="h-9 w-9 items-center justify-center rounded-lg active:bg-surface-raised"
        >
          <Ionicons name="arrow-back" size={22} color={colors.ink.secondary} />
        </Pressable>
        <View className="flex-1">
          <Text className="text-lg font-semibold text-ink-primary">Call Review</Text>
          {data?.conversation.lead_name && (
            <Text className="text-xs text-ink-muted">{data.conversation.lead_name}</Text>
          )}
        </View>
      </View>

      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={colors.brand[600]} />
        </View>
      ) : isError || !data ? (
        <View className="flex-1 items-center justify-center gap-4 px-8">
          <Ionicons name="alert-circle-outline" size={28} color="#dc2626" />
          <Text className="text-center text-sm text-ink-muted">
            {error instanceof Error ? error.message : "Couldn't load this call."}
          </Text>
          <Pressable
            onPress={() => refetch()}
            className="rounded-sm bg-brand-600 px-6 py-2.5 active:bg-brand-700"
          >
            <Text className="text-sm font-semibold text-white">Try again</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView contentContainerClassName="gap-4 p-4 pb-10">
          {(() => {
            const c = data.conversation;
            const notScored = c.overall_score == null || !!c.scoring_skip_reason;
            const swatch = c.overall_score != null ? scoreToColor(c.overall_score) : null;
            return (
              <>
                <View className={`gap-3 rounded-sm p-6 ${swatch?.bg ?? "bg-white"}`}>
                  <Text className="text-xs font-medium uppercase tracking-wider text-ink-muted">
                    Overall score
                  </Text>
                  {notScored ? (
                    <View className="gap-1">
                      <Text className="text-base font-semibold text-ink-primary">
                        Not scored
                      </Text>
                      <Text className="text-xs text-ink-muted">
                        This recording was too short or one-sided to coach. Record a fuller conversation to see scores.
                      </Text>
                    </View>
                  ) : (
                    <View className="flex-row items-end gap-2">
                      <Text className={`text-5xl font-bold ${swatch?.text}`}>
                        {c.overall_score?.toFixed(1)}
                      </Text>
                      <Text className="mb-1 text-lg text-ink-muted">/ 10</Text>
                    </View>
                  )}
                  <View className="flex-row flex-wrap gap-2">
                    <View className="rounded-sm bg-white/70 px-2.5 py-1">
                      <Text className="text-xs text-ink-secondary">
                        {formatWhen(c.scored_at || c.created_at)}
                      </Text>
                    </View>
                    <View className="rounded-sm bg-white/70 px-2.5 py-1">
                      <Text className="text-xs text-ink-secondary">
                        {formatDuration(c.duration_seconds)}
                      </Text>
                    </View>
                    {c.disc_primary && c.disc_primary !== "unknown" && (
                      <View className="rounded-sm bg-white/70 px-2.5 py-1">
                        <Text className="text-xs text-ink-secondary">DISC: {c.disc_primary}</Text>
                      </View>
                    )}
                  </View>
                </View>

                {!notScored && data.strengths.length > 0 && (
                  <View className="gap-3">
                    <View className="flex-row items-center gap-2">
                      <Ionicons name="trophy-outline" size={16} color="#047857" />
                      <Text className="text-sm font-semibold text-ink-secondary">
                        Top strengths
                      </Text>
                    </View>
                    {data.strengths.map((s) => (
                      <DimensionFeedback key={s.dimension} item={s} tone="strength" />
                    ))}
                  </View>
                )}

                {!notScored && data.improvements.length > 0 && (
                  <View className="gap-3">
                    <View className="flex-row items-center gap-2">
                      <Ionicons name="trending-up-outline" size={16} color="#b45309" />
                      <Text className="text-sm font-semibold text-ink-secondary">
                        Focus areas
                      </Text>
                    </View>
                    {data.improvements.map((s) => (
                      <DimensionFeedback key={s.dimension} item={s} tone="improvement" />
                    ))}
                  </View>
                )}

                {!notScored && data.dimensions.length > 0 && (
                  <View className="gap-4 rounded-sm bg-white p-6">
                    <Text className="text-sm font-semibold text-ink-secondary">
                      All dimensions
                    </Text>
                    {data.dimensions.map((d) => (
                      <DimensionRow key={d.dimension} item={d} />
                    ))}
                  </View>
                )}

                {c.lead_id && (
                  <Pressable
                    onPress={() => router.push(`/(tabs)/leads/${c.lead_id}`)}
                    className="flex-row items-center justify-center gap-2 rounded-sm bg-white p-4 active:bg-surface-raised"
                  >
                    <Ionicons name="person-outline" size={16} color={colors.brand[600]} />
                    <Text className="text-sm font-semibold text-brand-600">
                      View customer
                    </Text>
                  </Pressable>
                )}
              </>
            );
          })()}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
