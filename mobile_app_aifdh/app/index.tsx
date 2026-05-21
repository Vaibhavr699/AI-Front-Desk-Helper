import { Redirect } from "expo-router";

import { useAuthStore } from "@/src/features/auth/store";

export default function IndexRoute() {
  const status = useAuthStore((s) => s.status);

  const isUnlocked = useAuthStore((s) => s.isUnlocked);
  const biometricEnrolled = useAuthStore((s) => s.biometricEnrolled);

  if (status === "booting") return null;
  if (status === "authenticated") {
    if (!isUnlocked && biometricEnrolled) {
      return <Redirect href="/(auth)/unlock" />;
    }
    return <Redirect href="/(tabs)" />;
  }
  if (status === "awaiting_totp") return <Redirect href="/(auth)/totp" />;
  return <Redirect href="/(auth)/welcome" />;
}
