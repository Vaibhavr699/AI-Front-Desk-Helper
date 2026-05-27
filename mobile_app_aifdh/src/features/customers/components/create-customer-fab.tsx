import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Pressable, Text, View } from "react-native";

export function CreateCustomerFab() {
  const router = useRouter();

  return (
    <View className="absolute bottom-6 right-5">
      <Pressable
        onPress={() => router.push("/(tabs)/leads/create" as never)}
        className="flex-row items-center gap-2 rounded-sm bg-brand-600 px-5 py-3.5 shadow-lg active:bg-brand-700"
        style={{ shadowColor: "#2563eb", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 6 }}
      >
        <Ionicons name="add" size={20} color="#fff" />
        <Text className="text-sm font-semibold text-white">Add Customer</Text>
      </Pressable>
    </View>
  );
}
