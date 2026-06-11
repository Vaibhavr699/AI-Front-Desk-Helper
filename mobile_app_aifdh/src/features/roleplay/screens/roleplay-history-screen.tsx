import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { memo, useCallback } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { colors } from "@/src/shared/theme/tokens";

import { useSessions } from "../queries";
import type { RoleplaySessionSummary } from "../types";

const OUTCOME_LABEL: Record<string, string> = {
  closed: "Closed",
  warm_followup: "Warm follow-up",
  stalled: "Stalled",
  lost: "Lost",
};

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

const Row = memo(function Row({
  item,
  onPress,
}: {
  item: RoleplaySessionSummary;
  onPress: (s: RoleplaySessionSummary) => void;
}) {
  const score = item.overall_score;
  const scoreColor =
    score == null
      ? "text-ink-dim"
      : score >= 8
        ? "text-emerald-600"
        : score >= 6
          ? "text-amber-600"
          : "text-red-600";
  return (
    <Pressable
      onPress={() => onPress(item)}
      accessibilityRole="button"
      accessibilityLabel={`Roleplay: ${item.scenario_title}`}
      className="flex-row items-center gap-3 rounded-sm bg-white p-3.5 active:bg-surface-raised"
    >
      <View className="h-11 w-11 items-center justify-center rounded-sm bg-surface-raised">
        <Text className={`text-sm font-bold ${scoreColor}`}>
          {score != null ? score.toFixed(1) : item.completed_at ? "—" : "•"}
        </Text>
      </View>
      <View className="flex-1 gap-0.5">
        <Text className="text-sm font-medium text-ink-primary" numberOfLines={1}>
          {item.scenario_title}
        </Text>
        <Text className="text-xs text-ink-muted">
          {formatWhen(item.started_at)}
          {item.outcome
            ? ` · ${OUTCOME_LABEL[item.outcome] ?? item.outcome}`
            : item.completed_at
              ? ""
              : " · In progress"}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.ink.dim} />
    </Pressable>
  );
});

export function RoleplayHistoryScreen() {
  const router = useRouter();
  const { data, isLoading, isError, refetch, isRefetching } = useSessions();
  const sessions = data?.sessions ?? [];

  const handlePress = useCallback(
    (s: RoleplaySessionSummary) => {
      if (s.completed_at) {
        router.push(`/(tabs)/coaching/roleplay/results/${s.id}` as never);
      } else {
        router.push(`/(tabs)/coaching/roleplay/session/${s.id}` as never);
      }
    },
    [router],
  );

  const renderRow = useCallback(
    ({ item }: { item: RoleplaySessionSummary }) => (
      <Row item={item} onPress={handlePress} />
    ),
    [handlePress],
  );

  return (
    <SafeAreaView className="flex-1 bg-surface-base" edges={["top"]}>
      <View className="flex-row items-center gap-3 border-b border-surface-divider px-4 py-3 md:px-8">
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Back"
          className="h-10 w-10 items-center justify-center rounded-full active:bg-surface-raised"
        >
          <Ionicons name="arrow-back" size={22} color={colors.ink.secondary} />
        </Pressable>
        <View className="flex-1">
          <Text className="text-xs font-semibold uppercase tracking-wider text-brand-600">
            Practice mode
          </Text>
          <Text className="text-2xl font-bold text-ink-primary">
            Roleplay history
          </Text>
        </View>
      </View>

      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={colors.brand[600]} />
        </View>
      ) : isError ? (
        <View className="flex-1 items-center justify-center gap-4 px-8">
          <Ionicons name="alert-circle-outline" size={28} color="#dc2626" />
          <Text className="text-base font-semibold text-ink-primary">
            Couldn&apos;t load history
          </Text>
          <Pressable
            onPress={() => refetch()}
            accessibilityRole="button"
            accessibilityLabel="Try again"
            className="rounded-sm bg-brand-600 px-6 py-2.5 active:bg-brand-700"
          >
            <Text className="text-sm font-semibold text-white">Try again</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={sessions}
          keyExtractor={(s) => s.id}
          renderItem={renderRow}
          contentContainerClassName="mx-auto w-full max-w-2xl gap-2 p-4 pb-10 md:px-8"
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={refetch}
              tintColor={colors.brand[600]}
            />
          }
          ListEmptyComponent={
            <View className="items-center gap-3 py-16">
              <View className="h-12 w-12 items-center justify-center rounded-full bg-surface-raised">
                <Ionicons
                  name="game-controller-outline"
                  size={22}
                  color={colors.ink.dim}
                />
              </View>
              <Text className="text-sm text-ink-muted">
                No roleplay sessions yet
              </Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}
