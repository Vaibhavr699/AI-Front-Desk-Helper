import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { Alert, Switch, Text, View } from "react-native";

import {
  getBiometricCapability,
  type BiometricCapability,
} from "@/src/features/auth/biometric";
import { useAuthStore } from "@/src/features/auth/store";
import { colors } from "@/src/shared/theme/tokens";

export function BiometricCard() {
  const biometricEnrolled = useAuthStore((s) => s.biometricEnrolled);
  const enrollBiometric = useAuthStore((s) => s.enrollBiometric);
  const disableBiometric = useAuthStore((s) => s.disableBiometric);

  const [cap, setCap] = useState<BiometricCapability | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getBiometricCapability().then(setCap);
  }, []);

  async function toggle(next: boolean) {
    if (busy) return;
    setBusy(true);
    if (next) {
      const result = await enrollBiometric();
      if (!result.success && result.reason) {
        Alert.alert("Can't enable", result.reason);
      }
    } else {
      Alert.alert(
        "Turn off biometric unlock?",
        "You'll be asked for your password and TOTP code every time you re-open the app.",
        [
          { text: "Cancel", style: "cancel", onPress: () => setBusy(false) },
          {
            text: "Turn off",
            style: "destructive",
            onPress: async () => {
              await disableBiometric();
              setBusy(false);
            },
          },
        ],
      );
      return;
    }
    setBusy(false);
  }

  const supported = cap?.hasHardware ?? false;
  const enrolledInOs = cap?.hasEnrolledInOs ?? false;
  const label = cap?.label ?? "Biometric";

  return (
    <View className="gap-4 rounded-2xl border border-surface-border bg-white p-5">
      <View className="flex-row items-center gap-2">
        <Ionicons name="finger-print-outline" size={16} color={colors.ink.secondary} />
        <Text className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
          Biometric unlock
        </Text>
      </View>

      <View className="flex-row items-center gap-3">
        <View className="flex-1 gap-0.5">
          <Text className="text-sm font-medium text-ink-primary">
            Unlock with {label}
          </Text>
          <Text className="text-xs text-ink-muted">
            {supported && enrolledInOs
              ? `Skip password + TOTP when re-opening on this device.`
              : !supported
                ? `This device doesn't support biometric authentication.`
                : `Set up ${label} in your device settings first.`}
          </Text>
        </View>
        <Switch
          value={biometricEnrolled && supported && enrolledInOs}
          onValueChange={toggle}
          disabled={!supported || !enrolledInOs || busy}
          trackColor={{ false: "#cbd5e1", true: colors.brand[500] }}
          thumbColor="#ffffff"
        />
      </View>
    </View>
  );
}
