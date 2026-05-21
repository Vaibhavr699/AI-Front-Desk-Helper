import { Ionicons } from "@expo/vector-icons";
import { Alert, Linking, Pressable, Text, View } from "react-native";

import { colors } from "@/src/shared/theme/tokens";

import type { LeadDetail } from "../types";

type Props = {
  lead: LeadDetail;
};

export function LeadActionBar({ lead }: Props) {
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

  return (
    <View className="flex-row gap-2">
      <ActionButton
        icon="call"
        label="Call"
        onPress={call}
        disabled={!lead.phone}
      />
      <ActionButton
        icon="chatbox-ellipses"
        label="SMS"
        onPress={sms}
        disabled={!lead.phone}
      />
      <ActionButton icon="create" label="Note" onPress={addNote} />
      <ActionButton icon="pricetag" label="Quote" onPress={enterQuote} />
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
      className={`flex-1 items-center gap-1 rounded-2xl border border-surface-border bg-white px-3 py-3 active:bg-surface-raised ${disabled ? "opacity-40" : ""}`}
    >
      <Ionicons name={icon} size={20} color={colors.brand[600]} />
      <Text className="text-xs font-semibold text-ink-secondary">{label}</Text>
    </Pressable>
  );
}
