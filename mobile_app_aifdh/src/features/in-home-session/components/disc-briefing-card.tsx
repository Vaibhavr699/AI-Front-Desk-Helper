import { Ionicons } from "@expo/vector-icons";
import { Text, View } from "react-native";

import { DiscBadge } from "@/src/features/appointments/components/disc-badge";
import type { DiscLetter } from "@/src/features/appointments/types";

import { discBriefingFor } from "../disc-briefing";

type Props = {
  primary: DiscLetter | "unknown" | null | undefined;
  confidence?: number | null;
};

export function DiscBriefingCard({ primary, confidence }: Props) {
  const briefing = discBriefingFor(primary);
  if (!briefing) return null;

  return (
    <View className="gap-4 rounded-sm border border-surface-border bg-white p-4">
      <View className="flex-row items-center gap-3">
        <DiscBadge primary={primary ?? null} confidence={confidence} size="md" />
        <View className="flex-1">
          <Text className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
            Know this customer before you knock
          </Text>
          <Text className="text-sm font-semibold text-ink-primary">
            {briefing.label}
          </Text>
        </View>
      </View>

      <View className="flex-row items-start gap-2 rounded-sm bg-brand-50 p-3">
        <Ionicons name="speedometer-outline" size={16} color="#2563eb" />
        <Text className="flex-1 text-xs leading-relaxed text-brand-700">
          {briefing.pace}
        </Text>
      </View>

      <View className="flex-row gap-3">
        <View className="flex-1 gap-2">
          <Text className="text-xs font-semibold uppercase tracking-wider text-emerald-700">
            Do
          </Text>
          {briefing.dos.map((d, i) => (
            <View key={i} className="flex-row gap-1.5">
              <Ionicons name="checkmark-circle" size={14} color="#059669" />
              <Text className="flex-1 text-xs leading-relaxed text-ink-secondary">
                {d}
              </Text>
            </View>
          ))}
        </View>
        <View className="flex-1 gap-2">
          <Text className="text-xs font-semibold uppercase tracking-wider text-red-700">
            Don't
          </Text>
          {briefing.donts.map((d, i) => (
            <View key={i} className="flex-row gap-1.5">
              <Ionicons name="close-circle" size={14} color="#dc2626" />
              <Text className="flex-1 text-xs leading-relaxed text-ink-secondary">
                {d}
              </Text>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}
