import { Redirect } from "expo-router";

import { LoginScreen } from "@/src/features/auth/screens/login-screen";
import { useAuthStore } from "@/src/features/auth/store";

export default function LoginRoute() {
  const status = useAuthStore((s) => s.status);

  if (status === "authenticated") return <Redirect href="/(tabs)" />;
  if (status === "awaiting_totp") return <Redirect href="/(auth)/totp" />;

  return <LoginScreen />;
}
