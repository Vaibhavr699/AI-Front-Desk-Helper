import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useLeadDetail } from "@/src/features/leads/queries";
import { colors } from "@/src/shared/theme/tokens";

import { useInHomeSession } from "../queries";
import type { InHomeSessionAlert, TranscriptEntry } from "../types";

const OUTCOME_LABEL: Record<string, string> = {
  closed: "Closed",
  warm_followup: "Warm follow-up",
  stalled: "Stalled",
  lost: "Lost",
  completed: "Completed",
};

const URGENCY_DOT: Record<string, string> = {
  green: "bg-emerald-500",
  yellow: "bg-amber-400",
  orange: "bg-orange-500",
  red: "bg-red-500",
};

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function durationMin(a: string, b: string | null): number | null {
  if (!b) return null;
  return Math.max(1, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000));
}

type Props = {
  sessionId: string;
};

export function SessionReviewScreen({ sessionId }: Props) {
  const router = useRouter();
  const { data, isLoading, isError, error, refetch } =
    useInHomeSession(sessionId);
  const { data: lead } = useLeadDetail(data?.session.lead_id ?? null);

  if (isLoading) {
    return (
      <SafeAreaView className="flex-1 bg-surface-base">
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={colors.brand[600]} />
        </View>
      </SafeAreaView>
    );
  }

  if (isError || !data) {
    return (
      <SafeAreaView className="flex-1 bg-surface-base">
        <View className="flex-1 items-center justify-center gap-4 px-8">
          <Ionicons name="alert-circle-outline" size={28} color="#dc2626" />
          <Text className="text-base font-semibold text-ink-primary">
            Couldn&apos;t load session
          </Text>
          <Text className="text-center text-sm text-ink-muted">
            {error instanceof Error ? error.message : "Try again."}
          </Text>
          <Pressable
            onPress={() => refetch()}
            accessibilityRole="button"
            accessibilityLabel="Try again"
            className="rounded-sm bg-brand-600 px-6 py-2.5 active:bg-brand-700"
          >
            <Text className="text-sm font-semibold text-white">Try again</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const session = data.session;
  const alerts: InHomeSessionAlert[] = data.alerts ?? [];
  const transcript: TranscriptEntry[] = session.transcript ?? [];
  const dur = durationMin(session.started_at, session.ended_at);

  return (
    <SafeAreaView className="flex-1 bg-surface-base" edges={["top"]}>
      <View className="flex-row items-center gap-3 border-b border-surface-divider px-4 py-3 md:px-8">
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Back"
          className="h-10 w-10 items-center justify-center rounded-full active:bg-surface-raised"
        >
          <Ionicons name="arrow-back" size={22} color={colors.ink.secondary} />
        </Pressable>
        <View className="flex-1">
          <Text className="text-[10px] font-semibold uppercase tracking-wider text-brand-600">
            In-home visit
          </Text>
          <Text
            className="text-base font-semibold text-ink-primary"
            numberOfLines={1}
          >
            {lead?.name ?? "Live session"}
          </Text>
        </View>
      </View>

      <ScrollView contentContainerClassName="pb-10">
        <View className="mx-auto w-full max-w-2xl gap-4 p-4 md:px-8">
          <View className="gap-3 rounded-sm bg-white p-4">
            <Text className="text-xs text-ink-muted">
              {fmtDate(session.started_at)} · {fmtTime(session.started_at)}
              {dur ? ` · ${dur} min` : ""}
            </Text>
            <View className="flex-row flex-wrap gap-2">
              {session.outcome ? (
                <Chip label={OUTCOME_LABEL[session.outcome] ?? session.outcome} />
              ) : null}
              {session.estimate_value_cents != null ? (
                <Chip
                  label={`$${(session.estimate_value_cents / 100).toLocaleString()}`}
                />
              ) : null}
              {session.consent_state ? <Chip label={session.consent_state} /> : null}
            </View>
          </View>

          {alerts.length > 0 ? (
            <View className="gap-3 rounded-sm bg-white p-4">
              <Text className="text-sm font-semibold text-ink-secondary">
                Coaching cues ({alerts.length})
              </Text>
              {alerts.map((a) => (
                <View key={a.id} className="flex-row items-start gap-2.5">
                  <View
                    className={`mt-1.5 h-2 w-2 rounded-full ${URGENCY_DOT[a.alert_urgency ?? "yellow"] ?? "bg-amber-400"}`}
                  />
                  <View className="flex-1">
                    <Text className="text-sm text-ink-primary">
                      {a.alert_content}
                    </Text>
                    <Text className="text-[11px] text-ink-dim">
                      {fmtTime(a.fired_at)}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          ) : null}

          <View className="gap-2 rounded-sm bg-white p-4">
            <Text className="text-sm font-semibold text-ink-secondary">
              Conversation
            </Text>
            {transcript.length === 0 ? (
              <Text className="py-6 text-center text-sm text-ink-muted">
                No transcript was captured for this session.
              </Text>
            ) : (
              <View className="gap-2 pt-1">
                {transcript.map((turn, i) => (
                  <TurnBubble key={`${turn.speaker}-${i}`} turn={turn} />
                ))}
              </View>
            )}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Chip({ label }: { label: string }) {
  return (
    <View className="rounded-full bg-surface-raised px-2.5 py-1">
      <Text className="text-xs font-semibold text-ink-secondary">{label}</Text>
    </View>
  );
}

function TurnBubble({ turn }: { turn: TranscriptEntry }) {
  const isRep = turn.speaker === "rep";
  return (
    <View className={`w-full flex-row ${isRep ? "justify-end" : "justify-start"}`}>
      <View
        className={
          isRep
            ? "max-w-[82%] rounded-sm rounded-br-md bg-brand-600 px-3.5 py-2.5"
            : "max-w-[82%] rounded-sm rounded-bl-md border border-surface-border bg-white px-3.5 py-2.5"
        }
      >
        <Text
          className={`text-[10px] font-semibold uppercase tracking-wider ${isRep ? "text-blue-100" : "text-ink-muted"}`}
        >
          {isRep ? "You" : turn.speaker === "customer" ? "Customer" : "Speaker"}
        </Text>
        <Text
          className={`mt-0.5 text-sm leading-relaxed ${isRep ? "text-white" : "text-ink-primary"}`}
        >
          {turn.text}
        </Text>
      </View>
    </View>
  );
}
