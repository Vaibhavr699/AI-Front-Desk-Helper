import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";

import { getOrCreateDeviceFingerprint } from "@/src/features/auth/device";
import { colors } from "@/src/shared/theme/tokens";

import { useRevokeTrustedDevice } from "../queries";
import type { TrustedDeviceEntry } from "../types";

type Props = {
  devices: TrustedDeviceEntry[];
};

function formatExpiry(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  const days = Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
  if (days === 0) return "expires today";
  if (days === 1) return "expires tomorrow";
  return `expires in ${days} days`;
}

function shortFingerprint(fp: string): string {
  return fp.length > 12 ? `${fp.slice(0, 6)}…${fp.slice(-4)}` : fp;
}

export function TrustedDevicesCard({ devices }: Props) {
  const [currentFingerprint, setCurrentFingerprint] = useState<string | null>(
    null,
  );
  const revoke = useRevokeTrustedDevice();

  useEffect(() => {
    getOrCreateDeviceFingerprint().then(setCurrentFingerprint);
  }, []);

  function confirmRevoke(device: TrustedDeviceEntry) {
    const isCurrent = device.fingerprint === currentFingerprint;
    Alert.alert(
      "Revoke trusted device?",
      isCurrent
        ? "You'll be asked for your TOTP code next time you sign in on this device."
        : "That device will need to re-enter its TOTP code on next sign-in.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Revoke",
          style: "destructive",
          onPress: () => revoke.mutate(device.fingerprint),
        },
      ],
    );
  }

  return (
    <View className="gap-4 rounded-sm border border-surface-border bg-white p-5">
      <View className="flex-row items-center gap-2">
        <Ionicons name="shield-checkmark-outline" size={16} color={colors.ink.secondary} />
        <Text className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
          Trusted devices
        </Text>
      </View>
      <Text className="text-xs text-ink-muted">
        Devices that can skip TOTP for 30 days. Revoke any device you don't
        recognize.
      </Text>

      {devices.length === 0 ? (
        <View className="items-center gap-2 py-4">
          <Ionicons name="phone-portrait-outline" size={20} color={colors.ink.muted} />
          <Text className="text-sm text-ink-muted">
            No trusted devices on this account yet.
          </Text>
        </View>
      ) : (
        <View className="gap-3">
          {devices.map((d) => {
            const isCurrent = d.fingerprint === currentFingerprint;
            return (
              <View
                key={d.fingerprint}
                className="flex-row items-start gap-3 rounded-xl border border-surface-divider bg-surface-raised p-3"
              >
                <View className="h-10 w-10 items-center justify-center rounded-full bg-brand-50">
                  <Ionicons
                    name={isCurrent ? "phone-portrait" : "phone-portrait-outline"}
                    size={18}
                    color={colors.brand[700]}
                  />
                </View>
                <View className="flex-1 gap-0.5">
                  <View className="flex-row flex-wrap items-center gap-2">
                    <Text className="text-sm font-semibold text-ink-primary">
                      {d.biometric_type ?? "Trusted device"}
                    </Text>
                    {isCurrent ? (
                      <View className="rounded-full bg-emerald-100 px-2 py-0.5">
                        <Text className="text-[10px] font-semibold text-emerald-700">
                          THIS DEVICE
                        </Text>
                      </View>
                    ) : null}
                  </View>
                  <Text className="text-xs text-ink-muted">
                    ID {shortFingerprint(d.fingerprint)} · {formatExpiry(d.expires_at)}
                  </Text>
                </View>
                <Pressable
                  onPress={() => confirmRevoke(d)}
                  disabled={revoke.isPending}
                  hitSlop={8}
                  className="rounded-lg px-2 py-1 active:bg-red-50"
                >
                  <Text className="text-sm font-semibold text-red-600">
                    Revoke
                  </Text>
                </Pressable>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}
