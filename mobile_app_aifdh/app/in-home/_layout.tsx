import { Stack } from "expo-router";

import { useAuthStore } from "@/src/features/auth/store";
import { colors } from "@/src/shared/theme/tokens";
import { Redirect } from "expo-router";

export default function InHomeLayout() {
  const status = useAuthStore((s) => s.status);
  const isUnlocked = useAuthStore((s) => s.isUnlocked);
  const biometricEnrolled = useAuthStore((s) => s.biometricEnrolled);

  if (status !== "authenticated") {
    return <Redirect href="/(auth)/welcome" />;
  }
  if (!isUnlocked && biometricEnrolled) {
    return <Redirect href="/(auth)/unlock" />;
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.surface.base },
      }}
    >
      <Stack.Screen name="prepare/[leadId]" />
      <Stack.Screen
        name="live/[sessionId]"
        options={{ gestureEnabled: false }}
      />
    </Stack>
  );
}
