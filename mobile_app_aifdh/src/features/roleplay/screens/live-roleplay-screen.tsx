import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { colors } from "@/src/shared/theme/tokens";

import { speakText } from "../api";
import { playMp3Base64 } from "../audio/play-mp3";
import { useVoiceRecorder } from "../audio/use-voice-recorder";
import { MessageBubble, TypingBubble } from "../components/message-bubble";
import { SessionTimer } from "../components/session-timer";
import {
  useEndSession,
  useRespond,
  useRespondVoice,
  useSessionDetail,
} from "../queries";
import type { RoleplayTranscriptTurn } from "../types";

type Props = {
  sessionId: string;
};

export function LiveRoleplayScreen({ sessionId }: Props) {
  const router = useRouter();
  const { data, isLoading, isError, error, refetch } = useSessionDetail(sessionId);
  const respond = useRespond(sessionId);
  const respondVoice = useRespondVoice(sessionId);
  const end = useEndSession(sessionId);
  const recorder = useVoiceRecorder();

  const [localTurns, setLocalTurns] = useState<RoleplayTranscriptTurn[]>([]);
  const [input, setInput] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [processingVoice, setProcessingVoice] = useState(false);

  const listRef = useRef<FlatList<RoleplayTranscriptTurn>>(null);

  useEffect(() => {
    if (data && !hydrated) {
      setLocalTurns(data.transcript);
      setHydrated(true);
    }
  }, [data, hydrated]);

  useEffect(() => {
    if (data?.completed_at) {
      router.replace(
        `/(tabs)/coaching/roleplay/results/${sessionId}` as never,
      );
    }
  }, [data?.completed_at, router, sessionId]);

  const scenarioTitle = useMemo(
    () => data?.scenario?.title ?? data?.custom_scenario_text ?? "Roleplay",
    [data?.scenario, data?.custom_scenario_text],
  );

  async function send() {
    const text = input.trim();
    if (!text || respond.isPending || end.isPending) return;
    const optimistic: RoleplayTranscriptTurn = {
      role: "rep",
      text,
      at: new Date().toISOString(),
    };
    setInput("");
    setLocalTurns((prev) => [...prev, optimistic]);
    try {
      const result = await respond.mutateAsync(text);
      setLocalTurns((prev) => [
        ...prev.slice(0, -1),
        result.rep_turn,
        result.ai_turn,
      ]);
    } catch (err) {
      setLocalTurns((prev) => prev.slice(0, -1));
      Alert.alert(
        "Couldn't send",
        err instanceof Error ? err.message : "Try again in a moment.",
      );
    }
  }

  async function toggleRecord() {
    if (respond.isPending || processingVoice || end.isPending) return;
    if (recorder.isRecording) {
      const uri = await recorder.stop();
      if (!uri) return;
      setProcessingVoice(true);
      try {
        const result = await respondVoice.mutateAsync(uri);
        setLocalTurns((prev) => [...prev, result.rep_turn, result.ai_turn]);
        if (result.ai_audio_base64) {
          playMp3Base64(result.ai_audio_base64).catch(() => {});
        }
      } catch (err) {
        Alert.alert(
          "Couldn't send",
          err instanceof Error ? err.message : "Try again in a moment.",
        );
      } finally {
        setProcessingVoice(false);
      }
    } else {
      const ok = await recorder.start();
      if (!ok) {
        Alert.alert(
          "Microphone needed",
          "Enable microphone access to use voice roleplay.",
        );
      }
    }
  }

  const playTurn = useCallback((text: string) => {
    speakText(text)
      .then(({ audio_base64 }) => playMp3Base64(audio_base64))
      .catch(() => {});
  }, []);

  const renderTurn = useCallback(
    ({ item }: { item: RoleplayTranscriptTurn }) => (
      <MessageBubble turn={item} onPlay={playTurn} />
    ),
    [playTurn],
  );

  function confirmEnd() {
    if (end.isPending) return;
    Alert.alert(
      "End this roleplay?",
      "You'll get an AI score on your performance.",
      [
        { text: "Keep going", style: "cancel" },
        {
          text: "End session",
          style: "destructive",
          onPress: async () => {
            try {
              await end.mutateAsync();
              router.replace(
                `/(tabs)/coaching/roleplay/results/${sessionId}` as never,
              );
            } catch (err) {
              Alert.alert(
                "Couldn't score this session",
                err instanceof Error ? err.message : "Try again.",
              );
            }
          },
        },
      ],
    );
  }

  function confirmLeave() {
    if (localTurns.length <= 1 || data?.completed_at) {
      router.back();
      return;
    }
    Alert.alert(
      "Leave roleplay?",
      "Your session is saved. You can resume later — but it won't be scored until you end it.",
      [
        { text: "Stay", style: "cancel" },
        { text: "Leave", onPress: () => router.back() },
      ],
    );
  }

  if (isLoading || !hydrated) {
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
          <Ionicons name="alert-circle-outline" size={32} color="#dc2626" />
          <Text className="text-base font-semibold text-ink-primary">
            Couldn't load session
          </Text>
          <Text className="text-center text-sm text-ink-muted">
            {error instanceof Error ? error.message : "Try again."}
          </Text>
          <Pressable
            onPress={() => refetch()}
            className="h-11 items-center justify-center rounded-xl bg-brand-600 px-6 active:bg-brand-700"
          >
            <Text className="text-sm font-semibold text-white">Try again</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-surface-base" edges={["top"]}>
      <View
        className="flex-row items-center gap-3 border-b border-surface-divider px-4 py-3 md:px-8"
      >
        <Pressable
          onPress={confirmLeave}
          hitSlop={12}
          className="h-10 w-10 items-center justify-center rounded-full active:bg-surface-raised"
        >
          <Ionicons name="arrow-back" size={22} color={colors.ink.secondary} />
        </Pressable>
        <View className="flex-1 gap-0.5">
          <Text className="text-[10px] font-semibold uppercase tracking-wider text-brand-600">
            Live roleplay
          </Text>
          <Text className="text-base font-semibold text-ink-primary" numberOfLines={1}>
            {scenarioTitle}
          </Text>
        </View>
        <SessionTimer startedAt={data.started_at} />
      </View>

      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 0}
      >
        <FlatList
          ref={listRef}
          data={localTurns}
          keyExtractor={(item, i) => `${item.role}-${i}-${item.at}`}
          renderItem={renderTurn}
          contentContainerClassName="mx-auto w-full max-w-3xl px-4 py-4 md:px-8"
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={() =>
            listRef.current?.scrollToEnd({ animated: true })
          }
          ListFooterComponent={
            respond.isPending || processingVoice ? <TypingBubble /> : null
          }
        />

        <View className="border-t border-surface-divider bg-white px-4 py-3 md:px-8">
          <View className="mx-auto w-full max-w-3xl gap-3">
            <View className="flex-row items-center gap-2">
              <Pressable
                onPress={confirmEnd}
                disabled={end.isPending}
                accessibilityRole="button"
                accessibilityLabel="End session"
                className="flex-row items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-3 py-1.5 active:bg-red-100"
              >
                <Ionicons name="stop-circle-outline" size={14} color="#b91c1c" />
                <Text className="text-xs font-semibold text-red-700">
                  {end.isPending ? "Scoring…" : "End session"}
                </Text>
              </Pressable>
            </View>

            {recorder.isRecording ? (
              <Text className="text-center text-xs font-semibold text-red-600">
                Listening… tap the mic to send
              </Text>
            ) : processingVoice ? (
              <Text className="text-center text-xs font-semibold text-ink-muted">
                Transcribing…
              </Text>
            ) : (
              <Text className="text-center text-[11px] text-ink-dim">
                Tap the mic to speak, or type below
              </Text>
            )}

            <View className="flex-row items-end gap-2">
              <Pressable
                onPress={toggleRecord}
                disabled={respond.isPending || end.isPending || processingVoice}
                className={`h-12 w-12 items-center justify-center rounded-full ${
                  recorder.isRecording
                    ? "bg-red-600 active:bg-red-700"
                    : "bg-brand-600 active:bg-brand-700"
                }`}
              >
                {processingVoice ? (
                  <ActivityIndicator color="#ffffff" size="small" />
                ) : (
                  <Ionicons
                    name={recorder.isRecording ? "stop" : "mic"}
                    size={20}
                    color="#ffffff"
                  />
                )}
              </Pressable>
              <TextInput
                value={input}
                onChangeText={setInput}
                multiline
                placeholder="Type your response…"
                placeholderTextColor={colors.ink.dim}
                editable={
                  !respond.isPending &&
                  !end.isPending &&
                  !recorder.isRecording &&
                  !processingVoice
                }
                className="max-h-32 flex-1 rounded-sm border border-surface-border bg-surface-raised px-4 py-3 text-base text-ink-primary"
              />
              <Pressable
                onPress={send}
                disabled={
                  !input.trim() ||
                  respond.isPending ||
                  end.isPending ||
                  recorder.isRecording ||
                  processingVoice
                }
                className={`h-12 w-12 items-center justify-center rounded-full ${
                  input.trim() &&
                  !respond.isPending &&
                  !end.isPending &&
                  !recorder.isRecording &&
                  !processingVoice
                    ? "bg-brand-600 active:bg-brand-700"
                    : "bg-surface-raised"
                }`}
              >
                <Ionicons
                  name="send"
                  size={18}
                  color={
                    input.trim() &&
                    !respond.isPending &&
                    !end.isPending &&
                    !recorder.isRecording &&
                    !processingVoice
                      ? "#ffffff"
                      : colors.ink.dim
                  }
                />
              </Pressable>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
