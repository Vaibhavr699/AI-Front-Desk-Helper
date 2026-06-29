import { Text, View } from "react-native";

type Props = {
  message?: string | null;
};

export function ErrorBanner({ message }: Props) {
  if (!message) return null;
  return (
    <View className="w-full rounded-xl border border-red-200 bg-red-50 px-4 py-3">
      <Text className="text-sm text-red-700">{message}</Text>
    </View>
  );
}
