import { Ionicons } from "@expo/vector-icons";
import { memo } from "react";
import { Pressable, Text, View } from "react-native";

import { formatProjectType, formatTime } from "@/src/shared/lib/format";
import { colors } from "@/src/shared/theme/tokens";

import type { Appointment } from "../types";

import { DiscBadge } from "./disc-badge";
import { WidgetEstimateBadge } from "./widget-estimate-badge";

type Props = {
  appointment: Appointment;
  selected?: boolean;
  onPress?: (appointment: Appointment) => void;
  onViewBriefing?: (appointment: Appointment) => void;
};

function AppointmentCardBase({
  appointment,
  selected = false,
  onPress,
  onViewBriefing,
}: Props) {
  const lead = appointment.lead;
  const customerName = lead?.name ?? "Unnamed customer";
  const address = appointment.address ?? lead?.address ?? "Address pending";
  const projectType = formatProjectType(lead?.project_type ?? appointment.job_type);
  const time = formatTime(appointment.appointment_time);
  const borderClass = selected
    ? "border-brand-500"
    : "border-surface-border";
  const ringClass = selected ? "shadow-sm" : "";

  return (
    <Pressable
      onPress={onPress ? () => onPress(appointment) : undefined}
      accessibilityRole="button"
      accessibilityLabel={`${customerName}, ${time}`}
      className={`rounded-sm border ${borderClass} ${ringClass} bg-white p-4 active:bg-surface-raised`}
    >
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1 gap-1">
          <View className="flex-row items-center gap-2">
            <Ionicons name="time-outline" size={14} color={colors.ink.muted} />
            <Text className="text-sm font-semibold text-ink-secondary">
              {time}
            </Text>
          </View>
          <Text className="text-lg font-semibold text-ink-primary" numberOfLines={1}>
            {customerName}
          </Text>
          <Text className="text-sm text-ink-muted" numberOfLines={1}>
            {projectType}
          </Text>
        </View>
        <DiscBadge
          primary={lead?.disc_primary ?? null}
          confidence={lead?.disc_confidence}
        />
      </View>

      <View className="mt-3 flex-row items-center gap-1.5">
        <Ionicons name="location-outline" size={14} color={colors.ink.muted} />
        <Text className="flex-1 text-sm text-ink-muted" numberOfLines={1}>
          {address}
        </Text>
      </View>

      {lead?.has_widget_estimate ? (
        <View className="mt-3">
          <WidgetEstimateBadge
            lowCents={lead.widget_estimate_low_cents}
            highCents={lead.widget_estimate_high_cents}
          />
        </View>
      ) : null}

      {onViewBriefing ? (
        <Pressable
          onPress={() => onViewBriefing(appointment)}
          accessibilityRole="button"
          accessibilityLabel="View briefing"
          className="mt-4 h-10 flex-row items-center justify-center gap-1.5 rounded-sm bg-brand-600 active:bg-brand-700"
        >
          <Text className="text-sm font-semibold text-white">View briefing</Text>
          <Ionicons name="arrow-forward" size={14} color="#ffffff" />
        </Pressable>
      ) : null}
    </Pressable>
  );
}

export const AppointmentCard = memo(AppointmentCardBase);
