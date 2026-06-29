import { Ionicons } from "@expo/vector-icons";
import { View } from "react-native";

import { colors } from "@/src/shared/theme/tokens";

type Props = {
  level: number | null;
  size?: number;
};

export function DifficultyStars({ level, size = 12 }: Props) {
  const filled = Math.max(0, Math.min(5, Math.round(level ?? 0)));
  return (
    <View className="flex-row items-center gap-0.5">
      {Array.from({ length: 5 }).map((_, i) => (
        <Ionicons
          key={i}
          name={i < filled ? "star" : "star-outline"}
          size={size}
          color={i < filled ? colors.brand[600] : colors.ink.dim}
        />
      ))}
    </View>
  );
}
