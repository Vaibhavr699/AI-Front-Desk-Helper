import { Ionicons } from "@expo/vector-icons";
import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { colors } from "@/src/shared/theme/tokens";

import { BrandMark } from "../components/brand-mark";
import { useAuthStore } from "../store";

export function UnlockScreen() {
  const user = useAuthStore((s) => s.user);
  const biometricType = useAuthStore((s) => s.biometricType);
  const unlock = useAuthStore((s) => s.unlock);
  const signOut = useAuthStore((s) => s.signOut);
  const lastError = useAuthStore((s) => s.lastError);
  const clearError = useAuthStore((s) => s.clearError);

  const [busy, setBusy] = useState(false);
  const triggeredRef = useRef(false);

  const label =
    biometricType === "face_id"
      ? "Face ID"
      : biometricType === "touch_id"
        ? "Touch ID"
        : "Biometric";

  const iconName: "scan" | "finger-print" =
    biometricType === "face_id" ? "scan" : "finger-print";

  async function attempt() {
    if (busy) return;
    setBusy(true);
    clearError();
    await unlock();
    setBusy(false);
  }

  useEffect(() => {
    if (triggeredRef.current) return;
    triggeredRef.current = true;
    attempt();
  }, []);

  return (
    <SafeAreaView className="flex-1 bg-surface-base">
      <View className="flex-1 justify-between px-6 pb-8 pt-12 md:px-12">
        <View className="flex-1 items-center justify-center">
          <View className="items-center gap-6 md:gap-8">
            <BrandMark size={96} />
            <View className="items-center gap-2">
              <Text className="text-3xl font-bold text-ink-primary">
                Welcome back
              </Text>
              {user ? (
                <Text className="text-center text-sm text-ink-muted">
                  {user.email}
                </Text>
              ) : null}
            </View>

            <Pressable
              onPress={attempt}
              disabled={busy}
              className="mt-4 h-20 w-20 items-center justify-center rounded-full bg-brand-50 active:bg-brand-100"
            >
              <Ionicons name={iconName} size={40} color={colors.brand[600]} />
            </Pressable>

            <Text className="text-sm font-medium text-brand-700">
              {busy ? "Verifying…" : `Unlock with ${label}`}
            </Text>

            {lastError ? (
              <View className="w-full rounded-xl border border-red-200 bg-red-50 px-4 py-3">
                <Text className="text-center text-sm text-red-700">
                  {lastError}
                </Text>
              </View>
            ) : null}
          </View>
        </View>

        <View className="mx-auto w-full max-w-md gap-3">
          <Pressable
            onPress={attempt}
            disabled={busy}
            className={`h-14 items-center justify-center rounded-2xl bg-brand-600 active:bg-brand-700 ${busy ? "opacity-60" : ""}`}
          >
            <Text className="text-base font-semibold text-white">
              {busy ? "Verifying…" : `Use ${label}`}
            </Text>
          </Pressable>
          <Pressable
            onPress={signOut}
            disabled={busy}
            className="h-12 items-center justify-center rounded-2xl active:bg-surface-raised"
          >
            <Text className="text-sm font-medium text-ink-secondary">
              Sign in with password instead
            </Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}
