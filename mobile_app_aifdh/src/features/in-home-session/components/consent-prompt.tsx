import { Ionicons } from "@expo/vector-icons";
import { Pressable, Text, View } from "react-native";

import { colors } from "@/src/shared/theme/tokens";

import { isTwoPartyConsentState } from "../consent-states";

type Props = {
  stateCode: string | null;
  customerName?: string | null;
  acknowledged: boolean;
  onAcknowledge: () => void;
  consentScript: string;
};

export function ConsentPrompt({
  stateCode,
  acknowledged,
  onAcknowledge,
  consentScript,
}: Props) {
  const twoParty = isTwoPartyConsentState(stateCode);

  if (!stateCode) {
    return (
      <View className="rounded-sm border border-dashed border-surface-border bg-white p-4">
        <Text className="text-sm text-ink-muted">
          Choose your visit state above to see the consent requirement.
        </Text>
      </View>
    );
  }

  if (!twoParty) {
    return (
      <View className="gap-2 rounded-sm border border-emerald-200 bg-emerald-50 p-4">
        <View className="flex-row items-center gap-2">
          <Ionicons name="shield-checkmark" size={18} color="#059669" />
          <Text className="text-sm font-semibold text-emerald-700">
            One-party consent state
          </Text>
        </View>
        <Text className="text-sm leading-relaxed text-emerald-800">
          {stateCode} permits silent recording. No verbal disclosure required —
          you're clear to begin.
        </Text>
      </View>
    );
  }

  return (
    <View className="gap-4 rounded-sm border border-amber-200 bg-amber-50 p-4">
      <View className="flex-row items-center gap-2">
        <Ionicons name="megaphone" size={18} color="#d97706" />
        <Text className="text-sm font-semibold text-amber-800">
          Two-party consent state · {stateCode}
        </Text>
      </View>
      <Text className="text-sm leading-relaxed text-amber-900">
        {stateCode} requires the customer to verbally agree before recording.
        Read this aloud and confirm they said yes:
      </Text>
      <View className="rounded-xl border border-amber-300 bg-white p-3">
        <Text className="text-base leading-relaxed text-ink-primary">
          "{consentScript}"
        </Text>
      </View>
      <Pressable
        onPress={onAcknowledge}
        className="flex-row items-center gap-3"
      >
        <View
          className={`h-6 w-6 items-center justify-center rounded-md border ${
            acknowledged
              ? "border-amber-700 bg-amber-700"
              : "border-amber-400 bg-white"
          }`}
        >
          {acknowledged ? (
            <Ionicons name="checkmark" size={16} color="#ffffff" />
          ) : null}
        </View>
        <Text className="flex-1 text-sm font-medium text-amber-900">
          Customer verbally agreed to recording
        </Text>
      </Pressable>
    </View>
  );
}
