import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useMemo } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { colors } from "@/src/shared/theme/tokens";

import { scoreToColor } from "../lib/format";
import { useCoachingHistory } from "../queries";
import type { HistoryConversation } from "../types";

function formatWhen(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function Row({ item }: { item: HistoryConversation }) {
  const router = useRouter();
  const score = item.overall_score;
  const swatch = score != null ? scoreToColor(score) : null;
  const title = item.lead_name
    ? item.lead_name
    : item.outcome
      ? item.outcome.replace(/_/g, " ").replace(/^\w/, (m) => m.toUpperCase())
      : "Conversation";
  return (
    <Pressable
      onPress={() => router.push(`/(tabs)/coaching/conversation/${item.id}`)}
      className="flex-row items-center gap-3 rounded-sm bg-white p-3.5 active:bg-surface-raised"
    >
      <View
        className={`h-11 w-11 items-center justify-center rounded-sm ${swatch?.bg ?? "bg-surface-raised"}`}
      >
        <Text className={`text-sm font-bold ${swatch?.text ?? "text-ink-dim"}`}>
          {score != null ? score.toFixed(1) : "—"}
        </Text>
      </View>
      <View className="flex-1 gap-0.5">
        <Text className="text-sm font-medium text-ink-primary" numberOfLines={1}>
          {title}
        </Text>
        <Text className="text-xs text-ink-muted">
          {formatWhen(item.scored_at || item.created_at)}
          {item.disc_primary && item.disc_primary !== "unknown" ? ` · DISC ${item.disc_primary}` : ""}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.ink.dim} />
    </Pressable>
  );
}

export function HistoryScreen() {
  const router = useRouter();
  const { data, isLoading, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useCoachingHistory(30);

  const conversations = useMemo(
    () => data?.pages.flatMap((p) => p.conversations) ?? [],
    [data],
  );

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
          <Text className="text-lg font-semibold text-ink-primary">History</Text>
          <Text className="text-xs text-ink-muted">Last 30 days</Text>
        </View>
      </View>

      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={colors.brand[600]} />
        </View>
      ) : isError ? (
        <View className="flex-1 items-center justify-center gap-4 px-8">
          <Ionicons name="alert-circle-outline" size={28} color="#dc2626" />
          <Pressable
            onPress={() => refetch()}
            className="rounded-sm bg-brand-600 px-6 py-2.5 active:bg-brand-700"
          >
            <Text className="text-sm font-semibold text-white">Try again</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={conversations}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <Row item={item} />}
          contentContainerClassName="gap-2 p-4 pb-10"
          onEndReachedThreshold={0.4}
          onEndReached={() => {
            if (hasNextPage && !isFetchingNextPage) fetchNextPage();
          }}
          ListEmptyComponent={
            <View className="items-center gap-3 py-16">
              <View className="h-12 w-12 items-center justify-center rounded-full bg-surface-raised">
                <Ionicons name="chatbubbles-outline" size={22} color={colors.ink.dim} />
              </View>
              <Text className="text-sm text-ink-muted">No conversations in the last 30 days</Text>
            </View>
          }
          ListFooterComponent={
            isFetchingNextPage ? (
              <View className="py-4">
                <ActivityIndicator color={colors.brand[600]} />
              </View>
            ) : null
          }
        />
      )}
    </SafeAreaView>
  );
}
