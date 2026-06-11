import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useResponsive } from "@/src/shared/hooks/use-responsive";
import { colors } from "@/src/shared/theme/tokens";

import { CustomScenarioModal } from "../components/custom-scenario-modal";
import { ScenarioCard } from "../components/scenario-card";
import { useScenarios } from "../queries";
import type { RoleplayScenario } from "../types";

export function RoleplayHubScreen() {
  const router = useRouter();
  const { isTablet } = useResponsive();
  const { data, isLoading, isError, error, refetch, isRefetching } =
    useScenarios();
  const [showCustom, setShowCustom] = useState(false);

  const scenarios = data?.scenarios ?? [];

  const handleScenarioPress = useCallback(
    (scenario: RoleplayScenario) => {
      router.push(`/(tabs)/coaching/roleplay/scenario/${scenario.id}`);
    },
    [router],
  );

  const renderScenario = useCallback(
    ({ item }: { item: RoleplayScenario }) => (
      <ScenarioCard scenario={item} onPress={handleScenarioPress} />
    ),
    [handleScenarioPress],
  );

  return (
    <SafeAreaView className="flex-1 bg-surface-base" edges={["top"]}>
      <Header onBack={() => router.back()} />
      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={colors.brand[600]} />
        </View>
      ) : isError ? (
        <ErrorState message={extractMessage(error)} onRetry={refetch} />
      ) : (
        <FlatList
          data={scenarios}
          keyExtractor={(s) => s.id}
          numColumns={isTablet ? 2 : 1}
          key={isTablet ? "two" : "one"}
          columnWrapperStyle={isTablet ? { gap: 12 } : undefined}
          contentContainerClassName="gap-3 px-4 pb-10 pt-2 md:px-8"
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={refetch}
              tintColor={colors.brand[600]}
            />
          }
          ListHeaderComponent={
            <View className="mb-4 gap-3">
              <Text className="text-sm leading-relaxed text-ink-secondary">
                Practice in-home conversations with an AI customer before you
                walk into the real visit. Pick a scenario that tests where
                you're weakest.
              </Text>
              <View className="flex-row gap-2">
                <CtaPill
                  icon="add-circle"
                  label="Create custom"
                  onPress={() => setShowCustom(true)}
                />
                <CtaPill
                  icon="time-outline"
                  label="History"
                  onPress={() =>
                    router.navigate(
                      "/(tabs)/coaching/roleplay/history" as never,
                    )
                  }
                />
              </View>
            </View>
          }
          renderItem={renderScenario}
          ListEmptyComponent={
            <View className="items-center gap-2 px-8 py-12">
              <Ionicons
                name="game-controller-outline"
                size={28}
                color={colors.ink.muted}
              />
              <Text className="text-sm text-ink-muted">
                No scenarios available yet.
              </Text>
            </View>
          }
        />
      )}
      <CustomScenarioModal
        visible={showCustom}
        onClose={() => setShowCustom(false)}
      />
    </SafeAreaView>
  );
}

function Header({ onBack }: { onBack: () => void }) {
  return (
    <View className="flex-row items-center gap-3 px-4 pb-3 pt-4 md:px-8">
      <Pressable
        onPress={onBack}
        hitSlop={12}
        className="h-10 w-10 items-center justify-center rounded-full active:bg-surface-raised"
      >
        <Ionicons name="arrow-back" size={22} color={colors.ink.secondary} />
      </Pressable>
      <View className="flex-1">
        <Text className="text-xs font-semibold uppercase tracking-wider text-brand-600">
          Practice mode
        </Text>
        <Text className="text-2xl font-bold text-ink-primary">AI Roleplay</Text>
      </View>
    </View>
  );
}

function CtaPill({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center gap-1.5 rounded-full border border-surface-border bg-white px-3 py-2 active:bg-surface-raised"
    >
      <Ionicons name={icon} size={14} color={colors.brand[600]} />
      <Text className="text-xs font-semibold text-ink-primary">{label}</Text>
    </Pressable>
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
        Couldn't load scenarios
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
