import { Redirect } from "expo-router";

import { UnlockScreen } from "@/src/features/auth/screens/unlock-screen";
import { useAuthStore } from "@/src/features/auth/store";

export default function UnlockRoute() {
  const status = useAuthStore((s) => s.status);
  const isUnlocked = useAuthStore((s) => s.isUnlocked);
  const biometricEnrolled = useAuthStore((s) => s.biometricEnrolled);

  if (status === "booting") return null;
  if (status !== "authenticated") return <Redirect href="/(auth)/welcome" />;
  if (isUnlocked || !biometricEnrolled) return <Redirect href="/(tabs)" />;
  return <UnlockScreen />;
}
