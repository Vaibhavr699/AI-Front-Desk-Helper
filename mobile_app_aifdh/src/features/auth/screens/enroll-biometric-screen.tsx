import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { colors } from "@/src/shared/theme/tokens";

import { BrandMark } from "../components/brand-mark";
import { useAuthStore } from "../store";

export function EnrollBiometricScreen() {
  const router = useRouter();
  const capability = useAuthStore((s) => s.biometricCapability);
  const enrollBiometric = useAuthStore((s) => s.enrollBiometric);
  const dismissEnrollPrompt = useAuthStore((s) => s.dismissEnrollPrompt);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const label = capability?.label ?? "Biometric";
  const iconName: "scan" | "finger-print" =
    capability?.type === "face_id" ? "scan" : "finger-print";

  function goHome() {
    router.replace("/(tabs)");
  }

  async function handleEnable() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await enrollBiometric();
    setBusy(false);
    if (result.success) {
      goHome();
      return;
    }
    if (result.reason) setError(result.reason);
  }

  function handleSkip() {
    dismissEnrollPrompt();
    goHome();
  }

  return (
    <SafeAreaView className="flex-1 bg-surface-base">
      <View className="flex-1 justify-between px-6 pb-8 pt-12 md:px-12">
        <View className="flex-1 items-center justify-center">
          <View className="items-center gap-6 md:gap-8">
            <BrandMark size={84} />
            <View className="items-center gap-2">
              <Text className="text-3xl font-bold text-ink-primary md:text-4xl">
                Sign in faster
              </Text>
              <Text className="max-w-sm text-center text-base text-ink-muted">
                Use {label} so you can open the app each morning without typing
                your password.
              </Text>
            </View>

            <View className="mt-2 h-24 w-24 items-center justify-center rounded-full bg-brand-50">
              <Ionicons name={iconName} size={48} color={colors.brand[600]} />
            </View>

            {error ? (
              <View className="w-full max-w-sm rounded-xl border border-red-200 bg-red-50 px-4 py-3">
                <Text className="text-center text-sm text-red-700">{error}</Text>
              </View>
            ) : null}
          </View>
        </View>

        <View className="mx-auto w-full max-w-md gap-3">
          <Pressable
            onPress={handleEnable}
            disabled={busy}
            className={`h-14 items-center justify-center rounded-2xl bg-brand-600 active:bg-brand-700 ${busy ? "opacity-60" : ""}`}
          >
            <Text className="text-base font-semibold text-white">
              {busy ? "Setting up…" : `Enable ${label}`}
            </Text>
          </Pressable>
          <Pressable
            onPress={handleSkip}
            disabled={busy}
            className="h-12 items-center justify-center rounded-2xl active:bg-surface-raised"
          >
            <Text className="text-sm font-medium text-ink-secondary">
              Not now
            </Text>
          </Pressable>
          <Text className="text-center text-xs text-ink-dim">
            You can change this later in Settings.
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}
