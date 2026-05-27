import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Alert, Linking, Pressable, Text, View } from "react-native";

import { useTenantFlags } from "@/src/features/auth/store";
import { colors } from "@/src/shared/theme/tokens";

import type { LeadDetail } from "../types";

type Props = {
  lead: LeadDetail;
};

export function LeadActionBar({ lead }: Props) {
  const router = useRouter();
  const { rep_coach_enabled } = useTenantFlags();

  function call() {
    if (lead.phone) Linking.openURL(`tel:${lead.phone}`);
  }
  function sms() {
    if (lead.phone) Linking.openURL(`sms:${lead.phone}`);
  }
  function addNote() {
    Alert.alert("Add note", "Notes modal coming next.");
  }
  function enterQuote() {
    Alert.alert("Enter quote", "Quote-entry flow coming next.");
  }
  function startInHome() {
    router.push(`/in-home/prepare/${lead.id}` as never);
  }
  function recordVisit() {
    router.push(`/field-recording/${lead.id}` as never);
  }

  return (
    <View className="gap-2">
      {rep_coach_enabled && (
        <Pressable
          onPress={recordVisit}
          className="h-12 flex-row items-center justify-center gap-2 rounded-sm bg-brand-600 active:bg-brand-700"
        >
          <Ionicons name="mic" size={18} color="#ffffff" />
          <Text className="text-sm font-semibold text-white">Record visit</Text>
        </Pressable>
      )}
      <Pressable
        onPress={startInHome}
        className="h-12 flex-row items-center justify-center gap-2 rounded-sm border border-brand-200 bg-brand-50 active:bg-brand-100"
      >
        <Ionicons name="radio" size={18} color={colors.brand[600]} />
        <Text className="text-sm font-semibold text-brand-700">Start live session</Text>
      </Pressable>
      <View className="flex-row gap-2">
        <ActionButton icon="call" label="Call" onPress={call} disabled={!lead.phone} />
        <ActionButton icon="chatbox-ellipses" label="SMS" onPress={sms} disabled={!lead.phone} />
        <ActionButton icon="create" label="Note" onPress={addNote} />
        <ActionButton icon="pricetag" label="Quote" onPress={enterQuote} />
      </View>
    </View>
  );
}

type ButtonProps = {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  disabled?: boolean;
};

function ActionButton({ icon, label, onPress, disabled }: ButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      className={`flex-1 items-center gap-1 rounded-sm border border-surface-border bg-white px-3 py-3 active:bg-surface-raised ${disabled ? "opacity-40" : ""}`}
    >
      <Ionicons name={icon} size={20} color={colors.brand[600]} />
      <Text className="text-xs font-semibold text-ink-secondary">{label}</Text>
    </Pressable>
  );
}
