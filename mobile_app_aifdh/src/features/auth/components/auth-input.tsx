import { forwardRef } from "react";
import { Text, TextInput, View, type TextInputProps } from "react-native";

import { colors } from "@/src/shared/theme/tokens";

type Props = TextInputProps & {
  label?: string;
  error?: string | null;
};

export const AuthInput = forwardRef<TextInput, Props>(function AuthInput(
  { label, error, className, ...rest },
  ref,
) {
  const borderClass = error ? "border-red-500" : "border-surface-border";
  return (
    <View className="w-full">
      {label ? (
        <Text className="mb-2 text-sm font-medium text-ink-secondary">
          {label}
        </Text>
      ) : null}
      <TextInput
        ref={ref}
        placeholderTextColor={colors.ink.dim}
        selectionColor={colors.brand[500]}
        className={`h-14 w-full rounded-xl border ${borderClass} bg-surface-input px-4 text-base text-ink-primary ${className ?? ""}`}
        {...rest}
      />
      {error ? (
        <Text className="mt-1 text-sm text-red-600">{error}</Text>
      ) : null}
    </View>
  );
});
