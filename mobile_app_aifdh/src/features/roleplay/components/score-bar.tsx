import { Text, View } from "react-native";

type Props = {
  label: string;
  score: number | null;
};

const MAX = 10;

function pretty(label: string): string {
  return label
    .split(/[_\s-]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function tone(score: number): { bar: string; text: string } {
  if (score >= 8) return { bar: "bg-emerald-500", text: "text-emerald-700" };
  if (score >= 6) return { bar: "bg-brand-500", text: "text-brand-700" };
  if (score >= 4) return { bar: "bg-amber-500", text: "text-amber-700" };
  return { bar: "bg-red-500", text: "text-red-700" };
}

export function ScoreBar({ label, score }: Props) {
  const value = score ?? 0;
  const t = tone(value);
  const percent = Math.max(2, Math.min(100, (value / MAX) * 100));

  return (
    <View className="gap-2">
      <View className="flex-row items-baseline justify-between">
        <Text className="text-sm font-medium text-ink-primary">
          {pretty(label)}
        </Text>
        <Text className={`text-sm font-bold ${t.text}`}>
          {score != null ? score.toFixed(1) : "—"}
        </Text>
      </View>
      <View className="h-2 w-full overflow-hidden rounded-full bg-surface-raised">
        <View className={`h-full ${t.bar}`} style={{ width: `${percent}%` }} />
      </View>
    </View>
  );
}
