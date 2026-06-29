import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { isApiError } from "@/src/shared/api/errors";
import { DiscBadge } from "@/src/features/appointments/components/disc-badge";
import { colors } from "@/src/shared/theme/tokens";

import { useSendBriefing } from "../queries";
import type { CustomerIntelligence } from "../types";

type Props = {
  intelligence: CustomerIntelligence | null;
  leadId: string;
};

const DISC_DESCRIPTIONS: Record<string, string> = {
  D: "Direct, decisive, results-focused. Speak fast, lead with bottom line, respect their time.",
  I: "Outgoing, optimistic, story-driven. Build rapport, paint a vivid picture, share testimonials.",
  S: "Steady, patient, relationship-focused. Slow down, listen, address concerns about disruption.",
  C: "Cautious, detail-oriented, accuracy-focused. Bring data, expect questions, never improvise.",
};

export function IntelligenceCard({ intelligence, leadId }: Props) {
  const sendBriefing = useSendBriefing(leadId);
  const [feedback, setFeedback] = useState<{ kind: "ok" | "error"; message: string } | null>(null);

  async function handleSendBriefing() {
    if (sendBriefing.isPending) return;
    setFeedback(null);
    try {
      await sendBriefing.mutateAsync();
      setFeedback({ kind: "ok", message: "Briefing sent to your phone." });
      setTimeout(() => setFeedback(null), 3000);
    } catch (err) {
      const msg = isApiError(err)
        ? err.code === "REP_PHONE_MISSING"
          ? "Add your phone in Settings first."
          : err.message
        : "Couldn't send. Try again.";
      setFeedback({ kind: "error", message: msg });
    }
  }

  if (!intelligence) {
    return (
      <View className="gap-2 rounded-sm border border-dashed border-surface-border bg-white p-4">
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
    <View className="gap-4 rounded-sm border border-surface-border bg-white p-4">
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

      <View className="gap-2 border-t border-surface-divider pt-3">
        <Pressable
          onPress={handleSendBriefing}
          disabled={sendBriefing.isPending}
          className={`h-11 flex-row items-center justify-center gap-2 rounded-xl border border-brand-200 bg-brand-50 active:bg-brand-100 ${sendBriefing.isPending ? "opacity-60" : ""}`}
        >
          <Ionicons name="paper-plane-outline" size={16} color={colors.brand[700]} />
          <Text className="text-sm font-semibold text-brand-700">
            {sendBriefing.isPending ? "Sending…" : "Send briefing to my phone"}
          </Text>
        </Pressable>
        {feedback ? (
          <Text
            className={`text-xs ${feedback.kind === "ok" ? "text-emerald-600" : "text-red-600"}`}
          >
            {feedback.message}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
