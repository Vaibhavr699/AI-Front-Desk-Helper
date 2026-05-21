import { Pressable, Text, View } from "react-native";

import { DiscBadge } from "@/src/features/appointments/components/disc-badge";

import type { RoleplayScenario } from "../types";

import { DifficultyStars } from "./difficulty-stars";
import { SkillChip } from "./skill-chip";

type Props = {
  scenario: RoleplayScenario;
  onPress?: () => void;
};

export function ScenarioCard({ scenario, onPress }: Props) {
  return (
    <Pressable
      onPress={onPress}
      className="flex-1 gap-3 rounded-2xl border border-surface-border bg-white p-4 active:bg-surface-raised"
    >
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1 gap-1">
          <Text className="text-base font-semibold text-ink-primary" numberOfLines={2}>
            {scenario.title}
          </Text>
          <DifficultyStars level={scenario.difficulty} />
        </View>
        <DiscBadge primary={scenario.disc_type ?? null} />
      </View>

      {scenario.description ? (
        <Text className="text-sm leading-relaxed text-ink-secondary" numberOfLines={3}>
          {scenario.description}
        </Text>
      ) : null}

      {scenario.skills_trained.length > 0 ? (
        <View className="flex-row flex-wrap gap-1.5">
          {scenario.skills_trained.slice(0, 3).map((s) => (
            <SkillChip key={s} label={s} />
          ))}
        </View>
      ) : null}

      {scenario.is_custom ? (
        <View className="self-start rounded-full bg-brand-50 px-2.5 py-1">
          <Text className="text-[11px] font-semibold text-brand-700">
            Custom
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}
