import { Ionicons } from "@expo/vector-icons";
import { Text, View } from "react-native";

import { colors } from "@/src/shared/theme/tokens";

export type CheckStatus = "pending" | "checking" | "ok" | "warn" | "fail";

type Props = {
  status: CheckStatus;
  title: string;
  detail?: string | null;
};

const STATUS_META: Record<
  CheckStatus,
  {
    icon: keyof typeof Ionicons.glyphMap;
    iconColor: string;
    bg: string;
    border: string;
  }
> = {
  pending: {
    icon: "ellipse-outline",
    iconColor: colors.ink.muted,
    bg: "bg-white",
    border: "border-surface-border",
  },
  checking: {
    icon: "sync-outline",
    iconColor: colors.brand[600],
    bg: "bg-white",
    border: "border-surface-border",
  },
  ok: {
    icon: "checkmark-circle",
    iconColor: "#059669",
    bg: "bg-emerald-50",
    border: "border-emerald-200",
  },
  warn: {
    icon: "warning-outline",
    iconColor: "#d97706",
    bg: "bg-amber-50",
    border: "border-amber-200",
  },
  fail: {
    icon: "close-circle",
    iconColor: "#dc2626",
    bg: "bg-red-50",
    border: "border-red-200",
  },
};

export function ChecklistItem({ status, title, detail }: Props) {
  const meta = STATUS_META[status];
  return (
    <View
      className={`flex-row items-start gap-3 rounded-2xl border p-4 ${meta.bg} ${meta.border}`}
    >
      <View className="pt-0.5">
        <Ionicons name={meta.icon} size={22} color={meta.iconColor} />
      </View>
      <View className="flex-1 gap-1">
        <Text className="text-base font-semibold text-ink-primary">{title}</Text>
        {detail ? (
          <Text className="text-sm leading-snug text-ink-secondary">{detail}</Text>
        ) : null}
      </View>
    </View>
  );
}
