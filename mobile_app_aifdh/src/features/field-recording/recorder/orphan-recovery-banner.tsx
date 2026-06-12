import { Ionicons } from "@expo/vector-icons";
import * as FileSystem from "expo-file-system/legacy";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { enqueueRecording } from "../offline/recording-queue";
import { triggerSync } from "../offline/sync-manager";
import {
  discardOrphanMarker,
  readOrphanMarker,
  type OrphanMarker,
} from "./field-recorder-store";

const MIN_RECOVERABLE_BYTES = 2000;

export function OrphanRecoveryBanner() {
  const [marker, setMarker] = useState<OrphanMarker | null>(null);
  const [fileBytes, setFileBytes] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      const found = await readOrphanMarker();
      if (!found || !active) return;
      let bytes = 0;
      if (found.uri) {
        try {
          const info = await FileSystem.getInfoAsync(found.uri);
          if (info.exists && typeof info.size === "number") bytes = info.size;
        } catch {}
      }
      if (active) {
        setMarker(found);
        setFileBytes(bytes);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  if (!marker) return null;

  const recoverable = !!marker.uri && fileBytes >= MIN_RECOVERABLE_BYTES;

  async function recover() {
    if (!marker?.uri || !marker.leadId) {
      await dismiss();
      return;
    }
    setBusy(true);
    try {
      const result = await enqueueRecording({
        leadId: marker.leadId,
        leadName: null,
        fileUri: marker.uri,
        consentStatus: "not_required",
        consentMethod: "one_party_state",
        consentState: null,
        durationSeconds: 0,
      });
      if (result.ok) triggerSync();
    } catch {}
    await discardOrphanMarker();
    setMarker(null);
    setBusy(false);
  }

  async function dismiss() {
    setBusy(true);
    await discardOrphanMarker();
    setMarker(null);
    setBusy(false);
  }

  return (
    <View className="gap-3 rounded-sm border border-amber-200 bg-amber-50 p-4">
      <View className="flex-row items-center gap-2">
        <Ionicons name="alert-circle" size={18} color="#b45309" />
        <Text className="flex-1 text-sm font-semibold text-amber-800">
          A recording was interrupted
        </Text>
      </View>
      <Text className="text-xs leading-relaxed text-amber-700">
        {recoverable
          ? "We found a partial recording from a session that didn't end cleanly. You can recover it for upload, or discard it."
          : "A previous recording didn't end cleanly and couldn't be recovered. You can clear this notice."}
      </Text>
      <View className="flex-row gap-2">
        {recoverable ? (
          <Pressable
            onPress={recover}
            disabled={busy}
            className="flex-1 items-center rounded-sm bg-amber-600 py-2.5 active:bg-amber-700"
          >
            <Text className="text-sm font-semibold text-white">
              Recover & upload
            </Text>
          </Pressable>
        ) : null}
        <Pressable
          onPress={dismiss}
          disabled={busy}
          className="flex-1 items-center rounded-sm border border-amber-300 py-2.5 active:bg-amber-100"
        >
          <Text className="text-sm font-semibold text-amber-800">Discard</Text>
        </Pressable>
      </View>
    </View>
  );
}
