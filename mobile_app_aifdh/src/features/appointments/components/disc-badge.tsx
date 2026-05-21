import { Text, View } from "react-native";

type Props = {
  primary: string | null;
  confidence?: number | null;
  size?: "sm" | "md";
};

const palette: Record<string, { bg: string; text: string }> = {
  D: { bg: "bg-red-100", text: "text-red-700" },
  I: { bg: "bg-amber-100", text: "text-amber-700" },
  S: { bg: "bg-emerald-100", text: "text-emerald-700" },
  C: { bg: "bg-brand-100", text: "text-brand-700" },
};

export function DiscBadge({ primary, confidence, size = "sm" }: Props) {
  if (!primary || primary === "unknown") return null;
  const key = primary.charAt(0).toUpperCase();
  const swatch = palette[key];
  if (!swatch) return null;
  const dim = size === "md" ? "h-8 w-8 text-base" : "h-6 w-6 text-xs";
  return (
    <View className="flex-row items-center gap-1.5">
      <View
        className={`${dim} items-center justify-center rounded-full ${swatch.bg}`}
      >
        <Text className={`font-bold ${swatch.text}`}>{key}</Text>
      </View>
      {confidence != null ? (
        <Text className="text-xs text-ink-muted">
          {Math.round(confidence * 100)}%
        </Text>
      ) : null}
    </View>
  );
}
