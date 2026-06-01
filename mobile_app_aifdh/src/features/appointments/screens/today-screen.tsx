import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useTenantFlags } from "@/src/features/auth/store";
import { useResponsive } from "@/src/shared/hooks/use-responsive";
import { colors } from "@/src/shared/theme/tokens";

import { AppointmentCard } from "../components/appointment-card";
import { AppointmentDetailPane } from "../components/appointment-detail-pane";
import { EmptyState } from "../components/empty-state";
import { RepCoachHomeState } from "../components/rep-coach-home-state";
import { useTodayAppointments } from "../queries";
import type { Appointment } from "../types";

export function TodayScreen() {
  const router = useRouter();
  const { isTablet } = useResponsive();
  const { rep_coach_enabled, aifdh_enabled } = useTenantFlags();
  const repCoachOnly = rep_coach_enabled && !aifdh_enabled;
  const { data, isLoading, isError, error, refetch, isRefetching } =
    useTodayAppointments();

  const appointments = data?.appointments ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (isTablet && appointments.length > 0 && !selectedId) {
      setSelectedId(appointments[0].id);
    }
  }, [isTablet, appointments, selectedId]);

  const selected = useMemo<Appointment | null>(
    () => appointments.find((a) => a.id === selectedId) ?? null,
    [appointments, selectedId],
  );

  function navigateToLead(leadId: string) {
    router.push(`/(tabs)/leads/${leadId}`);
  }

  function handleCardPress(appointment: Appointment) {
    if (isTablet) {
      setSelectedId(appointment.id);
    } else if (appointment.lead) {
      navigateToLead(appointment.lead.id);
    }
  }

  function handleCardBriefing(appointment: Appointment) {
    if (appointment.lead) navigateToLead(appointment.lead.id);
  }

  function startQuickSession() {
    router.push("/in-home/prepare/quick" as never);
  }

  return (
    <SafeAreaView className="flex-1 bg-surface-base" edges={["top"]}>
      <Header />
      {isLoading ? (
        <LoadingState />
      ) : isError ? (
        <ErrorState message={extractErrorMessage(error)} onRetry={refetch} />
      ) : appointments.length === 0 ? (
        repCoachOnly ? <RepCoachHomeState /> : <EmptyState />
      ) : isTablet ? (
        <View className="flex-1 flex-row">
          <View
            className="w-[478px]"
            style={{
              borderRightWidth: StyleSheet.hairlineWidth,
              borderRightColor: colors.surface.divider,
            }}
          >
            <FlatList
              data={appointments}
              keyExtractor={(a) => a.id}
              contentContainerClassName="gap-3 p-4"
              refreshControl={
                <RefreshControl
                  refreshing={isRefetching}
                  onRefresh={refetch}
                  tintColor={colors.brand[600]}
                />
              }
              renderItem={({ item }) => (
                <AppointmentCard
                  appointment={item}
                  selected={item.id === selectedId}
                  onPress={() => handleCardPress(item)}
                />
              )}
            />
          </View>
          <View className="flex-1">
            <AppointmentDetailPane
              appointment={selected}
              onViewBriefing={navigateToLead}
            />
          </View>
        </View>
      ) : (
        <FlatList
          data={appointments}
          keyExtractor={(a) => a.id}
          contentContainerClassName="gap-3 px-4 pb-8 pt-2"
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={refetch}
              tintColor={colors.brand[600]}
            />
          }
          renderItem={({ item }) => (
            <AppointmentCard
              appointment={item}
              onPress={() => handleCardPress(item)}
              onViewBriefing={() => handleCardBriefing(item)}
            />
          )}
        />
      )}
      <View className="absolute bottom-6 left-0 right-0 items-center">
        <Pressable
          onPress={startQuickSession}
          className="flex-row items-center gap-2.5 rounded-full bg-brand-600 px-7 py-4 shadow-lg active:bg-brand-700"
          style={{ shadowColor: colors.brand[600], shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 12, elevation: 8 }}
        >
          <Ionicons name="radio" size={20} color="#fff" />
          <Text className="text-[15px] font-semibold text-white">Start Live Session</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

function Header() {
  const today = new Date();
  const dateLabel = today.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  return (
    <View className="px-6 pb-4 pt-6 md:px-8">
      <Text className="text-xs font-semibold uppercase tracking-wider text-brand-600">
        Today
      </Text>
      <Text className="mt-1 text-3xl font-bold text-ink-primary">
        {dateLabel}
      </Text>
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

type ErrorStateProps = {
  message: string;
  onRetry: () => void;
};

function ErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <View className="flex-1 items-center justify-center gap-4 px-8">
      <View className="h-16 w-16 items-center justify-center rounded-full bg-red-50">
        <Ionicons name="alert-circle-outline" size={32} color="#dc2626" />
      </View>
      <Text className="text-base font-semibold text-ink-primary">
        Couldn't load appointments
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

function extractErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return "Please check your connection and try again.";
}
