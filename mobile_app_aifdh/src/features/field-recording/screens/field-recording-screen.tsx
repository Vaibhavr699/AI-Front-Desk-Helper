import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useLeadDetail } from "@/src/features/leads/queries";
import { useRepProfile } from "@/src/features/settings/queries";
import { colors } from "@/src/shared/theme/tokens";

import {
  consentScriptFor,
  isTwoPartyConsentState,
} from "@/src/features/in-home-session/consent-states";
import { StatePicker } from "@/src/features/in-home-session/components/state-picker";

import { PendingUploadsBanner } from "../offline/components/pending-uploads-banner";
import { enqueueRecording } from "../offline/recording-queue";
import { triggerSync } from "../offline/sync-manager";
import { OrphanRecoveryBanner } from "../recorder/orphan-recovery-banner";
import { useFieldRecorder } from "../hooks/use-field-recorder";

export function FieldRecordingScreen() {
  const { leadId } = useLocalSearchParams<{ leadId: string }>();
  const router = useRouter();
  const { data: lead } = useLeadDetail(leadId || null);
  const { data: profile } = useRepProfile();
  const {
    recording,
    duration,
    permissionGranted,
    error: recorderError,
    startRecording,
    stopRecording,
    openSettings,
  } = useFieldRecorder();

  const [stateCode, setStateCode] = useState<string | null>(null);
  const [consentAck, setConsentAck] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (profile?.home_state) {
      setStateCode((cur) => cur ?? profile.home_state ?? null);
    }
  }, [profile?.home_state]);

  const isTwoParty = stateCode ? isTwoPartyConsentState(stateCode) : false;
  const consentReady = !!stateCode && (!isTwoParty || consentAck);

  const timer = useMemo(() => {
    const m = Math.floor(duration / 60).toString().padStart(2, "0");
    const s = (duration % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  }, [duration]);

  async function handleStop() {
    const fileUri = await stopRecording();
    if (!fileUri || !leadId) return;
    setUploading(true);
    try {
      const result = await enqueueRecording({
        leadId,
        leadName: lead?.name ?? null,
        fileUri,
        consentStatus: isTwoParty ? "obtained" : "not_required",
        consentMethod: isTwoParty ? "verbal_in_person" : "one_party_state",
        consentState: stateCode,
        durationSeconds: duration,
      });
      if (!result.ok) {
        Alert.alert(
          "Offline buffer full",
          "You've reached the 60-minute offline limit. Reconnect to upload your queued recordings before recording more.",
        );
        return;
      }
      triggerSync();
      setDone(true);
    } catch (err) {
      Alert.alert("Couldn't save recording", err instanceof Error ? err.message : "Try again.");
    } finally {
      setUploading(false);
    }
  }

  if (done) {
    return (
      <SafeAreaView className="flex-1 bg-surface-base px-8" edges={["top"]}>
        <View className="flex-1 items-center justify-center">
          <View className="h-16 w-16 items-center justify-center rounded-full bg-emerald-50">
            <Ionicons name="checkmark-circle" size={36} color="#059669" />
          </View>
          <Text className="mt-4 text-xl font-semibold text-ink-primary">Recording saved</Text>
          <Text className="mt-2 text-center text-sm text-ink-muted">
            It uploads and gets analyzed automatically. DISC profile and coaching scores appear on the customer's profile shortly. Safe to leave this screen — uploads finish in the background, even offline.
          </Text>
          <View className="mt-6 w-full max-w-sm">
            <PendingUploadsBanner />
          </View>
          <View className="mt-8 w-full max-w-sm gap-3">
            <Pressable
              onPress={() => router.replace("/(tabs)/coaching" as never)}
              accessibilityRole="button"
              accessibilityLabel="View my coaching"
              className="items-center rounded-sm bg-brand-600 px-8 py-3 active:bg-brand-700"
            >
              <Text className="text-sm font-semibold text-white">View my coaching</Text>
            </Pressable>
            <Pressable
              onPress={() => router.back()}
              accessibilityRole="button"
              accessibilityLabel="Back to customer"
              className="items-center rounded-sm border border-surface-border px-8 py-3 active:bg-surface-raised"
            >
              <Text className="text-sm font-semibold text-ink-primary">Back to customer</Text>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-surface-base" edges={["top"]}>
      <View className="flex-row items-center gap-3 border-b border-surface-divider px-5 py-3">
        <Pressable onPress={() => router.back()} hitSlop={12} className="h-9 w-9 items-center justify-center rounded-lg active:bg-surface-raised">
          <Ionicons name="arrow-back" size={22} color={colors.ink.secondary} />
        </Pressable>
        <View className="flex-1">
          <Text className="text-lg font-semibold text-ink-primary">Record Visit</Text>
          {lead?.name && <Text className="text-xs text-ink-muted">{lead.name}</Text>}
        </View>
      </View>

      <View className="flex-1 items-center justify-center px-8">
        {!consentReady ? (
          <View className="w-full max-w-sm gap-6">
            <Text className="text-center text-base font-semibold text-ink-primary">
              Select the visit state
            </Text>
            <StatePicker value={stateCode} onChange={setStateCode} />
            {isTwoParty && stateCode && (
              <View className="gap-3 rounded-sm bg-amber-50 p-4">
                <Text className="text-sm font-semibold text-amber-800">
                  Two-party consent state
                </Text>
                <Text className="text-xs leading-relaxed text-amber-700">
                  Please read this to the customer before recording:{"\n\n"}
                  "I use AI tools to help me capture details accurately. This means our conversation will be recorded. Is that okay with you?"
                </Text>
                <Pressable
                  onPress={() => setConsentAck(true)}
                  className="mt-2 items-center rounded-sm bg-amber-600 py-3 active:bg-amber-700"
                >
                  <Text className="text-sm font-semibold text-white">Customer agreed</Text>
                </Pressable>
              </View>
            )}
          </View>
        ) : recording ? (
          <View className="items-center gap-6">
            <View className="h-32 w-32 items-center justify-center rounded-full bg-red-50">
              <View className="h-5 w-5 rounded-sm bg-red-500" />
            </View>
            <Text className="font-mono text-5xl font-bold tabular-nums text-ink-primary">{timer}</Text>
            <Text className="text-sm text-ink-muted">Recording in progress...</Text>
            <Pressable
              onPress={handleStop}
              className="flex-row items-center gap-2 rounded-sm bg-red-600 px-8 py-3.5 active:bg-red-700"
            >
              <Ionicons name="stop" size={18} color="#fff" />
              <Text className="text-sm font-semibold text-white">Stop & Upload</Text>
            </Pressable>
          </View>
        ) : uploading ? (
          <View className="items-center gap-4">
            <Ionicons name="cloud-upload-outline" size={48} color={colors.brand[600]} />
            <Text className="text-base font-semibold text-ink-primary">Uploading recording...</Text>
            <Text className="text-sm text-ink-muted">This may take a moment.</Text>
          </View>
        ) : (
          <View className="w-full max-w-sm items-center gap-6">
            <View className="w-full">
              <OrphanRecoveryBanner />
            </View>
            <View className="h-32 w-32 items-center justify-center rounded-full bg-brand-50">
              <Ionicons name="mic" size={48} color={colors.brand[600]} />
            </View>
            <Text className="text-center text-base font-semibold text-ink-primary">
              Ready to record
            </Text>
            <Text className="text-center text-sm text-ink-muted">
              Place your phone on the table or nearby.{"\n"}The mic will capture the conversation.
            </Text>
            {recorderError === "permission" || !permissionGranted ? (
              <View className="w-full items-center gap-3">
                <Text className="text-center text-sm text-red-600">
                  Microphone access is off, so recording can't start.
                </Text>
                <Pressable
                  onPress={openSettings}
                  className="flex-row items-center gap-2 rounded-sm border border-red-200 bg-red-50 px-5 py-2.5 active:bg-red-100"
                >
                  <Ionicons name="settings-outline" size={16} color="#b91c1c" />
                  <Text className="text-sm font-semibold text-red-700">
                    Open settings
                  </Text>
                </Pressable>
              </View>
            ) : null}
            {recorderError === "start_failed" && (
              <Text className="text-center text-sm text-red-600">
                Recording couldn't start — the mic may be in use by a call. Try
                again in a moment.
              </Text>
            )}
            <Pressable
              onPress={() => startRecording(leadId ?? null)}
              disabled={!permissionGranted}
              className={`flex-row items-center gap-2 rounded-sm px-8 py-3.5 ${permissionGranted ? "bg-brand-600 active:bg-brand-700" : "bg-gray-300"}`}
            >
              <Ionicons name="mic" size={18} color="#fff" />
              <Text className="text-sm font-semibold text-white">Start Recording</Text>
            </Pressable>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}
