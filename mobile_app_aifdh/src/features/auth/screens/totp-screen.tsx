import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { TOTP_CODE_LENGTH } from "@/src/config/constants";
import { colors } from "@/src/shared/theme/tokens";

import { QrCodeDisplay } from "../components/qr-code-display";
import { useAuthStore } from "../store";

export function TotpScreen() {
  const verifyTotp = useAuthStore((s) => s.verifyTotp);
  const cancelTotp = useAuthStore((s) => s.cancelTotp);
  const enrollment = useAuthStore((s) => s.enrollment);
  const isBusy = useAuthStore((s) => s.isBusy);
  const lastError = useAuthStore((s) => s.lastError);
  const pendingEmail = useAuthStore((s) => s.pendingEmail);

  const [code, setCode] = useState("");
  const [trustDevice, setTrustDevice] = useState(true);

  const isEnrolling = enrollment != null;
  const canSubmit = code.length === TOTP_CODE_LENGTH && !isBusy;

  async function handleSubmit() {
    if (!canSubmit) return;
    await verifyTotp(code, trustDevice);
  }

  function handleCodeChange(text: string) {
    setCode(text.replace(/\D/g, "").slice(0, TOTP_CODE_LENGTH));
  }

  return (
    <SafeAreaView className="flex-1 bg-surface-base">
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerClassName="flex-grow px-6 pb-10 pt-4 md:px-12 md:pt-8"
        >
          <View className="mx-auto w-full max-w-md flex-1 gap-6 pt-4 md:pt-8">
            <View className="gap-2">
              <Text className="text-3xl font-bold text-ink-primary md:text-4xl">
                {isEnrolling ? "Set up two-factor" : "Two-factor authentication"}
              </Text>
              <Text className="text-base text-ink-muted">
                {isEnrolling
                  ? "Scan this QR code with Google Authenticator or 1Password, then enter the 6-digit code below."
                  : `Enter the 6-digit code for ${pendingEmail ?? "your account"}.`}
              </Text>
            </View>

            {isEnrolling && enrollment ? (
              <View className="gap-3">
                <QrCodeDisplay value={enrollment.otpauth_uri} />
                <View className="rounded-xl border border-surface-border bg-surface-raised px-4 py-3">
                  <Text className="text-xs font-medium uppercase tracking-wide text-ink-muted">
                    Manual entry secret
                  </Text>
                  <Text
                    className="mt-1 font-mono text-sm text-ink-primary"
                    selectable
                  >
                    {enrollment.secret}
                  </Text>
                </View>
              </View>
            ) : null}

            {lastError ? (
              <View className="w-full rounded-xl border border-red-200 bg-red-50 px-4 py-3">
                <Text className="text-sm text-red-700">{lastError}</Text>
              </View>
            ) : null}

            <View className="gap-4">
              <TextInput
                value={code}
                onChangeText={handleCodeChange}
                keyboardType="number-pad"
                autoFocus
                editable={!isBusy}
                maxLength={TOTP_CODE_LENGTH}
                textAlign="center"
                placeholder="000000"
                placeholderTextColor={colors.ink.dim}
                selectionColor={colors.brand[500]}
                className="h-20 w-full rounded-2xl border border-surface-border bg-surface-input text-center text-4xl font-semibold tracking-[12px] text-ink-primary"
              />

              <Pressable
                onPress={() => setTrustDevice((v) => !v)}
                disabled={isBusy}
                className="flex-row items-center gap-3"
              >
                <View
                  className={`h-5 w-5 items-center justify-center rounded border ${
                    trustDevice
                      ? "border-brand-600 bg-brand-600"
                      : "border-surface-border bg-surface-raised"
                  }`}
                >
                  {trustDevice ? (
                    <Text className="text-xs font-bold text-white">✓</Text>
                  ) : null}
                </View>
                <Text className="flex-1 text-sm text-ink-secondary">
                  Trust this device for 30 days
                </Text>
              </Pressable>
            </View>

            <View className="gap-3">
              <Pressable
                onPress={handleSubmit}
                disabled={!canSubmit}
                className={`h-14 items-center justify-center rounded-2xl bg-brand-600 active:bg-brand-700 ${canSubmit ? "" : "opacity-50"}`}
              >
                <Text className="text-base font-semibold text-white">
                  {isBusy ? "Verifying…" : "Verify"}
                </Text>
              </Pressable>

              <Pressable
                onPress={cancelTotp}
                disabled={isBusy}
                className="h-12 items-center justify-center rounded-2xl active:bg-surface-raised"
              >
                <Text className="text-sm font-medium text-ink-secondary">
                  Use a different account
                </Text>
              </Pressable>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
