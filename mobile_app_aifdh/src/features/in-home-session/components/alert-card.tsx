import { Ionicons } from "@expo/vector-icons";
import { Text, View } from "react-native";

import { colors } from "@/src/shared/theme/tokens";

import type { CoachingAlert, CoachingAlertUrgency } from "../types";

type Props = {
  alert: CoachingAlert;
  compact?: boolean;
};

const URGENCY_META: Record<
  CoachingAlertUrgency,
  {
    bg: string;
    border: string;
    titleColor: string;
    icon: keyof typeof Ionicons.glyphMap;
    iconColor: string;
  }
> = {
  green: {
    bg: "bg-emerald-50",
    border: "border-emerald-300",
    titleColor: "text-emerald-800",
    icon: "trending-up",
    iconColor: "#059669",
  },
  yellow: {
    bg: "bg-amber-50",
    border: "border-amber-300",
    titleColor: "text-amber-800",
    icon: "information-circle",
    iconColor: "#d97706",
  },
  orange: {
    bg: "bg-orange-50",
    border: "border-orange-300",
    titleColor: "text-orange-800",
    icon: "alert-circle",
    iconColor: "#ea580c",
  },
  red: {
    bg: "bg-red-50",
    border: "border-red-300",
    titleColor: "text-red-800",
    icon: "warning",
    iconColor: "#dc2626",
  },
};

const TYPE_LABEL: Record<string, string> = {
  ask_discovery: "Ask discovery",
  listen: "Listen",
  disc_reframe: "DISC reframe",
  missing_close: "Close attempt",
  address_objection: "Objection",
  slow_down: "Slow down",
  build_rapport: "Build rapport",
  confirm_next_step: "Confirm next step",
  disc_update: "DISC update",
  disc_shift: "DISC shift",
  objection_detected: "Objection",
  buying_signal: "Buying signal",
  decision_maker: "Decision maker",
  warning: "Warning",
  suggested_response: "Try saying",
  walkthrough_reminder: "Walkthrough",
};

export function AlertCard({ alert, compact = false }: Props) {
  const meta = URGENCY_META[alert.urgency];
  const label = TYPE_LABEL[alert.type] || alert.type;
  return (
    <View
      className={`gap-${compact ? "1.5" : "2"} rounded-sm border ${meta.bg} ${meta.border} p-${compact ? "3" : "4"}`}
    >
      <View className="flex-row items-center gap-2">
        <Ionicons name={meta.icon} size={14} color={meta.iconColor} />
        <Text
          className={`text-[10px] font-bold uppercase tracking-wider ${meta.titleColor}`}
        >
          {label}
        </Text>
        {alert.watch_label ? (
          <View className="rounded bg-gray-200 px-1.5 py-0.5">
            <Text className="text-[9px] font-bold text-gray-600">
              {alert.watch_label}
            </Text>
          </View>
        ) : null}
      </View>
      <Text className={`font-bold text-ink-primary ${compact ? "text-sm" : "text-base"}`}>
        {alert.headline}
      </Text>
      {!compact && alert.full_text ? (
        <Text className="text-sm leading-relaxed text-ink-secondary">
          {alert.full_text}
        </Text>
      ) : null}
    </View>
  );
}
