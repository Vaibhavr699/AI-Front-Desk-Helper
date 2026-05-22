import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

import { isApiError } from "@/src/shared/api/errors";
import { colors } from "@/src/shared/theme/tokens";

import { useUpdateRepPhone } from "../queries";

type Props = {
  phone: string | null;
};

function digitsOnly(s: string): string {
  return s.replace(/\D/g, "");
}

export function PhoneCard({ phone }: Props) {
  const [value, setValue] = useState(phone ?? "");
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const { mutateAsync, isPending } = useUpdateRepPhone();

  useEffect(() => {
    setValue(phone ?? "");
  }, [phone]);

  const trimmed = value.trim();
  const sanitized = digitsOnly(trimmed);
  const dirty = trimmed !== (phone ?? "");
  const looksValid = sanitized.length >= 10 || trimmed.length === 0;
  const canSave = dirty && looksValid && !isPending;

  async function handleSave() {
    if (!canSave) return;
    setErrorMessage(null);
    setSavedMessage(null);
    try {
      await mutateAsync(trimmed.length === 0 ? null : trimmed);
      setSavedMessage("Saved");
      setTimeout(() => setSavedMessage(null), 2000);
    } catch (err) {
      setErrorMessage(
        isApiError(err)
          ? err.message
          : "Couldn't save. Try again.",
      );
    }
  }

  return (
    <View className="gap-3 rounded-2xl border border-surface-border bg-white p-5">
      <View className="flex-row items-center gap-3">
        <View className="h-9 w-9 items-center justify-center rounded-full bg-brand-50">
          <Ionicons name="call-outline" size={18} color={colors.brand[600]} />
        </View>
        <View className="flex-1">
          <Text className="text-base font-semibold text-ink-primary">
            Your phone
          </Text>
          <Text className="text-xs text-ink-muted">
            We text briefings here when you tap "Send to my phone".
          </Text>
        </View>
      </View>

      <TextInput
        value={value}
        onChangeText={setValue}
        editable={!isPending}
        keyboardType="phone-pad"
        autoComplete="tel"
        placeholder="+1 555 123 4567"
        placeholderTextColor={colors.ink.dim}
        className="h-12 w-full rounded-xl border border-surface-border bg-surface-input px-4 text-base text-ink-primary"
      />

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
