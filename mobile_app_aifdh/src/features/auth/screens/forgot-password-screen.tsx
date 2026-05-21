import { useRouter } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export function ForgotPasswordScreen() {
  const router = useRouter();

  function goBack() {
    if (router.canGoBack()) router.back();
    else router.replace("/(auth)/login");
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

        <View className="mx-auto w-full max-w-md flex-1 justify-center gap-6">
          <View className="gap-2">
            <Text className="text-3xl font-bold text-ink-primary md:text-4xl">
              Forgot password
            </Text>
            <Text className="text-base text-ink-muted">
              Password reset is coming soon. Contact your tenant admin to reset
              your account, or reach out to support.
            </Text>
          </View>
          <Pressable
            onPress={goBack}
            className="h-14 items-center justify-center rounded-2xl bg-brand-600 active:bg-brand-700"
          >
            <Text className="text-base font-semibold text-white">
              Back to sign in
            </Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}
