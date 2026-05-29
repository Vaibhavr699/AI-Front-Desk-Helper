import { Ionicons } from "@expo/vector-icons";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { colors } from "@/src/shared/theme/tokens";

import { AudioCard } from "../components/audio-card";
import { BiometricCard } from "../components/biometric-card";
import { CoachingDeliveryCard } from "../components/coaching-delivery-card";
import { CueTypesCard } from "../components/cue-types-card";
import { NotificationsCard } from "../components/notifications-card";
import { PhoneCard } from "../components/phone-card";
import { ProfileCard } from "../components/profile-card";
import { SignOutCard } from "../components/sign-out-card";
import { SupportCard } from "../components/support-card";
import { TrustedDevicesCard } from "../components/trusted-devices-card";
import { useRepProfile, useUpdateCoachingDeliveryPrefs } from "../queries";
import type { CoachingDeliveryPrefs } from "../types";

export function SettingsScreen() {
  const { data, isLoading, isError, error, refetch, isRefetching } =
    useRepProfile();
  const updateDelivery = useUpdateCoachingDeliveryPrefs();

  function handleDeliveryToggle(key: keyof CoachingDeliveryPrefs, value: boolean) {
    if (!data) return;
    updateDelivery.mutate({ ...data.coaching_delivery_prefs, [key]: value });
  }

  return (
    <SafeAreaView className="flex-1 bg-surface-base" edges={["top"]}>
      <Header />
      {isLoading ? (
        <LoadingState />
      ) : isError || !data ? (
        <ErrorState message={extractMessage(error)} onRetry={refetch} />
      ) : (
        <ScrollView
          contentContainerClassName="pb-12 pt-2"
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={refetch}
              tintColor={colors.brand[600]}
            />
          }
        >
          <View className="mx-auto w-full max-w-2xl gap-4 px-4 md:px-8">
            <ProfileCard profile={data} />
            <PhoneCard phone={data.phone} />
            <BiometricCard />
            <NotificationsCard />
            <TrustedDevicesCard devices={data.trusted_devices} />
            <CoachingDeliveryCard
              prefs={data.coaching_delivery_prefs}
              seatTier={data.seat.tier}
              onToggle={handleDeliveryToggle}
            />
            <CueTypesCard />
            <AudioCard
              preferredDevice={data.preferred_earbud_device}
              minGapSeconds={data.coaching_delivery_prefs.audio_min_gap_seconds ?? 60}
              onChangeMinGap={(s) =>
                updateDelivery.mutate({
                  ...data.coaching_delivery_prefs,
                  audio_min_gap_seconds: s,
                })
              }
            />
            <SupportCard />
            <SignOutCard />
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function Header() {
  return (
    <View className="px-6 pb-3 pt-6 md:px-8">
      <Text className="text-xs font-semibold uppercase tracking-wider text-brand-600">
        Your account
      </Text>
      <Text className="mt-1 text-3xl font-bold text-ink-primary">Settings</Text>
    </View>
  );
}

function LoadingState() {
  return (
    <View className="flex-1 items-center justify-center">
      <ActivityIndicator color={colors.brand[600]} />
    </View>
  );
}

function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <View className="flex-1 items-center justify-center gap-4 px-8">
      <Ionicons name="alert-circle-outline" size={32} color="#dc2626" />
      <Text className="text-base font-semibold text-ink-primary">
        Couldn't load settings
      </Text>
      <Text className="text-center text-sm text-ink-muted">{message}</Text>
      <Pressable
        onPress={onRetry}
        className="h-11 items-center justify-center rounded-xl bg-brand-600 px-6 active:bg-brand-700"
      >
        <Text className="text-sm font-semibold text-white">Try again</Text>
      </Pressable>
    </View>
  );
}

function extractMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return "Please check your connection and try again.";
}
