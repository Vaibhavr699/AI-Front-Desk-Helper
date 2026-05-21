import { Ionicons } from "@expo/vector-icons";
import { Text, View } from "react-native";

import { DiscBadge } from "@/src/features/appointments/components/disc-badge";
import { colors } from "@/src/shared/theme/tokens";

import type { CustomerIntelligence } from "../types";

type Props = {
  intelligence: CustomerIntelligence | null;
};

const DISC_DESCRIPTIONS: Record<string, string> = {
  D: "Direct, decisive, results-focused. Speak fast, lead with bottom line, respect their time.",
  I: "Outgoing, optimistic, story-driven. Build rapport, paint a vivid picture, share testimonials.",
  S: "Steady, patient, relationship-focused. Slow down, listen, address concerns about disruption.",
  C: "Cautious, detail-oriented, accuracy-focused. Bring data, expect questions, never improvise.",
};

export function IntelligenceCard({ intelligence }: Props) {
  if (!intelligence) {
    return (
      <View className="gap-2 rounded-2xl border border-dashed border-surface-border bg-white p-4">
        <Text className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
          Customer intelligence
        </Text>
        <View className="flex-row items-center gap-2">
          <Ionicons name="hourglass-outline" size={16} color={colors.ink.muted} />
          <Text className="text-sm text-ink-muted">
            No intelligence available yet
          </Text>
        </View>
      </View>
    );
  }

  const disc = intelligence.disc_primary;
  const description =
    disc && disc !== "unknown" ? DISC_DESCRIPTIONS[disc] : null;

  return (
    <View className="gap-4 rounded-2xl border border-surface-border bg-white p-4">
      <View className="flex-row items-center justify-between">
        <Text className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
          Customer intelligence
        </Text>
        <DiscBadge
          primary={disc ?? null}
          confidence={intelligence.disc_confidence}
          size="md"
        />
      </View>

      {description ? (
        <View className="gap-1">
          <Text className="text-base font-semibold text-ink-primary">
            {disc}-type buyer
          </Text>
          <Text className="text-sm leading-relaxed text-ink-secondary">
            {description}
          </Text>
        </View>
      ) : null}

      {intelligence.persona ? (
        <View className="gap-1 border-t border-surface-divider pt-3">
          <Text className="text-xs font-medium text-ink-muted">
            Buyer persona
          </Text>
          <Text className="text-sm capitalize text-ink-primary">
            {intelligence.persona.replace(/_/g, " ")}
            {intelligence.confidence != null
              ? ` · ${Math.round(intelligence.confidence * 100)}%`
              : ""}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
