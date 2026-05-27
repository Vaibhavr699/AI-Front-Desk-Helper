import { Stack } from "expo-router";

import { colors } from "@/src/shared/theme/tokens";

export default function LeadsLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.surface.base },
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="create" options={{ presentation: "modal" }} />
      <Stack.Screen name="[id]" />
    </Stack>
  );
}
