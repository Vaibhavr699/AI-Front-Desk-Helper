import { Text, View } from "react-native";

type Props = {
  avgScore: number | null;
  conversations: number;
  windowDays: number;
};

export function OverallCard({ avgScore, conversations, windowDays }: Props) {
  const display = avgScore != null ? avgScore.toFixed(1) : "—";
  return (
    <View className="gap-3 rounded-2xl border border-surface-border bg-white p-5">
      <Text className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
        Last {windowDays} days
      </Text>
      <View className="flex-row items-baseline gap-2">
        <Text className="text-5xl font-bold text-ink-primary">{display}</Text>
        <Text className="text-base text-ink-muted">/ 10</Text>
      </View>
      <Text className="text-sm text-ink-muted">
        {conversations} scored conversation
        {conversations === 1 ? "" : "s"}
      </Text>
    </View>
  );
}
