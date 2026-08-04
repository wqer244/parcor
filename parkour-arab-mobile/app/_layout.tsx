import React, { useEffect } from 'react';
import { I18nManager, Platform } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from '@expo-google-fonts/inter';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import * as ScreenOrientation from 'expo-screen-orientation';
import { PlayerProvider } from '@/context/PlayerContext';

SplashScreen.preventAutoHideAsync();

// ── Restore normal RTL auto-detection ────────────────────────────────
// A previous change here force-disabled RTL app-wide to try to fix a
// button-overlap bug — that turned out not to be the actual cause (the
// real bug was the PvP button cluster's layout, fixed directly in
// game.tsx), so forcing LTR was unnecessary and would have affected
// Arabic UI/text-alignment behavior elsewhere in the app that should
// stay RTL for Arabic users.
//
// I18nManager.allowRTL()/forceRTL() persist to native storage, so simply
// deleting that old code wouldn't have undone it — the device would keep
// booting in the forced LTR state from before. This explicitly restores
// the default: RTL follows the device's own locale again, same as if
// this app had never touched I18nManager at all.
//
// NOTE: like any I18nManager change, this only fully takes effect after
// the app is completely closed and reopened — that's a React Native/
// native-module limitation, not something a JS-only fix can work around.
if (!I18nManager.isRTL) {
  I18nManager.allowRTL(true);
}

// Lock the whole app to landscape at runtime. `app.json`'s "orientation":
// "landscape" only takes effect in a real prebuilt/EAS build — it is NOT
// always honored inside Expo Go during development, which is why the game
// could show up in portrait when testing on a phone. This call forces
// landscape in both Expo Go and the built APK.
function useLockLandscape() {
  useEffect(() => {
    if (Platform.OS === 'web') return;
    // NOTE: `LANDSCAPE` (unqualified) allows the OS to pick EITHER
    // landscape-left or landscape-right, and can flip between them as the
    // device physically rotates. That flip does not stay in sync with our
    // manual touch hit-testing in GameControls, which is why the D-pad and
    // jump button could end up swapped (walk -> jump, jump -> walk).
    // Locking to a single specific direction fixes that permanently.
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE_RIGHT).catch(() => {});
  }, []);
}

const queryClient = new QueryClient();

function RootLayoutNav() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="servers" options={{ headerShown: false }} />
      <Stack.Screen name="game" options={{ headerShown: false }} />
    </Stack>
  );
}

export default function RootLayout() {
  useLockLandscape();

  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <GestureHandlerRootView style={{ flex: 1 }}>
            <KeyboardProvider>
              <PlayerProvider>
                <RootLayoutNav />
              </PlayerProvider>
            </KeyboardProvider>
          </GestureHandlerRootView>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
