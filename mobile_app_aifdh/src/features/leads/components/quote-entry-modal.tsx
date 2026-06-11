import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { colors } from "@/src/shared/theme/tokens";

import { useEnterQuote } from "../queries";

type Props = {
  leadId: string;
  visible: boolean;
  onClose: () => void;
};

export function QuoteEntryModal({ leadId, visible, onClose }: Props) {
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { mutateAsync, isPending } = useEnterQuote(leadId);

  const cents = Math.round(Number(amount.replace(/[^0-9.]/g, "")) * 100);
  const valid = Number.isFinite(cents) && cents > 0;

  async function submit() {
    if (!valid || isPending) return;
    setError(null);
    try {
      await mutateAsync(cents);
      setAmount("");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save your quote.");
    }
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView className="flex-1 bg-surface-base">
        <View className="flex-row items-center justify-between border-b border-surface-divider px-4 py-3">
          <Text className="text-lg font-semibold text-ink-primary">
            Enter your quote
          </Text>
          <Pressable
            onPress={onClose}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Close"
            className="h-9 w-9 items-center justify-center rounded-full active:bg-surface-raised"
          >
            <Ionicons name="close" size={22} color={colors.ink.secondary} />
          </Pressable>
        </View>
        <KeyboardAvoidingView
          className="flex-1"
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View className="mx-auto w-full max-w-xl gap-4 p-5">
            <Text className="text-sm text-ink-muted">
              Enter the total you quoted the customer. We compare it to the
              website estimate and coach the difference.
            </Text>
            <View className="flex-row items-center gap-2 rounded-sm border border-surface-border bg-white px-4">
              <Text className="text-2xl font-semibold text-ink-muted">$</Text>
              <TextInput
                value={amount}
                onChangeText={setAmount}
                keyboardType="decimal-pad"
                placeholder="2500"
                placeholderTextColor={colors.ink.dim}
                autoFocus
                className="h-16 flex-1 text-2xl font-semibold text-ink-primary"
              />
            </View>
            {error ? <Text className="text-sm text-red-600">{error}</Text> : null}
            <Pressable
              onPress={submit}
              disabled={!valid || isPending}
              accessibilityRole="button"
              accessibilityLabel="Save quote"
              className={`h-12 items-center justify-center rounded-sm bg-brand-600 active:bg-brand-700 ${valid && !isPending ? "" : "opacity-50"}`}
            >
              <Text className="text-sm font-semibold text-white">
                {isPending ? "Saving…" : "Save quote"}
              </Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}
