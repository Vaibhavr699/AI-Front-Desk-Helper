import '../global.css';

import { DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { QueryClientProvider } from '@tanstack/react-query';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useAuthStore } from '@/src/features/auth/store';
import { initSyncManager } from '@/src/features/field-recording/offline/sync-manager';
import {
  ensureNotificationHandler,
  registerForPushNotifications,
} from '@/src/features/notifications/manager';
import { queryClient } from '@/src/shared/api/query-client';
import { colors } from '@/src/shared/theme/tokens';

const navTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: colors.surface.base,
    card: colors.surface.base,
    border: colors.surface.divider,
    text: colors.ink.primary,
    primary: colors.brand[600],
  },
};

const isExpoGo =
  Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

if (!isExpoGo) {
  ensureNotificationHandler();
}

export default function RootLayout() {
  const router = useRouter();
  const hydrate = useAuthStore((s) => s.hydrate);
  const status = useAuthStore((s) => s.status);
  const isUnlocked = useAuthStore((s) => s.isUnlocked);
  const userId = useAuthStore((s) => s.user?.id ?? null);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    initSyncManager();
  }, []);

  useEffect(() => {
    if (status !== 'authenticated' || !isUnlocked || !userId) return;
    registerForPushNotifications();
  }, [status, isUnlocked, userId]);

  useEffect(() => {
    if (isExpoGo) return;
    try {
      const sub = Notifications.addNotificationResponseReceivedListener(
        (response) => {
          const data = response.notification.request.content.data as
            | { deep_link?: unknown }
            | undefined;
          if (typeof data?.deep_link === 'string' && data.deep_link.length > 0) {
            router.push(data.deep_link as never);
          }
        },
      );
      return () => sub.remove();
    } catch {
      // expo-notifications remote APIs are unavailable in Expo Go (SDK 53+)
    }
  }, [router]);

  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        <ThemeProvider value={navTheme}>
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: colors.surface.base },
            }}
          >
            <Stack.Screen name="index" />
            <Stack.Screen name="(auth)" />
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="in-home" options={{ animation: 'fade' }} />
            <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
          </Stack>
          <StatusBar style="dark" />
        </ThemeProvider>
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}
