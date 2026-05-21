import { Ionicons } from "@expo/vector-icons";
import { Linking, Pressable, Text, View } from "react-native";

import { APP_VERSION } from "@/src/config/env";
import { colors } from "@/src/shared/theme/tokens";

const SUPPORT_EMAIL = "support@aifrontdeskhelper.com";

export function SupportCard() {
  function contact() {
    Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=AI%20Front%20Desk%20Helper%20support`);
  }

  return (
    <View className="gap-3 rounded-2xl border border-surface-border bg-white p-5">
      <Text className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
        Support
      </Text>
      <Pressable
        onPress={contact}
        className="flex-row items-center gap-3 rounded-xl px-2 py-2 active:bg-surface-raised"
      >
        <View className="h-9 w-9 items-center justify-center rounded-lg bg-brand-50">
          <Ionicons name="mail-outline" size={16} color={colors.brand[700]} />
        </View>
        <View className="flex-1 gap-0.5">
          <Text className="text-sm font-semibold text-ink-primary">
            Contact support
          </Text>
          <Text className="text-xs text-ink-muted">{SUPPORT_EMAIL}</Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={colors.ink.muted} />
      </Pressable>
      <View className="border-t border-surface-divider pt-3">
        <Text className="text-xs text-ink-dim">
          AI Front Desk Helper · v{APP_VERSION}
        </Text>
      </View>
    </View>
  );
}
