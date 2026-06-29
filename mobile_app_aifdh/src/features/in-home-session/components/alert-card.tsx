import { Ionicons } from "@expo/vector-icons";
import { Text, View } from "react-native";

import type { CoachingAlert } from "../types";

type Props = {
  alert: CoachingAlert;
  compact?: boolean;
};

type CueMeta = {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  accent: string; // left bar + icon color
  tint: string; // soft background
};

// Per-cue-type styling. DISC cues get their own violet identity.
const CUE_META: Record<string, CueMeta> = {
  ask_discovery: { label: "Ask Discovery", icon: "help-circle", accent: "#2563eb", tint: "#eff6ff" },
  listen: { label: "Listen", icon: "ear", accent: "#d97706", tint: "#fffbeb" },
  disc_reframe: { label: "DISC Reframe", icon: "people", accent: "#7c3aed", tint: "#f5f3ff" },
  disc_update: { label: "DISC Read", icon: "people", accent: "#7c3aed", tint: "#f5f3ff" },
  disc_shift: { label: "DISC Shift", icon: "swap-horizontal", accent: "#7c3aed", tint: "#f5f3ff" },
  missing_close: { label: "Close", icon: "flag", accent: "#ea580c", tint: "#fff7ed" },
  address_objection: { label: "Objection", icon: "shield-checkmark", accent: "#dc2626", tint: "#fef2f2" },
  objection_detected: { label: "Objection", icon: "shield-checkmark", accent: "#dc2626", tint: "#fef2f2" },
  slow_down: { label: "Slow Down", icon: "speedometer", accent: "#dc2626", tint: "#fef2f2" },
  build_rapport: { label: "Build Rapport", icon: "heart", accent: "#db2777", tint: "#fdf2f8" },
  confirm_next_step: { label: "Confirm Next Step", icon: "checkmark-done-circle", accent: "#059669", tint: "#ecfdf5" },
  buying_signal: { label: "Buying Signal", icon: "trending-up", accent: "#059669", tint: "#ecfdf5" },
  decision_maker: { label: "Decision Maker", icon: "person-circle", accent: "#7c3aed", tint: "#f5f3ff" },
  warning: { label: "Warning", icon: "warning", accent: "#dc2626", tint: "#fef2f2" },
  suggested_response: { label: "Try Saying", icon: "chatbubble-ellipses", accent: "#ea580c", tint: "#fff7ed" },
  walkthrough_reminder: { label: "Walkthrough", icon: "list", accent: "#d97706", tint: "#fffbeb" },
};

const FALLBACK: CueMeta = { label: "Coaching", icon: "bulb", accent: "#6b7280", tint: "#f9fafb" };

export function AlertCard({ alert, compact = false }: Props) {
  const key = alert.cue_type || alert.type;
  const meta = CUE_META[key] || FALLBACK;

  return (
    <View
      className="flex-row overflow-hidden rounded-sm bg-white"
      style={{
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 3,
        elevation: 1,
      }}
    >
      <View style={{ width: 4, backgroundColor: meta.accent }} />
      <View className={`flex-1 ${compact ? "gap-1 p-3" : "gap-1.5 p-4"}`}>
        <View className="flex-row items-center gap-2">
          <View
            className="items-center justify-center rounded-full"
            style={{ width: 22, height: 22, backgroundColor: meta.tint }}
          >
            <Ionicons name={meta.icon} size={13} color={meta.accent} />
          </View>
          <Text
            className="text-[11px] font-bold uppercase tracking-wide"
            style={{ color: meta.accent }}
          >
            {meta.label}
          </Text>
        </View>
        <Text className={`font-semibold text-ink-primary ${compact ? "text-sm" : "text-[15px]"}`}>
          {alert.headline}
        </Text>
        {!compact && alert.full_text ? (
          <Text className="text-sm leading-relaxed text-ink-muted">
            {alert.full_text}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
