import { Redirect } from "expo-router";

import { WelcomeScreen } from "@/src/features/auth/screens/welcome-screen";
import { useAuthStore } from "@/src/features/auth/store";

export default function WelcomeRoute() {
  const status = useAuthStore((s) => s.status);

  if (status === "authenticated") return <Redirect href="/" />;
  if (status === "awaiting_totp") return <Redirect href="/(auth)/totp" />;

  return <WelcomeScreen />;
}
