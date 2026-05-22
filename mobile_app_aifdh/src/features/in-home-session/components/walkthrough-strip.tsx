import { Ionicons } from "@expo/vector-icons";
import { ScrollView, Text, View } from "react-native";

import { colors } from "@/src/shared/theme/tokens";

import type { WalkthroughItem } from "../types";

type Props = {
  items: WalkthroughItem[];
};

export function WalkthroughStrip({ items }: Props) {
  const completed = items.filter((i) => i.completed).length;
  return (
    <View className="border-t border-surface-divider bg-white">
      <View className="flex-row items-center justify-between px-4 py-2">
        <Text className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
          Walkthrough
        </Text>
        <Text className="text-xs font-semibold text-ink-secondary">
          {completed} / {items.length}
        </Text>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerClassName="gap-2 px-4 pb-3"
      >
        {items.map((item) => (
          <View
            key={item.key}
            className={`flex-row items-center gap-1.5 rounded-full px-3 py-1.5 ${
              item.completed
                ? "bg-emerald-100"
                : "border border-surface-border bg-surface-raised"
            }`}
          >
            <Ionicons
              name={item.completed ? "checkmark-circle" : "ellipse-outline"}
              size={14}
              color={item.completed ? "#059669" : colors.ink.muted}
            />
            <Text
              className={`text-xs font-medium ${
                item.completed ? "text-emerald-800" : "text-ink-secondary"
              }`}
            >
              {item.label}
            </Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}
