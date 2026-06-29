import { Text, View } from "react-native";

type Props = {
  label: string;
};

export function SkillChip({ label }: Props) {
  const pretty = label
    .split(/[_\s-]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
  return (
    <View className="rounded-full bg-surface-raised px-2.5 py-1">
      <Text className="text-[11px] font-medium text-ink-secondary">{pretty}</Text>
    </View>
  );
}
