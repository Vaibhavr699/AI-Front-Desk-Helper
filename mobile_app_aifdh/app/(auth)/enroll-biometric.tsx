import { Redirect } from "expo-router";

import { EnrollBiometricScreen } from "@/src/features/auth/screens/enroll-biometric-screen";
import { useAuthStore } from "@/src/features/auth/store";

export default function EnrollBiometricRoute() {
  const status = useAuthStore((s) => s.status);
  const biometricEnrolled = useAuthStore((s) => s.biometricEnrolled);
  const capability = useAuthStore((s) => s.biometricCapability);

  if (status === "booting") return null;
  if (status !== "authenticated") return <Redirect href="/(auth)/welcome" />;
  if (biometricEnrolled) return <Redirect href="/(tabs)" />;
  if (!capability?.hasHardware || !capability.hasEnrolledInOs) {
    return <Redirect href="/(tabs)" />;
  }
  return <EnrollBiometricScreen />;
}
