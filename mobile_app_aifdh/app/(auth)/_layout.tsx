import { Stack } from "expo-router";

import { colors } from "@/src/shared/theme/tokens";

export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: "slide_from_right",
        contentStyle: { backgroundColor: colors.surface.base },
      }}
    >
      <Stack.Screen name="welcome" options={{ animation: "fade" }} />
      <Stack.Screen name="login" />
      <Stack.Screen name="otp" />
      <Stack.Screen name="unlock" options={{ animation: "fade" }} />
      <Stack.Screen name="enroll-biometric" options={{ animation: "fade" }} />
      <Stack.Screen name="forgot-password" />
    </Stack>
  );
}
