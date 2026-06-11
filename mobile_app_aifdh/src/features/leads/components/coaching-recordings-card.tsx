import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Pressable, Text, View } from "react-native";

import { scoreToColor } from "@/src/features/coaching/lib/format";
import { colors } from "@/src/shared/theme/tokens";

import type { CoachingConversationSummary } from "../types";

type Props = {
  conversations: CoachingConversationSummary[];
};

function formatWhen(iso: string | null): string {
  if (!iso) return "Not scored yet";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function formatPersona(raw: string | null): string | null {
  if (!raw) return null;
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function formatOutcome(raw: string | null): string | null {
  if (!raw) return null;
  return raw.replace(/_/g, " ").replace(/^\w/, (m) => m.toUpperCase());
}

export function CoachingRecordingsCard({ conversations }: Props) {
  const router = useRouter();
  const scored = conversations.filter((c) => c.scored_at != null);

  if (scored.length === 0) return null;

  return (
    <View className="gap-3 rounded-sm border border-surface-border bg-white p-4">
      <View className="flex-row items-center gap-2">
        <Ionicons name="mic-outline" size={16} color={colors.brand[600]} />
        <Text className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
          Call recordings
        </Text>
      </View>

      <View className="gap-2">
        {scored.map((c) => {
          const swatch =
            c.overall_score != null ? scoreToColor(c.overall_score) : null;
          const meta = [formatPersona(c.buyer_persona), formatOutcome(c.outcome)]
            .filter(Boolean)
            .join(" · ");
          return (
            <Pressable
              key={c.id}
              onPress={() =>
                router.navigate(`/(tabs)/coaching/conversation/${c.id}` as never)
              }
              accessibilityRole="button"
              accessibilityLabel="Open call recording review"
              className="flex-row items-center gap-3 rounded-sm p-2.5 active:bg-surface-raised"
            >
              <View
                className={`h-11 w-11 items-center justify-center rounded-sm ${swatch?.bg ?? "bg-surface-raised"}`}
              >
                <Text
                  className={`text-base font-bold ${swatch?.text ?? "text-ink-dim"}`}
                >
                  {c.overall_score != null ? c.overall_score.toFixed(1) : "—"}
                </Text>
              </View>
              <View className="flex-1 gap-0.5">
                <Text className="text-sm font-medium text-ink-primary">
                  Coaching review
                </Text>
                <Text className="text-xs text-ink-muted">
                  {formatWhen(c.scored_at)}
                  {meta ? ` · ${meta}` : ""}
                </Text>
              </View>
              <Ionicons
                name="chevron-forward"
                size={16}
                color={colors.ink.dim}
              />
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
