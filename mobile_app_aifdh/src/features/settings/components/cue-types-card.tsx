import { Ionicons } from "@expo/vector-icons";
import { Switch, Text, View } from "react-native";

import { colors } from "@/src/shared/theme/tokens";

import {
  useCuePreferences,
  useUpdateCuePreferences,
} from "@/src/features/in-home-session/queries";
import type { CoachingCueType } from "@/src/features/in-home-session/types";

type CueMeta = {
  key: CoachingCueType;
  label: string;
  subtitle: string;
};

const CUE_LIST: CueMeta[] = [
  { key: "ask_discovery", label: "Ask discovery", subtitle: "When you're presenting before understanding their needs" },
  { key: "listen", label: "Listen", subtitle: "When the customer is trying to speak" },
  { key: "disc_reframe", label: "DISC reframe", subtitle: "When your style mismatches the customer's personality" },
  { key: "missing_close", label: "Missing close", subtitle: "When the conversation runs long without a close attempt" },
  { key: "address_objection", label: "Address objection", subtitle: "When an objection is ignored or deflected" },
  { key: "slow_down", label: "Slow down", subtitle: "When your speaking pace is too fast" },
  { key: "build_rapport", label: "Build rapport", subtitle: "When the customer's tone shifts guarded or cold" },
  { key: "confirm_next_step", label: "Confirm next step", subtitle: "When the call is ending without a commitment" },
];

export function CueTypesCard() {
  const { data, isLoading } = useCuePreferences();
  const update = useUpdateCuePreferences();

  const prefs = data?.cue_preferences;

  function toggle(key: CoachingCueType) {
    if (!prefs) return;
    update.mutate({ [key]: !prefs[key] });
  }

  if (isLoading || !prefs) return null;

  return (
    <View className="gap-4 rounded-sm border border-surface-border bg-white p-5">
      <View className="flex-row items-center gap-2">
        <Ionicons name="bulb-outline" size={16} color={colors.ink.secondary} />
        <Text className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
          Coaching cue types
        </Text>
      </View>

      <Text className="text-xs text-ink-muted">
        Choose which coaching cues appear during in-home sessions. Disabled cues
        won't fire even when detected.
      </Text>

      <View className="gap-1">
        {CUE_LIST.map((c, i) => (
          <View
            key={c.key}
            className={`flex-row items-center gap-3 py-3 ${i < CUE_LIST.length - 1 ? "border-b border-surface-divider" : ""}`}
          >
            <View className="flex-1 gap-0.5">
              <Text className="text-sm font-medium text-ink-primary">
                {c.label}
              </Text>
              <Text className="text-xs text-ink-muted">{c.subtitle}</Text>
            </View>
            <Switch
              value={prefs[c.key] !== false}
              onValueChange={() => toggle(c.key)}
              trackColor={{ false: "#cbd5e1", true: colors.brand[500] }}
              thumbColor="#ffffff"
            />
          </View>
        ))}
      </View>
    </View>
  );
}
