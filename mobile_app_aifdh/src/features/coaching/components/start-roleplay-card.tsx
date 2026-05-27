import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Pressable, Text, View } from "react-native";

import { colors } from "@/src/shared/theme/tokens";

export function StartRoleplayCard() {
  const router = useRouter();

  return (
    <Pressable
      onPress={() => router.push("/(tabs)/coaching/roleplay")}
      className="flex-row items-center gap-4 rounded-sm bg-brand-600 p-5 active:bg-brand-700"
    >
      <View className="h-12 w-12 items-center justify-center rounded-xl bg-white/20">
        <Ionicons name="mic-outline" size={22} color="#fff" />
      </View>
      <View className="flex-1 gap-1">
        <Text className="text-base font-semibold text-white">
          Practice with AI Roleplay
        </Text>
        <Text className="text-sm text-white/70">
          Run scenarios before your next visit
        </Text>
      </View>
      <Ionicons name="arrow-forward" size={18} color="rgba(255,255,255,0.6)" />
    </Pressable>
  );
}
