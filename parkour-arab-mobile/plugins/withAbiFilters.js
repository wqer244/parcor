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
// this writes `reactNativeArchitectures=...` into android/gradle.properties,
// which is precisely the mechanism the template already reads. This is
// also the officially documented way React Native itself recommends for
// controlling which architectures get built.
//
// v3 — temporarily widened to 4 architectures while chasing a crash-on-join
// bug, on the theory that it might be an ABI/missing-native-lib issue.
//
// v4 — reverted back to arm64-v8a only. The bug report captured from the
// actual crash showed a completely different cause (an
// IllegalStateException from expo-gl's GLView failing to construct via
// reflection, due to ProGuard/R8 stripping its constructor — fixed
// separately in app.json's extraProguardRules). ABI was never the problem.
// arm64-v8a-only was assumed safe on the theory that "the overwhelming
// majority of Android phones sold since ~2017" use it — true, but that
// silently locked out every OLDER or lower-end phone still on 32-bit ARM
// (armeabi-v7a), which is common on budget devices and anything from
// roughly pre-2017. The app simply can't install/run at all on those —
// there's no fallback, a missing native library is a hard crash, not a
// graceful degradation.
//
// v5 — armeabi-v7a added back. 32-bit ARM devices are exactly the "old,
// weak hardware" this app needs to support, and every native dependency
// here (Agora, expo-gl, Reanimated, Hermes) ships armeabi-v7a binaries, so
// there's no compatibility blocker — only APK size (roughly back up from
// ~⅓ to ~⅔ of the full 4-architecture size, still meaningfully smaller
// than shipping x86/x86_64 too, which only matter for emulators/Intel
// devices, not real old phones).
// ────────────────────────────────────────────────────────────────────────────
const { withGradleProperties } = require('@expo/config-plugins');

const ARCHITECTURES = ['arm64-v8a', 'armeabi-v7a'];
// If you ever need x86/x86_64 emulator support too (not needed for real
// old-device compatibility, only for testing on an Intel emulator), use:
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
