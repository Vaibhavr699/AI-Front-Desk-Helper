import { Text, View } from "react-native";

import type { LeadStatus } from "../types";

type Props = {
  status: LeadStatus | null;
};

const palette: Record<string, { bg: string; text: string; label: string }> = {
  "New Lead": { bg: "bg-brand-50", text: "text-brand-700", label: "New" },
  contacted: { bg: "bg-amber-50", text: "text-amber-700", label: "Contacted" },
  quoted: { bg: "bg-amber-50", text: "text-amber-700", label: "Quoted" },
  no_answer: { bg: "bg-slate-100", text: "text-slate-700", label: "No answer" },
  booked: { bg: "bg-emerald-50", text: "text-emerald-700", label: "Booked" },
  lost: { bg: "bg-red-50", text: "text-red-700", label: "Lost" },
  dead: { bg: "bg-slate-100", text: "text-slate-600", label: "Dead" },
  dnc: { bg: "bg-red-50", text: "text-red-700", label: "Do not contact" },
};

export function StatusBadge({ status }: Props) {
  const key = status ?? "";
  const swatch =
    palette[key] ?? { bg: "bg-slate-100", text: "text-slate-700", label: key || "—" };
  return (
    <View className={`self-start rounded-full px-2.5 py-1 ${swatch.bg}`}>
      <Text className={`text-xs font-semibold ${swatch.text}`}>
        {swatch.label}
      </Text>
    </View>
  );
}
