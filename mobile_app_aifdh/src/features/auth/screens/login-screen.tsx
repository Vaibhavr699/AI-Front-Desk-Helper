import { Link, useRouter } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AuthInput } from "../components/auth-input";
import { BrandMark } from "../components/brand-mark";
import { PasswordInput } from "../components/password-input";
import { useAuthStore } from "../store";

export function LoginScreen() {
  const router = useRouter();
  const signIn = useAuthStore((s) => s.signIn);
  const isBusy = useAuthStore((s) => s.isBusy);
  const lastError = useAuthStore((s) => s.lastError);
  const clearError = useAuthStore((s) => s.clearError);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const canSubmit = email.trim().length > 0 && password.length > 0 && !isBusy;

  async function handleSubmit() {
    if (!canSubmit) return;
    await signIn(email, password);
  }

  function handleEmailChange(value: string) {
    setEmail(value);
    if (lastError) clearError();
  }

  function handlePasswordChange(value: string) {
    setPassword(value);
    if (lastError) clearError();
  }

  function goBack() {
    if (router.canGoBack()) router.back();
    else router.replace("/(auth)/welcome");
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
          <View className="flex-row items-center">
            <Pressable
              onPress={goBack}
              hitSlop={12}
              className="h-10 w-10 items-center justify-center rounded-full active:bg-surface-raised"
            >
              <Text className="text-2xl text-ink-secondary">←</Text>
            </Pressable>
          </View>

          <View className="mx-auto w-full max-w-md flex-1 gap-8 pt-4 md:pt-8">
            <View className="items-center gap-4">
              <BrandMark size={72} />
              <View className="items-center gap-2">
                <Text className="text-3xl font-bold text-ink-primary md:text-4xl">
                  Welcome back
                </Text>
                <Text className="text-center text-base text-ink-muted">
                  Sign in to continue to AI Front Desk Helper.
                </Text>
              </View>
            </View>

            {lastError ? (
              <View className="w-full rounded-xl border border-red-200 bg-red-50 px-4 py-3">
                <Text className="text-sm text-red-700">{lastError}</Text>
              </View>
            ) : null}

            <View className="gap-4">
              <AuthInput
                label="Email"
                value={email}
                onChangeText={handleEmailChange}
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                placeholder="you@company.com"
                editable={!isBusy}
                returnKeyType="next"
              />
              <View>
                <PasswordInput
                  label="Password"
                  value={password}
                  onChangeText={handlePasswordChange}
                  autoCapitalize="none"
                  autoComplete="password"
                  placeholder="••••••••"
                  editable={!isBusy}
                  onSubmitEditing={handleSubmit}
                  returnKeyType="go"
                />
                <View className="mt-2 flex-row justify-end">
                  <Link href="/(auth)/forgot-password" asChild>
                    <Pressable hitSlop={8}>
                      <Text className="text-sm font-semibold text-brand-600">
                        Forgot password?
                      </Text>
                    </Pressable>
                  </Link>
                </View>
              </View>
            </View>

            <Pressable
              onPress={handleSubmit}
              disabled={!canSubmit}
              className={`h-14 items-center justify-center rounded-2xl bg-brand-600 active:bg-brand-700 ${canSubmit ? "" : "opacity-50"}`}
            >
              <Text className="text-base font-semibold text-white">
                {isBusy ? "Signing in…" : "Sign in"}
              </Text>
            </Pressable>

            <Text className="text-center text-xs text-ink-dim">
              Protected by two-factor authentication.
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
