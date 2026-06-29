import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { colors } from "@/src/shared/theme/tokens";

import { usePendingRecordings } from "../use-pending-recordings";

export function PendingUploadsBanner() {
  const { pending, syncing, retry } = usePendingRecordings();

  if (pending.length === 0) return null;

  const failed = pending.filter((p) => p.status === "failed");
  const minutes = Math.round(
    pending.reduce((sum, p) => sum + p.duration_seconds, 0) / 60,
  );
  const hasFailed = failed.length > 0 && !syncing;

  return (
    <View
      className={`gap-2 rounded-sm p-4 ${hasFailed ? "bg-amber-50" : "bg-brand-50"}`}
    >
      <View className="flex-row items-center gap-3">
        {syncing ? (
          <ActivityIndicator size="small" color={colors.brand[600]} />
        ) : (
          <Ionicons
            name={hasFailed ? "cloud-offline-outline" : "cloud-upload-outline"}
            size={18}
            color={hasFailed ? "#b45309" : colors.brand[600]}
          />
        )}
        <View className="flex-1">
          <Text
            className={`text-sm font-semibold ${hasFailed ? "text-amber-800" : "text-brand-700"}`}
          >
            {syncing
              ? "Uploading recordings…"
              : hasFailed
                ? `${failed.length} recording${failed.length === 1 ? "" : "s"} waiting to upload`
                : `${pending.length} recording${pending.length === 1 ? "" : "s"} queued`}
          </Text>
          <Text
            className={`text-xs ${hasFailed ? "text-amber-700" : "text-brand-600/70"}`}
          >
            {hasFailed
              ? "We'll keep retrying when you're back online."
              : `${minutes} min buffered · syncs automatically`}
          </Text>
        </View>
        {hasFailed && (
          <Pressable
            onPress={() => failed.forEach((f) => retry(f.id))}
            hitSlop={8}
            className="rounded-sm bg-amber-600 px-3 py-1.5 active:bg-amber-700"
          >
            <Text className="text-xs font-semibold text-white">Retry</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}
