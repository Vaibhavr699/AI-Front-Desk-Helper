import { Ionicons } from "@expo/vector-icons";
import { forwardRef, useState } from "react";
import {
  Pressable,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";

import { colors } from "@/src/shared/theme/tokens";

type Props = TextInputProps & {
  label?: string;
  error?: string | null;
};

export const PasswordInput = forwardRef<TextInput, Props>(function PasswordInput(
  { label, error, className, ...rest },
  ref,
) {
  const [visible, setVisible] = useState(false);
  const borderClass = error ? "border-red-500" : "border-surface-border";

  return (
    <View className="w-full">
      {label ? (
        <Text className="mb-2 text-sm font-medium text-ink-secondary">
          {label}
        </Text>
      ) : null}
      <View className="relative">
        <TextInput
          ref={ref}
          placeholderTextColor={colors.ink.dim}
          selectionColor={colors.brand[500]}
          secureTextEntry={!visible}
          className={`h-14 w-full rounded-xl border ${borderClass} bg-surface-input pl-4 pr-12 text-base text-ink-primary ${className ?? ""}`}
          {...rest}
        />
        <Pressable
          onPress={() => setVisible((v) => !v)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={visible ? "Hide password" : "Show password"}
          className="absolute inset-y-0 right-3 items-center justify-center"
        >
          <Ionicons
            name={visible ? "eye-off-outline" : "eye-outline"}
            size={22}
            color={colors.ink.muted}
          />
        </Pressable>
      </View>
      {error ? (
        <Text className="mt-1 text-sm text-red-600">{error}</Text>
      ) : null}
    </View>
  );
});
