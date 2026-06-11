import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { StatePicker } from "@/src/features/in-home-session/components/state-picker";
import { isApiError } from "@/src/shared/api/errors";
import { colors } from "@/src/shared/theme/tokens";

import { useUpdateRepHomeState } from "../queries";

type Props = {
  homeState: string | null;
};

export function HomeStateCard({ homeState }: Props) {
  const [value, setValue] = useState<string | null>(homeState);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const { mutateAsync, isPending } = useUpdateRepHomeState();

  useEffect(() => {
    setValue(homeState);
  }, [homeState]);

  const dirty = value !== homeState;
  const canSave = dirty && !isPending;

  async function handleSave() {
    if (!canSave) return;
    setErrorMessage(null);
    setSavedMessage(null);
    try {
      await mutateAsync(value);
      setSavedMessage("Saved");
      setTimeout(() => setSavedMessage(null), 2000);
    } catch (err) {
      setErrorMessage(isApiError(err) ? err.message : "Couldn't save. Try again.");
    }
  }

  return (
    <View className="gap-3 rounded-sm border border-surface-border bg-white p-5">
      <View className="flex-row items-center gap-3">
        <View className="h-9 w-9 items-center justify-center rounded-full bg-brand-50">
          <Ionicons name="location-outline" size={18} color={colors.brand[600]} />
        </View>
        <View className="flex-1">
          <Text className="text-base font-semibold text-ink-primary">
            Home state
          </Text>
          <Text className="text-xs text-ink-muted">
            Pre-fills the state when you add a new customer — just verify it.
          </Text>
        </View>
      </View>

      <StatePicker value={value} onChange={setValue} title="Home state" />

      {errorMessage ? (
        <Text className="text-sm text-red-600">{errorMessage}</Text>
      ) : null}
      {savedMessage ? (
        <Text className="text-sm text-emerald-600">{savedMessage}</Text>
      ) : null}

      <Pressable
        onPress={handleSave}
        disabled={!canSave}
        className={`h-11 items-center justify-center rounded-xl bg-brand-600 active:bg-brand-700 ${canSave ? "" : "opacity-50"}`}
      >
        <Text className="text-sm font-semibold text-white">
          {isPending ? "Saving…" : "Save"}
        </Text>
      </Pressable>
    </View>
  );
}
