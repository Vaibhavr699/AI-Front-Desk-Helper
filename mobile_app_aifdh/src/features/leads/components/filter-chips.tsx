import { Pressable, ScrollView, Text } from "react-native";

import type { LeadFilter } from "../types";

const OPTIONS: { value: LeadFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "today", label: "Today" },
  { value: "week", label: "This Week" },
  { value: "needs_followup", label: "Needs Follow-up" },
  { value: "booked", label: "Booked" },
  { value: "lost", label: "Lost" },
];

type Props = {
  value: LeadFilter;
  onChange: (next: LeadFilter) => void;
};

export function FilterChips({ value, onChange }: Props) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{ flexGrow: 0 }}
      contentContainerClassName="gap-2 px-4 pb-3"
    >
      {OPTIONS.map((opt) => {
        const active = value === opt.value;
        return (
          <Pressable
            key={opt.value}
            onPress={() => onChange(opt.value)}
            hitSlop={6}
            className={`h-9 items-center justify-center rounded-full border px-4 ${
              active
                ? "border-brand-600 bg-brand-600"
                : "border-surface-border bg-white active:bg-surface-raised"
            }`}
          >
            <Text
              className={`text-sm font-medium ${active ? "text-white" : "text-ink-secondary"}`}
            >
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
