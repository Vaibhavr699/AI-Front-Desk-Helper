import { Ionicons } from "@expo/vector-icons";
import { Pressable, Text, View } from "react-native";

import { DiscBadge } from "@/src/features/appointments/components/disc-badge";
import { WidgetEstimateBadge } from "@/src/features/appointments/components/widget-estimate-badge";
import { formatProjectType } from "@/src/shared/lib/format";
import { colors } from "@/src/shared/theme/tokens";

import type { LeadSummary } from "../types";

import { StatusBadge } from "./status-badge";

type Props = {
  lead: LeadSummary;
  selected?: boolean;
  onPress?: () => void;
};

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function LeadCard({ lead, selected = false, onPress }: Props) {
  const name = lead.name ?? "Unnamed lead";
  const projectType = formatProjectType(lead.project_type);
  const borderClass = selected ? "border-brand-500" : "border-surface-border";
  return (
    <Pressable
      onPress={onPress}
      className={`rounded-2xl border ${borderClass} bg-white p-4 active:bg-surface-raised`}
    >
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1 gap-1">
          <Text
            className="text-base font-semibold text-ink-primary"
            numberOfLines={1}
          >
            {name}
          </Text>
          <Text className="text-sm text-ink-muted" numberOfLines={1}>
            {projectType}
          </Text>
        </View>
        <DiscBadge
          primary={lead.disc_primary}
          confidence={lead.disc_confidence}
        />
      </View>

      <View className="mt-3 flex-row items-center justify-between gap-2">
        <View className="flex-row items-center gap-3">
          <StatusBadge status={lead.status} />
          {lead.has_widget_estimate ? (
            <WidgetEstimateBadge
              lowCents={lead.widget_estimate_low_cents}
              highCents={lead.widget_estimate_high_cents}
            />
          ) : null}
        </View>
        <View className="flex-row items-center gap-1">
          <Ionicons name="time-outline" size={12} color={colors.ink.muted} />
          <Text className="text-xs text-ink-muted">
            {timeAgo(lead.updated_at)}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}
