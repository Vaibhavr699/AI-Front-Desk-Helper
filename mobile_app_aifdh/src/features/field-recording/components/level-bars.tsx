import { View } from "react-native";

const BAR_COUNT = 12;

export function LevelBars({ level }: { level: number }) {
  const active = Math.round(Math.max(0, Math.min(1, level)) * BAR_COUNT);
  return (
    <View className="h-8 flex-row items-end gap-1">
      {Array.from({ length: BAR_COUNT }).map((_, i) => {
        const on = i < active;
        const height = 8 + (i / BAR_COUNT) * 24;
        return (
          <View
            key={i}
            style={{ height }}
            className={`w-1.5 rounded-full ${on ? "bg-red-500" : "bg-red-100"}`}
          />
        );
      })}
    </View>
  );
}
