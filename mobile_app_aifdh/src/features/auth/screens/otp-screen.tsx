import { useEffect, useState } from "react";
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

import { OTP_CODE_LENGTH } from "@/src/config/constants";
import { colors } from "@/src/shared/theme/tokens";

import { useAuthStore } from "../store";

const RESEND_COOLDOWN_SECONDS = 30;

export function OtpScreen() {
  const verifyOtp = useAuthStore((s) => s.verifyOtp);
  const resendOtp = useAuthStore((s) => s.resendOtp);
  const cancelOtp = useAuthStore((s) => s.cancelOtp);
  const clearError = useAuthStore((s) => s.clearError);
  const isBusy = useAuthStore((s) => s.isBusy);
  const lastError = useAuthStore((s) => s.lastError);
  const pendingEmail = useAuthStore((s) => s.pendingEmail);

  const [code, setCode] = useState("");
  const [trustDevice, setTrustDevice] = useState(true);
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_SECONDS);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => setCooldown((c) => (c <= 1 ? 0 : c - 1)), 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  const canSubmit = code.length === OTP_CODE_LENGTH && !isBusy;
  const canResend = cooldown === 0 && !isBusy;

  async function handleSubmit() {
    if (!canSubmit) return;
    await verifyOtp(code, trustDevice);
  }

  async function handleResend() {
    if (!canResend) return;
    const ok = await resendOtp();
    if (ok) {
      setCode("");
      setCooldown(RESEND_COOLDOWN_SECONDS);
    }
  }

  function handleCodeChange(text: string) {
    if (lastError) clearError();
    setCode(text.replace(/\D/g, "").slice(0, OTP_CODE_LENGTH));
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
                Check your email
              </Text>
              <Text className="text-base text-ink-muted">
                We sent a 6-digit code to{" "}
                <Text className="font-semibold text-ink-secondary">
                  {pendingEmail ?? "your email"}
                </Text>
                . Enter it below to finish signing in.
              </Text>
            </View>

            {lastError ? (
              <View
                accessibilityRole="alert"
                className="w-full rounded-xl border border-red-200 bg-red-50 px-4 py-3"
              >
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
                maxLength={OTP_CODE_LENGTH}
                textAlign="center"
                placeholder="000000"
                placeholderTextColor={colors.ink.dim}
                selectionColor={colors.brand[500]}
                textContentType="oneTimeCode"
                autoComplete="one-time-code"
                accessibilityLabel="6-digit verification code"
                className="h-20 w-full rounded-sm border border-surface-border bg-surface-input text-center text-4xl font-semibold tracking-[12px] text-ink-primary"
              />

              <Pressable
                onPress={() => setTrustDevice((v) => !v)}
                disabled={isBusy}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: trustDevice, disabled: isBusy }}
                accessibilityLabel="Trust this device for 30 days"
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
                accessibilityRole="button"
                accessibilityState={{ disabled: !canSubmit, busy: isBusy }}
                className={`h-14 items-center justify-center rounded-sm bg-brand-600 active:bg-brand-700 ${canSubmit ? "" : "opacity-50"}`}
              >
                <Text className="text-base font-semibold text-white">
                  {isBusy ? "Verifying…" : "Verify"}
                </Text>
              </Pressable>

              <Pressable
                onPress={handleResend}
                disabled={!canResend}
                accessibilityRole="button"
                accessibilityState={{ disabled: !canResend }}
                className="h-12 items-center justify-center rounded-sm active:bg-surface-raised"
              >
                <Text
                  className={`text-sm font-medium ${canResend ? "text-brand-600" : "text-ink-dim"}`}
                >
                  {cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
                </Text>
              </Pressable>

              <Pressable
                onPress={cancelOtp}
                disabled={isBusy}
                accessibilityRole="button"
                accessibilityState={{ disabled: isBusy }}
                className="h-12 items-center justify-center rounded-sm active:bg-surface-raised"
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
