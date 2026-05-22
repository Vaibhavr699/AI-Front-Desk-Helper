import { Redirect } from "expo-router";

import { useAuthStore } from "@/src/features/auth/store";

export default function IndexRoute() {
  const status = useAuthStore((s) => s.status);
  const isUnlocked = useAuthStore((s) => s.isUnlocked);
  const biometricEnrolled = useAuthStore((s) => s.biometricEnrolled);
  const capability = useAuthStore((s) => s.biometricCapability);
  const enrollPromptDismissed = useAuthStore((s) => s.enrollPromptDismissed);

  if (status === "booting") return null;
  if (status === "authenticated") {
    if (!isUnlocked && biometricEnrolled) {
      return <Redirect href="/(auth)/unlock" />;
    }
    const shouldOfferEnroll =
      !biometricEnrolled &&
      !enrollPromptDismissed &&
      !!capability?.hasHardware &&
      !!capability?.hasEnrolledInOs;
    if (shouldOfferEnroll) {
      return <Redirect href="/(auth)/enroll-biometric" />;
    }
    return <Redirect href="/(tabs)" />;
  }
  if (status === "awaiting_totp") return <Redirect href="/(auth)/totp" />;
  return <Redirect href="/(auth)/welcome" />;
}
