import { Ionicons } from "@expo/vector-icons";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useResponsive } from "@/src/shared/hooks/use-responsive";
import { colors } from "@/src/shared/theme/tokens";

import { DimensionsCard } from "../components/dimensions-card";
import { HighlightCard } from "../components/highlight-card";
import { OverallCard } from "../components/overall-card";
import { RecentConversationsCard } from "../components/recent-conversations-card";
import { StartRoleplayCard } from "../components/start-roleplay-card";
import { TipsCard } from "../components/tips-card";
import { TrendChart } from "../components/trend-chart";
import { useCoachingMe } from "../queries";

export function CoachingScreen() {
  const { isTablet } = useResponsive();
  const { data, isLoading, isError, error, refetch, isRefetching } =
    useCoachingMe(30);

  return (
    <SafeAreaView className="flex-1 bg-surface-base" edges={["top"]}>
      <Header />
      {isLoading ? (
        <LoadingState />
      ) : isError || !data ? (
        <ErrorState message={extractMessage(error)} onRetry={refetch} />
      ) : (
        <ScrollView
          contentContainerClassName="pb-10 pt-2"
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={refetch}
              tintColor={colors.brand[600]}
            />
          }
        >
          <View className="mx-auto w-full max-w-5xl gap-4 px-4 md:px-8">
            {data.overall.conversations === 0 ? (
              <EmptyState />
            ) : null}

            {isTablet ? (
              <View className="flex-row gap-4">
                <View className="flex-1 gap-4">
                  <OverallCard
                    avgScore={data.overall.avg_score}
                    conversations={data.overall.conversations}
                    windowDays={data.window_days}
                  />
                  <TrendChart trend={data.trend} />
                  <View className="flex-row gap-3">
                    <HighlightCard kind="best" dimension={data.best_dimension} />
                    <HighlightCard
                      kind="weakest"
                      dimension={data.weakest_dimension}
                    />
                  </View>
                  <StartRoleplayCard />
                </View>
                <View className="flex-1 gap-4">
                  <DimensionsCard dimensions={data.dimensions} />
                  <TipsCard
                    weakestDimension={data.weakest_dimension?.dimension ?? null}
                  />
                  <RecentConversationsCard
                    conversations={data.recent_conversations}
                  />
                </View>
              </View>
            ) : (
              <View className="gap-4">
                <OverallCard
                  avgScore={data.overall.avg_score}
                  conversations={data.overall.conversations}
                  windowDays={data.window_days}
                />
                <TrendChart trend={data.trend} />
                <View className="flex-row gap-3">
                  <HighlightCard kind="best" dimension={data.best_dimension} />
                  <HighlightCard
                    kind="weakest"
                    dimension={data.weakest_dimension}
                  />
                </View>
                <DimensionsCard dimensions={data.dimensions} />
                <TipsCard
                  weakestDimension={data.weakest_dimension?.dimension ?? null}
                />
                <RecentConversationsCard
                  conversations={data.recent_conversations}
                />
                <StartRoleplayCard />
              </View>
            )}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function Header() {
  return (
    <View className="px-6 pb-3 pt-6 md:px-8">
      <Text className="text-xs font-semibold uppercase tracking-wider text-brand-600">
        Your performance
      </Text>
      <Text className="mt-1 text-3xl font-bold text-ink-primary">
        My Coaching
      </Text>
    </View>
  );
}

function LoadingState() {
  return (
    <View className="flex-1 items-center justify-center">
      <ActivityIndicator color={colors.brand[600]} />
    </View>
  );
}

function EmptyState() {
  return (
    <View className="gap-3 rounded-2xl border border-dashed border-surface-border bg-white p-5">
      <View className="flex-row items-center gap-2">
        <Ionicons name="information-circle-outline" size={18} color={colors.ink.muted} />
        <Text className="text-sm font-medium text-ink-secondary">
          No coaching data yet
        </Text>
      </View>
      <Text className="text-sm leading-relaxed text-ink-muted">
        Once your calls and in-home conversations start getting scored, your
        trends, dimension breakdowns, and personalized tips will land here.
      </Text>
    </View>
  );
}

function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <View className="flex-1 items-center justify-center gap-4 px-8">
      <Ionicons name="alert-circle-outline" size={32} color="#dc2626" />
      <Text className="text-base font-semibold text-ink-primary">
        Couldn't load coaching
      </Text>
      <Text className="text-center text-sm text-ink-muted">{message}</Text>
      <Pressable
        onPress={onRetry}
        className="h-11 items-center justify-center rounded-xl bg-brand-600 px-6 active:bg-brand-700"
      >
        <Text className="text-sm font-semibold text-white">Try again</Text>
      </Pressable>
    </View>
  );
}

function extractMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return "Please check your connection and try again.";
}
