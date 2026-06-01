import { Ionicons } from "@expo/vector-icons";
import { Text, View } from "react-native";

import { colors } from "@/src/shared/theme/tokens";

export function RepCoachHomeState() {
  return (
    <View className="flex-1 items-center justify-center px-8 py-16">
      <View className="h-16 w-16 items-center justify-center rounded-full bg-surface-raised">
        <Ionicons name="radio-outline" size={32} color={colors.brand[600]} />
      </View>
      <Text className="mt-4 text-lg font-semibold text-ink-primary">
        Ready to coach
      </Text>
      <Text className="mt-1 text-center text-sm text-ink-muted">
        Start a live session when you walk into your next visit and you'll get
        real-time coaching cues.
      </Text>
    </View>
  );
}
