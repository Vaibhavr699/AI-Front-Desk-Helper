import { forwardRef } from "react";
import { Text, TextInput, View, type TextInputProps } from "react-native";

type Props = TextInputProps & {
  label?: string;
  error?: string | null;
};

export const FormField = forwardRef<TextInput, Props>(function FormField(
  { label, error, className, ...rest },
  ref,
) {
  const borderClass = error ? "border-red-500" : "border-slate-300";
  return (
    <View className="w-full">
      {label ? (
        <Text className="mb-2 text-sm font-medium text-slate-700">{label}</Text>
      ) : null}
      <TextInput
        ref={ref}
        placeholderTextColor="#94a3b8"
        className={`h-12 w-full rounded-xl border ${borderClass} bg-white px-4 text-base text-slate-900 ${className ?? ""}`}
        {...rest}
      />
      {error ? <Text className="mt-1 text-sm text-red-600">{error}</Text> : null}
    </View>
  );
});
