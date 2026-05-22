import { useRouter } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { BrandMark } from "../components/brand-mark";

export function WelcomeScreen() {
  const router = useRouter();

  return (
    <SafeAreaView className="flex-1 bg-surface-base">
      <View className="flex-1 justify-between px-6 pb-6 pt-12 md:px-12 md:pb-10 md:pt-20">
        <View className="flex-1 items-center justify-center">
          <View className="items-center gap-8 md:gap-10">
            <BrandMark size={132} className="md:hidden" />
            <BrandMark size={172} className="hidden md:flex" />
            <View className="items-center gap-3">
              <Text className="text-center text-xs font-semibold uppercase tracking-[3px] text-brand-600">
                Welcome to
              </Text>
              <Text className="text-center text-3xl font-bold tracking-wider text-ink-primary md:text-4xl">
                AI REP COACH
              </Text>
              <Text className="mt-2 max-w-xs text-center text-base leading-relaxed text-ink-muted md:max-w-md">
                Your in-home sales co-pilot. Walk in informed, close with confidence.
              </Text>
            </View>
          </View>
        </View>

        <View className="mx-auto w-full max-w-md gap-3">
          <Pressable
            onPress={() => router.push("/(auth)/login")}
            className="h-14 items-center justify-center rounded-2xl bg-brand-600 active:bg-brand-700"
          >
            <Text className="text-base font-semibold text-white">Log in</Text>
          </Pressable>
          <Text className="text-center text-xs text-ink-dim">
            Field-sales coaching for tablets and phones.
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}
