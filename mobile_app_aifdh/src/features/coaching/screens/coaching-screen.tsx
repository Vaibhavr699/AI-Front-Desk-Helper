import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { PendingUploadsBanner } from "@/src/features/field-recording/offline/components/pending-uploads-banner";
import { useResponsive } from "@/src/shared/hooks/use-responsive";
import { colors } from "@/src/shared/theme/tokens";

import { CoachingEmptyState } from "../components/coaching-empty-state";
import { FocusCard } from "../components/focus-card";
import { RecentConversationsCard } from "../components/recent-conversations-card";
import { ScoreSnapshot } from "../components/score-snapshot";
import { SkillsBreakdown } from "../components/skills-breakdown";
import { useCoachingMe } from "../queries";

export function CoachingScreen() {
  const router = useRouter();
  const { isTablet } = useResponsive();
  const { data, isLoading, isError, error, refetch, isRefetching } =
    useCoachingMe(30);

  const goPractice = () =>
    router.navigate("/(tabs)/coaching/roleplay" as never);

  return (
    <SafeAreaView className="flex-1 bg-surface-base" edges={["top"]}>
      <View className="px-6 pb-4 pt-6 md:px-8">
        <Text className="text-2xl font-bold text-ink-primary">My Coaching</Text>
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
            Couldn&apos;t load coaching
          </Text>
          <Text className="text-center text-sm text-ink-muted">
            {error instanceof Error
              ? error.message
              : "Check your connection and try again."}
          </Text>
          <Pressable
            onPress={() => refetch()}
            accessibilityRole="button"
            accessibilityLabel="Try again"
            className="h-11 items-center justify-center rounded-sm bg-brand-600 px-6 active:bg-brand-700"
          >
            <Text className="text-sm font-semibold text-white">Try again</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView
          contentContainerClassName="pb-10 pt-1"
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={refetch}
              tintColor={colors.brand[600]}
            />
          }
        >
          <View className="mx-auto w-full max-w-5xl gap-4 px-4 md:px-8">
            <PendingUploadsBanner />

            <Pressable
              onPress={() => router.navigate("/(tabs)/coaching/sessions" as never)}
              accessibilityRole="button"
              accessibilityLabel="View live sessions"
              className="flex-row items-center justify-between rounded-sm bg-white p-4 active:bg-surface-raised"
            >
              <View className="flex-row items-center gap-2.5">
                <View className="h-8 w-8 items-center justify-center rounded-sm bg-brand-50">
                  <Ionicons name="radio-outline" size={16} color={colors.brand[600]} />
                </View>
                <Text className="text-sm font-semibold text-ink-secondary">
                  Live sessions
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.ink.muted} />
            </Pressable>

            {data.overall.conversations === 0 ? (
              <CoachingEmptyState />
            ) : isTablet ? (
              <View className="flex-row gap-4">
                <View className="flex-1 gap-4">
                  <FocusCard
                    weakest={data.weakest_dimension}
                    onPractice={goPractice}
                  />
                  <ScoreSnapshot
                    avgScore={data.overall.avg_score}
                    conversations={data.overall.conversations}
                    windowDays={data.window_days}
                    trend={data.trend}
                  />
                  <RecentConversationsCard
                    conversations={data.recent_conversations}
                  />
                </View>
                <View className="flex-1 gap-4">
                  <SkillsBreakdown
                    dimensions={data.dimensions}
                    best={data.best_dimension}
                    weakest={data.weakest_dimension}
                    defaultOpen
                  />
                </View>
              </View>
            ) : (
              <View className="gap-4">
                <FocusCard
                  weakest={data.weakest_dimension}
                  onPractice={goPractice}
                />
                <ScoreSnapshot
                  avgScore={data.overall.avg_score}
                  conversations={data.overall.conversations}
                  windowDays={data.window_days}
                  trend={data.trend}
                />
                <RecentConversationsCard
                  conversations={data.recent_conversations}
                />
                <SkillsBreakdown
                  dimensions={data.dimensions}
                  best={data.best_dimension}
                  weakest={data.weakest_dimension}
                />
              </View>
            )}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
