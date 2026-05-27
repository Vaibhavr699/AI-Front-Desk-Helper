import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Pressable, Text, View } from "react-native";

import { colors } from "@/src/shared/theme/tokens";

import { scoreToColor } from "../lib/format";
import type { CoachingRecentConversation } from "../types";

type Props = {
  conversations: CoachingRecentConversation[];
};

function formatWhen(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export function RecentConversationsCard({ conversations }: Props) {
  const router = useRouter();

  return (
    <View className="gap-4 rounded-sm bg-white p-6">
      <View className="flex-row items-center gap-2">
        <Ionicons name="time-outline" size={16} color={colors.ink.secondary} />
        <Text className="text-sm font-semibold text-ink-secondary">
          Recent conversations
        </Text>
      </View>
      {conversations.length === 0 ? (
        <View className="items-center gap-3 py-8">
          <View className="h-12 w-12 items-center justify-center rounded-full bg-surface-raised">
            <Ionicons name="chatbubbles-outline" size={22} color={colors.ink.dim} />
          </View>
          <Text className="text-sm text-ink-muted">
            Scored calls will show up here
          </Text>
        </View>
      ) : (
        <View className="gap-1">
          {conversations.slice(0, 10).map((c) => {
            const score = c.overall_score;
            const swatch = score != null ? scoreToColor(score) : null;
            return (
              <Pressable
                key={c.id}
                onPress={() => {
                  if (c.lead_id) router.push(`/(tabs)/leads/${c.lead_id}`);
                }}
                className="flex-row items-center gap-3 rounded-xl p-2.5 active:bg-surface-raised"
              >
                <View
                  className={`h-10 w-10 items-center justify-center rounded-xl ${swatch?.bg ?? "bg-surface-raised"}`}
                >
                  <Text className={`text-sm font-bold ${swatch?.text ?? "text-ink-dim"}`}>
                    {score != null ? score.toFixed(1) : "—"}
                  </Text>
                </View>
                <View className="flex-1 gap-0.5">
                  <Text className="text-sm font-medium text-ink-primary">
                    {c.outcome ? c.outcome.replace(/_/g, " ").replace(/^\w/, (m) => m.toUpperCase()) : "Conversation"}
                  </Text>
                  <Text className="text-xs text-ink-muted">
                    {formatWhen(c.scored_at)}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={14} color={colors.ink.dim} />
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}
