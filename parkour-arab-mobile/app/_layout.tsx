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

// ── Force LTR layout, regardless of the device's Arabic locale ──────────
// React Native auto-enables I18nManager.isRTL when the OS locale is a
// right-to-left language (Arabic included) — completely separate from
// what language the app's own text is in. Once RTL is on, it silently
// mirrors every `position: 'absolute'` view's `left`/`right` values and
// reverses every `flexDirection: 'row'` container. That's exactly what
// was stacking the game's top-right icon cluster (camera/settings/mic),
// the health bar, and the pickup/aim/attack button column all on top of
// each other on the SAME physical side of the screen — each of those was
// coded with a plain left/right offset, and RTL flipped all of them at
// once, independently of each other, so several unrelated HUD pieces
// collapsed into the same physical spot.
//
// A game's control layout (buttons, joystick, HUD) should stay fixed no
// matter what language is selected — mirroring it by locale wasn't a
// deliberate design choice here, just an unintended side effect of the
// device being set to Arabic. This turns that off app-wide; Arabic TEXT
// itself is untouched (that's plain string content, not layout
// direction) and still renders and reads correctly everywhere.
//
// NOTE: like any I18nManager change, this only fully applies after the
// app is completely closed and reopened (a hot reload during development
// is not enough) — that's a React Native/native-module limitation, not
// something a JS-only fix can work around.
if (I18nManager.isRTL) {
  I18nManager.allowRTL(false);
  I18nManager.forceRTL(false);
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
