import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Pressable, Text, View } from "react-native";

import { colors } from "@/src/shared/theme/tokens";

export function StartRoleplayCard() {
  const router = useRouter();

  function onPress() {
    router.push("/(tabs)/coaching/roleplay");
  }

  return (
    <Pressable
      onPress={onPress}
      className="gap-3 rounded-2xl border border-brand-200 bg-brand-50 p-5 active:bg-brand-100"
    >
      <View className="flex-row items-center gap-2">
        <Ionicons name="play-circle" size={18} color={colors.brand[700]} />
        <Text className="text-xs font-semibold uppercase tracking-wider text-brand-700">
          AI Roleplay
        </Text>
      </View>
      <Text className="text-lg font-semibold text-ink-primary">
        Practice before your next visit
      </Text>
      <Text className="text-sm leading-relaxed text-ink-secondary">
        Run through real-world scenarios with an AI customer. Build confidence on the dimensions you struggle with most.
      </Text>
      <View className="flex-row items-center gap-2 self-start rounded-full bg-white px-3 py-1.5">
        <Text className="text-xs font-semibold text-brand-700">Open Roleplay</Text>
        <Ionicons name="arrow-forward" size={12} color={colors.brand[700]} />
      </View>
    </Pressable>
  );
}
