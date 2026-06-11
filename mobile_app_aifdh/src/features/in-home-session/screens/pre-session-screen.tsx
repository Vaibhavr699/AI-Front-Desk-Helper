import { Ionicons } from "@expo/vector-icons";
import * as Battery from "expo-battery";
import * as Network from "expo-network";
import { useRouter } from "expo-router";
import { Audio } from "expo-av";
import { useEffect, useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useLeadDetail } from "@/src/features/leads/queries";
import { useRepProfile } from "@/src/features/settings/queries";
import { colors } from "@/src/shared/theme/tokens";

import {
  ChecklistItem,
  type CheckStatus,
} from "../components/checklist-item";
import { ConsentPrompt } from "../components/consent-prompt";
import { StatePicker } from "../components/state-picker";
import {
  consentScriptFor,
  isTwoPartyConsentState,
} from "../consent-states";
import { useStartInHomeSession } from "../queries";
import type { NetworkMode } from "../types";

type Props = {
  leadId: string;
};

const BATTERY_MIN = 0.3;

export function PreSessionScreen({ leadId }: Props) {
  const router = useRouter();
  const isQuickStart = leadId === "quick";
  const { data: lead } = useLeadDetail(isQuickStart ? null : leadId);
  const { data: profile } = useRepProfile();
  const start = useStartInHomeSession();

  const [stateCode, setStateCode] = useState<string | null>(null);
  const [consentAck, setConsentAck] = useState(false);

  const [batteryLevel, setBatteryLevel] = useState<number | null>(null);
  const [networkType, setNetworkType] = useState<string | null>(null);
  const [networkConnected, setNetworkConnected] = useState<boolean | null>(null);
  const [micStatus, setMicStatus] = useState<CheckStatus>("checking");

  useEffect(() => {
    let mounted = true;
    (async () => {
      const lvl = await Battery.getBatteryLevelAsync();
      if (mounted) setBatteryLevel(lvl);
    })();
    (async () => {
      const net = await Network.getNetworkStateAsync();
      if (mounted) {
        setNetworkType(net.type ?? null);
        setNetworkConnected(net.isConnected ?? null);
      }
    })();
    (async () => {
      const current = await Audio.getPermissionsAsync();
      if (current.status === "granted") {
        if (mounted) setMicStatus("ok");
        return;
      }
      const { status } = await Audio.requestPermissionsAsync();
      if (mounted) setMicStatus(status === "granted" ? "ok" : "fail");
    })();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (profile?.home_state) {
      setStateCode((cur) => cur ?? profile.home_state ?? null);
    }
  }, [profile?.home_state]);

  const networkStatus: CheckStatus =
    networkConnected == null
      ? "checking"
      : networkConnected
        ? "ok"
        : "fail";
  const networkDetail =
    networkConnected == null
      ? "Detecting connection…"
      : networkConnected
        ? `Connected via ${networkType?.toLowerCase() ?? "unknown"}. Live coaching ready.`
        : "No connection detected. Live coaching will run in offline mode and sync later.";

  const batteryStatus: CheckStatus =
    batteryLevel == null
      ? "checking"
      : batteryLevel >= BATTERY_MIN
        ? "ok"
        : "warn";
  const batteryDetail =
    batteryLevel == null
      ? "Reading battery…"
      : `${Math.round(batteryLevel * 100)}% — ${batteryLevel >= BATTERY_MIN ? "plenty for a 45-minute visit." : "below 30%. Consider plugging in before you walk up."}`;

  const micDetail =
    micStatus === "ok"
      ? "Microphone permission granted."
      : micStatus === "fail"
        ? "Microphone access denied. Enable it in iOS / Android settings to record."
        : "Requesting microphone permission…";

  const consentScript = useMemo(
    () =>
      consentScriptFor(
        lead?.name ?? null,
        profile?.email?.split("@")[0] ?? null,
        profile?.tenant?.name ?? null,
      ),
    [lead?.name, profile?.email, profile?.tenant?.name],
  );

  const consentStatus: CheckStatus = !stateCode
    ? "pending"
    : isTwoPartyConsentState(stateCode)
      ? consentAck
        ? "ok"
        : "warn"
      : "ok";

  const networkMode: NetworkMode = networkConnected
    ? "online"
    : "offline";

  const consentMet =
    !!stateCode &&
    (!isTwoPartyConsentState(stateCode) || consentAck);

  const canStart =
    !!stateCode &&
    consentMet &&
    micStatus === "ok" &&
    !start.isPending;

  async function handleStart() {
    if (!canStart) return;
    try {
      const result = await start.mutateAsync({
        lead_id: isQuickStart ? undefined : leadId,
        consent_obtained: true,
        consent_type: isTwoPartyConsentState(stateCode!)
          ? "verbal"
          : "not_required",
        consent_state: stateCode,
        device_type: "mobile",
        network_mode: networkMode,
      });
      router.replace(`/in-home/live/${result.session.id}` as never);
    } catch (err) {
      Alert.alert(
        "Couldn't start session",
        err instanceof Error ? err.message : "Please try again.",
      );
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-surface-base" edges={["top"]}>
      <View className="flex-row items-center gap-3 border-b border-surface-divider px-4 py-3 md:px-8">
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          className="h-10 w-10 items-center justify-center rounded-full active:bg-surface-raised"
        >
          <Ionicons name="close" size={22} color={colors.ink.secondary} />
        </Pressable>
        <View className="flex-1 gap-0.5">
          <Text className="text-[10px] font-semibold uppercase tracking-wider text-brand-600">
            Pre-session check
          </Text>
          <Text className="text-base font-semibold text-ink-primary" numberOfLines={1}>
            {lead?.name ?? "In-home session"}
          </Text>
        </View>
      </View>

      <ScrollView contentContainerClassName="px-4 pb-10 pt-4 md:px-8 gap-4">
        <View className="mx-auto w-full max-w-2xl gap-4">
          <View className="gap-2">
            <Text className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
              Visit state
            </Text>
            <StatePicker value={stateCode} onChange={setStateCode} />
          </View>

          <ConsentPrompt
            stateCode={stateCode}
            customerName={lead?.name ?? null}
            acknowledged={consentAck}
            onAcknowledge={() => setConsentAck((v) => !v)}
            consentScript={consentScript}
          />

          <ChecklistItem
            status={consentStatus}
            title="Consent"
            detail={
              !stateCode
                ? "Pick the state you're visiting."
                : isTwoPartyConsentState(stateCode)
                  ? consentAck
                    ? "Customer agreed. You're clear to record."
                    : "Read the script and check the box once they say yes."
                  : `${stateCode} is a one-party-consent state. Cleared automatically.`
            }
          />
          <ChecklistItem
            status={networkStatus}
            title="Connectivity"
            detail={networkDetail}
          />
          <ChecklistItem
            status={batteryStatus}
            title="Battery"
            detail={batteryDetail}
          />
          <ChecklistItem
            status={micStatus}
            title="Microphone access"
            detail={micDetail}
          />

          <View className="rounded-sm border border-surface-border bg-surface-raised p-4">
            <View className="flex-row items-center gap-2">
              <Ionicons
                name="phone-portrait-outline"
                size={16}
                color={colors.ink.muted}
              />
              <Text className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
                Recommended
              </Text>
            </View>
            <Text className="mt-2 text-sm leading-relaxed text-ink-secondary">
              Make sure device vibration is on so coaching alerts reach you
              even when you're not looking at the screen.
            </Text>
          </View>
        </View>
      </ScrollView>

      <View className="border-t border-surface-divider bg-white px-4 py-3 md:px-8">
        <View className="mx-auto w-full max-w-2xl">
          <Pressable
            onPress={handleStart}
            disabled={!canStart}
            className={`h-14 flex-row items-center justify-center gap-2 rounded-sm ${canStart ? "bg-brand-600 active:bg-brand-700" : "bg-surface-raised"}`}
          >
            <Ionicons
              name="play-circle"
              size={20}
              color={canStart ? "#ffffff" : colors.ink.dim}
            />
            <Text
              className={`text-base font-semibold ${canStart ? "text-white" : "text-ink-dim"}`}
            >
              {start.isPending ? "Starting…" : "Begin session"}
            </Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}
