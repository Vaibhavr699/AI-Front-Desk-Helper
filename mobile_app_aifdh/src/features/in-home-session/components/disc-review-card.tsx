import { Ionicons } from "@expo/vector-icons";
import { Text, View } from "react-native";

import { DiscBadge } from "@/src/features/appointments/components/disc-badge";

import { discBriefingFor } from "../disc-briefing";
import type { DiscProgression } from "../types";

const TYPE_NAME: Record<string, string> = {
  D: "Dominant",
  I: "Influential",
  S: "Steady",
  C: "Conscientious",
};

type Props = {
  progression: DiscProgression | null | undefined;
};

export function DiscReviewCard({ progression }: Props) {
  if (!progression?.final || progression.final.primary === "unknown") return null;

  const primary = progression.final.primary;
  const briefing = discBriefingFor(primary);
  const shifts = progression.shifts ?? [];

  const distinctPath = shifts
    .map((s) => s.primary)
    .filter((p, i, arr) => i === 0 || arr[i - 1] !== p);
  const shifted = distinctPath.length > 1;

  return (
    <View className="gap-4 rounded-sm border border-brand-100 bg-white p-4">
      <View className="flex-row items-center gap-1.5">
        <Ionicons name="sparkles" size={13} color="#7c3aed" />
        <Text className="text-[10px] font-semibold uppercase tracking-wider text-violet-700">
          Customer read
        </Text>
      </View>

      <View className="flex-row items-center gap-3">
        <DiscBadge
          primary={primary}
          confidence={progression.final.confidence}
          size="md"
        />
        <View className="flex-1">
          <Text className="text-xl font-bold text-ink-primary">
            {TYPE_NAME[primary] ?? primary}
          </Text>
          {briefing ? (
            <Text className="text-xs text-ink-muted">{briefing.label}</Text>
          ) : null}
        </View>
      </View>

      {shifted ? (
        <View className="flex-row items-center gap-2 rounded-sm bg-violet-50 px-3 py-2">
          <Ionicons name="git-compare-outline" size={15} color="#7c3aed" />
          <Text className="flex-1 text-xs leading-relaxed text-violet-700">
            Their style shifted during the visit: {distinctPath.join(" → ")}.
            Read the room — they don&apos;t stay in one mode.
          </Text>
        </View>
      ) : null}

      {briefing ? (
        <View className="gap-1.5 rounded-sm bg-surface-raised p-3">
          <Text className="text-[10px] font-semibold uppercase tracking-wider text-ink-muted">
            Next time with this customer
          </Text>
          <Text className="text-sm leading-relaxed text-ink-secondary">
            {briefing.pace}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
