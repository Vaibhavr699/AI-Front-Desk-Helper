import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { DiscBadge } from "@/src/features/appointments/components/disc-badge";
import { colors } from "@/src/shared/theme/tokens";

import { DifficultyStars } from "../components/difficulty-stars";
import { SkillChip } from "../components/skill-chip";
import { useScenarios, useStartSession } from "../queries";

const DISC_DESCRIPTIONS: Record<string, string> = {
  D: "Direct buyer. Move fast, lead with bottom line, defend ground.",
  I: "Story-driven buyer. Build energy, stay on agenda, paint outcomes.",
  S: "Steady buyer. Slow down, listen, secure clear next steps.",
  C: "Detail-driven buyer. Bring data, expect questions, avoid improvising.",
};

type Props = {
  scenarioId: string;
};

export function ScenarioSelectionScreen({ scenarioId }: Props) {
  const router = useRouter();
  const { data, isLoading, isError, error, refetch } = useScenarios();
  const start = useStartSession();

  const scenario = data?.scenarios.find((s) => s.id === scenarioId);

  function goBack() {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/coaching/roleplay");
  }

  async function handleStart() {
    if (!scenario || start.isPending) return;
    try {
      const result = await start.mutateAsync({ scenario_id: scenario.id });
      router.replace(
        `/(tabs)/coaching/roleplay/session/${result.session.id}` as never,
      );
    } catch (err) {
      Alert.alert(
        "Couldn't start",
        err instanceof Error ? err.message : "Try again in a moment.",
      );
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-surface-base" edges={["top"]}>
      <View className="flex-row items-center gap-3 px-4 pb-3 pt-4 md:px-8">
        <Pressable
          onPress={goBack}
          hitSlop={12}
          className="h-10 w-10 items-center justify-center rounded-full active:bg-surface-raised"
        >
          <Ionicons name="arrow-back" size={22} color={colors.ink.secondary} />
        </Pressable>
        <Text className="flex-1 text-base font-semibold text-ink-primary">
          Scenario preview
        </Text>
      </View>

      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={colors.brand[600]} />
        </View>
      ) : isError ? (
        <ErrorState message={extractMessage(error)} onRetry={refetch} />
      ) : !scenario ? (
        <ErrorState
          message="That scenario isn't available anymore."
          onRetry={refetch}
        />
      ) : (
        <ScrollView contentContainerClassName="px-4 pb-10 pt-2 md:px-8">
          <View className="mx-auto w-full max-w-2xl gap-4">
            <View className="gap-3 rounded-sm border border-surface-border bg-white p-5">
              <View className="flex-row items-start justify-between gap-3">
                <View className="flex-1 gap-2">
                  <Text className="text-2xl font-bold text-ink-primary">
                    {scenario.title}
                  </Text>
                  <DifficultyStars level={scenario.difficulty} size={16} />
                </View>
                <DiscBadge
                  primary={scenario.disc_type ?? null}
                  size="md"
                />
              </View>
              {scenario.description ? (
                <Text className="text-base leading-relaxed text-ink-secondary">
                  {scenario.description}
                </Text>
              ) : null}
            </View>

            {scenario.skills_trained.length > 0 ? (
              <View className="gap-3 rounded-sm border border-surface-border bg-white p-5">
                <Text className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
                  Skills trained
                </Text>
                <View className="flex-row flex-wrap gap-2">
                  {scenario.skills_trained.map((s) => (
                    <SkillChip key={s} label={s} />
                  ))}
                </View>
              </View>
            ) : null}

            {scenario.disc_type &&
            scenario.disc_type !== "unknown" &&
            DISC_DESCRIPTIONS[scenario.disc_type] ? (
              <View className="gap-3 rounded-sm border border-surface-border bg-white p-5">
                <Text className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
                  How this customer thinks
                </Text>
                <View className="flex-row items-center gap-3">
                  <DiscBadge primary={scenario.disc_type} size="md" />
                  <Text className="flex-1 text-sm leading-relaxed text-ink-secondary">
                    {DISC_DESCRIPTIONS[scenario.disc_type]}
                  </Text>
                </View>
              </View>
            ) : null}

            <View className="gap-2 rounded-sm border border-brand-200 bg-brand-50 p-4">
              <View className="flex-row items-center gap-2">
                <Ionicons
                  name="information-circle"
                  size={16}
                  color={colors.brand[700]}
                />
                <Text className="text-xs font-semibold uppercase tracking-wider text-brand-700">
                  How it works
                </Text>
              </View>
              <Text className="text-sm leading-relaxed text-ink-secondary">
                The AI plays this customer. You respond as the rep. When you
                end the session, you'll be scored on the same dimensions as
                your real calls.
              </Text>
            </View>

            <Pressable
              onPress={handleStart}
              disabled={start.isPending}
              className={`h-14 flex-row items-center justify-center gap-2 rounded-sm bg-brand-600 active:bg-brand-700 ${start.isPending ? "opacity-60" : ""}`}
            >
              <Ionicons name="play" size={18} color="#ffffff" />
              <Text className="text-base font-semibold text-white">
                {start.isPending ? "Starting…" : "Start roleplay"}
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
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
        Couldn't load scenario
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
