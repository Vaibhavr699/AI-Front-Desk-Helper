import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import {
  FlatList,
  Modal,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { colors } from "@/src/shared/theme/tokens";

import { US_STATES, type StateOption } from "../consent-states";

type Props = {
  value: string | null;
  onChange: (code: string) => void;
  title?: string;
};

export function StatePicker({ value, onChange, title = "Visit state" }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const selected = US_STATES.find((s) => s.code === value);
  const filtered = search
    ? US_STATES.filter((s) =>
        s.name.toLowerCase().includes(search.toLowerCase()) ||
        s.code.toLowerCase().includes(search.toLowerCase()),
      )
    : US_STATES;

  function pick(state: StateOption) {
    onChange(state.code);
    setOpen(false);
    setSearch("");
  }

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        className="flex-row items-center justify-between rounded-xl border border-surface-border bg-white px-4 py-3 active:bg-surface-raised"
      >
        <Text
          className={`text-base ${selected ? "text-ink-primary" : "text-ink-muted"}`}
        >
          {selected ? `${selected.name} (${selected.code})` : "Choose state…"}
        </Text>
        <Ionicons name="chevron-down" size={18} color={colors.ink.muted} />
      </Pressable>

      <Modal
        visible={open}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setOpen(false)}
      >
        <SafeAreaView className="flex-1 bg-surface-base">
          <View className="flex-row items-center justify-between border-b border-surface-divider px-4 py-3">
            <Text className="text-lg font-semibold text-ink-primary">
              {title}
            </Text>
            <Pressable
              onPress={() => setOpen(false)}
              hitSlop={12}
              className="h-9 w-9 items-center justify-center rounded-full active:bg-surface-raised"
            >
              <Ionicons name="close" size={22} color={colors.ink.secondary} />
            </Pressable>
          </View>

          <View className="px-4 py-3">
            <View className="flex-row items-center gap-2 rounded-sm border border-surface-border bg-white px-3">
              <Ionicons name="search-outline" size={18} color={colors.ink.muted} />
              <TextInput
                value={search}
                onChangeText={setSearch}
                placeholder="Search state"
                placeholderTextColor={colors.ink.dim}
                autoCapitalize="words"
                autoCorrect={false}
                className="h-11 flex-1 text-base text-ink-primary"
              />
            </View>
          </View>

          <FlatList
            data={filtered}
            keyExtractor={(s) => s.code}
            renderItem={({ item }) => (
              <Pressable
                onPress={() => pick(item)}
                className="flex-row items-center justify-between border-b border-surface-divider px-4 py-3 active:bg-surface-raised"
              >
                <Text className="text-base text-ink-primary">{item.name}</Text>
                <Text className="text-sm text-ink-muted">{item.code}</Text>
              </Pressable>
            )}
          />
        </SafeAreaView>
      </Modal>
    </>
  );
}
