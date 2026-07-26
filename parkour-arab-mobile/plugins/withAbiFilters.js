// ────────────────────────────────────────────────────────────────────────────
// Local Expo config plugin — controls which Android CPU architectures the
// native libraries (Agora's voice engine, expo-gl/three.js, Reanimated,
// Hermes, etc.) get built for.
//
// v2 — the previous version of this file edited android/app/build.gradle's
// `defaultConfig { ndk { abiFilters ... } }` block directly. That DIDN'T
// work: the stock React Native Gradle template sets abiFilters again,
// later in the same file, driven by a gradle property called
// `reactNativeArchitectures` — and that later assignment overwrote ours.
//
// The fix is to set that exact property instead of fighting the template:
// this writes `reactNativeArchitectures=arm64-v8a` into
// android/gradle.properties, which is precisely the mechanism the
// template already reads. This is also the officially documented way
// React Native itself recommends for shrinking APK size.
//
// v3 — temporarily widened to 4 architectures while chasing a crash-on-join
// bug, on the theory that it might be an ABI/missing-native-lib issue.
//
// v4 — reverted back to arm64-v8a only. The bug report captured from the
// actual crash showed a completely different cause (an
// IllegalStateException from expo-gl's GLView failing to construct via
// reflection, due to ProGuard/R8 stripping its constructor — fixed
// separately in app.json's extraProguardRules). ABI was never the problem.
// Every real device this has been tested on is arm64-v8a, which is true of
// the overwhelming majority of Android phones sold since ~2017, so keeping
// the build restricted to just that architecture is safe and keeps the APK
// ~⅓ the size. If testing on an x86_64 emulator or a very old 32-bit
// device ever becomes necessary again, add that architecture back here.
// ────────────────────────────────────────────────────────────────────────────
const { withGradleProperties } = require('@expo/config-plugins');

const ARCHITECTURES = ['arm64-v8a'];
// If you ever need 32-bit device or emulator support too, use e.g.:
// const ARCHITECTURES = ['arm64-v8a', 'armeabi-v7a', 'x86_64', 'x86'];

function withAbiFilters(config) {
  return withGradleProperties(config, (config) => {
    // Drop any pre-existing entry first so we don't end up with duplicates
    // across repeated `expo prebuild` runs.
    config.modResults = config.modResults.filter(
      (item) => !(item.type === 'property' && item.key === 'reactNativeArchitectures')
    );
    config.modResults.push({
      type: 'property',
      key: 'reactNativeArchitectures',
      value: ARCHITECTURES.join(','),
    });
    return config;
  });
}

module.exports = withAbiFilters;
