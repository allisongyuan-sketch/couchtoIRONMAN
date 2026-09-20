import { useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as SplashScreen from 'expo-splash-screen';
import { colors } from '@/ui/theme';
import { useSessionStore } from '@/state/sessionStore';
import { useLibraryStore } from '@/state/libraryStore';

void SplashScreen.preventAutoHideAsync();

/**
 * TanStack Query is configured but deliberately under-used in the MVP: all data is
 * local, so there is no server state to cache yet. It is wired now so that adding a
 * synced backend later does not mean restructuring how screens fetch.
 */
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

export default function RootLayout() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    async function bootstrap() {
      // Restore an interrupted workout before the first screen paints, so a user who
      // force-quit mid-set is offered Resume rather than a blank Home (PRD §23).
      await Promise.all([
        useSessionStore.getState().restore(),
        useLibraryStore.getState().load(),
      ]);
      setReady(true);
      await SplashScreen.hideAsync();
    }
    void bootstrap();
  }, []);

  if (!ready) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <StatusBar style="light" />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: colors.background },
              animation: 'slide_from_right',
            }}
          >
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="onboarding" options={{ animation: 'fade' }} />
            <Stack.Screen name="session/active" options={{ gestureEnabled: false }} />
            <Stack.Screen
              name="session/complete"
              options={{ gestureEnabled: false, animation: 'fade' }}
            />
          </Stack>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
