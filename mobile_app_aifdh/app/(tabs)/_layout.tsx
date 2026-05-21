import { Ionicons } from "@expo/vector-icons";
import { Redirect, Tabs } from "expo-router";
import React from "react";

import { HapticTab } from "@/components/haptic-tab";
import { useAuthStore } from "@/src/features/auth/store";
import { colors } from "@/src/shared/theme/tokens";

type TabIconProps = {
  color: string;
  focused: boolean;
};

export default function TabLayout() {
  const status = useAuthStore((s) => s.status);
  const isUnlocked = useAuthStore((s) => s.isUnlocked);
  const biometricEnrolled = useAuthStore((s) => s.biometricEnrolled);

  if (status !== "authenticated") {
    return <Redirect href="/(auth)/welcome" />;
  }
  if (!isUnlocked && biometricEnrolled) {
    return <Redirect href="/(auth)/unlock" />;
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarButton: HapticTab,
        tabBarActiveTintColor: colors.brand[600],
        tabBarInactiveTintColor: colors.ink.muted,
        tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
        tabBarStyle: {
          backgroundColor: colors.surface.base,
          borderTopColor: colors.surface.divider,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Today",
          tabBarIcon: ({ color, focused }: TabIconProps) => (
            <Ionicons
              name={focused ? "today" : "today-outline"}
              size={24}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="leads"
        options={{
          title: "Leads",
          tabBarIcon: ({ color, focused }: TabIconProps) => (
            <Ionicons
              name={focused ? "people" : "people-outline"}
              size={24}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="coaching"
        options={{
          title: "Coaching",
          tabBarIcon: ({ color, focused }: TabIconProps) => (
            <Ionicons
              name={focused ? "stats-chart" : "stats-chart-outline"}
              size={24}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          tabBarIcon: ({ color, focused }: TabIconProps) => (
            <Ionicons
              name={focused ? "settings" : "settings-outline"}
              size={24}
              color={color}
            />
          ),
        }}
      />
    </Tabs>
  );
}
