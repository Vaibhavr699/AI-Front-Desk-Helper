import { Ionicons } from "@expo/vector-icons";
import { Pressable, Switch, Text, View } from "react-native";

import {
  setAudioTestOverride,
  useAudioOutputReady,
  useAudioTestOverride,
} from "@/src/features/in-home-session/audio/audio-route";
import { colors } from "@/src/shared/theme/tokens";

type Props = {
  preferredDevice: string | null;
  minGapSeconds: number;
  onChangeMinGap: (seconds: number) => void;
};

const MIN_GAP = 15;
const MAX_GAP = 180;
const STEP = 15;

export function AudioCard({ preferredDevice, minGapSeconds, onChangeMinGap }: Props) {
  const ready = useAudioOutputReady();
  const testOverride = useAudioTestOverride();

  const gap = Math.min(MAX_GAP, Math.max(MIN_GAP, minGapSeconds || 60));

  return (
    <View className="gap-4 rounded-sm border border-surface-border bg-white p-5">
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center gap-2">
          <Ionicons name="headset-outline" size={16} color={colors.ink.secondary} />
          <Text className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
            Audio & earbud
          </Text>
        </View>
        <View className="rounded-full bg-amber-100 px-2.5 py-1">
          <Text className="text-[10px] font-semibold text-amber-700">PRO</Text>
        </View>
      </View>

      <Text className="text-xs text-ink-muted">
        Coaching is whispered into a connected Bluetooth earbud during in-home
        sessions. When no earbud is connected, cues stay visual so the customer
        never hears them.
      </Text>

      <View className="flex-row items-center gap-3 rounded-sm bg-surface-raised p-3">
        <View className="h-9 w-9 items-center justify-center rounded-lg bg-white">
          <Ionicons
            name={ready ? "bluetooth" : "bluetooth-outline"}
            size={16}
            color={ready ? colors.brand[600] : colors.ink.muted}
          />
        </View>
        <View className="flex-1 gap-0.5">
          <Text className="text-sm font-medium text-ink-primary">
            {ready ? "Earbud ready" : "No earbud connected"}
          </Text>
          <Text className="text-xs text-ink-muted">
            {preferredDevice ?? (ready ? "Audio cues will play" : "Audio cues paused")}
          </Text>
        </View>
        <View className={`h-2.5 w-2.5 rounded-full ${ready ? "bg-emerald-500" : "bg-surface-border"}`} />
      </View>

      <View className="flex-row items-center justify-between">
        <View className="flex-1 pr-3">
          <Text className="text-sm font-medium text-ink-primary">
            Minimum gap between audio cues
          </Text>
          <Text className="text-xs text-ink-muted">
            Avoids over-coaching. Visual cues are unaffected.
          </Text>
        </View>
        <View className="flex-row items-center gap-2">
          <Pressable
            onPress={() => onChangeMinGap(Math.max(MIN_GAP, gap - STEP))}
            hitSlop={8}
            className="h-8 w-8 items-center justify-center rounded-sm bg-surface-raised active:opacity-70"
          >
            <Ionicons name="remove" size={16} color={colors.ink.secondary} />
          </Pressable>
          <Text className="w-12 text-center text-sm font-semibold tabular-nums text-ink-primary">
            {gap}s
          </Text>
          <Pressable
            onPress={() => onChangeMinGap(Math.min(MAX_GAP, gap + STEP))}
            hitSlop={8}
            className="h-8 w-8 items-center justify-center rounded-sm bg-surface-raised active:opacity-70"
          >
            <Ionicons name="add" size={16} color={colors.ink.secondary} />
          </Pressable>
        </View>
      </View>

      <View className="flex-row items-center gap-3 border-t border-surface-divider pt-3">
        <View className="flex-1 gap-0.5">
          <Text className="text-sm font-medium text-ink-primary">
            Play on this device (testing)
          </Text>
          <Text className="text-xs text-ink-muted">
            Force audio cues to play through the phone even without a paired
            earbud. For testing on a dev build.
          </Text>
        </View>
        <Switch
          value={testOverride}
          onValueChange={setAudioTestOverride}
          trackColor={{ false: "#d1d5db", true: colors.brand[500] }}
        />
      </View>
    </View>
  );
}
