import { Ionicons } from "@expo/vector-icons";
import { useMemo } from "react";
import { Text, View } from "react-native";

import { colors } from "@/src/shared/theme/tokens";

import type { LeadCall, LeadMessage } from "../types";

type Props = {
  messages: LeadMessage[];
  calls: LeadCall[];
};

type TimelineEntry =
  | { kind: "message"; data: LeadMessage; date: string }
  | { kind: "call"; data: LeadCall; date: string };

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export function ConversationHistory({ messages, calls }: Props) {
  const entries = useMemo<TimelineEntry[]>(() => {
    const m: TimelineEntry[] = messages.map((data) => ({
      kind: "message",
      data,
      date: data.created_at,
    }));
    const c: TimelineEntry[] = calls.map((data) => ({
      kind: "call",
      data,
      date: data.started_at,
    }));
    return [...m, ...c].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
    );
  }, [messages, calls]);

  return (
    <View className="gap-3 rounded-2xl border border-surface-border bg-white p-4">
      <Text className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
        Conversation history
      </Text>
      {entries.length === 0 ? (
        <View className="items-center gap-2 py-6">
          <Ionicons
            name="chatbubbles-outline"
            size={24}
            color={colors.ink.muted}
          />
          <Text className="text-sm text-ink-muted">No conversations yet</Text>
        </View>
      ) : (
        <View className="gap-3">
          {entries.slice(0, 20).map((entry) =>
            entry.kind === "message" ? (
              <MessageRow key={`m-${entry.data.id}`} message={entry.data} />
            ) : (
              <CallRow key={`c-${entry.data.id}`} call={entry.data} />
            ),
          )}
        </View>
      )}
    </View>
  );
}

function MessageRow({ message }: { message: LeadMessage }) {
  const isInbound = message.direction === "inbound";
  return (
    <View className="flex-row items-start gap-3">
      <View
        className={`h-8 w-8 items-center justify-center rounded-full ${isInbound ? "bg-brand-50" : "bg-emerald-50"}`}
      >
        <Ionicons
          name={isInbound ? "chatbox-ellipses-outline" : "send-outline"}
          size={14}
          color={isInbound ? colors.brand[700] : "#047857"}
        />
      </View>
      <View className="flex-1 gap-1">
        <View className="flex-row items-baseline gap-2">
          <Text className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
            {message.channel} · {isInbound ? "in" : "out"}
          </Text>
          <Text className="text-xs text-ink-muted">
            {formatWhen(message.created_at)}
          </Text>
        </View>
        <Text className="text-sm text-ink-secondary">
          {message.body ?? "(no body)"}
        </Text>
      </View>
    </View>
  );
}

function CallRow({ call }: { call: LeadCall }) {
  const isInbound = call.direction === "inbound";
  return (
    <View className="flex-row items-start gap-3">
      <View className="h-8 w-8 items-center justify-center rounded-full bg-amber-50">
        <Ionicons
          name={isInbound ? "call-outline" : "arrow-up-outline"}
          size={14}
          color="#b45309"
        />
      </View>
      <View className="flex-1 gap-1">
        <View className="flex-row items-baseline gap-2">
          <Text className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
            Call · {isInbound ? "in" : "out"}
          </Text>
          <Text className="text-xs text-ink-muted">
            {formatWhen(call.started_at)}
          </Text>
        </View>
        <Text className="text-sm text-ink-secondary">
          {call.disposition ?? call.status ?? "Completed"}
          {call.duration_minutes != null
            ? ` · ${call.duration_minutes} min`
            : ""}
        </Text>
      </View>
    </View>
  );
}
