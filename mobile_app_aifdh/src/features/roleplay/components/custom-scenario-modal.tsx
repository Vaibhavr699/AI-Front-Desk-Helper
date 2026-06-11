import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
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

import { useStartSession } from "../queries";

type Props = {
  visible: boolean;
  onClose: () => void;
};

export function CustomScenarioModal({ visible, onClose }: Props) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { mutateAsync, isPending } = useStartSession();

  const valid = text.trim().length >= 8;

  async function start() {
    if (!valid || isPending) return;
    setError(null);
    try {
      const { session } = await mutateAsync({ custom_text: text.trim() });
      setText("");
      onClose();
      router.push(
        `/(tabs)/coaching/roleplay/session/${session.id}` as never,
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Couldn't build that scenario. Try a different description.",
      );
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
            Custom scenario
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
          <View className="mx-auto w-full max-w-xl flex-1 gap-4 p-5">
            <Text className="text-sm text-ink-muted">
              Describe the customer and situation you want to practice. The AI
              plays that customer.
            </Text>
            <TextInput
              value={text}
              onChangeText={setText}
              multiline
              autoFocus
              placeholder="e.g. A skeptical homeowner who got three cheaper roofing quotes and thinks all contractors are the same."
              placeholderTextColor={colors.ink.dim}
              textAlignVertical="top"
              className="min-h-[140px] rounded-sm border border-surface-border bg-white px-4 py-3 text-base text-ink-primary"
            />
            {error ? <Text className="text-sm text-red-600">{error}</Text> : null}
            <Pressable
              onPress={start}
              disabled={!valid || isPending}
              accessibilityRole="button"
              accessibilityLabel="Start roleplay"
              className={`h-12 items-center justify-center rounded-sm bg-brand-600 active:bg-brand-700 ${valid && !isPending ? "" : "opacity-50"}`}
            >
              <Text className="text-sm font-semibold text-white">
                {isPending ? "Building scenario…" : "Start roleplay"}
              </Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}
