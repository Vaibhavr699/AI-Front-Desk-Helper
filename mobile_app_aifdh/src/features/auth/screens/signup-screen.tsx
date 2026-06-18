import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { colors } from "@/src/shared/theme/tokens";

import { startStandaloneSignup } from "../api";
import { BrandMark } from "../components/brand-mark";

export function SignupScreen() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleStart() {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed.includes("@")) {
      setError("Enter a valid email address.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const { checkout_url } = await startStandaloneSignup(trimmed);
      await WebBrowser.openBrowserAsync(checkout_url);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e?.response?.data?.error ?? "Couldn't start signup. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-surface-base">
      <View className="flex-1 justify-between px-6 pb-6 pt-12 md:px-12">
        <View className="flex-1 items-center justify-center gap-8">
          <BrandMark size={120} />
          <View className="items-center gap-2">
            <Text className="text-center text-2xl font-bold tracking-wider text-ink-primary">
              Start your free trial
            </Text>
            <Text className="max-w-xs text-center text-base leading-relaxed text-ink-muted">
              14 days free. Run real in-home sessions from day one. Card required;
              cancel anytime before day 14 and you won&apos;t be charged.
            </Text>
          </View>

          <View className="w-full max-w-md gap-2">
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="you@company.com"
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
              className="h-14 rounded-sm border border-surface-border bg-white px-4 text-base text-ink-primary"
              placeholderTextColor={colors.ink.dim}
            />
            {error ? (
              <Text className="text-sm text-red-600">{error}</Text>
            ) : null}
          </View>
        </View>

        <View className="mx-auto w-full max-w-md gap-3">
          <Pressable
            onPress={handleStart}
            disabled={submitting}
            className={`h-14 flex-row items-center justify-center gap-2 rounded-sm bg-brand-600 active:bg-brand-700 ${submitting ? "opacity-60" : ""}`}
          >
            <Ionicons name="rocket" size={18} color="#fff" />
            <Text className="text-base font-semibold text-white">
              {submitting ? "Starting…" : "Start 14-day free trial"}
            </Text>
          </Pressable>
          <Pressable onPress={() => router.push("/(auth)/login")}>
            <Text className="text-center text-sm text-ink-muted">
              Already have an account? <Text className="font-semibold text-brand-600">Log in</Text>
            </Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}
