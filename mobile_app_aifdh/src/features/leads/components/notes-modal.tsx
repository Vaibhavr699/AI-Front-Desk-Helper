import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
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

import { useUpdateCustomer } from "@/src/features/customers/queries";
import { colors } from "@/src/shared/theme/tokens";

type Props = {
  leadId: string;
  initialNotes: string | null;
  visible: boolean;
  onClose: () => void;
};

export function NotesModal({ leadId, initialNotes, visible, onClose }: Props) {
  const [value, setValue] = useState(initialNotes ?? "");
  const [error, setError] = useState<string | null>(null);
  const { mutateAsync, isPending } = useUpdateCustomer();

  useEffect(() => {
    if (visible) setValue(initialNotes ?? "");
  }, [visible, initialNotes]);

  async function save() {
    if (isPending) return;
    setError(null);
    try {
      await mutateAsync({ id: leadId, input: { notes: value.trim() } });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the note.");
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
          <Text className="text-lg font-semibold text-ink-primary">Note</Text>
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
            <TextInput
              value={value}
              onChangeText={setValue}
              multiline
              autoFocus
              placeholder="Add a note about this customer…"
              placeholderTextColor={colors.ink.dim}
              textAlignVertical="top"
              className="min-h-[160px] flex-1 rounded-sm border border-surface-border bg-white px-4 py-3 text-base text-ink-primary"
            />
            {error ? <Text className="text-sm text-red-600">{error}</Text> : null}
            <Pressable
              onPress={save}
              disabled={isPending}
              accessibilityRole="button"
              accessibilityLabel="Save note"
              className={`h-12 items-center justify-center rounded-sm bg-brand-600 active:bg-brand-700 ${isPending ? "opacity-50" : ""}`}
            >
              <Text className="text-sm font-semibold text-white">
                {isPending ? "Saving…" : "Save note"}
              </Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}
