import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { colors } from "@/src/shared/theme/tokens";

import { useCreateCustomer } from "../queries";

export function CreateCustomerScreen() {
  const router = useRouter();
  const create = useCreateCustomer();

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [projectType, setProjectType] = useState("");
  const [estimatedValue, setEstimatedValue] = useState("");
  const [notes, setNotes] = useState("");

  async function handleSave() {
    if (!name.trim() || !phone.trim()) {
      Alert.alert("Missing info", "Name and phone are required.");
      return;
    }
    try {
      const result = await create.mutateAsync({
        name: name.trim(),
        phone: phone.trim(),
        email: email.trim() || undefined,
        address: address.trim() || undefined,
        project_type: projectType.trim() || undefined,
        estimated_value: estimatedValue ? parseFloat(estimatedValue) : undefined,
        notes: notes.trim() || undefined,
        source: "rep_manual",
      });
      if (!result.created) {
        Alert.alert("Existing customer", "A customer with this phone number already exists. We've updated their info.");
      }
      router.back();
    } catch (err) {
      Alert.alert("Error", err instanceof Error ? err.message : "Could not save customer.");
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-surface-base" edges={["top"]}>
      <View className="flex-row items-center gap-3 border-b border-surface-divider px-5 py-3">
        <Pressable onPress={() => router.back()} hitSlop={12} className="h-9 w-9 items-center justify-center rounded-lg active:bg-surface-raised">
          <Ionicons name="close" size={22} color={colors.ink.secondary} />
        </Pressable>
        <Text className="flex-1 text-lg font-semibold text-ink-primary">New Customer</Text>
        <Pressable
          onPress={handleSave}
          disabled={create.isPending}
          className="rounded-lg bg-brand-600 px-4 py-2 active:bg-brand-700"
        >
          <Text className="text-sm font-semibold text-white">
            {create.isPending ? "Saving..." : "Save"}
          </Text>
        </Pressable>
      </View>

      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView contentContainerClassName="px-5 py-6 gap-5">
          <View className="gap-4">
            <Field label="Name" value={name} onChange={setName} placeholder="Mike Johnson" required />
            <Field label="Phone" value={phone} onChange={setPhone} placeholder="(402) 555-1234" keyboardType="phone-pad" required />
            <Field label="Email" value={email} onChange={setEmail} placeholder="mike@email.com" keyboardType="email-address" />
            <Field label="Address" value={address} onChange={setAddress} placeholder="123 Oak Street, Lincoln, NE" />
            <Field label="Project type" value={projectType} onChange={setProjectType} placeholder="Interior painting" />
            <Field label="Estimated value ($)" value={estimatedValue} onChange={setEstimatedValue} placeholder="2500" keyboardType="numeric" />
            <View className="gap-1.5">
              <Text className="text-sm font-medium text-ink-secondary">Notes</Text>
              <TextInput
                value={notes}
                onChangeText={setNotes}
                placeholder="Any details about this customer..."
                placeholderTextColor={colors.ink.dim}
                multiline
                numberOfLines={4}
                textAlignVertical="top"
                className="min-h-[100px] rounded-sm border border-surface-border bg-white px-4 py-3 text-sm text-ink-primary"
              />
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  keyboardType,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  keyboardType?: "default" | "phone-pad" | "email-address" | "numeric";
  required?: boolean;
}) {
  return (
    <View className="gap-1.5">
      <View className="flex-row items-center gap-1">
        <Text className="text-sm font-medium text-ink-secondary">{label}</Text>
        {required && <Text className="text-xs text-red-500">*</Text>}
      </View>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.ink.dim}
        keyboardType={keyboardType || "default"}
        className="h-12 rounded-sm border border-surface-border bg-white px-4 text-sm text-ink-primary"
      />
    </View>
  );
}
