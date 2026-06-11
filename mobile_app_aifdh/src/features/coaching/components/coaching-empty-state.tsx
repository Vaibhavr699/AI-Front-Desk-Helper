import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Pressable, Text, View } from "react-native";

import { colors } from "@/src/shared/theme/tokens";

const SKILLS = [
  "Rapport",
  "Discovery",
  "Walkthrough",
  "Education",
  "Value framing",
  "Objection handling",
  "Closing",
  "Professionalism",
];

export function CoachingEmptyState() {
  const router = useRouter();

  return (
    <View className="gap-4">
      <View className="items-center gap-4 rounded-sm border border-brand-100 bg-white p-6">
        <View className="h-16 w-16 items-center justify-center rounded-full bg-brand-50">
          <Ionicons name="school-outline" size={30} color={colors.brand[600]} />
        </View>
        <View className="gap-1.5">
          <Text className="text-center text-xl font-bold text-ink-primary">
            Your coaching starts after your first call
          </Text>
          <Text className="text-center text-sm leading-relaxed text-ink-muted">
            Record a real visit or run a roleplay. We score 8 selling skills and
            show you exactly what to work on next.
          </Text>
        </View>
        <View className="w-full gap-2.5 pt-1">
          <Pressable
            onPress={() => router.navigate("/(tabs)/coaching/roleplay" as never)}
            accessibilityRole="button"
            accessibilityLabel="Try a roleplay"
            className="h-12 flex-row items-center justify-center gap-2 rounded-sm bg-brand-600 active:bg-brand-700"
          >
            <Ionicons name="play" size={16} color="#ffffff" />
            <Text className="text-sm font-semibold text-white">
              Try a roleplay
            </Text>
          </Pressable>
          <Pressable
            onPress={() => router.navigate("/(tabs)/leads" as never)}
            accessibilityRole="button"
            accessibilityLabel="Record a customer visit"
            className="h-12 flex-row items-center justify-center gap-2 rounded-sm border border-surface-border active:bg-surface-raised"
          >
            <Ionicons name="mic-outline" size={16} color={colors.brand[600]} />
            <Text className="text-sm font-semibold text-ink-primary">
              Record a customer visit
            </Text>
          </Pressable>
        </View>
      </View>

      <View className="gap-2.5 rounded-sm bg-white p-5">
        <Text className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
          You&apos;ll be coached on
        </Text>
        <View className="flex-row flex-wrap gap-2">
          {SKILLS.map((s) => (
            <View key={s} className="rounded-full bg-surface-raised px-3 py-1.5">
              <Text className="text-xs font-medium text-ink-secondary">{s}</Text>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}
