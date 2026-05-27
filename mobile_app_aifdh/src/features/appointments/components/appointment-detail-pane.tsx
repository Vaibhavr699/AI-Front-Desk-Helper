import { Ionicons } from "@expo/vector-icons";
import { Pressable, ScrollView, Text, View } from "react-native";

import { formatProjectType, formatTime } from "@/src/shared/lib/format";
import { colors } from "@/src/shared/theme/tokens";

import type { Appointment } from "../types";

import { DiscBadge } from "./disc-badge";
import { WidgetEstimateBadge } from "./widget-estimate-badge";

type Props = {
  appointment: Appointment | null;
  onViewBriefing?: (leadId: string) => void;
};

export function AppointmentDetailPane({ appointment, onViewBriefing }: Props) {
  if (!appointment) {
    return (
      <View className="flex-1 items-center justify-center px-8">
        <View className="h-16 w-16 items-center justify-center rounded-full bg-surface-raised">
          <Ionicons name="hand-left-outline" size={32} color={colors.ink.muted} />
        </View>
        <Text className="mt-4 text-base text-ink-muted">
          Select an appointment to preview
        </Text>
      </View>
    );
  }

  const lead = appointment.lead;
  const customerName = lead?.name ?? "Unnamed customer";
  const address = appointment.address ?? lead?.address ?? "Address pending";
  const projectType = formatProjectType(
    lead?.project_type ?? appointment.job_type,
  );
  const time = formatTime(appointment.appointment_time);
  const phone = lead?.phone;
  const email = lead?.email;

  return (
    <ScrollView
      className="flex-1"
      contentContainerClassName="px-6 py-6 gap-6"
    >
      <View className="gap-2">
        <View className="flex-row items-center gap-2">
          <Ionicons name="time-outline" size={16} color={colors.ink.muted} />
          <Text className="text-sm font-medium text-ink-secondary">{time}</Text>
        </View>
        <Text className="text-2xl font-bold text-ink-primary">
          {customerName}
        </Text>
        <Text className="text-base text-ink-muted">{projectType}</Text>
      </View>

      <View className="gap-3 rounded-sm border border-surface-border bg-white p-4">
        <DetailRow icon="location-outline" label="Address" value={address} />
        {phone ? (
          <DetailRow icon="call-outline" label="Phone" value={phone} />
        ) : null}
        {email ? (
          <DetailRow icon="mail-outline" label="Email" value={email} />
        ) : null}
      </View>

      {lead?.disc_primary && lead.disc_primary !== "unknown" ? (
        <View className="gap-3 rounded-sm border border-surface-border bg-white p-4">
          <Text className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
            Customer intelligence
          </Text>
          <View className="flex-row items-center gap-3">
            <DiscBadge
              primary={lead.disc_primary}
              confidence={lead.disc_confidence}
              size="md"
            />
            <Text className="flex-1 text-sm text-ink-secondary">
              DISC profile: {lead.disc_primary}-type buyer
            </Text>
          </View>
        </View>
      ) : null}

      {lead?.has_widget_estimate ? (
        <View className="gap-3 rounded-sm border border-surface-border bg-white p-4">
          <Text className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
            Customer used website estimator
          </Text>
          <WidgetEstimateBadge
            lowCents={lead.widget_estimate_low_cents}
            highCents={lead.widget_estimate_high_cents}
          />
          <Text className="text-xs text-ink-muted">
            Be prepared to explain variance if your quote differs from this
            ballpark.
          </Text>
        </View>
      ) : null}

      {appointment.notes ? (
        <View className="gap-2 rounded-sm border border-surface-border bg-white p-4">
          <Text className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
            Notes
          </Text>
          <Text className="text-sm text-ink-secondary">{appointment.notes}</Text>
        </View>
      ) : null}

      {lead && onViewBriefing ? (
        <Pressable
          onPress={() => onViewBriefing(lead.id)}
          className="h-12 flex-row items-center justify-center gap-2 rounded-sm bg-brand-600 active:bg-brand-700"
        >
          <Text className="text-base font-semibold text-white">
            View full briefing
          </Text>
          <Ionicons name="arrow-forward" size={16} color="#ffffff" />
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

type DetailRowProps = {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
};

function DetailRow({ icon, label, value }: DetailRowProps) {
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
