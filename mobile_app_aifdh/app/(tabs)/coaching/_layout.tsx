import { Stack } from "expo-router";

import { colors } from "@/src/shared/theme/tokens";

export default function CoachingLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.surface.base },
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="roleplay" />
    </Stack>
  );
}
