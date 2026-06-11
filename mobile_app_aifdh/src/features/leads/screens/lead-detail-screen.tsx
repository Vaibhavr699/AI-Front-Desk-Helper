import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { DiscBadge } from "@/src/features/appointments/components/disc-badge";
import { colors } from "@/src/shared/theme/tokens";

import { CoachingRecordingsCard } from "../components/coaching-recordings-card";
import { ConversationHistory } from "../components/conversation-history";
import { CustomerInfoCard } from "../components/customer-info-card";
import { IntelligenceCard } from "../components/intelligence-card";
import { LeadActionBar } from "../components/lead-action-bar";
import { StatusBadge } from "../components/status-badge";
import { VarianceCoachingCard } from "../components/variance-coaching-card";
import { WidgetEstimateCard } from "../components/widget-estimate-card";
import { useLeadDetail } from "../queries";
import type { LeadDetail } from "../types";

type Props = {
  leadId: string;
};

export function LeadDetailScreen({ leadId }: Props) {
  const router = useRouter();
  const { data, isLoading, isError, error, refetch } = useLeadDetail(leadId);

  function goBack() {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/leads");
  }

  return (
    <SafeAreaView className="flex-1 bg-surface-base" edges={["top"]}>
      <View className="flex-row items-center gap-3 px-4 pb-2 pt-4">
        <Pressable
          onPress={goBack}
          hitSlop={12}
          className="h-10 w-10 items-center justify-center rounded-full active:bg-surface-raised"
        >
          <Ionicons name="arrow-back" size={22} color={colors.ink.secondary} />
        </Pressable>
        <Text className="flex-1 text-base font-semibold text-ink-primary">
          Lead detail
        </Text>
      </View>

      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={colors.brand[600]} />
        </View>
      ) : isError || !data ? (
        <ErrorState message={extractMessage(error)} onRetry={refetch} />
      ) : (
        <LeadDetailBody lead={data} />
      )}
    </SafeAreaView>
  );
}

export function LeadDetailBody({ lead }: { lead: LeadDetail }) {
  return (
    <ScrollView contentContainerClassName="px-4 pb-10 pt-2 gap-4 md:px-6">
      <View className="mx-auto w-full max-w-2xl gap-4">
        <View className="gap-3 rounded-sm border border-surface-border bg-white p-4">
          <View className="flex-row items-start justify-between gap-3">
            <View className="flex-1 gap-2">
              <Text className="text-2xl font-bold text-ink-primary">
                {lead.name ?? "Unnamed lead"}
              </Text>
              <View className="flex-row items-center gap-2">
                <StatusBadge status={lead.status} />
                {lead.do_not_contact ? (
                  <View className="rounded-full bg-red-50 px-2.5 py-1">
                    <Text className="text-xs font-semibold text-red-700">
                      Do not contact
                    </Text>
                  </View>
                ) : null}
              </View>
            </View>
            <DiscBadge
              primary={lead.intelligence?.disc_primary ?? null}
              confidence={lead.intelligence?.disc_confidence}
              size="md"
            />
          </View>
          <LeadActionBar lead={lead} />
        </View>

        <CustomerInfoCard lead={lead} />

        {lead.widget_estimate ? (
          <WidgetEstimateCard estimate={lead.widget_estimate} />
        ) : null}

        {lead.variance_coaching ? (
          <VarianceCoachingCard coaching={lead.variance_coaching} />
        ) : null}

        <IntelligenceCard intelligence={lead.intelligence} leadId={lead.id} />

        <CoachingRecordingsCard conversations={lead.coaching_conversations} />

        <ConversationHistory messages={lead.messages} calls={lead.calls} />
      </View>
    </ScrollView>
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
        Couldn't load lead
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
