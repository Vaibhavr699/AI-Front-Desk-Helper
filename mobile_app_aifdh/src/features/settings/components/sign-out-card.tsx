import { Ionicons } from "@expo/vector-icons";
import { Alert, Pressable, Text } from "react-native";

import { useAuthStore } from "@/src/features/auth/store";

export function SignOutCard() {
  const signOut = useAuthStore((s) => s.signOut);
  const isBusy = useAuthStore((s) => s.isBusy);

  function confirm() {
    Alert.alert("Sign out?", "You'll need to re-enter your password and TOTP code on next sign-in.", [
      { text: "Cancel", style: "cancel" },
      { text: "Sign out", style: "destructive", onPress: () => signOut() },
    ]);
  }

  return (
    <Pressable
      onPress={confirm}
      disabled={isBusy}
      className="h-12 flex-row items-center justify-center gap-2 rounded-2xl border border-red-200 bg-red-50 active:bg-red-100"
    >
      <Ionicons name="log-out-outline" size={18} color="#b91c1c" />
      <Text className="text-sm font-semibold text-red-700">
        {isBusy ? "Signing out…" : "Sign out"}
      </Text>
    </Pressable>
  );
}
