import { type PropsWithChildren } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

type Props = PropsWithChildren<{
  scrollable?: boolean;
  className?: string;
  contentClassName?: string;
}>;

export function ScreenContainer({
  children,
  scrollable = false,
  className,
  contentClassName,
}: Props) {
  const wrapperClass = `flex-1 bg-white ${className ?? ""}`;
  return (
    <SafeAreaView className={wrapperClass}>
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {scrollable ? (
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerClassName={`flex-grow ${contentClassName ?? ""}`}
          >
            {children}
          </ScrollView>
        ) : (
          <View className={`flex-1 ${contentClassName ?? ""}`}>{children}</View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
