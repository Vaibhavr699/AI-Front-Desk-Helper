import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useLeadDetail } from "@/src/features/leads/queries";
import { colors } from "@/src/shared/theme/tokens";

import { useCallSession } from "../hooks/use-call-session";

export function CallScreen() {
  const { leadId } = useLocalSearchParams<{ leadId: string }>();
  const router = useRouter();
  const { data: lead } = useLeadDetail(leadId || null);
  const { phase, duration, error, start, hangUp } = useCallSession();

  useEffect(() => {
    if (leadId && phase === "idle") {
      start(leadId);
    }
  }, [leadId, phase, start]);

  const timer = useMemo(() => {
    const m = Math.floor(duration / 60).toString().padStart(2, "0");
    const s = (duration % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  }, [duration]);

  const isActive = phase === "ringing" || phase === "in-progress" || phase === "initiating";

  return (
    <SafeAreaView className="flex-1 bg-gray-900" edges={["top", "bottom"]}>
      <View className="flex-1 items-center justify-center px-8">
        <View className="h-20 w-20 items-center justify-center rounded-full bg-white/10">
          <Ionicons
            name={phase === "in-progress" ? "call" : phase === "completed" ? "checkmark" : "call-outline"}
            size={36}
            color="#fff"
          />
        </View>
        <Text className="mt-6 text-2xl font-semibold text-white">
          {lead?.name || "Calling..."}
        </Text>
        <Text className="mt-1 text-sm text-gray-400">
          {lead?.phone || ""}
        </Text>
        <Text className="mt-6 text-sm font-medium text-gray-400">
          {phase === "initiating" && "Connecting..."}
          {phase === "ringing" && "Ringing..."}
          {phase === "in-progress" && "Call in progress"}
          {phase === "completed" && "Call ended"}
          {phase === "failed" && (error || "Call failed")}
        </Text>
        {(phase === "in-progress" || phase === "ringing") && (
          <Text className="mt-2 font-mono text-4xl font-bold tabular-nums text-white">
            {timer}
          </Text>
        )}
      </View>

      <View className="items-center pb-10">
        {isActive ? (
          <Pressable
            onPress={hangUp}
            accessibilityRole="button"
            accessibilityLabel="Hang up"
            className="h-16 w-16 items-center justify-center rounded-full bg-red-600 active:bg-red-700"
          >
            <Ionicons name="call" size={28} color="#fff" style={{ transform: [{ rotate: "135deg" }] }} />
          </Pressable>
        ) : phase === "failed" ? (
          <View className="w-full max-w-xs gap-3">
            <Pressable
              onPress={() => leadId && start(leadId)}
              accessibilityRole="button"
              accessibilityLabel="Try the call again"
              className="items-center rounded-sm bg-brand-600 px-8 py-3 active:bg-brand-700"
            >
              <Text className="text-sm font-semibold text-white">Try again</Text>
            </Pressable>
            <Pressable
              onPress={() => router.back()}
              accessibilityRole="button"
              accessibilityLabel="Done"
              className="items-center rounded-sm bg-white/10 px-8 py-3 active:bg-white/20"
            >
              <Text className="text-sm font-semibold text-white">Done</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Done"
            className="rounded-sm bg-white/10 px-8 py-3 active:bg-white/20"
          >
            <Text className="text-sm font-semibold text-white">Done</Text>
          </Pressable>
        )}
        {phase === "completed" && (
          <Text className="mt-4 text-center text-xs text-gray-500">
            Recording is being analyzed. DISC + coaching scores will update shortly.
          </Text>
        )}
      </View>
    </SafeAreaView>
  );
}
