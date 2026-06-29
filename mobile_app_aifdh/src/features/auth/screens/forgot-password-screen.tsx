import { useRouter } from "expo-router";
import { Linking, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const SUPPORT_EMAIL = "support@airepcoach.com";

export function ForgotPasswordScreen() {
  const router = useRouter();

  function goBack() {
    if (router.canGoBack()) router.back();
    else router.replace("/(auth)/login");
  }

  function emailSupport() {
    const subject = encodeURIComponent("AI Rep Coach — password reset request");
    const body = encodeURIComponent(
      "Hi,\n\nI need help resetting my AI Rep Coach password.\n\nMy work email: \nCompany / tenant: \n\nThanks.",
    );
    Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`);
  }

  return (
    <SafeAreaView className="flex-1 bg-surface-base">
      <View className="flex-1 px-6 pt-4 md:px-12 md:pt-8">
        <View className="flex-row items-center">
          <Pressable
            onPress={goBack}
            hitSlop={12}
            className="h-10 w-10 items-center justify-center rounded-full active:bg-surface-raised"
          >
            <Text className="text-2xl text-ink-secondary">←</Text>
          </Pressable>
        </View>

        <View className="mx-auto w-full max-w-md flex-1 justify-center gap-8">
          <View className="gap-2">
            <Text className="text-3xl font-bold text-ink-primary md:text-4xl">
              Reset your password
            </Text>
            <Text className="text-base text-ink-muted">
              Self-serve password reset is not available yet. Your tenant admin
              can reset it for you, or our support team can help directly.
            </Text>
          </View>

          <View className="gap-3">
            <Pressable
              onPress={emailSupport}
              className="h-14 items-center justify-center rounded-sm bg-brand-600 active:bg-brand-700"
            >
              <Text className="text-base font-semibold text-white">
                Email support
              </Text>
            </Pressable>
            <Text className="text-center text-xs text-ink-dim">
              {SUPPORT_EMAIL}
            </Text>
          </View>

          <Pressable
            onPress={goBack}
            className="h-12 items-center justify-center rounded-sm active:bg-surface-raised"
          >
            <Text className="text-sm font-medium text-ink-secondary">
              Back to sign in
            </Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}
