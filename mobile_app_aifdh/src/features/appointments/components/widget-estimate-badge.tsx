import { Ionicons } from "@expo/vector-icons";
import { Text, View } from "react-native";

import { formatCurrencyRange } from "@/src/shared/lib/format";
import { colors } from "@/src/shared/theme/tokens";

type Props = {
  lowCents: number | null;
  highCents: number | null;
};

export function WidgetEstimateBadge({ lowCents, highCents }: Props) {
  const range = formatCurrencyRange(lowCents, highCents);
  if (!range) return null;
  return (
    <View className="flex-row items-center gap-1 self-start rounded-full bg-brand-50 px-2.5 py-1">
      <Ionicons name="globe-outline" size={12} color={colors.brand[700]} />
      <Text className="text-xs font-semibold text-brand-700">{range}</Text>
    </View>
  );
}
