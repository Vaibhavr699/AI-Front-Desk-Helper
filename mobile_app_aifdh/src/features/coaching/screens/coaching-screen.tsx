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
      <View className="flex-row items-center gap-3 px-6 pb-4 pt-6 md:px-8">
        <View className="h-10 w-10 items-center justify-center rounded-xl bg-brand-50">
          <Ionicons name="stats-chart" size={20} color={colors.brand[600]} />
        </View>
        <View>
          <Text className="text-2xl font-bold text-ink-primary">My Coaching</Text>
          <Text className="text-xs text-ink-muted">Your performance overview</Text>
        </View>
      </View>
      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={colors.brand[600]} />
        </View>
      ) : isError || !data ? (
        <View className="flex-1 items-center justify-center gap-4 px-8">
          <View className="h-14 w-14 items-center justify-center rounded-full bg-red-50">
            <Ionicons name="alert-circle-outline" size={28} color="#dc2626" />
          </View>
          <Text className="text-base font-semibold text-ink-primary">
            Couldn't load coaching
          </Text>
          <Text className="text-center text-sm text-ink-muted">
            {error instanceof Error ? error.message : "Check your connection and try again."}
          </Text>
          <Pressable
            onPress={refetch}
            className="h-11 items-center justify-center rounded-xl bg-brand-600 px-6 active:bg-brand-700"
          >
            <Text className="text-sm font-semibold text-white">Try again</Text>
          </Pressable>
        </View>
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
            {data.overall.conversations === 0 && (
              <View className="flex-row items-center gap-3 rounded-2xl bg-brand-50 p-4">
                <Ionicons name="sparkles-outline" size={20} color={colors.brand[600]} />
                <View className="flex-1">
                  <Text className="text-sm font-medium text-brand-700">
                    No coaching data yet
                  </Text>
                  <Text className="text-xs text-brand-600/70">
                    Start a roleplay or in-home session to see your scores here
                  </Text>
                </View>
              </View>
            )}

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
                    <HighlightCard kind="weakest" dimension={data.weakest_dimension} />
                  </View>
                  <StartRoleplayCard />
                </View>
                <View className="flex-1 gap-4">
                  <DimensionsCard dimensions={data.dimensions} />
                  <TipsCard weakestDimension={data.weakest_dimension?.dimension ?? null} />
                  <RecentConversationsCard conversations={data.recent_conversations} />
                </View>
              </View>
            ) : (
              <View className="gap-4">
                <OverallCard
                  avgScore={data.overall.avg_score}
                  conversations={data.overall.conversations}
                  windowDays={data.window_days}
                />
                <View className="flex-row gap-3">
                  <HighlightCard kind="best" dimension={data.best_dimension} />
                  <HighlightCard kind="weakest" dimension={data.weakest_dimension} />
                </View>
                <TrendChart trend={data.trend} />
                <DimensionsCard dimensions={data.dimensions} />
                <TipsCard weakestDimension={data.weakest_dimension?.dimension ?? null} />
                <StartRoleplayCard />
                <RecentConversationsCard conversations={data.recent_conversations} />
              </View>
            )}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
