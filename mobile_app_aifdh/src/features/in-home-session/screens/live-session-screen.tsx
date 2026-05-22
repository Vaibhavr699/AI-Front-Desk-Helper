import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAuthStore } from "@/src/features/auth/store";
import { useResponsive } from "@/src/shared/hooks/use-responsive";
import { colors } from "@/src/shared/theme/tokens";

import { AlertCard } from "../components/alert-card";
import { DiscLiveBadge } from "../components/disc-live-badge";
import { WalkthroughStrip } from "../components/walkthrough-strip";
import { buildWsUrl } from "../api";
import { useEndInHomeSession, useInHomeSession } from "../queries";
import type {
  CoachingAlert,
  CoachingAlertType,
  CoachingAlertUrgency,
  DiscReading,
  WalkthroughItem,
} from "../types";
import { InHomeWsClient, type WsStatus } from "../ws-client";

type Props = {
  sessionId: string;
};

const MOCK_ALERTS: Omit<CoachingAlert, "id" | "fired_at">[] = [
  {
    type: "disc_update",
    urgency: "yellow",
    headline: "D-type confirmed",
    full_text: "Customer is direct and time-conscious. Skip warm-up, lead with bottom line.",
    vibration: "single_tap",
  },
  {
    type: "decision_maker",
    urgency: "yellow",
    headline: "Wife mentioned 3x",
    full_text: "Address her next time she's in the room — she's the secondary decision-maker.",
    vibration: "single_tap",
  },
  {
    type: "objection_detected",
    urgency: "orange",
    headline: "Price objection coming",
    full_text: "\"Let me show you the warranty value first…\" Anchor on outcome before price.",
    vibration: "double_tap",
  },
  {
    type: "buying_signal",
    urgency: "green",
    headline: "Buying signal — move to close",
    full_text: "Customer asked about timeline. Pivot to scheduling.",
    vibration: "double_tap",
  },
  {
    type: "warning",
    urgency: "red",
    headline: "Engagement dropping",
    full_text: "Slow down. Ask an open question to re-engage.",
    vibration: "long_buzz",
  },
  {
    type: "suggested_response",
    urgency: "orange",
    headline: "Try: \"What concerns you most?\"",
    full_text: null,
    vibration: "double_tap",
  },
];

const INITIAL_WALKTHROUGH: WalkthroughItem[] = [
  { key: "rooms", label: "Rooms", completed: false },
  { key: "scope", label: "Scope", completed: false },
  { key: "timeline", label: "Timeline", completed: false },
  { key: "budget", label: "Budget", completed: false },
  { key: "close", label: "Close", completed: false },
];

export function LiveSessionScreen({ sessionId }: Props) {
  const router = useRouter();
  const { isTablet } = useResponsive();
  const sessionToken = useAuthStore((s) => s.sessionToken);
  const { data } = useInHomeSession(sessionId);
  const end = useEndInHomeSession();

  const [wsStatus, setWsStatus] = useState<WsStatus>("idle");
  const [alerts, setAlerts] = useState<CoachingAlert[]>([]);
  const [disc, setDisc] = useState<DiscReading | null>(null);
  const [walkthrough, setWalkthrough] = useState<WalkthroughItem[]>(
    INITIAL_WALKTHROUGH,
  );
  const [elapsed, setElapsed] = useState(0);

  const wsRef = useRef<InHomeWsClient | null>(null);
  const startedAtRef = useRef<number>(Date.now());

  useEffect(() => {
    if (data?.session?.started_at) {
      startedAtRef.current = new Date(data.session.started_at).getTime();
    }
  }, [data?.session?.started_at]);

  useEffect(() => {
    if (!sessionToken || !data?.session) return;
    const wsPath = `/ws/rep/in-home/${sessionId}`;
    const client = new InHomeWsClient(buildWsUrl(wsPath, sessionToken));
    wsRef.current = client;
    const offStatus = client.onStatus(setWsStatus);
    client.connect();
    return () => {
      offStatus();
      client.close();
      wsRef.current = null;
    };
  }, [sessionId, sessionToken, data?.session]);

  useEffect(() => {
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let alertIndex = 0;
    let walkthroughIndex = 0;
    const alertTimer = setInterval(() => {
      const mock = MOCK_ALERTS[alertIndex % MOCK_ALERTS.length];
      alertIndex += 1;
      const alert: CoachingAlert = {
        ...mock,
        id: `mock-${Date.now()}-${alertIndex}`,
        fired_at: new Date().toISOString(),
      };
      setAlerts((prev) => [alert, ...prev].slice(0, 12));
      if (mock.type === "disc_update") {
        setDisc({ primary: "D", secondary: "C", confidence: 0.78 });
      }
    }, 8_000);

    const walkthroughTimer = setInterval(() => {
      setWalkthrough((prev) => {
        if (walkthroughIndex >= prev.length) return prev;
        const next = [...prev];
        next[walkthroughIndex] = { ...next[walkthroughIndex], completed: true };
        walkthroughIndex += 1;
        return next;
      });
    }, 18_000);

    return () => {
      clearInterval(alertTimer);
      clearInterval(walkthroughTimer);
    };
  }, []);

  function confirmEnd() {
    if (end.isPending) return;
    Alert.alert(
      "End in-home session?",
      "You'll get an AI-scored review of how the visit went.",
      [
        { text: "Keep going", style: "cancel" },
        {
          text: "End session",
          style: "destructive",
          onPress: async () => {
            try {
              await end.mutateAsync({ sessionId, outcome: "completed" });
              wsRef.current?.close();
              router.replace("/(tabs)" as never);
            } catch (err) {
              Alert.alert(
                "Couldn't end session",
                err instanceof Error ? err.message : "Try again in a moment.",
              );
            }
          },
        },
      ],
    );
  }

  const timer = useMemo(() => {
    const m = Math.floor(elapsed / 60).toString().padStart(2, "0");
    const s = (elapsed % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  }, [elapsed]);

  return (
    <SafeAreaView className="flex-1 bg-surface-base" edges={["top"]}>
      <Header
        timer={timer}
        wsStatus={wsStatus}
        onEnd={confirmEnd}
        ending={end.isPending}
      />
      <View className="flex-1">
        {isTablet ? (
          <View className="flex-1 flex-row">
            <View className="flex-1 border-r border-surface-divider bg-surface-raised">
              <View className="flex-1 items-center justify-center px-8">
                <Ionicons
                  name="document-text-outline"
                  size={48}
                  color={colors.ink.dim}
                />
                <Text className="mt-3 text-base text-ink-muted">
                  Customer notes / quote builder
                </Text>
                <Text className="mt-1 text-xs text-ink-dim">
                  (Working area — populated in a future iteration)
                </Text>
              </View>
            </View>
            <View className="w-[360px] border-l border-surface-divider bg-white">
              <View className="items-center gap-3 border-b border-surface-divider p-5">
                <DiscLiveBadge reading={disc} size="xl" />
              </View>
              <ScrollView contentContainerClassName="gap-3 p-4">
                <Text className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
                  Recent alerts
                </Text>
                {alerts.length === 0 ? (
                  <Text className="text-sm text-ink-muted">
                    Coaching alerts will appear here as the conversation unfolds.
                  </Text>
                ) : (
                  alerts.map((a) => <AlertCard key={a.id} alert={a} />)
                )}
              </ScrollView>
            </View>
          </View>
        ) : (
          <PhoneLayout alerts={alerts} disc={disc} />
        )}
      </View>
      <WalkthroughStrip items={walkthrough} />
    </SafeAreaView>
  );
}

function Header({
  timer,
  wsStatus,
  onEnd,
  ending,
}: {
  timer: string;
  wsStatus: WsStatus;
  onEnd: () => void;
  ending: boolean;
}) {
  const statusColor: Record<WsStatus, string> = {
    idle: colors.ink.muted,
    connecting: "#d97706",
    open: "#059669",
    closed: colors.ink.muted,
    error: "#dc2626",
  };
  const statusLabel: Record<WsStatus, string> = {
    idle: "idle",
    connecting: "connecting",
    open: "live",
    closed: "offline",
    error: "error",
  };
  return (
    <View className="flex-row items-center gap-3 border-b border-surface-divider px-4 py-3 md:px-8">
      <View className="flex-1 gap-0.5">
        <View className="flex-row items-center gap-2">
          <View
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: statusColor[wsStatus] }}
          />
          <Text className="text-[10px] font-bold uppercase tracking-wider text-brand-600">
            Session {statusLabel[wsStatus]}
          </Text>
        </View>
        <Text className="font-mono text-2xl font-bold tabular-nums text-ink-primary">
          {timer}
        </Text>
      </View>
      <Pressable
        onPress={onEnd}
        disabled={ending}
        className="flex-row items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-3 py-2 active:bg-red-100"
      >
        <Ionicons name="stop-circle" size={16} color="#b91c1c" />
        <Text className="text-xs font-semibold text-red-700">
          {ending ? "Ending…" : "End session"}
        </Text>
      </Pressable>
    </View>
  );
}

function PhoneLayout({
  alerts,
  disc,
}: {
  alerts: CoachingAlert[];
  disc: DiscReading | null;
}) {
  const top = alerts[0] ?? null;
  return (
    <ScrollView contentContainerClassName="flex-grow gap-3 px-4 py-4">
      <View className="flex-row items-start justify-between">
        <View className="flex-1 gap-1">
          <Text className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
            Latest coaching
          </Text>
          <Text className="text-xs text-ink-dim">
            Newest at the top — older alerts scroll below.
          </Text>
        </View>
        <DiscLiveBadge reading={disc} size="lg" />
      </View>

      {top ? (
        <AlertCard alert={top} />
      ) : (
        <View className="items-center gap-2 rounded-2xl border border-dashed border-surface-border bg-white py-8">
          <Ionicons
            name="ear-outline"
            size={24}
            color={colors.ink.muted}
          />
          <Text className="text-sm text-ink-muted">Listening for coaching cues…</Text>
        </View>
      )}

      {alerts.length > 1 ? (
        <View className="gap-2">
          <Text className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
            History
          </Text>
          {alerts.slice(1).map((a) => (
            <AlertCard key={a.id} alert={a} compact />
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}
