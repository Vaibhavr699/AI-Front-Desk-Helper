import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAuthStore } from "@/src/features/auth/store";
import { useResponsive } from "@/src/shared/hooks/use-responsive";
import { colors } from "@/src/shared/theme/tokens";

import { AlertCard } from "../components/alert-card";
import { CueOverlayBanner } from "../components/cue-overlay-banner";
import { DiscLiveBadge } from "../components/disc-live-badge";
import { WalkthroughStrip } from "../components/walkthrough-strip";
import { buildWsUrl } from "../api";
import { queueSessionEnd } from "../end-queue";
import { useAudioStream } from "../hooks/use-audio-stream";
import { useWatchCue } from "../hooks/use-watch-cue";
import { useCueAudio } from "../hooks/use-cue-audio";
import { useEndInHomeSession, useInHomeSession } from "../queries";
import type {
  CoachingAlert,
  DiscReading,
  WalkthroughItem,
  WsServerMessage,
} from "../types";
import { InHomeWsClient, type WsStatus } from "../ws-client";

type Props = {
  sessionId: string;
};

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
  const { sendCueToWatch, clearWatch } = useWatchCue();
  const cueAudio = useCueAudio();

  const [wsStatus, setWsStatus] = useState<WsStatus>("idle");
  const [alerts, setAlerts] = useState<CoachingAlert[]>([]);
  const [activeCue, setActiveCue] = useState<CoachingAlert | null>(null);
  const [disc, setDisc] = useState<DiscReading | null>(null);
  const [walkthrough, setWalkthrough] = useState<WalkthroughItem[]>(
    INITIAL_WALKTHROUGH,
  );
  const [elapsed, setElapsed] = useState(0);

  const wsRef = useRef<InHomeWsClient | null>(null);
  const startedAtRef = useRef<number>(Date.now());
  const [wsClient, setWsClient] = useState<InHomeWsClient | null>(null);

  const {
    streaming,
    error: streamError,
    startStreaming,
    stopStreaming,
    markAcked,
    flushUnacked,
  } = useAudioStream(wsClient, sessionId);

  useEffect(() => {
    if (data?.session?.started_at) {
      startedAtRef.current = new Date(data.session.started_at).getTime();
    }
  }, [data?.session?.started_at]);

  const handleWsMessage = useCallback(
    (msg: WsServerMessage) => {
      switch (msg.type) {
        case "coaching_cue": {
          const cue = msg.cue;
          const channels: string[] = (msg as any).channels || [];
          setAlerts((prev) => [cue, ...prev].slice(0, 50));
          setActiveCue(cue);
          if (channels.includes("watch")) {
            sendCueToWatch(cue);
          }
          break;
        }
        case "cue_audio": {
          cueAudio.play(msg.data);
          break;
        }
        case "chunk_ack": {
          markAcked(msg.seq);
          break;
        }
        case "disc_update":
          setDisc(msg.reading);
          break;
        case "checklist_update":
          setWalkthrough((prev) =>
            prev.map((item) =>
              item.key === msg.key ? { ...item, completed: msg.completed } : item,
            ),
          );
          break;
        case "transcript_update":
          break;
        case "transcriber_error":
          console.warn("[live] transcriber error:", msg.message);
          break;
      }
    },
    [sendCueToWatch, cueAudio, markAcked],
  );

  useEffect(() => {
    if (!sessionToken || !data?.session) return;
    const wsPath = `/ws/rep/in-home/${sessionId}`;
    const client = new InHomeWsClient(buildWsUrl(wsPath, sessionToken));
    wsRef.current = client;
    setWsClient(client);
    const offStatus = client.onStatus(setWsStatus);
    const offMessage = client.on(handleWsMessage);
    client.connect();
    return () => {
      offStatus();
      offMessage();
      client.close();
      wsRef.current = null;
      setWsClient(null);
    };
  }, [sessionId, sessionToken, data?.session, handleWsMessage]);

  useEffect(() => {
    if (wsStatus === "open" && !streaming && wsRef.current) {
      startStreaming();
    }
  }, [wsStatus, streaming, startStreaming]);

  useEffect(() => {
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const handleDismissCue = useCallback(
    (cueId: string) => {
      setActiveCue((prev) => (prev?.id === cueId ? null : prev));
      wsRef.current?.send({ type: "cue_dismissed", cue_id: cueId });
    },
    [],
  );

  const toggleAudioMute = useCallback(() => {
    cueAudio.setMuted((m) => {
      const next = !m;
      wsRef.current?.send({ type: "set_audio_mute", muted: next });
      return next;
    });
  }, [cueAudio]);

  function confirmEnd() {
    if (end.isPending) return;
    Alert.alert(
      "End in-home session?",
      "You’ll get an AI-scored review of how the visit went.",
      [
        { text: "Keep going", style: "cancel" },
        {
          text: "End session",
          style: "destructive",
          onPress: async () => {
            await stopStreaming();
            await flushUnacked();
            clearWatch();
            try {
              await end.mutateAsync({ sessionId, outcome: "completed" });
            } catch {
              await queueSessionEnd(sessionId, "completed");
              Alert.alert(
                "Saved — will sync later",
                "You’re offline, so we saved this session locally. It’ll finish syncing automatically once you’re back online.",
              );
            }
            wsRef.current?.close();
            router.replace("/(tabs)" as never);
          },
        },
      ],
    );
  }

  const timer = useMemo(() => {
    const m = Math.floor(elapsed / 60)
      .toString()
      .padStart(2, "0");
    const s = (elapsed % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  }, [elapsed]);

  return (
    <SafeAreaView className="flex-1 bg-surface-base" edges={["top"]}>
      <CueOverlayBanner cue={activeCue} onDismiss={handleDismissCue} />
      {streamError ? (
        <View className="flex-row items-center gap-2 bg-red-600 px-4 py-2">
          <Ionicons name="warning" size={16} color="#ffffff" />
          <Text className="flex-1 text-xs font-semibold text-white">
            Recording stopped unexpectedly. Tap End and restart the session to
            keep capturing.
          </Text>
        </View>
      ) : null}
      <Header
        timer={timer}
        wsStatus={wsStatus}
        streaming={streaming}
        onEnd={confirmEnd}
        ending={end.isPending}
        audioReady={cueAudio.ready}
        audioMuted={cueAudio.muted}
        onToggleMute={toggleAudioMute}
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
                  Coaching cues
                </Text>
                {alerts.length === 0 ? (
                  <Text className="text-sm text-ink-muted">
                    Coaching cues will appear here as the conversation unfolds.
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
  streaming,
  onEnd,
  ending,
  audioReady,
  audioMuted,
  onToggleMute,
}: {
  timer: string;
  wsStatus: WsStatus;
  streaming: boolean;
  onEnd: () => void;
  ending: boolean;
  audioReady: boolean;
  audioMuted: boolean;
  onToggleMute: () => void;
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
          {streaming ? (
            <View className="flex-row items-center gap-1 rounded-full bg-red-100 px-2 py-0.5">
              <View className="h-1.5 w-1.5 rounded-full bg-red-500" />
              <Text className="text-[9px] font-bold uppercase text-red-700">
                Mic
              </Text>
            </View>
          ) : null}
        </View>
        <Text className="font-mono text-2xl font-bold tabular-nums text-ink-primary">
          {timer}
        </Text>
      </View>
      {audioReady ? (
        <Pressable
          onPress={onToggleMute}
          hitSlop={8}
          className={`h-9 w-9 items-center justify-center rounded-full border active:opacity-70 ${
            audioMuted ? "border-red-200 bg-red-50" : "border-surface-border bg-surface-raised"
          }`}
        >
          <Ionicons
            name={audioMuted ? "volume-mute" : "volume-high"}
            size={16}
            color={audioMuted ? "#b91c1c" : colors.ink.secondary}
          />
        </Pressable>
      ) : null}
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
      <View className="flex-row items-center justify-between">
        <Text className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
          Live coaching
        </Text>
        <DiscLiveBadge reading={disc} size="lg" />
      </View>

      {top ? (
        <AlertCard alert={top} />
      ) : (
        <View className="items-center gap-2 rounded-sm bg-white py-10">
          <Ionicons name="ear-outline" size={26} color={colors.ink.dim} />
          <Text className="text-sm text-ink-muted">Listening for coaching cues…</Text>
        </View>
      )}

      {alerts.length > 1 ? (
        <View className="mt-2 gap-2">
          <Text className="text-[11px] font-semibold uppercase tracking-wider text-ink-dim">
            Earlier
          </Text>
          {alerts.slice(1).map((a) => (
            <AlertCard key={a.id} alert={a} compact />
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}
