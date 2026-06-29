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

import { useInHomeSessions } from "../queries";
import type { InHomeSessionSummary } from "../types";

const OUTCOME_LABEL: Record<string, string> = {
  closed: "Closed",
  warm_followup: "Warm follow-up",
  stalled: "Stalled",
  lost: "Lost",
  completed: "Completed",
};

function fmtWhen(iso: string): string {
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
  item: InHomeSessionSummary;
  onPress: (s: InHomeSessionSummary) => void;
}) {
  const inProgress = !item.ended_at;
  return (
    <Pressable
      onPress={() => onPress(item)}
      accessibilityRole="button"
      accessibilityLabel="Open in-home session"
      className="flex-row items-center gap-3 rounded-sm bg-white p-3.5 active:bg-surface-raised"
    >
      <View className="h-10 w-10 items-center justify-center rounded-sm bg-brand-50">
        <Ionicons name="radio-outline" size={18} color={colors.brand[600]} />
      </View>
      <View className="flex-1 gap-0.5">
        <Text className="text-sm font-medium text-ink-primary">
          In-home visit
          {item.estimate_value_cents != null
            ? ` · $${(item.estimate_value_cents / 100).toLocaleString()}`
            : ""}
        </Text>
        <Text className="text-xs text-ink-muted">
          {fmtWhen(item.started_at)}
          {inProgress
            ? " · In progress"
            : item.outcome
              ? ` · ${OUTCOME_LABEL[item.outcome] ?? item.outcome}`
              : ""}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.ink.dim} />
    </Pressable>
  );
});

export function SessionHistoryScreen() {
  const router = useRouter();
  const { data, isLoading, isError, refetch, isRefetching } =
    useInHomeSessions();
  const sessions = data?.sessions ?? [];

  const handlePress = useCallback(
    (s: InHomeSessionSummary) => {
      router.push(`/(tabs)/coaching/live-session/${s.id}` as never);
    },
    [router],
  );

  const renderRow = useCallback(
    ({ item }: { item: InHomeSessionSummary }) => (
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
            Live coaching
          </Text>
          <Text className="text-2xl font-bold text-ink-primary">
            Live sessions
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
            Couldn&apos;t load sessions
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
          className="flex-1"
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
                <Ionicons name="radio-outline" size={22} color={colors.ink.dim} />
              </View>
              <Text className="text-sm text-ink-muted">
                No live sessions yet
              </Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}
