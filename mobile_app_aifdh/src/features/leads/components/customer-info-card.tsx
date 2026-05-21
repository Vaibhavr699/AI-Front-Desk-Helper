import { Ionicons } from "@expo/vector-icons";
import { Linking, Pressable, Text, View } from "react-native";

import { formatProjectType } from "@/src/shared/lib/format";
import { colors } from "@/src/shared/theme/tokens";

import type { LeadDetail } from "../types";

type Props = {
  lead: LeadDetail;
};

export function CustomerInfoCard({ lead }: Props) {
  function openMaps() {
    if (!lead.address) return;
    const encoded = encodeURIComponent(lead.address);
    Linking.openURL(`https://maps.apple.com/?q=${encoded}`).catch(() => {
      Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${encoded}`);
    });
  }
  function call() {
    if (lead.phone) Linking.openURL(`tel:${lead.phone}`);
  }
  function email() {
    if (lead.email) Linking.openURL(`mailto:${lead.email}`);
  }

  return (
    <View className="gap-3 rounded-2xl border border-surface-border bg-white p-4">
      <Text className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
        Customer
      </Text>
      <View className="gap-2">
        <Row
          icon="briefcase-outline"
          label="Project"
          value={formatProjectType(lead.project_type)}
        />
        {lead.address ? (
          <PressableRow
            icon="location-outline"
            label="Address"
            value={lead.address}
            onPress={openMaps}
          />
        ) : null}
        {lead.phone ? (
          <PressableRow
            icon="call-outline"
            label="Phone"
            value={lead.phone}
            onPress={call}
          />
        ) : null}
        {lead.email ? (
          <PressableRow
            icon="mail-outline"
            label="Email"
            value={lead.email}
            onPress={email}
          />
        ) : null}
        {lead.lead_source ? (
          <Row icon="git-branch-outline" label="Source" value={lead.lead_source} />
        ) : null}
      </View>
    </View>
  );
}

type RowProps = {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
};

function Row({ icon, label, value }: RowProps) {
  return (
    <View className="flex-row items-start gap-3">
      <View className="h-8 w-8 items-center justify-center rounded-lg bg-surface-raised">
        <Ionicons name={icon} size={16} color={colors.ink.muted} />
      </View>
      <View className="flex-1 gap-0.5">
        <Text className="text-xs font-medium text-ink-muted">{label}</Text>
        <Text className="text-sm text-ink-primary">{value}</Text>
      </View>
    </View>
  );
}

function PressableRow({ icon, label, value, onPress }: RowProps & { onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-start gap-3 -mx-1 rounded-lg px-1 py-1 active:bg-surface-raised"
    >
      <View className="h-8 w-8 items-center justify-center rounded-lg bg-surface-raised">
        <Ionicons name={icon} size={16} color={colors.ink.muted} />
      </View>
      <View className="flex-1 gap-0.5">
        <Text className="text-xs font-medium text-ink-muted">{label}</Text>
        <Text className="text-sm font-medium text-brand-700">{value}</Text>
      </View>
    </Pressable>
  );
}
