// ────────────────────────────────────────────────────────────────────────────
// Local Expo config plugin — controls which Android CPU architectures the
// native libraries (Agora's voice engine, expo-gl/three.js, Reanimated,
// Hermes, etc.) get built for.
//
// By default React Native/EAS builds a "universal" APK bundling native code
// for FOUR processor architectures (arm64-v8a, armeabi-v7a, x86, x86_64).
// That's the safe, crash-proof default and is what this plugin currently
// sets. An earlier version of this file restricted it to arm64-v8a only to
// shrink the APK — but that meant the app hard-crashed (closed completely,
// no JS error screen) on any device/emulator that isn't arm64-v8a, because
// the native .so files those modules need simply weren't in the build.
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
// ────────────────────────────────────────────────────────────────────────────
const { withGradleProperties } = require('@expo/config-plugins');

// v3 — was 'arm64-v8a' only. That caused a hard native crash (app closes
// completely, no JS error screen — UnsatisfiedLinkError under the hood)
// the instant the game screen tried to load a native module (Agora's
// voice engine, expo-gl/three.js's GL bindings, Reanimated) on ANY device
// or emulator that isn't arm64-v8a specifically:
//   - Android Studio emulators default to x86_64
//   - many budget/older phones are still 32-bit (armeabi-v7a)
// Building all four common architectures avoids that crash everywhere,
// at the cost of a larger APK. Once you've confirmed exactly which
// architecture(s) your real test/release devices use, you can trim this
// back down — just make sure it always includes whatever you're
// currently testing on.
const ARCHITECTURES = ['arm64-v8a', 'armeabi-v7a', 'x86_64', 'x86'];

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
