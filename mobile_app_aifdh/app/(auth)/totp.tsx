import { Redirect } from "expo-router";

import { TotpScreen } from "@/src/features/auth/screens/totp-screen";
import { useAuthStore } from "@/src/features/auth/store";

export default function TotpRoute() {
  const status = useAuthStore((s) => s.status);

  if (status === "authenticated") return <Redirect href="/(tabs)" />;
  if (status === "unauthenticated") return <Redirect href="/(auth)/login" />;

  return <TotpScreen />;
}
