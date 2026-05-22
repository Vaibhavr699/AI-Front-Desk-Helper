import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useMemo } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { colors } from "@/src/shared/theme/tokens";

import { ScoreBar } from "../components/score-bar";
import { useSessionDetail } from "../queries";
import type { RoleplayOutcome } from "../types";

type Props = {
  sessionId: string;
};

const OUTCOME_LABELS: Record<RoleplayOutcome, { label: string; bg: string; text: string }> = {
  closed: { label: "Closed", bg: "bg-emerald-50", text: "text-emerald-700" },
  warm_followup: { label: "Warm follow-up", bg: "bg-brand-50", text: "text-brand-700" },
  stalled: { label: "Stalled", bg: "bg-amber-50", text: "text-amber-700" },
  lost: { label: "Lost", bg: "bg-red-50", text: "text-red-700" },
};

function formatDuration(seconds: number | null): string {
  if (!seconds || seconds < 0) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}

export function RoleplayResultsScreen({ sessionId }: Props) {
  const router = useRouter();
  const { data, isLoading, isError, error, refetch } =
    useSessionDetail(sessionId);

  const scoring = data?.scoring ?? null;

  const dimensionEntries = useMemo(() => {
    if (!scoring?.dimensions) return [];
    return Object.entries(scoring.dimensions).sort(
      ([, a], [, b]) => (b ?? 0) - (a ?? 0),
    );
  }, [scoring?.dimensions]);

  function goToHub() {
    router.replace("/(tabs)/coaching/roleplay");
  }

  if (isLoading) {
    return (
      <SafeAreaView className="flex-1 bg-surface-base">
        <View className="flex-1 items-center justify-center gap-3">
          <ActivityIndicator color={colors.brand[600]} />
          <Text className="text-sm text-ink-muted">Scoring your session…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (isError || !data) {
    return (
      <SafeAreaView className="flex-1 bg-surface-base">
        <View className="flex-1 items-center justify-center gap-4 px-8">
          <Ionicons name="alert-circle-outline" size={32} color="#dc2626" />
          <Text className="text-base font-semibold text-ink-primary">
            Couldn't load results
          </Text>
          <Text className="text-center text-sm text-ink-muted">
            {error instanceof Error ? error.message : "Try again."}
          </Text>
          <Pressable
            onPress={() => refetch()}
            className="h-11 items-center justify-center rounded-xl bg-brand-600 px-6 active:bg-brand-700"
          >
            <Text className="text-sm font-semibold text-white">Try again</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const outcomeMeta = scoring?.outcome ? OUTCOME_LABELS[scoring.outcome] : null;
  const overall = scoring?.overall_score ?? null;

  return (
    <SafeAreaView className="flex-1 bg-surface-base" edges={["top"]}>
      <View className="flex-row items-center gap-3 px-4 pb-3 pt-4 md:px-8">
        <Pressable
          onPress={goToHub}
          hitSlop={12}
          className="h-10 w-10 items-center justify-center rounded-full active:bg-surface-raised"
        >
          <Ionicons name="close" size={22} color={colors.ink.secondary} />
        </Pressable>
        <Text className="flex-1 text-base font-semibold text-ink-primary">
          Roleplay results
        </Text>
      </View>

      <ScrollView contentContainerClassName="px-4 pb-10 pt-2 md:px-8">
        <View className="mx-auto w-full max-w-2xl gap-4">
          <View className="gap-3 rounded-2xl border border-surface-border bg-white p-5">
            <Text className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
              {data.scenario?.title ?? "Custom roleplay"}
            </Text>
            <View className="flex-row items-baseline gap-2">
              <Text className="text-6xl font-bold text-ink-primary">
                {overall != null ? overall.toFixed(1) : "—"}
              </Text>
              <Text className="text-xl text-ink-muted">/ 10</Text>
            </View>
            <View className="flex-row flex-wrap items-center gap-2">
              {outcomeMeta ? (
                <View className={`rounded-full px-2.5 py-1 ${outcomeMeta.bg}`}>
                  <Text className={`text-xs font-semibold ${outcomeMeta.text}`}>
                    {outcomeMeta.label}
                  </Text>
                </View>
              ) : null}
              <Text className="text-xs text-ink-muted">
                Duration · {formatDuration(data.duration_seconds)}
              </Text>
            </View>
          </View>

          {dimensionEntries.length > 0 ? (
            <View className="gap-4 rounded-2xl border border-surface-border bg-white p-5">
              <Text className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
                Dimension breakdown
              </Text>
              <View className="gap-4">
                {dimensionEntries.map(([dim, score]) => (
                  <ScoreBar key={dim} label={dim} score={score} />
                ))}
              </View>
            </View>
          ) : null}

          {scoring?.what_worked && scoring.what_worked.length > 0 ? (
            <View className="gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
              <View className="flex-row items-center gap-2">
                <Ionicons
                  name="checkmark-circle"
                  size={16}
                  color="#059669"
                />
                <Text className="text-xs font-semibold uppercase tracking-wider text-emerald-700">
                  What worked
                </Text>
              </View>
              <View className="gap-2">
                {scoring.what_worked.map((line, i) => (
                  <View key={i} className="flex-row gap-2">
                    <Text className="text-sm text-emerald-700">•</Text>
                    <Text className="flex-1 text-sm leading-relaxed text-ink-secondary">
                      {line}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          ) : null}

          {scoring?.what_to_improve && scoring.what_to_improve.length > 0 ? (
            <View className="gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-5">
              <View className="flex-row items-center gap-2">
                <Ionicons name="bulb" size={16} color="#d97706" />
                <Text className="text-xs font-semibold uppercase tracking-wider text-amber-700">
                  What to improve
                </Text>
              </View>
              <View className="gap-2">
                {scoring.what_to_improve.map((line, i) => (
                  <View key={i} className="flex-row gap-2">
                    <Text className="text-sm text-amber-700">•</Text>
                    <Text className="flex-1 text-sm leading-relaxed text-ink-secondary">
                      {line}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          ) : null}

          <Pressable
            onPress={goToHub}
            className="h-14 flex-row items-center justify-center gap-2 rounded-2xl bg-brand-600 active:bg-brand-700"
          >
            <Ionicons name="refresh" size={16} color="#ffffff" />
            <Text className="text-base font-semibold text-white">
              Try another scenario
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
