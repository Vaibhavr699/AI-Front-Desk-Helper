import { Stack } from "expo-router";

import { colors } from "@/src/shared/theme/tokens";

export default function RoleplayLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.surface.base },
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="scenario/[id]" />
      <Stack.Screen name="session/[id]" options={{ gestureEnabled: false }} />
      <Stack.Screen name="results/[id]" options={{ gestureEnabled: false }} />
    </Stack>
  );
}
