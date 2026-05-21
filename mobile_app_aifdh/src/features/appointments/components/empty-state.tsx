import { Ionicons } from "@expo/vector-icons";
import { Text, View } from "react-native";

import { colors } from "@/src/shared/theme/tokens";

export function EmptyState() {
  return (
    <View className="flex-1 items-center justify-center px-8 py-16">
      <View className="h-16 w-16 items-center justify-center rounded-full bg-surface-raised">
        <Ionicons name="calendar-outline" size={32} color={colors.ink.muted} />
      </View>
      <Text className="mt-4 text-lg font-semibold text-ink-primary">
        No appointments today
      </Text>
      <Text className="mt-1 text-center text-sm text-ink-muted">
        When new in-home visits are scheduled, they'll appear here.
      </Text>
    </View>
  );
}
