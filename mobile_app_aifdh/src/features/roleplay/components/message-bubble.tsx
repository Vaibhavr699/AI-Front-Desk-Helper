import { Ionicons } from "@expo/vector-icons";
import { memo } from "react";
import { Pressable, Text, View } from "react-native";

import { colors } from "@/src/shared/theme/tokens";

import type { RoleplayTranscriptTurn } from "../types";

type Props = {
  turn: RoleplayTranscriptTurn;
  onPlay?: (text: string) => void;
};

function MessageBubbleBase({ turn, onPlay }: Props) {
  const isRep = turn.role === "rep";
  return (
    <View
      className={`mb-2 w-full flex-row ${isRep ? "justify-end" : "justify-start"}`}
    >
      <View
        className={
          isRep
            ? "max-w-[80%] rounded-sm rounded-br-md bg-brand-600 px-4 py-3"
            : "max-w-[80%] rounded-sm rounded-bl-md border border-surface-border bg-white px-4 py-3"
        }
      >
        <View className="flex-row items-center justify-between gap-3">
          <Text
            className={`text-[10px] font-semibold uppercase tracking-wider ${isRep ? "text-blue-100" : "text-ink-muted"}`}
          >
            {isRep ? "You" : "Customer"}
          </Text>
          {!isRep && onPlay ? (
            <Pressable
              onPress={() => onPlay(turn.text)}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Play customer line"
              className="h-6 w-6 items-center justify-center rounded-full active:bg-surface-raised"
            >
              <Ionicons
                name="volume-medium"
                size={15}
                color={colors.brand[600]}
              />
            </Pressable>
          ) : null}
        </View>
        <Text
          className={`mt-1 text-base leading-relaxed ${isRep ? "text-white" : "text-ink-primary"}`}
        >
          {turn.text}
        </Text>
      </View>
    </View>
  );
}

export const MessageBubble = memo(MessageBubbleBase);

export function TypingBubble() {
  return (
    <View className="mb-2 w-full flex-row justify-start">
      <View className="rounded-sm rounded-bl-md border border-surface-border bg-white px-5 py-4">
        <View className="flex-row items-center gap-1">
          <View className="h-2 w-2 rounded-full bg-ink-dim" />
          <View className="h-2 w-2 rounded-full bg-ink-muted" />
          <View className="h-2 w-2 rounded-full bg-ink-dim" />
        </View>
      </View>
    </View>
  );
}
