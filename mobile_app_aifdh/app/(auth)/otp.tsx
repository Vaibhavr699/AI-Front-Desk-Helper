import { Redirect } from "expo-router";

import { OtpScreen } from "@/src/features/auth/screens/otp-screen";
import { useAuthStore } from "@/src/features/auth/store";

export default function OtpRoute() {
  const status = useAuthStore((s) => s.status);

  if (status === "authenticated") return <Redirect href="/" />;
  if (status === "unauthenticated") return <Redirect href="/(auth)/login" />;

  return <OtpScreen />;
}
